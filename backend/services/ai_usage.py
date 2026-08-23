"""AI usage logging and analytics for admin overview charts."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from backend.database.postgres_pool import execute, execute_void, is_postgres_configured


def estimate_tokens(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


def log_ai_usage(
    *,
    task: str,
    model: str,
    provider: str | None = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int | None = None,
) -> None:
    if not is_postgres_configured():
        return
    total = total_tokens if total_tokens is not None else (prompt_tokens + completion_tokens)
    try:
        execute_void(
            """
            INSERT INTO public.ai_usage_logs
              (task, model, provider, prompt_tokens, completion_tokens, total_tokens)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (task, model, provider, prompt_tokens, completion_tokens, total),
        )
    except Exception as exc:
        print(f"⚠️ Failed to log AI usage: {exc}")


def _bucket_unit(days: int) -> str:
    return "hour" if days <= 2 else "day"


def _format_bucket_label(bucket: Any, days: int) -> str:
    if isinstance(bucket, datetime):
        dt = bucket
    else:
        dt = datetime.fromisoformat(str(bucket).replace("Z", "+00:00"))
    if days <= 2:
        return dt.strftime("%b %d %H:%M")
    return dt.strftime("%b %d")


def _bucket_key(bucket: Any) -> str:
    if isinstance(bucket, datetime):
        return bucket.isoformat()
    return str(bucket)


def _sort_ts(bucket: Any) -> float:
    if isinstance(bucket, datetime):
        dt = bucket if bucket.tzinfo is not None else bucket.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    try:
        dt = datetime.fromisoformat(str(bucket).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return 0.0


def _generate_bucket_range(period_days: int) -> list[datetime]:
    """Inclusive UTC buckets matching the SQL date_trunc grain."""
    now = datetime.now(timezone.utc)
    unit = _bucket_unit(period_days)
    if unit == "hour":
        end = now.replace(minute=0, second=0, microsecond=0)
        start = end - timedelta(hours=max(1, period_days * 24) - 1)
        step = timedelta(hours=1)
    else:
        end = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start = end - timedelta(days=max(1, period_days) - 1)
        step = timedelta(days=1)

    out: list[datetime] = []
    cur = start
    while cur <= end:
        out.append(cur)
        cur += step
    return out


def get_ai_usage_analytics(days: int = 7) -> dict[str, Any]:
    period_days = max(1, min(90, int(days or 7)))
    empty = {
        "periodDays": period_days,
        "totals": {"requests": 0, "tokens": 0},
        "requestsByTask": [],
        "tokensByTask": [],
        "requestsByModel": [],
        "tokensByModel": [],
        "models": [],
        "timeSeries": [],
    }
    if not is_postgres_configured():
        return empty

    interval = f"{period_days} days"
    unit = _bucket_unit(period_days)
    bucket_sql = f"date_trunc('{unit}', created_at)"
    step = "1 hour" if unit == "hour" else "1 day"

    totals = execute(
        """
        SELECT COUNT(*)::int AS requests, COALESCE(SUM(total_tokens), 0)::bigint AS tokens
        FROM public.ai_usage_logs
        WHERE created_at >= NOW() - %s::interval
        """,
        (interval,),
    )
    task_rows = execute(
        """
        SELECT task, COUNT(*)::int AS requests, COALESCE(SUM(total_tokens), 0)::bigint AS tokens
        FROM public.ai_usage_logs
        WHERE created_at >= NOW() - %s::interval
        GROUP BY task ORDER BY COUNT(*) DESC
        """,
        (interval,),
    )
    model_rows = execute(
        """
        SELECT model, COUNT(*)::int AS requests, COALESCE(SUM(total_tokens), 0)::bigint AS tokens
        FROM public.ai_usage_logs
        WHERE created_at >= NOW() - %s::interval
        GROUP BY model ORDER BY COUNT(*) DESC
        """,
        (interval,),
    )
    # Fill every bucket in the period (including zero-usage days/hours) so charts stay hoverable.
    series_rows = execute(
        f"""
        WITH buckets AS (
          SELECT generate_series(
            date_trunc('{unit}', NOW() - %s::interval),
            date_trunc('{unit}', NOW()),
            %s::interval
          ) AS bucket
        ),
        models AS (
          SELECT DISTINCT model
          FROM public.ai_usage_logs
          WHERE created_at >= NOW() - %s::interval
        ),
        agg AS (
          SELECT {bucket_sql} AS bucket, model,
                 COUNT(*)::int AS requests,
                 COALESCE(SUM(total_tokens), 0)::bigint AS tokens
          FROM public.ai_usage_logs
          WHERE created_at >= NOW() - %s::interval
          GROUP BY 1, model
        )
        SELECT b.bucket,
               m.model,
               COALESCE(a.requests, 0)::int AS requests,
               COALESCE(a.tokens, 0)::bigint AS tokens
        FROM buckets b
        LEFT JOIN models m ON TRUE
        LEFT JOIN agg a ON a.bucket = b.bucket AND a.model = m.model
        ORDER BY b.bucket ASC, m.model ASC NULLS LAST
        """,
        (interval, step, interval, interval),
    )

    t = totals[0] if totals else {"requests": 0, "tokens": 0}
    models = sorted({str(r["model"]) for r in model_rows if r.get("model")})

    bucket_map: dict[str, dict[str, Any]] = {}
    for row in series_rows:
        b = row["bucket"]
        key = _bucket_key(b)
        if key not in bucket_map:
            bucket_map[key] = {
                "label": _format_bucket_label(b, period_days),
                "bucket": key,
                "sort": _sort_ts(b),
                "byModel": {},
            }
        model = row.get("model")
        if model:
            bucket_map[key]["byModel"][str(model)] = {
                "requests": int(row["requests"] or 0),
                "tokens": int(row["tokens"] or 0),
            }

    # If the DB returned no rows at all (unlikely), still synthesize buckets locally.
    if not bucket_map:
        for b in _generate_bucket_range(period_days):
            key = b.isoformat()
            bucket_map[key] = {
                "label": _format_bucket_label(b, period_days),
                "bucket": key,
                "sort": _sort_ts(b),
                "byModel": {},
            }

    ordered = sorted(bucket_map.values(), key=lambda e: e["sort"])
    time_series = []
    for entry in ordered:
        by_model = entry["byModel"]
        flat: dict[str, Any] = {
            "label": entry["label"],
            "bucket": entry["bucket"],
            "byModel": by_model,
        }
        for model in models:
            stats = by_model.get(model) or {"requests": 0, "tokens": 0}
            flat[f"{model}__requests"] = stats["requests"]
            flat[f"{model}__tokens"] = stats["tokens"]
        time_series.append(flat)

    return {
        "periodDays": period_days,
        "totals": {"requests": int(t.get("requests") or 0), "tokens": int(t.get("tokens") or 0)},
        "requestsByTask": [{"name": r["task"], "value": int(r["requests"] or 0)} for r in task_rows],
        "tokensByTask": [{"name": r["task"], "value": int(r["tokens"] or 0)} for r in task_rows],
        "requestsByModel": [{"name": r["model"], "value": int(r["requests"] or 0)} for r in model_rows],
        "tokensByModel": [{"name": r["model"], "value": int(r["tokens"] or 0)} for r in model_rows],
        "models": models,
        "timeSeries": time_series,
    }
