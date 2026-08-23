"""Moderator capacity config, SLA delay ticks, and revision embeddings."""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Optional

import backend.database.supabase_db as supabase_db
from backend.services import admin_models
from backend.websocket_manager import manager

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG: dict[str, Any] = {
    "cases_per_hour": 5,
    "sla_minutes": 60,
    "delay_tick_minutes": 5,
    "respect_penalty_per_tick": 1,
}

_ticker_started = False
_ticker_lock = threading.Lock()
_last_tick_key: dict[str, float] = {}


def get_queue_config() -> dict[str, Any]:
    cfg = admin_models.read_config_key("moderator_queue", dict(_DEFAULT_CONFIG))
    merged = {**_DEFAULT_CONFIG, **(cfg or {})}
    merged["cases_per_hour"] = max(1, int(merged.get("cases_per_hour") or 5))
    merged["sla_minutes"] = max(1, int(merged.get("sla_minutes") or 60))
    merged["delay_tick_minutes"] = max(1, int(merged.get("delay_tick_minutes") or 5))
    merged["respect_penalty_per_tick"] = max(
        0.0, float(merged.get("respect_penalty_per_tick") or 1)
    )
    return merged


def embed_revision_async(revision_id: str, text: str) -> None:
    if not revision_id or not (text or "").strip():
        return

    def _run() -> None:
        try:
            from backend.database.vector_db import VectorDB

            vdb = VectorDB()
            vec = vdb._embed_query_text(text[:6000])
            if vec:
                supabase_db.set_moderator_revision_embedding(revision_id, vec)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Revision embed failed for %s: %s", revision_id, exc)

    threading.Thread(target=_run, daemon=True, name=f"rev-embed-{revision_id[:8]}").start()


def create_revision_with_embed(
    *,
    intervention_id: str,
    agent_payload: dict,
    agent_report: dict | None = None,
    case_id: str | None = None,
    user_statement: str = "",
) -> Optional[str]:
    rev_id = supabase_db.create_moderator_case_revision(
        intervention_id=intervention_id,
        agent_payload=agent_payload,
        agent_report=agent_report,
        case_id=case_id,
        user_statement=user_statement,
    )
    if rev_id:
        report = agent_report if isinstance(agent_report, dict) else {}
        search = " ".join(
            [
                str(report.get("incident_type") or ""),
                str(report.get("summary") or ""),
                user_statement or "",
            ]
        ).strip()
        if search:
            embed_revision_async(rev_id, search)
    return rev_id


