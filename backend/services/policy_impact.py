"""Read-only platform aggregates that ground policy impact analysis in real numbers.

Every query is defensive: a missing table or column yields an empty slice rather
than failing the whole snapshot, because the studio must still work on partially
migrated environments.
"""
from __future__ import annotations

from typing import Any

from backend.database.postgres_pool import execute, is_postgres_configured


def _safe(sql: str, params: tuple[Any, ...] | None = None) -> list[dict[str, Any]]:
    if not is_postgres_configured():
        return []
    try:
        return execute(sql, params) if params else execute(sql)
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] policy impact query skipped: {exc}")
        return []


def _scalar(sql: str, key: str = "value") -> int:
    rows = _safe(sql)
    if not rows:
        return 0
    try:
        return int(rows[0].get(key) or 0)
    except (TypeError, ValueError):
        return 0


def _pairs(rows: list[dict[str, Any]], name_key: str, value_key: str = "count") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        name = row.get(name_key)
        if name is None or str(name).strip() == "":
            name = "unspecified"
        out.append({"name": str(name), "value": int(row.get(value_key) or 0)})
    return out


def case_breakdown(days: int = 30) -> dict[str, Any]:
    interval = f"{max(1, min(365, int(days or 30)))} days"
    by_incident = _safe(
        """
        SELECT COALESCE(NULLIF(structured_report->>'incident_type', ''), 'unclassified') AS incident,
               COUNT(*)::int AS count
        FROM public.cases
        WHERE timestamp >= NOW() - %s::interval
        GROUP BY 1 ORDER BY 2 DESC LIMIT 15
        """,
        (interval,),
    )
    by_criticality = _safe(
        """
        SELECT COALESCE(NULLIF(structured_report->>'criticality', ''), 'unset') AS criticality,
               COUNT(*)::int AS count
        FROM public.cases
        WHERE timestamp >= NOW() - %s::interval
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        """,
        (interval,),
    )
    by_status = _safe(
        """
        SELECT COALESCE(NULLIF(status, ''), 'none') AS status, COUNT(*)::int AS count
        FROM public.cases
        WHERE timestamp >= NOW() - %s::interval
        GROUP BY 1 ORDER BY 2 DESC LIMIT 12
        """,
        (interval,),
    )
    by_state = _safe(
        """
        SELECT COALESCE(NULLIF(structured_report->'location'->>'state', ''), 'unknown') AS state,
               COUNT(*)::int AS count
        FROM public.cases
        WHERE timestamp >= NOW() - %s::interval
        GROUP BY 1 ORDER BY 2 DESC LIMIT 12
        """,
        (interval,),
    )
    daily = _safe(
        """
        SELECT to_char(date_trunc('day', timestamp), 'Mon DD') AS label,
               COUNT(*)::int AS count
        FROM public.cases
        WHERE timestamp >= NOW() - %s::interval
        GROUP BY date_trunc('day', timestamp)
        ORDER BY date_trunc('day', timestamp) ASC
        """,
        (interval,),
    )
    total = _safe(
        "SELECT COUNT(*)::int AS value FROM public.cases WHERE timestamp >= NOW() - %s::interval",
        (interval,),
    )
    return {
        "total": int(total[0]["value"]) if total else 0,
        "byIncident": _pairs(by_incident, "incident"),
        "byCriticality": _pairs(by_criticality, "criticality"),
        "byStatus": _pairs(by_status, "status"),
        "byState": _pairs(by_state, "state"),
        "daily": [{"name": r.get("label"), "value": int(r.get("count") or 0)} for r in daily],
    }


def user_breakdown() -> dict[str, Any]:
    by_role = _safe(
        """
        SELECT COALESCE(NULLIF(role, ''), 'unknown') AS role, COUNT(*)::int AS count
        FROM public.users GROUP BY 1 ORDER BY 2 DESC
        """
    )
    by_status = _safe(
        """
        SELECT COALESCE(NULLIF(status, ''), 'unknown') AS status, COUNT(*)::int AS count
        FROM public.users GROUP BY 1 ORDER BY 2 DESC
        """
    )
    return {
        "total": _scalar("SELECT COUNT(*)::int AS value FROM public.users"),
        "newLast30Days": _scalar(
            "SELECT COUNT(*)::int AS value FROM public.users WHERE created_at >= NOW() - INTERVAL '30 days'"
        ),
        "byRole": _pairs(by_role, "role"),
        "byStatus": _pairs(by_status, "status"),
    }


