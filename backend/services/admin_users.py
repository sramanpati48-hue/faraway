"""Admin user management mutations (patch status/role, reset password, delete)."""
from __future__ import annotations

import json
from typing import Any, Optional

from argon2 import PasswordHasher

from backend.database.auth_service import normalize_email, normalize_mobile
from backend.database.postgres_pool import execute_one, execute_void, is_postgres_configured
from backend.services import admin_cases

ph = PasswordHasher()

ALLOWED_ROLES = {"victim", "sahayak", "lawyer", "moderator", "admin", "super_admin"}
ALLOWED_STATUSES = {"active", "disabled", "pending_reset"}
PRIVILEGED_ROLES = {"admin", "super_admin"}
MIN_PASSWORD_LEN = 8


class AdminUserError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _audit(actor_id: Optional[str], action: str, detail: dict) -> None:
    try:
        execute_void(
            """
            INSERT INTO admin_audit_logs (actor_user_id, action, target_table, detail)
            VALUES (%s, %s, %s, %s::jsonb)
            """,
            (actor_id, action, "users", json.dumps(detail, default=str)),
        )
    except Exception:
        pass


def _load_user(user_id: str) -> dict[str, Any]:
    if not is_postgres_configured() or not user_id:
        raise AdminUserError("User not found", 404)
    row = execute_one(
        """
        SELECT id, email, mobile, display_name, role, status, firebase_uid,
               password_reset_required, failed_login_attempts, locked_until,
               created_at, updated_at
        FROM public.users
        WHERE id::text = %s OR firebase_uid = %s
        LIMIT 1
        """,
        (user_id, user_id),
    )
    if not row:
        raise AdminUserError("User not found", 404)
    return row


def _actor_role(actor: dict[str, Any]) -> str:
    return str(actor.get("role") or "").lower()


def _is_self(actor: dict[str, Any], target: dict[str, Any]) -> bool:
    return bool(actor.get("id")) and str(actor.get("id")) == str(target.get("id"))


def _guard_privileged_target(actor: dict[str, Any], target: dict[str, Any]) -> None:
    target_role = str(target.get("role") or "").lower()
    if target_role in PRIVILEGED_ROLES and _actor_role(actor) != "super_admin":
        raise AdminUserError("Only super_admin can modify admin accounts", 403)


def _count_super_admins() -> int:
    row = execute_one(
        "SELECT COUNT(*)::int AS total FROM public.users WHERE role = 'super_admin'"
    )
    return int((row or {}).get("total") or 0)


def _serialize_user(row: dict[str, Any]) -> dict[str, Any]:
    item = admin_cases._serialize(row) or {}
    item["case_scope"] = admin_cases._case_scope(item.get("role"))
    return item


def create_user(
    actor: dict[str, Any],
    *,
    email: Optional[str] = None,
    mobile: Optional[str] = None,
    password: str,
    role: str = "victim",
    display_name: Optional[str] = None,
) -> dict[str, Any]:
    """Create an active user. Any admin may assign any ALLOWED_ROLES value."""
    if not is_postgres_configured():
        raise AdminUserError("Postgres is required", 503)

    email_n = normalize_email(email)
    mobile_n = normalize_mobile(mobile)
    if not email_n and not mobile_n:
        raise AdminUserError("Email or mobile is required")
    if not password or len(password) < MIN_PASSWORD_LEN:
        raise AdminUserError(f"Password must be at least {MIN_PASSWORD_LEN} characters")

    role_n = (role or "victim").strip().lower()
    if role_n not in ALLOWED_ROLES:
        raise AdminUserError(f"Invalid role. Allowed: {', '.join(sorted(ALLOWED_ROLES))}")

    if email_n and execute_one("SELECT id FROM users WHERE email_normalized = %s", (email_n,)):
        raise AdminUserError("Email already registered", 409)
    if mobile_n and execute_one("SELECT id FROM users WHERE mobile_normalized = %s", (mobile_n,)):
        raise AdminUserError("Mobile already registered", 409)

    name = (display_name or "").strip() or None
    password_hash = ph.hash(password)
    row = execute_one(
        """
        INSERT INTO public.users (
            email, mobile, password_hash, role, status, password_reset_required, display_name
        )
        VALUES (%s, %s, %s, %s, 'active', false, %s)
        RETURNING id, email, mobile, display_name, role, status, firebase_uid,
                  password_reset_required, failed_login_attempts, locked_until,
                  created_at, updated_at
        """,
        (email_n, mobile_n, password_hash, role_n, name),
    )
    if not row:
        raise AdminUserError("Failed to create user", 500)

    _audit(
        str(actor.get("id")),
        "admin_create_user",
        {"user_id": str(row["id"]), "role": role_n, "email": email_n, "mobile": mobile_n},
    )
    return {"success": True, "user": _serialize_user(row)}


