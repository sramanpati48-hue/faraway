"""Local JWT authentication (email or mobile + password)."""
from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from dotenv import load_dotenv

from backend.database.postgres_pool import execute, execute_one, execute_void, is_postgres_configured

load_dotenv()

ph = PasswordHasher()
JWT_SECRET = os.getenv("JWT_SECRET", "dev-change-me-nyaysahayak-jwt-secret")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.getenv("JWT_ACCESS_MINUTES", "30"))
REFRESH_TOKEN_DAYS = int(os.getenv("JWT_REFRESH_DAYS", "14"))
# Absolute admin/super_admin session lifetime from login (refresh cannot extend past this).
ADMIN_SESSION_HOURS = int(os.getenv("ADMIN_SESSION_HOURS", "6"))
ADMIN_ROLES = frozenset({"admin", "super_admin"})
RESET_CODE_HOURS = int(os.getenv("RESET_CODE_HOURS", "24"))
MAX_FAILED_LOGINS = int(os.getenv("MAX_FAILED_LOGINS", "8"))


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def normalize_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    value = email.strip().lower()
    return value or None


def normalize_mobile(mobile: Optional[str]) -> Optional[str]:
    if not mobile:
        return None
    digits = "".join(ch for ch in mobile.strip() if ch.isdigit() or ch == "+")
    return digits or None


def _find_user_by_identifier(identifier: str) -> Optional[dict[str, Any]]:
    email = normalize_email(identifier)
    mobile = normalize_mobile(identifier)
    if email and "@" in identifier:
        return execute_one(
            "SELECT * FROM users WHERE email_normalized = %s LIMIT 1",
            (email,),
        )
    if mobile:
        return execute_one(
            "SELECT * FROM users WHERE mobile_normalized = %s LIMIT 1",
            (mobile,),
        )
    # try both
    return execute_one(
        """
        SELECT * FROM users
        WHERE email_normalized = %s OR mobile_normalized = %s
        LIMIT 1
        """,
        (email, mobile),
    )


def _public_user(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "uid": str(row.get("firebase_uid") or row["id"]),
        "email": row.get("email"),
        "mobile": row.get("mobile"),
        "role": row.get("role") or "victim",
        "status": row.get("status"),
        "password_reset_required": bool(row.get("password_reset_required")),
        "display_name": row.get("display_name"),
    }