def routing_breakdown(days: int = 30) -> dict[str, Any]:
    interval = f"{max(1, min(365, int(days or 30)))} days"
    assignments = _safe(
        """
        SELECT COALESCE(NULLIF(assignee_type, ''), 'unknown') AS role, COUNT(*)::int AS count
        FROM public.case_assignments
        WHERE created_at >= NOW() - %s::interval
        GROUP BY 1 ORDER BY 2 DESC
        """,
        (interval,),
    )
    followups = _safe(
        """
        SELECT COALESCE(NULLIF(target_role, ''), 'unknown') AS status, COUNT(*)::int AS count
        FROM public.case_followups
        WHERE created_at >= NOW() - %s::interval
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        """,
        (interval,),
    )
    moderator = _safe(
        """
        SELECT COALESCE(NULLIF(status, ''), 'unknown') AS status, COUNT(*)::int AS count
        FROM public.moderator_updatation
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        """
    )
    return {
        "assignmentsByRole": _pairs(assignments, "role"),
        "forwardsByRole": _pairs(followups, "status"),
        "moderatorByStatus": _pairs(moderator, "status"),
        "lawyers": _scalar("SELECT COUNT(*)::int AS value FROM public.lawyers"),
        "nodalGuides": _scalar("SELECT COUNT(*)::int AS value FROM public.nodal_guides"),
        "nyaysahayakBookings": _scalar(
            "SELECT COUNT(*)::int AS value FROM public.nyaysahayak_bookings"
        ),
    }


def ai_breakdown(days: int = 30) -> dict[str, Any]:
    interval = f"{max(1, min(365, int(days or 30)))} days"
    by_task = _safe(
        """
        SELECT task, COUNT(*)::int AS count, COALESCE(SUM(total_tokens), 0)::bigint AS tokens
        FROM public.ai_usage_logs
        WHERE created_at >= NOW() - %s::interval
        GROUP BY task ORDER BY 2 DESC LIMIT 15
        """,
        (interval,),
    )
    totals = _safe(
        """
        SELECT COUNT(*)::int AS requests, COALESCE(SUM(total_tokens), 0)::bigint AS tokens
        FROM public.ai_usage_logs
        WHERE created_at >= NOW() - %s::interval
        """,
        (interval,),
    )
    row = totals[0] if totals else {}
    return {
        "requests": int(row.get("requests") or 0),
        "tokens": int(row.get("tokens") or 0),
        "byTask": [
            {
                "name": str(r.get("task")),
                "value": int(r.get("count") or 0),
                "tokens": int(r.get("tokens") or 0),
            }
            for r in by_task
        ],
    }


def recent_cases(limit: int = 10) -> list[dict[str, Any]]:
    rows = _safe(
        """
        SELECT id,
               COALESCE(NULLIF(structured_report->>'incident_type', ''), 'unclassified') AS incident,
               COALESCE(NULLIF(structured_report->>'criticality', ''), 'unset') AS criticality,
               COALESCE(NULLIF(structured_report->'location'->>'state', ''), 'unknown') AS state,
               COALESCE(NULLIF(status, ''), 'none') AS status,
               to_char(timestamp, 'YYYY-MM-DD') AS created_on
        FROM public.cases
        ORDER BY timestamp DESC
        LIMIT %s
        """,
        (max(1, min(50, int(limit or 10))),),
    )
    return [
        {
            "id": str(r.get("id")),
            "incident": str(r.get("incident")),
            "criticality": str(r.get("criticality")),
            "state": str(r.get("state")),
            "status": str(r.get("status")),
            "created_on": str(r.get("created_on")),
        }
        for r in rows
    ]


def current_config() -> dict[str, Any]:
    """Config keys the studio is allowed to reason about and change."""
    from backend.services.admin_models import read_config_key

    keys = (
        "rag_retrieval",
        "rag_funnel",
        "graph_node_models",
        "moderator_queue",
        "scam_classifier",
        "ai_embeddings",
    )
    out: dict[str, Any] = {}
    for key in keys:
        try:
            out[key] = read_config_key(key, {})
        except Exception:  # noqa: BLE001
            out[key] = {}
    return out


def impact_snapshot(days: int = 30) -> dict[str, Any]:
    """Everything the impact model needs in one read-only payload."""
    return {
        "periodDays": max(1, min(365, int(days or 30))),
        "cases": case_breakdown(days),
        "users": user_breakdown(),
        "routing": routing_breakdown(days),
        "ai": ai_breakdown(days),
        "recentCases": recent_cases(10),
        "config": current_config(),
    }
