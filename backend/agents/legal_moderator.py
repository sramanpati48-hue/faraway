from langchain_core.messages import SystemMessage
from langgraph.graph import END
import backend.database.supabase_db as supabase_db
from backend import case_dispatcher
from backend.services.nyayguide_eligibility import (
    CODE_HUMAN_REVIEW_REQUIRED,
    WORKFLOW_MODERATOR_APPROVED,
    build_nyayguide_suggestion,
)


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


def legal_moderator_agent(state):
    print(f"\n⚖️ LEGAL MODERATOR AGENT ACTIVATED")

    structured_report = state.get("structured_report", {})
    user_details = state.get("user_details", {})
    user_id = user_details.get("user_id", "anonymous")
    session_id = user_details.get("session_id")
    case_id = state.get("case_id")
    user_statement = state.get("user_statement", "")
    location = _resolve_location(state)
    pdf_url = state.get("pdf_url") or (
        structured_report.get("pdf_url") if isinstance(structured_report, dict) else None
    )
    if not pdf_url and case_id and isinstance(structured_report, dict) and structured_report:
        try:
            from backend.database.pdf_service import ensure_report_pdf_url

            labels = state.get("question_labels")
            if not isinstance(labels, dict) or not labels:
                summary = state.get("situation_summary") if isinstance(state.get("situation_summary"), dict) else {}
                labels = summary.get("question_labels") if isinstance(summary, dict) else None
            # Embed labels on report payload so PDF renderers can resolve q_0 → text.
            report_for_pdf = dict(structured_report)
            if isinstance(labels, dict) and labels:
                report_for_pdf["question_labels"] = labels
                summary = dict(state.get("situation_summary") or {})
                summary["question_labels"] = labels
                report_for_pdf["situation_summary"] = summary

            pdf_url = ensure_report_pdf_url(
                report_for_pdf,
                str(case_id),
                str(user_id),
                answers=state.get("collected_answers") if isinstance(state.get("collected_answers"), dict) else None,
                question_labels=labels if isinstance(labels, dict) else None,
            )
            if pdf_url:
                structured_report = {**structured_report, "pdf_url": pdf_url}
        except Exception as pdf_err:
            print(f"   Warning: moderator PDF generate skipped: {pdf_err}")

    # Second pass: apply moderator resolution from admin/chat resume answers
    if state.get("waiting_for_moderator_resolution"):
        print("   → Applying moderator resolution from resume input")
        answers = state.get("collected_answers") or {}
        if not isinstance(answers, dict):
            answers = {}

        # Prefer explicit keys from admin resume; fall back to last human message
        moderator_response = str(
            answers.get("moderator_response")
            or answers.get("pending_question")
            or ""
        ).strip()
        if not moderator_response:
            for msg in reversed(state.get("messages") or []):
                if hasattr(msg, "type") and msg.type == "human":
                    moderator_response = str(msg.content or "").strip()
                    break

        options_raw = answers.get("moderator_options") or answers.get("options") or ""
        options: list = []
        if isinstance(options_raw, list):
            options = options_raw
        elif isinstance(options_raw, str) and options_raw.strip():
            # Comma / newline separated labels
            for part in options_raw.replace("\n", ",").split(","):
                label = part.strip()
                if label:
                    options.append({"label": label, "payload": label})

        if not moderator_response:
            moderator_response = (
                "Based on my review, here are the immediate next steps you should take."
            )

        # Criminal / high-severity cases: ensure lawyer + Nyay Guide (sahayak) options at flow end.
        incident = str((structured_report or {}).get("incident_type") or "").lower()
        category = str(state.get("case_category") or "").lower()
        is_criminalish = category == "criminal" or any(
            k in incident for k in ("criminal", "missing", "kidnap", "assault", "theft", "robbery")
        )
        if is_criminalish and not options:
            structured_report = {
                **(structured_report if isinstance(structured_report, dict) else {}),
                "workflow_state": WORKFLOW_MODERATOR_APPROVED,
                "nyayguide_support_needed": True,
            }
            nyayguide_option = build_nyayguide_suggestion(
                structured_report,
                support_needs_met=True,
                case_id=str(case_id) if case_id else None,
            )
            if nyayguide_option is None:
                nyayguide_option = {
                    "id": f"nyayguide_suggestion:{case_id}" if case_id else "nyayguide_suggestion",
                    "kind": "nyayguide_suggestion",
                    "label": "Connect to Nyay Guide",
                    "node": "sahayak",
                    "payload": "Request Human Help",
                    "requires_user_confirmation": True,
                    "enabled": False,
                    "workflow_state": "HIGH_RISK_HUMAN_REVIEW",
                    "blocked_reason": CODE_HUMAN_REVIEW_REQUIRED,
                }
            options = [
                {"label": "Recommend a lawyer", "node": "lawyer_forwarder", "payload": "Please recommend a lawyer for my case"},
                nyayguide_option,
            ]

        try:
            if case_id:
                supabase_db.resolve_intervention_case(
                    case_id,
                    moderator_response,
                    options,
                    routing_recommendation=state.get("routing_recommendation"),
                )
                print(f"   ✅ Intervention {case_id} resolved via moderator input")
                case_dispatcher.notify_intervention_claimed(case_id, "", None)
        except Exception as e:
            print(f"   ❌ Failed to resolve intervention: {e}")

        response_text = (
            "✅ **MODERATOR RESOLUTION SUBMITTED**\n\n"
            f"{moderator_response}\n\n"
            "_The user will receive these next steps and options._"
        )
        return {
            "messages": [SystemMessage(content=response_text)],
            "final_response": response_text,
            "intervention_required": True,
            "intervention_collection": "moderator",
            "case_id": case_id,
            "suggested_actions": options if isinstance(options, list) else [],
            "waiting_for_moderator_resolution": False,
            "awaiting_user_input": False,
            "input_prompts": [],
            "location": location,
            "next_step": END,
        }

    # First pass: enqueue case and push-notify ranked online moderators
    print("   Reviewing case and creating intervention...")
    intervention_case_id = case_id or "Unknown"
    try:
        intervention_case_id = supabase_db.create_intervention_case(
            user_id,
            structured_report,
            collection_name="moderator",
            session_id=session_id,
            user_statement=user_statement,
            location=location,
            case_id=case_id,
            pdf_url=pdf_url,
        )
        print(f"   ✅ Case written to queue 'moderator' with ID: {intervention_case_id}")
        if intervention_case_id:
            agent_payload = {
                "source": "legal_moderator_agent",
                "user_id": user_id,
                "session_id": session_id,
                "user_statement": user_statement,
                "location": location,
                "pdf_url": pdf_url,
                "case_category": state.get("case_category"),
                "user_details": {
                    k: user_details.get(k)
                    for k in ("user_id", "session_id", "user_name", "name")
                    if user_details.get(k) is not None
                },
                "waiting_for_moderator_resolution": True,
            }
            recipients = case_dispatcher.dispatch_intervention(
                case_id=intervention_case_id,
                user_id=user_id,
                structured_report=structured_report if isinstance(structured_report, dict) else {},
                collection_name="moderator",
                session_id=session_id,
                user_statement=user_statement,
                location=location,
                agent_payload=agent_payload,
            )
            print(f"   Notified moderators: {recipients}")
            try:
                supabase_db.create_moderator_updatation(
                    intervention_id=str(intervention_case_id),
                    case_id=str(case_id) if case_id else str(intervention_case_id),
                    session_id=session_id,
                    agent_summary=(structured_report or {}).get("summary") if isinstance(structured_report, dict) else None,
                    agent_chat_response=state.get("final_response") or state.get("user_facing_delta"),
                    agent_report=structured_report if isinstance(structured_report, dict) else {},
                    agent_suggested_actions=state.get("suggested_actions") or [],
                    agent_suggested_links=state.get("suggested_links") or [],
                    agent_flags={
                        "cognizable": (structured_report or {}).get("cognizable") if isinstance(structured_report, dict) else None,
                        "is_complex_mlat": (structured_report or {}).get("is_complex_mlat") if isinstance(structured_report, dict) else None,
                        "fraud_under_10k": (structured_report or {}).get("fraud_under_10k") if isinstance(structured_report, dict) else None,
                    },
                    agent_pdf_url=pdf_url,
                )
            except Exception as upd_err:
                print(f"   ⚠️ moderator_updatation insert skipped: {upd_err}")
            try:
                supabase_db.mark_case_forwarded(
                    role="moderator",
                    target_id=str(intervention_case_id),
                    case_id=str(case_id or intervention_case_id),
                    session_id=session_id,
                    user_id=user_id,
                    structured_report=structured_report if isinstance(structured_report, dict) else {},
                    pdf_url=pdf_url,
                )
            except Exception as fwd_err:
                print(f"   ⚠️ mark_case_forwarded skipped: {fwd_err}")
    except Exception as e:
        print(f"   ❌ Failed to write/dispatch intervention: {e}")

    response_text = (
        "🚨 **MODERATOR REVIEW INITIATED**\n\n"
        "Your case needs a human legal moderator review due to risk and complexity signals "
        "detected in the report.\n\n"
        "_Awaiting moderator response and recommended options (same fields as the moderator dashboard)._"
    )

    # Keep AI next-steps / suggestions visible while waiting — do not wipe the rail.
    prior_actions = state.get("suggested_actions") if isinstance(state.get("suggested_actions"), list) else []
    prior_links = state.get("suggested_links") if isinstance(state.get("suggested_links"), list) else []
    prior_delta = str(state.get("user_facing_delta") or "").strip()
    prior_guidance = str(state.get("final_response") or "").strip()
    if prior_guidance and "MODERATOR REVIEW" not in prior_guidance.upper():
        # Keep conclusion in chat: prior specialist/report next-steps, then moderator notice.
        response_text = f"{prior_guidance}\n\n---\n\n{response_text}"
    elif prior_delta and "MODERATOR REVIEW" not in prior_delta.upper():
        response_text = f"{prior_delta}\n\n---\n\n{response_text}"

    input_prompts = [
        {
            "id": "moderator_response",
            "label": "Moderator response to the user",
            "hint": "Same as Legal Moderator Dashboard — guidance text the user will see.",
            "node_id": "legal_moderator",
            "kind": "moderator_response",
        },
        {
            "id": "moderator_options",
            "label": "Suggested action options (comma-separated labels)",
            "hint": "Optional. Example: File FIR, Contact cyber cell, Consult lawyer",
            "node_id": "legal_moderator",
            "kind": "moderator_options",
        },
    ]

    return {
        "messages": [SystemMessage(content=response_text)],
        "final_response": response_text,
        "intervention_required": True,
        "intervention_collection": "moderator",
        "case_id": intervention_case_id,
        "suggested_actions": prior_actions,
        "suggested_links": prior_links,
        "show_suggestions_rail": bool(prior_actions or prior_links or state.get("show_suggestions_rail")),
        "waiting_for_moderator_resolution": True,
        "awaiting_user_input": True,
        "input_prompts": input_prompts,
        "pending_question": "Enter moderator resolution for this case",
        "location": location,
        "next_step": END,
        "pdf_url": pdf_url,
        "structured_report": structured_report if isinstance(structured_report, dict) else {},
        "forwarded_role": "moderator",
        "forwarded_target_id": str(intervention_case_id),
        "question_labels": state.get("question_labels") if isinstance(state.get("question_labels"), dict) else {},
    }
