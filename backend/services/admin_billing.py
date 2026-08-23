"""Admin monitoring for Clash Razorpay subscriptions and webhook payments."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from backend.database.postgres_pool import execute, execute_one, is_postgres_configured

ALLOWED_SUB_STATUSES = frozenset({"created", "active", "cancelled", "past_due", "expired"})
ALLOWED_PLANS = frozenset({"free", "basic", "fearless"})


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _user_label(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "user_id": str(row["user_id"]) if row.get("user_id") else None,
        "email": row.get("email"),
        "mobile": row.get("mobile"),
        "display_name": row.get("display_name"),
        "role": row.get("role"),
        "user_status": row.get("user_status"),
    }


def summary() -> dict[str, Any]:
    if not is_postgres_configured():
        return {
            "subscriptions": {},
            "active_by_plan": [],
            "events_total": 0,
            "mrr_paise": 0,
        }
    status_rows = execute(
        """
        SELECT status, COUNT(*)::int AS n
        FROM public.clash_subscriptions
        GROUP BY status
        """
    )
    plan_rows = execute(
        """
        SELECT s.plan_id, p.name AS plan_name, p.price_paise, COUNT(*)::int AS n
        FROM public.clash_subscriptions s
        JOIN public.clash_plans p ON p.id = s.plan_id
        WHERE s.status = 'active'
        GROUP BY s.plan_id, p.name, p.price_paise
        ORDER BY p.price_paise ASC
        """
    )
    events_row = execute_one("SELECT COUNT(*)::int AS total FROM public.clash_billing_events")
    mrr = 0
    for r in plan_rows:
        mrr += int(r.get("price_paise") or 0) * int(r.get("n") or 0)
    return {
        "subscriptions": {str(r["status"]): int(r["n"]) for r in status_rows},
        "active_by_plan": [
            {
                "plan_id": r["plan_id"],
                "plan_name": r["plan_name"],
                "price_paise": int(r.get("price_paise") or 0),
                "count": int(r["n"]),
            }
            for r in plan_rows
        ],
        "events_total": int((events_row or {}).get("total") or 0),
        "mrr_paise": mrr,
    }


def list_subscriptions(
    *,
    q: str = "",
    status: Optional[str] = None,
    plan_id: Optional[str] = None,
    offset: int = 0,
    limit: int = 25,
) -> dict[str, Any]:
    if not is_postgres_configured():
        return {"subscriptions": [], "total": 0, "offset": 0, "limit": limit}

    offset = max(0, offset)
    limit = max(1, min(100, limit))
    q = (q or "").strip()
    status = (status or "").strip().lower() or None
    plan_id = (plan_id or "").strip().lower() or None
    if status and status not in ALLOWED_SUB_STATUSES:
        status = None
    if plan_id and plan_id not in ALLOWED_PLANS:
        plan_id = None

    where = ["TRUE"]
    params: list[Any] = []

    if q:
        where.append(
            """(
              u.email ILIKE %s
              OR u.mobile ILIKE %s
              OR u.display_name ILIKE %s
              OR u.id::text ILIKE %s
              OR COALESCE(s.razorpay_subscription_id, '') ILIKE %s
              OR COALESCE(s.razorpay_customer_id, '') ILIKE %s
            )"""
        )
        like = f"%{q}%"
        params.extend([like, like, like, like, like, like])
    if status:
        where.append("s.status = %s")
        params.append(status)
    if plan_id:
        where.append("s.plan_id = %s")
        params.append(plan_id)

    where_sql = " AND ".join(where)
    from_sql = """
        FROM public.clash_subscriptions s
        JOIN public.clash_plans p ON p.id = s.plan_id
        JOIN public.users u ON u.id = s.user_id
        WHERE
    """
    total_row = execute_one(
        f"SELECT COUNT(*)::int AS total {from_sql} {where_sql}",
        tuple(params),
    )
    rows = execute(
        f"""
        SELECT
          s.id, s.user_id, s.plan_id, s.status,
          s.razorpay_subscription_id, s.razorpay_customer_id,
          s.current_period_start, s.current_period_end,
          s.cancel_at_period_end, s.created_at, s.updated_at,
          p.name AS plan_name, p.price_paise,
          u.email, u.mobile, u.display_name, u.role, u.status AS user_status
        {from_sql} {where_sql}
        ORDER BY s.updated_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    items = []
    for r in rows:
        items.append(
            {
                "id": str(r["id"]),
                **_user_label(r),
                "plan_id": r.get("plan_id"),
                "plan_name": r.get("plan_name"),
                "price_paise": int(r.get("price_paise") or 0),
                "status": r.get("status"),
                "razorpay_subscription_id": r.get("razorpay_subscription_id"),
                "razorpay_customer_id": r.get("razorpay_customer_id"),
                "cancel_at_period_end": bool(r.get("cancel_at_period_end")),
                "current_period_start": _iso(r.get("current_period_start")),
                "current_period_end": _iso(r.get("current_period_end")),
                "created_at": _iso(r.get("created_at")),
                "updated_at": _iso(r.get("updated_at")),
            }
        )
    return {
        "subscriptions": items,
        "total": int((total_row or {}).get("total") or 0),
        "offset": offset,
        "limit": limit,
    }