def patch_user(
    user_id: str,
    actor: dict[str, Any],
    *,
    status: Optional[str] = None,
    role: Optional[str] = None,
    display_name: Optional[str] = None,
) -> dict[str, Any]:
    target = _load_user(user_id)
    _guard_privileged_target(actor, target)

    updates: list[str] = []
    params: list[Any] = []
    changes: dict[str, Any] = {}

    if status is not None:
        status_n = status.strip().lower()
        if status_n not in ALLOWED_STATUSES:
            raise AdminUserError(f"Invalid status. Allowed: {', '.join(sorted(ALLOWED_STATUSES))}")
        if status_n == "disabled":
            if _is_self(actor, target):
                raise AdminUserError("You cannot disable your own account", 400)
            if str(target.get("role")).lower() == "super_admin" and _count_super_admins() <= 1:
                raise AdminUserError("Cannot disable the last super_admin", 400)
        updates.append("status = %s")
        params.append(status_n)
        changes["status"] = status_n
        if status_n == "active":
            updates.append("failed_login_attempts = 0")
            updates.append("locked_until = NULL")

    if role is not None:
        role_n = role.strip().lower()
        if role_n not in ALLOWED_ROLES:
            raise AdminUserError(f"Invalid role. Allowed: {', '.join(sorted(ALLOWED_ROLES))}")
        if _is_self(actor, target) and role_n != str(target.get("role")).lower():
            raise AdminUserError("You cannot change your own role", 400)
        if (
            str(target.get("role")).lower() == "super_admin"
            and role_n != "super_admin"
            and _count_super_admins() <= 1
        ):
            raise AdminUserError("Cannot demote the last super_admin", 400)
        if role_n in PRIVILEGED_ROLES and _actor_role(actor) != "super_admin":
            raise AdminUserError("Only super_admin can assign admin roles", 403)
        updates.append("role = %s")
        params.append(role_n)
        changes["role"] = role_n

    if display_name is not None:
        name = display_name.strip() or None
        updates.append("display_name = %s")
        params.append(name)
        changes["display_name"] = name

    if not updates:
        raise AdminUserError("No changes provided")

    updates.append("updated_at = now()")
    params.append(str(target["id"]))
    execute_void(
        f"UPDATE public.users SET {', '.join(updates)} WHERE id = %s::uuid",
        tuple(params),
    )
    _audit(str(actor.get("id")), "user_patch", {"user_id": str(target["id"]), **changes})
    return {"user": _serialize_user(_load_user(str(target["id"])))}


def reset_password(user_id: str, actor: dict[str, Any], new_password: str) -> dict[str, Any]:
    if not new_password or len(new_password) < MIN_PASSWORD_LEN:
        raise AdminUserError(f"Password must be at least {MIN_PASSWORD_LEN} characters")

    target = _load_user(user_id)
    _guard_privileged_target(actor, target)

    password_hash = ph.hash(new_password)
    execute_void(
        """
        UPDATE public.users
        SET password_hash = %s,
            password_reset_required = false,
            status = 'active',
            failed_login_attempts = 0,
            locked_until = NULL,
            updated_at = now()
        WHERE id = %s
        """,
        (password_hash, target["id"]),
    )
    execute_void(
        """
        UPDATE public.refresh_tokens
        SET revoked_at = now()
        WHERE user_id = %s AND revoked_at IS NULL
        """,
        (target["id"],),
    )
    _audit(
        str(actor.get("id")),
        "user_reset_password",
        {"user_id": str(target["id"])},
    )
    return {
        "ok": True,
        "message": "Password updated. Existing sessions were revoked.",
        "user": _serialize_user(_load_user(str(target["id"]))),
    }


def delete_user(user_id: str, actor: dict[str, Any]) -> dict[str, Any]:
    target = _load_user(user_id)
    _guard_privileged_target(actor, target)

    if _is_self(actor, target):
        raise AdminUserError("You cannot delete your own account", 400)
    if str(target.get("role")).lower() == "super_admin" and _count_super_admins() <= 1:
        raise AdminUserError("Cannot delete the last super_admin", 400)

    tid = str(target["id"])
    execute_void("DELETE FROM public.users WHERE id = %s::uuid", (tid,))
    _audit(
        str(actor.get("id")),
        "user_delete",
        {
            "user_id": tid,
            "email": target.get("email"),
            "mobile": target.get("mobile"),
            "role": target.get("role"),
        },
    )
    return {"ok": True, "deleted_id": tid}
