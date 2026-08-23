"""Clash Mode subscription entitlement + Razorpay Subscriptions."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from dotenv import dotenv_values

from backend.database.postgres_pool import execute, execute_one, execute_void, is_postgres_configured
from backend.paths import REPO_ROOT

FREE_PLAN_ID = "free"
PAID_PLAN_IDS = frozenset({"basic", "fearless"})
MIN_ORDER_AMOUNT_PAISE = 100


class ClashQuotaExceeded(Exception):
    def __init__(self, *, plan: str, used: int, limit: int, period: str):
        self.plan = plan
        self.used = used
        self.limit = limit
        self.period = period
        super().__init__("clash_quota_exceeded")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _month_period_bounds(now: Optional[datetime] = None) -> tuple[datetime, datetime, str]:
    """UTC calendar month [start, next_month_start) and label YYYY-MM."""
    n = now or _utc_now()
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    start = datetime(n.year, n.month, 1, tzinfo=timezone.utc)
    if n.month == 12:
        end = datetime(n.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(n.year, n.month + 1, 1, tzinfo=timezone.utc)
    return start, end, f"{n.year:04d}-{n.month:02d}"


def _razorpay_credentials() -> tuple[str, str]:
    """Prefer repo .env so key rotations apply without a full API restart.

    uvicorn --reload inherits the parent process env; load_dotenv() does not
    override existing RAZORPAY_* values, which left stale test keys in memory.
    """
    file_vals = dotenv_values(REPO_ROOT / ".env") if (REPO_ROOT / ".env").is_file() else {}
    key_id = (file_vals.get("RAZORPAY_KEY_ID") or "").strip()
    key_secret = (file_vals.get("RAZORPAY_KEY_SECRET") or "").strip()
    if key_id:
        os.environ["RAZORPAY_KEY_ID"] = key_id
    if key_secret:
        os.environ["RAZORPAY_KEY_SECRET"] = key_secret
    key_id = key_id or (os.getenv("RAZORPAY_KEY_ID") or "").strip()
    key_secret = key_secret or (os.getenv("RAZORPAY_KEY_SECRET") or "").strip()
    if not key_id or not key_secret:
        raise RuntimeError("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required")
    return key_id, key_secret


def _razorpay_client():
    key_id, key_secret = _razorpay_credentials()
    import razorpay

    return razorpay.Client(auth=(key_id, key_secret)), key_id


def razorpay_error_http_status(exc: BaseException) -> int:
    """Map Razorpay SDK/API failures to 401 (auth) or 500 (everything else)."""
    status = getattr(exc, "status_code", None) or getattr(exc, "http_status", None)
    if not isinstance(status, int):
        raw = getattr(exc, "json", None) or getattr(exc, "error", None)
        if isinstance(raw, dict):
            nested = raw.get("status") or raw.get("status_code")
            if isinstance(nested, int):
                status = nested
    msg = str(exc).lower()
    if status == 401 or "authentication failed" in msg or "unauthorized" in msg or "invalid api key" in msg:
        return 401
    return 500


def verify_razorpay_signature(order_id: str, payment_id: str, signature: str) -> bool:
    _, key_secret = _razorpay_credentials()
    payload = f"{order_id}|{payment_id}"
    expected = hmac.new(key_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, (signature or "").strip())


def list_plans() -> list[dict[str, Any]]:
    if not is_postgres_configured():
        return [
            {"id": "free", "name": "Free", "price_paise": 0, "monthly_session_limit": 2, "sort_order": 1},
            {"id": "basic", "name": "Basic", "price_paise": 4900, "monthly_session_limit": 50, "sort_order": 2},
            {"id": "fearless", "name": "Fearless", "price_paise": 59900, "monthly_session_limit": None, "sort_order": 3},
        ]
    rows = execute(
        """
        SELECT id, name, price_paise, monthly_session_limit, sort_order
        FROM public.clash_plans
        ORDER BY sort_order ASC, id ASC
        """
    )
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "price_paise": int(r["price_paise"] or 0),
            "monthly_session_limit": r["monthly_session_limit"],
            "sort_order": int(r.get("sort_order") or 0),
        }
        for r in rows
    ]


def get_plan(plan_id: str) -> Optional[dict[str, Any]]:
    if not is_postgres_configured():
        for p in list_plans():
            if p["id"] == plan_id:
                return p
        return None
    row = execute_one(
        """
        SELECT id, name, price_paise, monthly_session_limit, razorpay_plan_id, sort_order
        FROM public.clash_plans WHERE id = %s
        """,
        (plan_id,),
    )
    return dict(row) if row else None


def _env_from_dotenv(name: str) -> str:
    file_vals = dotenv_values(REPO_ROOT / ".env") if (REPO_ROOT / ".env").is_file() else {}
    value = (file_vals.get(name) or os.getenv(name) or "").strip()
    if value:
        os.environ[name] = value
    return value


def _resolve_razorpay_plan_id(plan_id: str, plan_row: dict[str, Any]) -> str:
    env_key = {
        "basic": "RAZORPAY_BASIC_PLAN_ID",
        "fearless": "RAZORPAY_FEARLESS_PLAN_ID",
    }.get(plan_id)
    if env_key:
        override = _env_from_dotenv(env_key)
        if override:
            return override
    rid = (plan_row.get("razorpay_plan_id") or "").strip()
    if not rid:
        raise RuntimeError(
            f"Razorpay plan id missing for '{plan_id}'. "
            f"Set clash_plans.razorpay_plan_id or {env_key or 'RAZORPAY_*_PLAN_ID'}."
        )
    return rid


def get_active_subscription(user_id: str) -> Optional[dict[str, Any]]:
    if not is_postgres_configured():
        return None
    try:
        uid = str(UUID(str(user_id)))
    except ValueError:
        return None
    row = execute_one(
        """
        SELECT s.*, p.name AS plan_name, p.price_paise, p.monthly_session_limit
        FROM public.clash_subscriptions s
        JOIN public.clash_plans p ON p.id = s.plan_id
        WHERE s.user_id = %s::uuid
          AND s.status IN ('active', 'past_due')
          AND (s.current_period_end IS NULL OR s.current_period_end > now())
        ORDER BY s.updated_at DESC
        LIMIT 1
        """,
        (uid,),
    )
    return dict(row) if row else None


def count_sessions_this_month(user_id: str) -> tuple[int, str, datetime, datetime]:
    start, end, label = _month_period_bounds()
    if not is_postgres_configured():
        return 0, label, start, end
    try:
        uid = str(UUID(str(user_id)))
    except ValueError:
        return 0, label, start, end
    row = execute_one(
        """
        SELECT COUNT(*)::int AS c
        FROM public.clash_session_runs
        WHERE user_id = %s::uuid
          AND created_at >= %s
          AND created_at < %s
        """,
        (uid, start, end),
    )
    return int((row or {}).get("c") or 0), label, start, end


def resolve_entitlement(user_id: str) -> dict[str, Any]:
    sub = get_active_subscription(user_id)
    if sub and sub.get("plan_id") in PAID_PLAN_IDS:
        plan_id = str(sub["plan_id"])
        limit = sub.get("monthly_session_limit")
        plan_name = str(sub.get("plan_name") or plan_id.title())
        price_paise = int(sub.get("price_paise") or 0)
        status = str(sub.get("status") or "active")
    else:
        free = get_plan(FREE_PLAN_ID) or {
            "id": FREE_PLAN_ID,
            "name": "Free",
            "monthly_session_limit": 2,
            "price_paise": 0,
        }
        plan_id = FREE_PLAN_ID
        limit = free.get("monthly_session_limit")
        plan_name = str(free.get("name") or "Free")
        price_paise = int(free.get("price_paise") or 0)
        status = "free"
        sub = None

    used, period, period_start, period_end = count_sessions_this_month(user_id)
    limit_i = int(limit) if limit is not None else None
    can_start = True if limit_i is None else used < limit_i
    remaining = None if limit_i is None else max(0, limit_i - used)

    return {
        "plan_id": plan_id,
        "plan_name": plan_name,
        "price_paise": price_paise,
        "status": status,
        "used": used,
        "limit": limit_i,
        "remaining": remaining,
        "can_start": can_start,
        "period": period,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "subscription_id": str(sub["id"]) if sub and sub.get("id") else None,
        "razorpay_subscription_id": (sub or {}).get("razorpay_subscription_id"),
        "cancel_at_period_end": bool((sub or {}).get("cancel_at_period_end")),
        "current_period_end": (
            sub["current_period_end"].isoformat()
            if sub and sub.get("current_period_end")
            else None
        ),
    }


def assert_can_start_clash(user_id: str) -> dict[str, Any]:
    try:
        sync_pending_checkouts(user_id)
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ clash billing sync before session: {exc}")
    ent = resolve_entitlement(user_id)
    if not ent["can_start"]:
        raise ClashQuotaExceeded(
            plan=ent["plan_id"],
            used=int(ent["used"]),
            limit=int(ent["limit"] or 0),
            period=str(ent["period"]),
        )
    return ent


def record_session_run(user_id: str, session_id: str, mode: Optional[str] = None) -> None:
    if not is_postgres_configured():
        return
    try:
        uid = str(UUID(str(user_id)))
    except ValueError:
        return
    execute_void(
        """
        INSERT INTO public.clash_session_runs (user_id, session_id, mode)
        VALUES (%s::uuid, %s, %s)
        ON CONFLICT (session_id) DO NOTHING
        """,
        (uid, session_id, mode),
    )


def _insert_pending_checkout(uid: str, plan_id: str, razorpay_id: str) -> None:
    execute_void(
        """
        UPDATE public.clash_subscriptions
        SET status = 'cancelled', updated_at = now()
        WHERE user_id = %s::uuid AND status = 'created'
        """,
        (uid,),
    )
    execute_void(
        """
        INSERT INTO public.clash_subscriptions (
          user_id, plan_id, status, razorpay_subscription_id, cancel_at_period_end
        )
        VALUES (%s::uuid, %s, 'created', %s, false)
        ON CONFLICT (razorpay_subscription_id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          status = 'created',
          updated_at = now()
        """,
        (uid, plan_id, razorpay_id),
    )


def _activate_paid_period(
    user_id: str,
    plan_id: str,
    razorpay_id: str,
    *,
    customer_id: Optional[str] = None,
    period_days: int = 30,
) -> None:
    now = _utc_now()
    period_end = now + timedelta(days=period_days)
    execute_void(
        """
        UPDATE public.clash_subscriptions
        SET status = 'cancelled', updated_at = now()
        WHERE user_id = %s::uuid
          AND razorpay_subscription_id IS DISTINCT FROM %s
          AND status IN ('active', 'past_due', 'created')
        """,
        (user_id, razorpay_id),
    )
    execute_void(
        """
        INSERT INTO public.clash_subscriptions (
          user_id, plan_id, status, razorpay_subscription_id, razorpay_customer_id,
          current_period_start, current_period_end, cancel_at_period_end
        )
        VALUES (%s::uuid, %s, 'active', %s, %s, %s, %s, false)
        ON CONFLICT (razorpay_subscription_id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          status = 'active',
          razorpay_customer_id = COALESCE(EXCLUDED.razorpay_customer_id, public.clash_subscriptions.razorpay_customer_id),
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          updated_at = now()
        """,
        (user_id, plan_id, razorpay_id, customer_id, now, period_end),
    )


def _checkout_row(rz_id: str) -> Optional[dict[str, Any]]:
    if not rz_id:
        return None
    return execute_one(
        """
        SELECT user_id, plan_id, status
        FROM public.clash_subscriptions
        WHERE razorpay_subscription_id = %s
        """,
        (rz_id,),
    )


def _try_activate_paid(
    *razorpay_ids: Optional[str],
    payment: Optional[dict[str, Any]] = None,
    extra_notes: Optional[dict[str, Any]] = None,
) -> bool:
    """Activate Clash from a captured payment/order/subscription id."""
    notes: dict[str, Any] = {}
    if extra_notes and isinstance(extra_notes, dict):
        notes.update(extra_notes)
    if payment and isinstance(payment.get("notes"), dict):
        notes.update(payment["notes"])
    customer_id = (payment or {}).get("customer_id")
    ids = [str(i).strip() for i in razorpay_ids if i]
    for rz_id in ids:
        row = _checkout_row(rz_id)
        if not row:
            continue
        plan_id = str(row["plan_id"])
        if plan_id not in PAID_PLAN_IDS:
            continue
        _activate_paid_period(str(row["user_id"]), plan_id, rz_id, customer_id=customer_id)
        return True
    uid = notes.get("user_id")
    plan_id = str(notes.get("plan_id") or "")
    rz_id = ids[0] if ids else ""
    if uid and plan_id in PAID_PLAN_IDS and rz_id:
        _activate_paid_period(str(uid), plan_id, rz_id, customer_id=customer_id)
        return True
    return False


def _order_has_captured_payment(client: Any, order_id: str) -> bool:
    try:
        order = client.order.fetch(order_id)
        if str(order.get("status") or "").lower() == "paid":
            return True
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ Razorpay order.fetch {order_id}: {exc}")
        return False
    try:
        bag = client.order.payments(order_id)
        items = bag.get("items") if isinstance(bag, dict) else bag
        for pay in items or []:
            if str((pay or {}).get("status") or "").lower() in ("captured", "authorized"):
                return True
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ Razorpay order.payments {order_id}: {exc}")
    return False


def _subscription_is_paid(client: Any, sub_id: str) -> bool:
    try:
        sub = client.subscription.fetch(sub_id)
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ Razorpay subscription.fetch {sub_id}: {exc}")
        return False
    status = str(sub.get("status") or "").lower()
    if status in ("active", "authenticated"):
        return True
    try:
        return int(sub.get("paid_count") or 0) > 0
    except (TypeError, ValueError):
        return False


def sync_pending_checkouts(user_id: str) -> int:
    """Ask Razorpay whether pending checkouts were paid (UPI/app switch). Returns activations."""
    if not is_postgres_configured():
        return 0
    try:
        uid = str(UUID(str(user_id)))
    except ValueError:
        return 0
    rows = execute(
        """
        SELECT plan_id, razorpay_subscription_id
        FROM public.clash_subscriptions
        WHERE user_id = %s::uuid
          AND status = 'created'
          AND razorpay_subscription_id IS NOT NULL
          AND created_at > now() - interval '48 hours'
        """,
        (uid,),
    )
    if not rows:
        return 0
    try:
        client, _ = _razorpay_client()
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ clash billing sync skipped (Razorpay client): {exc}")
        return 0
    activated = 0
    for row in rows:
        rz_id = str(row.get("razorpay_subscription_id") or "")
        plan_id = str(row.get("plan_id") or "")
        if not rz_id or plan_id not in PAID_PLAN_IDS:
            continue
        paid = False
        try:
            if rz_id.startswith("order_"):
                paid = _order_has_captured_payment(client, rz_id)
            elif rz_id.startswith("sub_"):
                paid = _subscription_is_paid(client, rz_id)
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ clash billing sync {rz_id}: {exc}")
            continue
        if paid:
            _activate_paid_period(uid, plan_id, rz_id)
            activated += 1
    return activated


def reconcile_pending_checkouts(limit: int = 50) -> dict[str, Any]:
    """Cron: confirm unpaid Clash checkouts against Razorpay (user may have left the site)."""
    if not is_postgres_configured():
        return {"checked": 0, "activated": 0}
    rows = execute(
        """
        SELECT user_id, plan_id, razorpay_subscription_id
        FROM public.clash_subscriptions
        WHERE status = 'created'
          AND razorpay_subscription_id IS NOT NULL
          AND created_at > now() - interval '48 hours'
        ORDER BY created_at ASC
        LIMIT %s
        """,
        (max(1, min(200, limit)),),
    )
    activated = 0
    seen: set[str] = set()
    for row in rows:
        uid = str(row["user_id"])
        if uid in seen:
            continue
        seen.add(uid)
        activated += sync_pending_checkouts(uid)
    return {"checked": len(rows), "users": len(seen), "activated": activated}


def _create_order_checkout(uid: str, plan_id: str, plan: dict[str, Any], *, email: Optional[str] = None) -> dict[str, Any]:
    client, key_id = _razorpay_client()
    amount = int(plan.get("price_paise") or 0)
    if amount < MIN_ORDER_AMOUNT_PAISE:
        raise ValueError(f"Amount must be at least {MIN_ORDER_AMOUNT_PAISE} paise")
    notes = {"user_id": uid, "plan_id": plan_id, "product": "clash"}
    order = client.order.create(
        {
            "amount": amount,
            "currency": "INR",
            "receipt": f"clash_{uid.replace('-', '')[:12]}_{plan_id}"[:40],
            "notes": notes,
        }
    )
    order_id = order.get("id")
    if not order_id:
        raise RuntimeError("Razorpay did not return order id")
    _insert_pending_checkout(uid, plan_id, order_id)
    return {
        "key_id": key_id,
        "checkout_mode": "order",
        "order_id": order_id,
        "amount": amount,
        "currency": "INR",
        "plan_id": plan_id,
        "price_paise": amount,
        "prefill": {"email": email} if email else {},
    }


def create_subscription_checkout(user_id: str, plan_id: str, *, email: Optional[str] = None) -> dict[str, Any]:
    if plan_id not in PAID_PLAN_IDS:
        raise ValueError("Only basic or fearless can be purchased")
    plan = get_plan(plan_id)
    if not plan:
        raise ValueError(f"Unknown plan '{plan_id}'")

    try:
        uid = str(UUID(str(user_id)))
    except ValueError as exc:
        raise ValueError("Invalid user id") from exc

    # Prefer Razorpay Subscriptions when Plan IDs exist and the product is enabled.
    try:
        rz_plan_id = _resolve_razorpay_plan_id(plan_id, plan)
        client, key_id = _razorpay_client()
        payload: dict[str, Any] = {
            "plan_id": rz_plan_id,
            "total_count": 12,
            "customer_notify": 1,
            "notes": {"user_id": uid, "plan_id": plan_id, "product": "clash"},
        }
        if email:
            payload["notify_info"] = {"notify_email": email}
        sub = client.subscription.create(payload)
        rz_sub_id = sub.get("id")
        if not rz_sub_id:
            raise RuntimeError("Razorpay did not return subscription id")
        _insert_pending_checkout(uid, plan_id, rz_sub_id)
        return {
            "key_id": key_id,
            "checkout_mode": "subscription",
            "subscription_id": rz_sub_id,
            "plan_id": plan_id,
            "price_paise": int(plan.get("price_paise") or 0),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"ℹ️ Clash subscription checkout unavailable ({exc}); using one-time order")
        return _create_order_checkout(uid, plan_id, plan, email=email)


def create_standard_order(
    *,
    amount: int,
    currency: str = "INR",
    receipt: Optional[str] = None,
    user_id: Optional[str] = None,
) -> dict[str, Any]:
    if amount < MIN_ORDER_AMOUNT_PAISE:
        raise ValueError(f"Amount must be at least {MIN_ORDER_AMOUNT_PAISE} paise")
    client, key_id = _razorpay_client()
    payload: dict[str, Any] = {
        "amount": int(amount),
        "currency": (currency or "INR").upper(),
        "receipt": (receipt or f"ns_{os.urandom(6).hex()}")[:40],
    }
    if user_id:
        payload["notes"] = {"user_id": user_id}
    order = client.order.create(payload)
    order_id = order.get("id")
    if not order_id:
        raise RuntimeError("Razorpay did not return order id")
    return {
        "order_id": order_id,
        "amount": int(order.get("amount") or amount),
        "currency": str(order.get("currency") or payload["currency"]),
        "key_id": key_id,
    }


def verify_order_payment(
    user_id: str,
    *,
    razorpay_order_id: str = "",
    razorpay_payment_id: str,
    razorpay_signature: str,
    razorpay_subscription_id: str = "",
) -> dict[str, Any]:
    checkout_id = (razorpay_order_id or razorpay_subscription_id or "").strip()
    if not checkout_id or not razorpay_payment_id or not razorpay_signature:
        raise ValueError("Missing razorpay_order_id/subscription_id, razorpay_payment_id, or razorpay_signature")
    if not verify_razorpay_signature(checkout_id, razorpay_payment_id, razorpay_signature):
        raise ValueError("Invalid Razorpay payment signature")

    try:
        uid = str(UUID(str(user_id)))
    except ValueError as exc:
        raise ValueError("Invalid user id") from exc

    pending = execute_one(
        """
        SELECT plan_id FROM public.clash_subscriptions
        WHERE razorpay_subscription_id = %s AND user_id = %s::uuid
        """,
        (checkout_id, uid),
    )
    if not pending:
        raise ValueError("Unknown checkout order")
    plan_id = str(pending["plan_id"])
    if plan_id not in PAID_PLAN_IDS:
        raise ValueError("Invalid plan on order")
    _activate_paid_period(uid, plan_id, checkout_id)
    result = resolve_entitlement(uid)
    result["verified"] = True
    return result


def confirm_standard_payment(
    user_id: Optional[str],
    *,
    razorpay_order_id: str = "",
    razorpay_payment_id: str,
    razorpay_signature: str,
    razorpay_subscription_id: str = "",
) -> dict[str, Any]:
    """HMAC-verify Checkout. Activates Clash if this id is a pending Clash checkout."""
    checkout_id = (razorpay_order_id or razorpay_subscription_id or "").strip()
    if not checkout_id or not razorpay_payment_id or not razorpay_signature:
        raise ValueError("Missing razorpay_order_id/subscription_id, razorpay_payment_id, or razorpay_signature")
    if not verify_razorpay_signature(checkout_id, razorpay_payment_id, razorpay_signature):
        raise ValueError("Invalid Razorpay payment signature")
    if user_id:
        try:
            return verify_order_payment(
                user_id,
                razorpay_order_id=razorpay_order_id,
                razorpay_payment_id=razorpay_payment_id,
                razorpay_signature=razorpay_signature,
                razorpay_subscription_id=razorpay_subscription_id,
            )
        except ValueError as exc:
            if "Unknown checkout order" not in str(exc) and "Invalid plan" not in str(exc):
                raise
    return {
        "verified": True,
        "razorpay_order_id": razorpay_order_id or None,
        "razorpay_subscription_id": razorpay_subscription_id or None,
        "razorpay_payment_id": razorpay_payment_id,
    }


def cancel_subscription(user_id: str) -> dict[str, Any]:
    sub = get_active_subscription(user_id)
    if not sub or not sub.get("razorpay_subscription_id"):
        raise ValueError("No active Clash subscription")
    rz_id = str(sub["razorpay_subscription_id"])
    if rz_id.startswith("sub_"):
        client, _ = _razorpay_client()
        client.subscription.cancel(rz_id, {"cancel_at_cycle_end": 1})
        execute_void(
            """
            UPDATE public.clash_subscriptions
            SET cancel_at_period_end = true, updated_at = now()
            WHERE razorpay_subscription_id = %s
            """,
            (rz_id,),
        )
    else:
        execute_void(
            """
            UPDATE public.clash_subscriptions
            SET status = 'cancelled', cancel_at_period_end = true, updated_at = now()
            WHERE razorpay_subscription_id = %s
            """,
            (rz_id,),
        )
    return resolve_entitlement(user_id)


def _razorpay_webhook_secret() -> str:
    file_vals = dotenv_values(REPO_ROOT / ".env") if (REPO_ROOT / ".env").is_file() else {}
    secret = (file_vals.get("RAZORPAY_WEBHOOK_SECRET") or os.getenv("RAZORPAY_WEBHOOK_SECRET") or "").strip()
    if secret:
        os.environ["RAZORPAY_WEBHOOK_SECRET"] = secret
    if not secret:
        raise RuntimeError("RAZORPAY_WEBHOOK_SECRET is not configured")
    return secret


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    secret = _razorpay_webhook_secret()
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, (signature or "").strip())


def _ts_to_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _plan_id_from_notes(entity: dict[str, Any]) -> Optional[str]:
    notes = entity.get("notes") or {}
    if isinstance(notes, dict):
        pid = notes.get("plan_id")
        if pid in PAID_PLAN_IDS:
            return str(pid)
    return None


def _user_id_from_notes(entity: dict[str, Any]) -> Optional[str]:
    notes = entity.get("notes") or {}
    if isinstance(notes, dict) and notes.get("user_id"):
        return str(notes["user_id"])
    return None


def _upsert_subscription_from_entity(
    entity: dict[str, Any],
    *,
    status: str,
) -> None:
    rz_sub_id = entity.get("id")
    if not rz_sub_id:
        return
    plan_id = _plan_id_from_notes(entity)
    user_id = _user_id_from_notes(entity)

    existing = execute_one(
        "SELECT id, user_id, plan_id FROM public.clash_subscriptions WHERE razorpay_subscription_id = %s",
        (rz_sub_id,),
    )
    if existing:
        user_id = str(existing["user_id"])
        plan_id = plan_id or str(existing["plan_id"])
    if not user_id or not plan_id:
        print(f"⚠️ clash billing webhook: missing user/plan for {rz_sub_id}")
        return

    period_start = _ts_to_dt(entity.get("current_start") or entity.get("start_at"))
    period_end = _ts_to_dt(entity.get("current_end") or entity.get("end_at"))
    customer_id = entity.get("customer_id")

    if status == "active" and existing is None:
        # Cancel other active rows for this user
        execute_void(
            """
            UPDATE public.clash_subscriptions
            SET status = 'cancelled', updated_at = now()
            WHERE user_id = %s::uuid
              AND razorpay_subscription_id IS DISTINCT FROM %s
              AND status IN ('active', 'past_due', 'created')
            """,
            (user_id, rz_sub_id),
        )

    execute_void(
        """
        INSERT INTO public.clash_subscriptions (
          user_id, plan_id, status, razorpay_subscription_id, razorpay_customer_id,
          current_period_start, current_period_end, cancel_at_period_end
        )
        VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, false)
        ON CONFLICT (razorpay_subscription_id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          status = EXCLUDED.status,
          razorpay_customer_id = COALESCE(EXCLUDED.razorpay_customer_id, public.clash_subscriptions.razorpay_customer_id),
          current_period_start = COALESCE(EXCLUDED.current_period_start, public.clash_subscriptions.current_period_start),
          current_period_end = COALESCE(EXCLUDED.current_period_end, public.clash_subscriptions.current_period_end),
          updated_at = now()
        """,
        (user_id, plan_id, status, rz_sub_id, customer_id, period_start, period_end),
    )


def process_webhook_event(event: dict[str, Any]) -> dict[str, Any]:
    event_id = str(event.get("id") or "")
    event_type = str(event.get("event") or "")
    if not event_id:
        raise ValueError("Missing event id")

    if not is_postgres_configured():
        return {"ok": False, "reason": "database_unavailable"}

    inserted = execute_one(
        """
        INSERT INTO public.clash_billing_events (razorpay_event_id, event_type, payload)
        VALUES (%s, %s, %s::jsonb)
        ON CONFLICT (razorpay_event_id) DO NOTHING
        RETURNING id
        """,
        (event_id, event_type, json.dumps(event, default=str)),
    )
    if not inserted:
        return {"ok": True, "duplicate": True}

    payload = event.get("payload") or {}
    subscription = (payload.get("subscription") or {}).get("entity") or {}
    payment = (payload.get("payment") or {}).get("entity") or {}
    order = (payload.get("order") or {}).get("entity") or {}
    order_notes = order.get("notes") if isinstance(order.get("notes"), dict) else {}

    if event_type in ("subscription.activated", "subscription.charged", "subscription.authenticated"):
        _upsert_subscription_from_entity(subscription, status="active")
        _try_activate_paid(
            subscription.get("id"),
            payment.get("subscription_id"),
            payment.get("order_id"),
            order.get("id"),
            payment=payment or None,
            extra_notes=order_notes,
        )
    elif event_type in ("subscription.pending",):
        _upsert_subscription_from_entity(subscription, status="past_due")
    elif event_type in ("subscription.cancelled", "subscription.completed", "subscription.halted"):
        _upsert_subscription_from_entity(subscription, status="cancelled")
    elif event_type in ("payment.captured", "order.paid"):
        # UPI often completes after Checkout.js is gone; resolve by order/sub id, not only notes.
        _try_activate_paid(
            payment.get("order_id"),
            payment.get("subscription_id"),
            order.get("id"),
            subscription.get("id"),
            (payment.get("notes") or {}).get("order_id") if isinstance(payment.get("notes"), dict) else None,
            payment=payment or None,
            extra_notes=order_notes,
        )
    elif event_type == "payment.failed" and payment:
        # Mark linked subscription past_due if we can resolve it
        notes = payment.get("notes") or {}
        rz_sub = None
        if isinstance(notes, dict):
            rz_sub = notes.get("subscription_id")
        if not rz_sub:
            rz_sub = payment.get("subscription_id")
        if not rz_sub and subscription.get("id"):
            rz_sub = subscription.get("id")
        if rz_sub:
            execute_void(
                """
                UPDATE public.clash_subscriptions
                SET status = 'past_due', updated_at = now()
                WHERE razorpay_subscription_id = %s AND status = 'active'
                """,
                (rz_sub,),
            )

    return {"ok": True, "event": event_type}