def list_events(
    *,
    q: str = "",
    event_type: Optional[str] = None,
    offset: int = 0,
    limit: int = 25,
) -> dict[str, Any]:
    if not is_postgres_configured():
        return {"events": [], "total": 0, "offset": 0, "limit": limit}

    offset = max(0, offset)
    limit = max(1, min(100, limit))
    q = (q or "").strip()
    event_type = (event_type or "").strip() or None

    where = ["TRUE"]
    params: list[Any] = []
    if event_type:
        where.append("e.event_type = %s")
        params.append(event_type)
    if q:
        where.append(
            """(
              e.razorpay_event_id ILIKE %s
              OR COALESCE(e.event_type, '') ILIKE %s
              OR COALESCE(e.payload #>> '{payload,payment,entity,id}', '') ILIKE %s
              OR COALESCE(e.payload #>> '{payload,payment,entity,order_id}', '') ILIKE %s
              OR COALESCE(e.payload #>> '{payload,subscription,entity,id}', '') ILIKE %s
              OR COALESCE(u.email, '') ILIKE %s
              OR COALESCE(u.mobile, '') ILIKE %s
              OR COALESCE(u.display_name, '') ILIKE %s
              OR COALESCE(n.uid, '') ILIKE %s
            )"""
        )
        like = f"%{q}%"
        params.extend([like] * 9)

    where_sql = " AND ".join(where)
    from_sql = """
        FROM public.clash_billing_events e
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            e.payload #>> '{payload,payment,entity,notes,user_id}',
            e.payload #>> '{payload,subscription,entity,notes,user_id}',
            e.payload #>> '{payload,order,entity,notes,user_id}'
          ) AS uid
        ) n ON TRUE
        LEFT JOIN public.users u ON u.id::text = n.uid
        WHERE
    """
    total_row = execute_one(
        f"SELECT COUNT(*)::int AS total {from_sql} {where_sql}",
        tuple(params),
    )
    rows = execute(
        f"""
        SELECT
          e.id, e.razorpay_event_id, e.event_type, e.processed_at, e.payload,
          n.uid AS notes_user_id,
          u.id AS user_id, u.email, u.mobile, u.display_name, u.role, u.status AS user_status,
          e.payload #>> '{{payload,payment,entity,id}}' AS payment_id,
          e.payload #>> '{{payload,payment,entity,order_id}}' AS order_id,
          e.payload #>> '{{payload,payment,entity,status}}' AS payment_status,
          e.payload #>> '{{payload,payment,entity,method}}' AS method,
          e.payload #>> '{{payload,payment,entity,email}}' AS payment_email,
          e.payload #>> '{{payload,payment,entity,contact}}' AS payment_contact,
          e.payload #>> '{{payload,subscription,entity,id}}' AS subscription_id,
          e.payload #>> '{{payload,payment,entity,notes,plan_id}}' AS notes_plan_id,
          (e.payload #>> '{{payload,payment,entity,amount}}') AS amount_raw
        {from_sql} {where_sql}
        ORDER BY e.id DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    items = []
    for r in rows:
        amount_raw = r.get("amount_raw")
        try:
            amount_paise = int(amount_raw) if amount_raw not in (None, "") else None
        except (TypeError, ValueError):
            amount_paise = None
        payload = r.get("payload")
        items.append(
            {
                "id": int(r["id"]) if r.get("id") is not None else None,
                "razorpay_event_id": r.get("razorpay_event_id"),
                "event_type": r.get("event_type"),
                "processed_at": _iso(r.get("processed_at")),
                "payment_id": r.get("payment_id"),
                "order_id": r.get("order_id"),
                "subscription_id": r.get("subscription_id"),
                "payment_status": r.get("payment_status"),
                "method": r.get("method"),
                "amount_paise": amount_paise,
                "plan_id": r.get("notes_plan_id"),
                "payment_email": r.get("payment_email"),
                "payment_contact": r.get("payment_contact"),
                **_user_label({**r, "user_id": r.get("user_id") or r.get("notes_user_id")}),
                "payload": payload if isinstance(payload, dict) else None,
            }
        )
    return {
        "events": items,
        "total": int((total_row or {}).get("total") or 0),
        "offset": offset,
        "limit": limit,
    }
