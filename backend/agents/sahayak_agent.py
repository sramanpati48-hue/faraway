from langchain_core.messages import SystemMessage, AIMessage
from langgraph.graph import END
import backend.database.supabase_db as supabase_db
from backend import case_dispatcher


def _resolve_location(state) -> dict:
    user_details = state.get("user_details") or {}
    structured_report = state.get("structured_report") or {}
    location = state.get("location") or {}
    if not isinstance(location, dict) or not location:
        location = user_details.get("location") or {}
    if (not isinstance(location, dict) or not location) and isinstance(structured_report, dict):
        nested = structured_report.get("location")
        if isinstance(nested, dict):
            location = nested
    return location if isinstance(location, dict) else {}


def _profile_in_area(profile: dict, victim_city: str, victim_state: str) -> bool:
    p_state = str(profile.get("state") or "").strip().lower()
    p_city = str(profile.get("city") or "").strip().lower()
    p_loc = str(profile.get("location") or "").strip().lower()
    v_state = (victim_state or "").strip().lower()
    v_city = (victim_city or "").strip().lower()
    if v_state and (p_state == v_state or (p_loc and v_state in p_loc)):
        return True
    if v_city and (p_city == v_city or (p_loc and v_city in p_loc)):
        return True
    return False


def sahayak_agent(state):
    print(f"\n🤝 SAHAYAK AGENT (HUMAN HANDOFF) ACTIVATED")
    print(f"   Routing case to a Physical Nyay Guide...")

    user_details = state.get("user_details", {})
    user_id = state.get("user_id", "") or user_details.get("user_id", "")
    user_name = state.get("user_name", "") or "User"
    session_id = state.get("session_id", "") or user_details.get("session_id", "")
    structured_report = state.get("structured_report", {})
    location = _resolve_location(state)
    victim_city = str(location.get("city") or "").strip()
    victim_state = str(location.get("state") or "").strip()

    if not user_id:
        response_text = "Please log in to request a Nyay Guide."
        return {
            "messages": [SystemMessage(content=response_text)],
            "final_response": response_text,
            "suggested_actions": [],
            "next_step": END,
        }

    # 1. Store the case with location (+ PDF if available)
    pdf_url = state.get("pdf_url") or (
        structured_report.get("pdf_url") if isinstance(structured_report, dict) else None
    )
    if not pdf_url and state.get("case_id"):
        try:
            pdf_url = supabase_db.get_case_pdf_url(state.get("case_id"))
        except Exception:
            pdf_url = None
    sahayak_case_id = supabase_db.forward_case_to_sahayak(
        user_id=user_id,
        user_name=user_name,
        structured_report=structured_report,
        session_id=session_id,
        location=location,
        pdf_url=pdf_url,
    )

    # 2. Push-notify ranked online sahayaks in the victim's area
    if sahayak_case_id:
        recipients = case_dispatcher.dispatch_sahayak_case(
            case_id=sahayak_case_id,
            user_id=user_id,
            user_name=user_name,
            structured_report=structured_report if isinstance(structured_report, dict) else {},
            session_id=session_id,
            location=location,
        )
        print(f"   📢 Notified sahayaks: {recipients}")

    # 3. Profiles for victim browse — prefer in-area
    sahayak_profiles = supabase_db.get_all_sahayak_profiles() or []
    in_area = [
        p for p in sahayak_profiles
        if _profile_in_area(p, victim_city, victim_state)
    ]
    pool = in_area if in_area else sahayak_profiles
    recommended_sahayaks = [
        {
            "uid": p.get("uid", ""),
            "name": p.get("name", "Nyay Guide"),
            "location": p.get("location", "Nearby"),
            "state": p.get("state", ""),
            "city": p.get("city", ""),
            "occupation": p.get("occupation", "Community Legal Aid"),
            "bio": p.get("bio", ""),
            "avatar": p.get("avatar", ""),
            "contact_number": p.get("contact_number", ""),
            "email": p.get("email", ""),
            "availability": p.get("availability", "Available"),
            "rating": p.get("rating", 4.5),
            "cases_resolved": p.get("cases_resolved", 0),
            "languages": p.get("languages", ["Hindi", "English"]),
        }
        for p in pool
    ]

    area_label = ", ".join([x for x in [victim_city, victim_state] if x and x.lower() != "unknown"]) or "your area"
    response_text = (
        f"I have registered your case and alerted Nyay Guides available near {area_label}. "
        "Here are Sahayaks you can view, contact, and accept for hands-on assistance."
    )

    print(f"   ✅ Sahayak case created: {sahayak_case_id}")
    print(f"   👥 Returning {len(recommended_sahayaks)} sahayak profiles to frontend")
    if sahayak_case_id:
        try:
            supabase_db.mark_case_forwarded(
                role="sahayak",
                target_id=str(sahayak_case_id),
                case_id=str(state.get("case_id") or sahayak_case_id),
                session_id=session_id,
                user_id=user_id,
                structured_report=structured_report if isinstance(structured_report, dict) else {},
                pdf_url=pdf_url,
            )
        except Exception as fwd_err:
            print(f"   ⚠️ mark_case_forwarded skipped: {fwd_err}")

    return {
        "messages": [AIMessage(content=response_text)],
        "final_response": response_text,
        "suggested_actions": [],
        "next_step": END,
        "recommended_sahayaks": recommended_sahayaks,
        "sahayak_case_id": sahayak_case_id,
        "show_sahayak_panel": True,
        "location": location,
        "forwarded_role": "sahayak" if sahayak_case_id else None,
        "forwarded_target_id": sahayak_case_id,
        "pdf_url": pdf_url,
    }
