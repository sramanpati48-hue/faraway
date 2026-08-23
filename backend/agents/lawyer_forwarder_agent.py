from langchain_core.messages import SystemMessage
from langgraph.graph import END
import backend.database.supabase_db as supabase_db


def _resolve_lawyer_search_key(state: dict) -> str:
    """Prefer explicit category from suggestions, then report incident / case category."""
    structured_report = state.get("structured_report") if isinstance(state.get("structured_report"), dict) else {}
    explicit = str(state.get("lawyer_category") or "").strip()
    if explicit:
        return explicit
    incident_type = str(structured_report.get("incident_type") or "").strip()
    case_category = str(state.get("case_category") or structured_report.get("case_category") or "").strip()
    if incident_type:
        return incident_type
    if case_category:
        return case_category

    messages = state.get("messages") or []
    if messages:
        last_msg = str(getattr(messages[-1], "content", messages[-1]) or "").lower()
        if "cyber" in last_msg or "fraud" in last_msg or "scam" in last_msg:
            return "Cyber & Financial Fraud"
        if "property" in last_msg or "civil" in last_msg or "consumer" in last_msg:
            return "Civil & Consumer Disputes"
        if "divorce" in last_msg or "family" in last_msg or "domestic" in last_msg:
            return "Family & Matrimonial"
        if any(k in last_msg for k in ("criminal", "assault", "fir", "theft", "missing")):
            return "Criminal Law"
    return "General Practice"


def lawyer_forwarder_agent(state):
    print("\n⚖️ LAWYER RECOMMENDATION AGENT ACTIVATED")

    structured_report = state.get("structured_report", {})
    if not isinstance(structured_report, dict):
        structured_report = {}
    user_id = state.get("user_id", "")
    user_name = state.get("user_name", "User")
    session_id = state.get("session_id", "")

    search_key = _resolve_lawyer_search_key(state)
    print(f"   Searching for lawyers specializing in: {search_key}")

    lawyers = supabase_db.search_lawyers_by_specialization(search_key, limit=12)

    lawyer_case_id = None
    pdf_url = state.get("pdf_url") or structured_report.get("pdf_url")
    if not pdf_url and state.get("case_id"):
        try:
            pdf_url = supabase_db.get_case_pdf_url(state.get("case_id"))
        except Exception:
            pdf_url = None
    if not pdf_url and state.get("case_id") and structured_report:
        try:
            from backend.database.pdf_service import ensure_report_pdf_url

            pdf_url = ensure_report_pdf_url(
                structured_report,
                str(state.get("case_id")),
                str(user_id),
                answers=state.get("collected_answers") if isinstance(state.get("collected_answers"), dict) else None,
                existing_url=pdf_url,
            )
            if pdf_url:
                structured_report = {**structured_report, "pdf_url": pdf_url}
                try:
                    supabase_db.update_case_pdf_url(state.get("case_id"), pdf_url)
                except Exception:
                    pass
        except Exception as pdf_err:
            print(f"   ⚠️ lawyer-forward PDF generate skipped: {pdf_err}")
    if user_id and structured_report:
        try:
            lawyer_case_id = supabase_db.forward_case_to_lawyer(
                user_id=user_id,
                user_name=user_name,
                structured_report=structured_report,
                session_id=session_id or None,
                pdf_url=pdf_url,
            )
            print(f"   ✅ Case forwarded to lawyer dashboard with ID: {lawyer_case_id}")
            try:
                supabase_db.mark_case_forwarded(
                    role="lawyer",
                    target_id=str(lawyer_case_id),
                    case_id=str(state.get("case_id") or lawyer_case_id),
                    session_id=session_id,
                    user_id=user_id,
                    structured_report=structured_report,
                    pdf_url=pdf_url,
                )
            except Exception as fwd_err:
                print(f"   ⚠️ mark_case_forwarded skipped: {fwd_err}")
        except Exception as e:
            print(f"   ⚠️ Could not forward case to lawyer dashboard: {e}")

    if lawyers and len(lawyers) > 0:
        response_text = (
            f"✅ I've found **{len(lawyers)} verified lawyers** matched to **{search_key}**. "
            "Open the lawyer selection window to browse profiles, fees, and connect."
        )
        actions = [
            {"label": "Browse matched lawyers", "action": "show_lawyers", "payload": "show_lawyers"},
            {
                "label": "No, I'll handle it myself",
                "action": "end",
                "payload": "No thanks, I'll proceed on my own.",
            },
        ]
    else:
        response_text = (
            f"We are currently updating our database of verified lawyers for **{search_key}**.\n\n"
            "In the meantime, you can visit the [National Legal Services Authority (NALSA)]"
            "(https://nalsa.gov.in/) website to find free legal aid in your jurisdiction."
        )
        lawyers = []
        actions = []

    return {
        "messages": [SystemMessage(content=response_text)],
        "final_response": response_text,
        "next_step": END,
        "suggested_actions": actions,
        "recommended_lawyers": lawyers,
        "lawyer_case_id": lawyer_case_id,
        "lawyer_category": search_key,
        "show_lawyer_panel": True if lawyers else False,
        "pdf_url": pdf_url,
        "structured_report": structured_report,
        "forwarded_role": "lawyer" if lawyer_case_id else None,
        "forwarded_target_id": lawyer_case_id,
    }