def run_sla_delay_ticks() -> dict[str, Any]:
    """Apply delay ticks for overdue pending interventions. Idempotent per tick window."""
    cfg = get_queue_config()
    sla_minutes = cfg["sla_minutes"]
    tick_minutes = cfg["delay_tick_minutes"]
    penalty = cfg["respect_penalty_per_tick"]
    tick_seconds = tick_minutes * 60
    now = time.time()

    candidates = supabase_db.list_sla_breach_candidates(sla_minutes)
    applied = 0
    warnings: list[dict] = []

    for row in candidates or []:
        iid = str(row.get("id") or "")
        mid = str(row.get("assigned_moderator_id") or "")
        if not iid or not mid:
            continue
        # Throttle: at most one tick per intervention per delay_tick_minutes
        last = _last_tick_key.get(iid, 0.0)
        if now - last < tick_seconds - 5:
            continue
        updated = supabase_db.apply_intervention_delay_tick(iid, mid, penalty)
        if not updated:
            continue
        _last_tick_key[iid] = now
        applied += 1
        report = row.get("structured_report") or {}
        if isinstance(report, str):
            report = {}
        payload = {
            "type": "intervention_sla_warning",
            "case_id": iid,
            "delay_score": int(updated.get("delay_score") or 0),
            "respect_score": float(updated.get("respect_score") or 0),
            "sla_minutes": sla_minutes,
            "delay_tick_minutes": tick_minutes,
            "message": (
                f"Delay score is increasing every {tick_minutes} minutes. "
                "This affects your respect with the team."
            ),
            "incident_type": (report or {}).get("incident_type") if isinstance(report, dict) else None,
        }
        warnings.append(payload)
        try:
            manager.send_to_uids_sync([mid], payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning("SLA WS warn failed for %s: %s", mid, exc)

    # Prune stale keys
    if len(_last_tick_key) > 2000:
        cutoff = now - tick_seconds * 4
        for k, ts in list(_last_tick_key.items()):
            if ts < cutoff:
                _last_tick_key.pop(k, None)

    return {"applied": applied, "candidates": len(candidates or []), "warnings": len(warnings)}


def start_sla_ticker_in_background() -> None:
    """Lightweight in-process loop (safe for local/dev; cron covers Cloud Run)."""
    global _ticker_started
    with _ticker_lock:
        if _ticker_started:
            return
        _ticker_started = True

    def _loop() -> None:
        while True:
            try:
                cfg = get_queue_config()
                sleep_s = max(30, int(cfg["delay_tick_minutes"]) * 60)
                run_sla_delay_ticks()
            except Exception as exc:  # noqa: BLE001
                logger.warning("SLA ticker error: %s", exc)
                sleep_s = 60
            time.sleep(sleep_s)

    threading.Thread(target=_loop, daemon=True, name="moderator-sla-ticker").start()
    logger.info("Moderator SLA ticker started")


def moderator_stats_for(uid: str) -> dict[str, Any]:
    cfg = get_queue_config()
    used = supabase_db.count_assigned_interventions_in_hour(uid)
    open_count = supabase_db.count_open_assigned_interventions(uid)
    perf = supabase_db.get_moderator_performance(uid)
    pending = supabase_db.get_assigned_interventions_for_moderator(uid, include_resolved=False)
    breached = sum(1 for c in pending if (c.get("delay_score") or 0) > 0 or c.get("sla_breached_at"))
    return {
        "cases_per_hour": cfg["cases_per_hour"],
        "assigned_in_hour": used,
        "capacity_remaining": max(0, cfg["cases_per_hour"] - used),
        "open_pending": open_count,
        "sla_minutes": cfg["sla_minutes"],
        "delay_tick_minutes": cfg["delay_tick_minutes"],
        "respect_score": float(perf.get("respect_score") or 100),
        "delay_score_total": int(perf.get("delay_score_total") or 0),
        "cases_resolved": int(perf.get("cases_resolved") or 0),
        "cases_breached": int(perf.get("cases_breached") or 0),
        "overdue_open": breached,
    }


def try_claim_unassigned_for(uid: str) -> list[str]:
    """Assign orphaned pending interventions to an under-capacity online moderator."""
    if not uid:
        return []
    cfg = get_queue_config()
    remaining = cfg["cases_per_hour"] - supabase_db.count_assigned_interventions_in_hour(uid)
    if remaining <= 0:
        return []
    claimed: list[str] = []
    for row in supabase_db.list_unassigned_pending_interventions(remaining) or []:
        iid = str(row.get("id") or "")
        if not iid:
            continue
        if supabase_db.assign_intervention_moderator(iid, uid):
            claimed.append(iid)
            try:
                report = row.get("structured_report") or {}
                if isinstance(report, str):
                    report = {}
                manager.send_to_uids_sync(
                    [uid],
                    {
                        "type": "new_intervention",
                        "case_id": iid,
                        "user_id": row.get("user_id"),
                        "incident_type": (report or {}).get("incident_type", "Unknown"),
                        "risk_level": (report or {}).get("risk_level", "High"),
                        "structured_report": report,
                        "collection": "moderator",
                        "session_id": row.get("session_id"),
                        "user_statement": row.get("user_statement") or "",
                        "location": row.get("location") or {},
                        "assigned_moderator_id": uid,
                        "delay_score": 0,
                        "timestamp": int(time.time() * 1000),
                    },
                )
            except Exception:
                pass
        if len(claimed) >= remaining:
            break
    return claimed
