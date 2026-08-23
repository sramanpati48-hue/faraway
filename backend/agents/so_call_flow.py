"""Helpers for one-time unpaid sexual-offence confirmation calls."""
from __future__ import annotations

import re
from typing import Any

from backend.database import supabase_db


def _is_yes(value: Any) -> bool:
    text = str(value or "").strip().lower()
    return any(
        token in text
        for token in ("yes", "y", "haan", "ha", "हाँ", "हां", "হ্যাঁ", "ஆம்", "అవును", "होय")
    )


def phone_from_answers(collected: dict | None) -> str:
    answers = collected or {}
    raw = str(answers.get("contact_phone") or answers.get("phone") or "").strip()
    digits = re.sub(r"\D", "", raw)
    if len(digits) >= 10:
        return digits[-10:]
    return raw


def compose_so_rights_message(structured_report: dict | None) -> str:
    report = structured_report or {}
    sections = [str(s).strip() for s in (report.get("statutory_sections") or []) if str(s).strip()]
    if not sections:
        sections = [
            "BNS / IPC provisions on sexual assault and outraging modesty",
            "POSH Act (if the incident is at a workplace)",
            "Protection of Children from Sexual Offences Act (if a minor is involved)",
        ]
    lines = "\n".join(f"- {s}" for s in sections[:4])
    return (
        "You do not need to share more detail than you already have.\n\n"
        "**What the law can offer in a situation like this:**\n"
        f"{lines}\n\n"
        "You can file a police complaint, seek a protection order, and ask for a female officer. "
        "If you want a female Nyay Guide, a moderator will place **one confirmation call** to you "
        "(no payment). After that call, the guide receives your case."
    )


def enqueue_so_confirmation_call(state: dict, structured_report: dict) -> dict:
    """Create a pending moderator confirmation-call row. Never assigns the guide yet."""
    collected = state.get("collected_answers") or {}
    user_id = str(state.get("user_id") or (state.get("user_details") or {}).get("user_id") or "")
    snapshot = {}
    try:
        snapshot = supabase_db.get_user_contact_snapshot(user_id) or {}
    except Exception:
        snapshot = {}
    phone = phone_from_answers(collected) or str(state.get("victim_phone") or snapshot.get("phone") or "")
    name = (
        str(state.get("user_name") or "").strip()
        or str(snapshot.get("name") or "").strip()
        or "Survivor"
    )
    row = supabase_db.create_so_call_confirmation(
        case_id=str(state.get("case_id") or "") or None,
        session_id=str(state.get("session_id") or (state.get("user_details") or {}).get("session_id") or "")
        or None,
        user_id=user_id or None,
        victim_name=name,
        victim_phone=phone,
        structured_report=structured_report,
        document_summary=str(state.get("document_analysis") or ""),
    )
    confirmation_id = str((row or {}).get("id") or "")
    try:
        from backend.websocket_manager import manager

        manager.broadcast_sync(
            {
                "type": "so_call_confirmation",
                "confirmation": row,
            },
            channel="moderator",
        )
    except Exception:
        pass
    pending_msg = (
        compose_so_rights_message(structured_report)
        + "\n\n**Status:** Confirmation call pending. A moderator will call you once, free of charge. "
        "Your case is not assigned to a Nyay Guide until that call is done."
    )
    if not phone:
        pending_msg += (
            "\n\nWe do not have a phone number yet. Please reply with a 10-digit mobile number "
            "so the confirmation call can be placed."
        )
    return {
        "so_call_confirmation_id": confirmation_id,
        "waiting_for_so_call_confirmation": True,
        "victim_phone": phone,
        "show_female_nyayguide_panel": False,
        "show_female_lawyer_panel": False,
        "intervention_required": False,
        "final_response": pending_msg,
    }


def wants_female_nyayguide(collected: dict | None, structured_report: dict | None = None) -> bool:
    answers = collected or {}
    report = structured_report or {}
    if _is_yes(answers.get("female_nyayguide_needed") or answers.get("counsellor_needed")):
        return True
    if _is_yes(answers.get("confirm_call_consent")):
        return True
    return bool(report.get("female_nyayguide_support_enabled"))


def consented_to_confirmation_call(collected: dict | None) -> bool:
    answers = collected or {}
    if "confirm_call_consent" in answers:
        return _is_yes(answers.get("confirm_call_consent"))
    return _is_yes(answers.get("female_nyayguide_needed"))