def _issue_tokens(
    user: dict[str, Any],
    user_agent: str | None = None,
    ip: str | None = None,
    *,
    session_expires_at: datetime | None = None,
) -> dict[str, Any]:
    now = _utcnow()
    role = str(user.get("role") or "victim").lower()
    is_admin = role in ADMIN_ROLES

    if is_admin:
        # Absolute session window: login + ADMIN_SESSION_HOURS (default 6h).
        sess_exp = session_expires_at or (now + timedelta(hours=ADMIN_SESSION_HOURS))
        if getattr(sess_exp, "tzinfo", None) is None:
            sess_exp = sess_exp.replace(tzinfo=timezone.utc)
        if sess_exp <= now:
            raise AuthError("Admin session expired", 401)
        remaining = sess_exp - now
        # Access token lasts until the session ends (capped at the admin session window).
        access_ttl = min(remaining, timedelta(hours=ADMIN_SESSION_HOURS))
        refresh_expires_at = sess_exp
    else:
        access_ttl = timedelta(minutes=ACCESS_TOKEN_MINUTES)
        refresh_expires_at = now + timedelta(days=REFRESH_TOKEN_DAYS)
        sess_exp = None

    access_payload: dict[str, Any] = {
        "sub": str(user["id"]),
        "uid": str(user.get("firebase_uid") or user["id"]),
        "role": user.get("role") or "victim",
        "email": user.get("email"),
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + access_ttl).timestamp()),
    }
    if sess_exp is not None:
        access_payload["session_exp"] = int(sess_exp.timestamp())

    access_token = jwt.encode(access_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    refresh_raw = secrets.token_urlsafe(48)
    refresh_hash = _hash_token(refresh_raw)
    execute_void(
        """
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (user["id"], refresh_hash, refresh_expires_at, user_agent, ip),
    )
    return {
        "access_token": access_token,
        "refresh_token": refresh_raw,
        "token_type": "bearer",
        "expires_in": int(access_ttl.total_seconds()),
        "user": _public_user(user),
    }


def _audit(user_id: Optional[str], event_type: str, detail: dict | None = None, ip: str | None = None) -> None:
    try:
        execute_void(
            """
            INSERT INTO auth_audit_events (user_id, event_type, detail, ip_address)
            VALUES (%s, %s, %s::jsonb, %s)
            """,
            (user_id, event_type, __import__("json").dumps(detail or {}), ip),
        )
    except Exception:
        pass


def register_user(
    *,
    email: Optional[str] = None,
    mobile: Optional[str] = None,
    password: str,
    role: str = "victim",
    display_name: Optional[str] = None,
) -> dict[str, Any]:
    if not is_postgres_configured():
        raise AuthError("Postgres is required for local auth", 503)
    email_n = normalize_email(email)
    mobile_n = normalize_mobile(mobile)
    if not email_n and not mobile_n:
        raise AuthError("Email or mobile is required")
    if not password or len(password) < 8:
        raise AuthError("Password must be at least 8 characters")
    public_roles = {"victim", "lawyer"}
    role_n = (role or "victim").strip().lower()
    if role_n not in public_roles:
        raise AuthError("Role must be victim or lawyer")
    if email_n and execute_one("SELECT id FROM users WHERE email_normalized = %s", (email_n,)):
        raise AuthError("Email already registered", 409)
    if mobile_n and execute_one("SELECT id FROM users WHERE mobile_normalized = %s", (mobile_n,)):
        raise AuthError("Mobile already registered", 409)
    password_hash = ph.hash(password)
    rows = execute(
        """
        INSERT INTO users (email, mobile, password_hash, role, status, password_reset_required, display_name)
        VALUES (%s, %s, %s, %s, 'active', false, %s)
        RETURNING *
        """,
        (email_n, mobile_n, password_hash, role_n, display_name),
    )
    user = rows[0]
    _audit(str(user["id"]), "register", {"role": role_n})
    return _issue_tokens(user)


def login(identifier: str, password: str, user_agent: str | None = None, ip: str | None = None) -> dict[str, Any]:
    if not is_postgres_configured():
        raise AuthError("Postgres is required for local auth", 503)
    user = _find_user_by_identifier(identifier)
    if not user:
        raise AuthError("Invalid credentials", 401)
    if user.get("status") == "disabled":
        raise AuthError("Account disabled", 403)
    locked_until = user.get("locked_until")
    if locked_until and locked_until > _utcnow():
        raise AuthError("Account temporarily locked", 423)
    if not user.get("password_hash"):
        raise AuthError("Password reset required. Contact an admin for a reset code.", 403)
    try:
        ph.verify(user["password_hash"], password)
    except VerifyMismatchError:
        attempts = int(user.get("failed_login_attempts") or 0) + 1
        lock_sql = ""
        params: list[Any] = [attempts]
        if attempts >= MAX_FAILED_LOGINS:
            lock_sql = ", locked_until = now() + interval '15 minutes'"
        params.append(user["id"])
        execute_void(
            f"UPDATE users SET failed_login_attempts = %s{lock_sql}, updated_at = now() WHERE id = %s",
            params,
        )
        _audit(str(user["id"]), "login_failed", {"attempts": attempts}, ip)
        raise AuthError("Invalid credentials", 401)
    if user.get("password_reset_required"):
        raise AuthError("Password reset required before login", 403)
    execute_void(
        "UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = %s",
        (user["id"],),
    )
    _audit(str(user["id"]), "login", {}, ip)
    return _issue_tokens(user, user_agent=user_agent, ip=ip)


def refresh(refresh_token: str, user_agent: str | None = None, ip: str | None = None) -> dict[str, Any]:
    token_hash = _hash_token(refresh_token)
    row = execute_one(
        """
        SELECT rt.user_id, rt.expires_at
        FROM refresh_tokens rt
        WHERE rt.token_hash = %s AND rt.revoked_at IS NULL
        LIMIT 1
        """,
        (token_hash,),
    )
    if not row:
        raise AuthError("Invalid refresh token", 401)
    if row["expires_at"] < _utcnow():
        raise AuthError("Refresh token expired", 401)
    execute_void("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = %s", (token_hash,))
    user = execute_one("SELECT * FROM users WHERE id = %s", (row["user_id"],))
    if not user:
        raise AuthError("User not found", 401)
    role = str(user.get("role") or "").lower()
    # Admins keep the original session end time — refresh must not extend past 6h from login.
    session_expires_at = row["expires_at"] if role in ADMIN_ROLES else None
    return _issue_tokens(
        user,
        user_agent=user_agent,
        ip=ip,
        session_expires_at=session_expires_at,
    )


def logout(refresh_token: str | None) -> bool:
    if not refresh_token:
        return True
    execute_void(
        "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = %s",
        (_hash_token(refresh_token),),
    )
    return True


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise AuthError("Invalid or expired token", 401) from exc
    if payload.get("type") != "access":
        raise AuthError("Invalid token type", 401)
    return payload


def get_user_by_id(user_id: str) -> Optional[dict[str, Any]]:
    return execute_one("SELECT * FROM users WHERE id = %s OR firebase_uid = %s LIMIT 1", (user_id, user_id))


def admin_create_reset_code(user_identifier: str, created_by: str | None = None) -> dict[str, Any]:
    user = _find_user_by_identifier(user_identifier)
    if not user:
        raise AuthError("User not found", 404)
    code = secrets.token_urlsafe(10).replace("-", "").replace("_", "")[:12].upper()
    code_hash = _hash_token(code)
    expires_at = _utcnow() + timedelta(hours=RESET_CODE_HOURS)
    execute_void(
        """
        INSERT INTO password_reset_codes (user_id, code_hash, expires_at, created_by)
        VALUES (%s, %s, %s, %s)
        """,
        (user["id"], code_hash, expires_at, created_by),
    )
    execute_void(
        "UPDATE users SET password_reset_required = true, status = 'pending_reset', updated_at = now() WHERE id = %s",
        (user["id"],),
    )
    _audit(str(user["id"]), "admin_reset_code_created", {"by": created_by})
    return {
        "user": _public_user(user),
        "reset_code": code,
        "expires_at": expires_at.isoformat(),
    }


def reset_password_with_code(identifier: str, reset_code: str, new_password: str) -> dict[str, Any]:
    if not new_password or len(new_password) < 8:
        raise AuthError("Password must be at least 8 characters")
    user = _find_user_by_identifier(identifier)
    if not user:
        raise AuthError("User not found", 404)
    codes = execute(
        """
        SELECT * FROM password_reset_codes
        WHERE user_id = %s AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 10
        """,
        (user["id"],),
    )
    matched = None
    target = _hash_token(reset_code.strip().upper())
    # also accept raw case variants
    target_alt = _hash_token(reset_code.strip())
    for c in codes:
        if c["code_hash"] in {target, target_alt, _hash_token(reset_code.strip().lower())}:
            matched = c
            break
    if not matched:
        raise AuthError("Invalid or expired reset code", 400)
    password_hash = ph.hash(new_password)
    execute_void(
        """
        UPDATE users
        SET password_hash = %s, password_reset_required = false, status = 'active',
            failed_login_attempts = 0, locked_until = NULL, updated_at = now()
        WHERE id = %s
        """,
        (password_hash, user["id"]),
    )
    execute_void("UPDATE password_reset_codes SET used_at = now() WHERE id = %s", (matched["id"],))
    _audit(str(user["id"]), "password_reset")
    user = execute_one("SELECT * FROM users WHERE id = %s", (user["id"],))
    return _issue_tokens(user)


def import_firebase_user(firebase_uid: str, email: Optional[str], role: str = "victim") -> dict[str, Any]:
    """Import a Firebase profile as password_reset_required local user."""
    existing = execute_one("SELECT * FROM users WHERE firebase_uid = %s LIMIT 1", (firebase_uid,))
    if existing:
        return _public_user(existing)
    email_n = normalize_email(email)
    rows = execute(
        """
        INSERT INTO users (firebase_uid, email, role, status, password_reset_required)
        VALUES (%s, %s, %s, 'pending_reset', true)
        RETURNING *
        """,
        (firebase_uid, email_n, (role or "victim").lower()),
    )
    return _public_user(rows[0])
