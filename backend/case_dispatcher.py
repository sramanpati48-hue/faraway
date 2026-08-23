"""
Push-on-create case assignment.

Picks a ranked top-3 set of available moderators / in-area sahayaks from the
in-memory presence queue and pushes WebSocket notifications. Replaces the
legacy DB webhook poller fan-out.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional

import backend.database.supabase_db as supabase_db
from backend.websocket_manager import manager

logger = logging.getLogger(__name__)

TOP_N = 3


def _norm(s: Any) -> str:
    return str(s or "").strip().lower()


def _pick_exclusive_moderator(online: List[Dict[str, Any]], cases_per_hour: int) -> Optional[str]:
    """Pick one under-capacity online moderator with even load + higher respect."""
    if not online:
        return None
    uids = [str(p.get("uid") or "") for p in online if p.get("uid")]
    respect = {}
    try:
        if hasattr(supabase_db, "get_moderator_respect_scores"):
            respect = supabase_db.get_moderator_respect_scores(uids) or {}
    except Exception:
        respect = {}

    enriched: List[Dict[str, Any]] = []
    for person in online:
        uid = str(person.get("uid") or "")
        if not uid:
            continue
        assigned_hour = int(person.get("assigned_in_hour") or 0)
        if assigned_hour >= cases_per_hour:
            continue
        open_cases = int(person.get("open_cases") or 0)
        enriched.append(
            {
                **person,
                "uid": uid,
                "assigned_in_hour": assigned_hour,
                "open_cases": open_cases,
                "respect": float(respect.get(uid, 100)),
                "connected_at": float(person.get("connected_at") or 0),
            }
        )
    if not enriched:
        return None
    enriched.sort(
        key=lambda p: (
            p["assigned_in_hour"],
            p["open_cases"],
            -p["respect"],
            p["connected_at"],
        )
    )
    return enriched[0]["uid"]


def _area_match(person: Dict[str, Any], victim_city: str, victim_state: str) -> bool:
    p_state = _norm(person.get("state"))
    p_city = _norm(person.get("city"))
    p_loc = _norm(person.get("location"))
    v_state = _norm(victim_state)
    v_city = _norm(victim_city)
    if v_state and (p_state == v_state or (p_loc and v_state in p_loc)):
        return True
    if v_city and (p_city == v_city or (p_loc and v_city in p_loc)):
        return True
    return False


def _extract_victim_area(location: Optional[dict]) -> tuple[str, str]:
    loc = location if isinstance(location, dict) else {}
    city = str(loc.get("city") or "").strip()
    state = str(loc.get("state") or "").strip()
    if city.lower() in {"unknown", "none", "null"}:
        city = ""
    if state.lower() in {"unknown", "none", "null", "all"}:
        state = ""
    return city, state


def _rank_moderators(online: List[Dict[str, Any]]) -> List[str]:
    ranked = sorted(
        online,
        key=lambda p: (int(p.get("open_cases") or 0), float(p.get("connected_at") or 0)),
    )
    return [p["uid"] for p in ranked[:TOP_N] if p.get("uid")]


def _rank_sahayaks(
    online: List[Dict[str, Any]],
    victim_city: str,
    victim_state: str,
    profiles_by_uid: Dict[str, dict],
) -> List[str]:
    enriched = []
    for p in online:
        uid = p.get("uid")
        if not uid:
            continue
        profile = profiles_by_uid.get(uid) or {}
        merged = {
            **p,
            "state": p.get("state") or profile.get("state") or "",
            "city": p.get("city") or profile.get("city") or "",
            "location": profile.get("location") or "",
            "rating": float(profile.get("rating") or 0),
        }
        enriched.append(merged)

    in_area = [p for p in enriched if _area_match(p, victim_city, victim_state)]
    pool = in_area if in_area else enriched  # only fall back when zero in-area
    ranked = sorted(
        pool,
        key=lambda p: (
            -float(p.get("rating") or 0),
            int(p.get("open_cases") or 0),
            float(p.get("connected_at") or 0),
        ),
    )
    return [p["uid"] for p in ranked[:TOP_N] if p.get("uid")]


def dispatch_intervention(
    *,
    case_id: str,
    user_id: Optional[str],
    structured_report: Optional[dict],
    collection_name: str = "moderator",
    session_id: Optional[str] = None,
    user_statement: str = "",
    location: Optional[dict] = None,
    created_at: Optional[str] = None,
    agent_payload: Optional[dict] = None,
) -> List[str]:
    """Exclusively assign one under-capacity online moderator and notify them."""
    if not case_id:
        return []

    s_report = structured_report or {}
    if isinstance(s_report, str):
        try:
            s_report = json.loads(s_report)
        except Exception:
            s_report = {}

    loc = location if isinstance(location, dict) else {}
    online = manager.list_online("moderator")

    cases_per_hour = 5
    try:
        from backend.services.moderator_queue import get_queue_config

        cases_per_hour = int(get_queue_config().get("cases_per_hour") or 5)
    except Exception:
        pass

    try:
        for person in online:
            uid = person.get("uid")
            if not uid:
                continue
            if hasattr(supabase_db, "count_open_assigned_interventions"):
                person["open_cases"] = supabase_db.count_open_assigned_interventions(uid)
            elif hasattr(supabase_db, "count_notified_pending_interventions"):
                person["open_cases"] = supabase_db.count_notified_pending_interventions(uid)
            if hasattr(supabase_db, "count_assigned_interventions_in_hour"):
                person["assigned_in_hour"] = supabase_db.count_assigned_interventions_in_hour(uid)
    except Exception:
        pass

    assignee = _pick_exclusive_moderator(online, cases_per_hour)
    recipients = [assignee] if assignee else []
    if not recipients:
        logger.warning(
            "No under-capacity online moderators for intervention %s (online=%s)",
            case_id,
            len(online),
        )
        # Persist empty notify so case stays pending for later reassignment
        try:
            supabase_db.set_intervention_notified_users(case_id, [])
        except Exception as e:
            logger.error("Failed to clear notified moderators for %s: %s", case_id, e)
    else:
        try:
            if hasattr(supabase_db, "assign_intervention_moderator"):
                supabase_db.assign_intervention_moderator(case_id, assignee)
            else:
                supabase_db.set_intervention_notified_users(case_id, recipients)
        except Exception as e:
            logger.error("Failed to assign moderator for %s: %s", case_id, e)

    # Audit row: agent payload vs later moderator edits
    try:
        from backend.services.moderator_queue import create_revision_with_embed

        payload = dict(agent_payload or {})
        payload.setdefault("user_id", user_id)
        payload.setdefault("session_id", session_id)
        payload.setdefault("user_statement", user_statement or "")
        payload.setdefault("location", loc)
        payload.setdefault("collection_name", collection_name or "moderator")
        create_revision_with_embed(
            intervention_id=case_id,
            agent_payload=payload,
            agent_report=s_report if isinstance(s_report, dict) else {},
            case_id=case_id,
            user_statement=user_statement or "",
        )
    except Exception as e:
        logger.warning("Failed to create moderator revision for %s: %s", case_id, e)

    case_data = {
        "type": "new_intervention",
        "case_id": case_id,
        "user_id": user_id,
        "incident_type": s_report.get("incident_type", "Unknown"),
        "risk_level": s_report.get("risk_level", "High"),
        "structured_report": s_report,
        "collection": collection_name or "moderator",
        "created_at": str(created_at or ""),
        "timestamp": int(time.time() * 1000),
        "session_id": session_id,
        "user_statement": user_statement or "",
        "location": loc,
        "pdf_url": s_report.get("pdf_url") if isinstance(s_report, dict) else None,
        "notified_user_ids": recipients,
        "assigned_moderator_id": assignee,
        "assigned_at": str(created_at or ""),
        "delay_score": 0,
        "routing_recommendation": supabase_db.get_intervention_routing_recommendation(
            s_report,
            user_statement or "",
            loc,
        ),
    }

    if recipients:
        manager.send_to_uids_sync(recipients, case_data)
        logger.info("Dispatched intervention %s exclusively to %s", case_id, recipients)
    return recipients


def dispatch_sahayak_case(
    *,
    case_id: str,
    user_id: Optional[str],
    user_name: str = "",
    structured_report: Optional[dict] = None,
    session_id: Optional[str] = None,
    location: Optional[dict] = None,
    created_at: Optional[str] = None,
) -> List[str]:
    """Notify top-3 online in-area sahayaks about a new case."""
    if not case_id:
        return []

    s_report = structured_report or {}
    if isinstance(s_report, str):
        try:
            s_report = json.loads(s_report)
        except Exception:
            s_report = {}

    loc = location if isinstance(location, dict) else {}
    if not loc and isinstance(s_report, dict):
        nested = s_report.get("location")
        if isinstance(nested, dict):
            loc = nested

    victim_city, victim_state = _extract_victim_area(loc)
    online = manager.list_online("sahayak")

    profiles_by_uid: Dict[str, dict] = {}
    try:
        for p in supabase_db.get_all_sahayak_profiles() or []:
            if p.get("uid"):
                profiles_by_uid[p["uid"]] = p
    except Exception:
        pass

    try:
        if hasattr(supabase_db, "count_notified_pending_sahayak_cases"):
            for person in online:
                person["open_cases"] = supabase_db.count_notified_pending_sahayak_cases(person["uid"])
    except Exception:
        pass

    recipients = _rank_sahayaks(online, victim_city, victim_state, profiles_by_uid)
    if not recipients:
        logger.warning("No online sahayaks to notify for case %s", case_id)

    try:
        supabase_db.set_sahayak_case_notified_users(case_id, recipients)
    except Exception as e:
        logger.error("Failed to persist notified sahayaks for %s: %s", case_id, e)

    case_data = {
        "type": "new_sahayak_case",
        "case_id": case_id,
        "user_id": user_id,
        "user_name": user_name or "",
        "incident_type": s_report.get("incident_type", "Unknown") if isinstance(s_report, dict) else "Unknown",
        "risk_level": s_report.get("risk_level", "High") if isinstance(s_report, dict) else "High",
        "summary": s_report.get("summary", "") if isinstance(s_report, dict) else "",
        "structured_report": s_report,
        "location": loc,
        "created_at": str(created_at or ""),
        "session_id": session_id,
        "pdf_url": s_report.get("pdf_url") if isinstance(s_report, dict) else None,
        "notified_user_ids": recipients,
    }

    if recipients:
        manager.send_to_uids_sync(recipients, case_data)
        logger.info("📢 Dispatched sahayak case %s to %s", case_id, recipients)
    return recipients


def notify_sahayak_case_claimed(case_id: str, claimed_by: str, notified_user_ids: Optional[List[str]] = None):
    """Tell other notified sahayaks that the case was claimed."""
    uids = list(notified_user_ids or [])
    if not uids:
        try:
            row = supabase_db.get_sahayak_case_row(case_id) if hasattr(supabase_db, "get_sahayak_case_row") else None
            uids = list((row or {}).get("notified_user_ids") or [])
        except Exception:
            uids = []
    others = [u for u in uids if u and u != claimed_by]
    if not others:
        return
    payload = {
        "type": "case_claimed",
        "case_id": case_id,
        "claimed_by": claimed_by,
        "role": "sahayak",
    }
    manager.send_to_uids_sync(others, payload)


def notify_intervention_claimed(case_id: str, claimed_by: str, notified_user_ids: Optional[List[str]] = None):
    """Tell other notified moderators the intervention was resolved/claimed."""
    uids = list(notified_user_ids or [])
    if not uids:
        try:
            row = (
                supabase_db.get_intervention_row(case_id)
                if hasattr(supabase_db, "get_intervention_row")
                else None
            )
            uids = list((row or {}).get("notified_user_ids") or [])
        except Exception:
            uids = []
    others = [u for u in uids if u and u != claimed_by]
    payload = {
        "type": "intervention_resolved",
        "case_id": case_id,
        "status": "resolved",
        "collection": "moderator",
        "claimed_by": claimed_by,
    }
    targets = others or uids
    if targets:
        manager.send_to_uids_sync(targets, payload)
