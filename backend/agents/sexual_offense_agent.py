"""
Sexual Offense Agent
-------------------
Post-report support choice handler for sexual-offense cases.
Flow order is enforced upstream as:
question_processor intake -> report_generator -> sexual_offense support choices.
If user rejects support choices, route to legal_moderator.
"""

from langgraph.graph import END
from backend.agents.so_call_flow import compose_so_rights_message, enqueue_so_confirmation_call


def sexual_offense_agent(state):
    """
    Handles post-report choice phase for sexual offense cases.
    First call: show support choices (lawyer/female nyayguide/urgent help)
    Next call: parse user's choice; if rejected, route to legal_moderator
    """
    print(f"\n🚨 SEXUAL OFFENSE AGENT ACTIVATED")
    
    messages = state.get("messages", [])
    structured_report = state.get("structured_report", {})
    user_language = state.get("user_language", "english")
    female_lawyer_profiles = state.get("female_lawyer_profiles", [])
    female_nyayguide_profiles = state.get(
        "female_nyayguide_profiles",
        state.get("female_counsellor_profiles", []),
    )
    case_id = state.get("case_id")
    waiting_for_choice = bool(state.get("waiting_for_sexual_offense_choice", False))
    immediate_danger = bool(structured_report.get("immediate_danger", False))
    minor_involved = bool(structured_report.get("minor_flag", False))
    nyayguide_needed = bool(
        structured_report.get(
            "female_nyayguide_support_enabled",
            structured_report.get("counsellor_support_enabled", False),
        )
    )

    show_female_lawyer_panel = len(female_lawyer_profiles) > 0
    show_female_nyayguide_panel = nyayguide_needed and len(female_nyayguide_profiles) > 0

    if not waiting_for_choice:
        print("   → Presenting post-report support choices")
        prefix = ""
        if immediate_danger:
            prefix = "🚨 Immediate risk detected. Please call **100** or **1091** now.\n\n"
        elif minor_involved:
            prefix = "🔴 A minor-survivor signal was noted. This stays with human support.\n\n"

        rights = compose_so_rights_message(structured_report)
        response_msg = (
            f"{prefix}{rights}\n\n"
            "Choose any option below. Connecting a female Nyay Guide starts with **one free confirmation call** "
            "from a moderator; assignment happens after that call.\n\n"
            "1. Connect Lawyer\n"
            "2. Connect Female Lawyer\n"
            "3. Connect Female NyayGuide (confirmation call)\n"
            "4. Get Urgent Help Now\n\n"
            "If you do not want these options, reply **No** and we will route you to a legal moderator."
        )

        suggested_actions = [
            {"label": "Connect Lawyer", "node": "sexual_offense", "payload": "connect lawyer"},
            {"label": "Connect Female Lawyer", "node": "sexual_offense", "payload": "connect female lawyer"},
            {"label": "Connect Female NyayGuide", "node": "sexual_offense", "payload": "connect female nyayguide"},
            {"label": "Get Urgent Help Now", "node": "sexual_offense", "payload": "urgent help"},
            {"label": "No / route to moderator", "node": "sexual_offense", "payload": "no"},
        ]

        input_prompts = [
            {
                "id": "sexual_offense_choice",
                "label": response_msg,
                "hint": "Pick a support option or reply No to escalate to legal moderator.",
                "node_id": "sexual_offense",
                "kind": "choice",
                "choices": [
                    {"id": a["payload"], "label": a["label"]} for a in suggested_actions
                ],
            }
        ]

        return {
            "final_response": response_msg,
            "suggested_actions": suggested_actions,
            "next_step": END,
            "waiting_for_sexual_offense_choice": True,
            "awaiting_user_input": True,
            "input_prompts": input_prompts,
            "pending_question": "Choose a support option for this sexual-offense case",
            "show_female_lawyer_panel": show_female_lawyer_panel,
            "show_female_nyayguide_panel": show_female_nyayguide_panel,
            "female_lawyer_profiles": female_lawyer_profiles,
            "female_nyayguide_profiles": female_nyayguide_profiles,
            "structured_report": structured_report,
            "case_id": case_id,
            "user_language": user_language,
        }

    # Parse user choice after options were shown.
    last_user_input = ""
    for msg in reversed(messages):
        if hasattr(msg, "type") and msg.type == "human":
            last_user_input = (msg.content or "").strip().lower()
            break

    nyayguide_selected = any(
        k in last_user_input
        for k in [
            "nyayguide",
            "nyay guide",
            "female nyayguide",
            "connect female nyayguide",
            "talk to female nyayguide",
        ]
    )
    lawyer_selected = any(
        k in last_user_input
        for k in [
            "connect lawyer",
            "female lawyer",
            "connect female lawyer",
            "request female lawyer",
        ]
    )
    urgent_selected = any(
        k in last_user_input
        for k in ["urgent", "emergency", "help now", "call 100", "1091"]
    )

    # Hard guard: Female NyayGuide → one-time unpaid confirmation call, then moderator assigns.
    if nyayguide_selected:
        collected = dict(state.get("collected_answers") or {})
        collected.setdefault("female_nyayguide_needed", "yes")
        collected.setdefault("confirm_call_consent", "yes")
        queued_state = {**state, "collected_answers": collected}
        enqueue = enqueue_so_confirmation_call(queued_state, structured_report)
        return {
            "final_response": enqueue.get("final_response") or compose_so_rights_message(structured_report),
            "suggested_actions": [],
            "next_step": END,
            "waiting_for_sexual_offense_choice": False,
            "waiting_for_so_call_confirmation": True,
            "so_call_confirmation_id": enqueue.get("so_call_confirmation_id") or "",
            "victim_phone": enqueue.get("victim_phone") or "",
            "awaiting_user_input": True,
            "input_prompts": [],
            "intervention_required": False,
            "show_female_lawyer_panel": False,
            "show_female_nyayguide_panel": False,
            "female_lawyer_profiles": female_lawyer_profiles,
            "female_nyayguide_profiles": female_nyayguide_profiles,
            "structured_report": structured_report,
            "case_id": case_id,
            "user_language": user_language,
        }

    explicit_choice_selected = nyayguide_selected or lawyer_selected or urgent_selected

    if (not explicit_choice_selected) and any(
        k in last_user_input for k in ["no", "nah", "not now", "reject", "skip", "decline"]
    ):
        print("   ❌ User rejected specialist support; routing to legal_moderator")
        return {
            "final_response": (
                "Understood. We will now route your case to a legal moderator for immediate human review."
            ),
            "next_step": "legal_moderator",
            "waiting_for_sexual_offense_choice": False,
            "awaiting_user_input": False,
            "input_prompts": [],
            "show_female_lawyer_panel": False,
            "show_female_nyayguide_panel": False,
            "female_lawyer_profiles": female_lawyer_profiles,
            "female_nyayguide_profiles": female_nyayguide_profiles,
            "structured_report": structured_report,
            "case_id": case_id,
            "user_language": user_language,
        }

    response_msg = (
        "We are proceeding with specialized support now. "
        "A female lawyer/female NyayGuide option is available below as requested."
    )
    
    suggested_actions = []
    if show_female_lawyer_panel:
        suggested_actions.append({
            "label": "Connect with Female Lawyer",
            "node": "female_lawyer",
            "payload": "Request Female Lawyer"
        })
    if show_female_nyayguide_panel:
        suggested_actions.append({
            "label": "Connect with Female NyayGuide",
            "node": "female_nyayguide",
            "payload": "Request Female NyayGuide Support"
        })
    if immediate_danger:
        suggested_actions.append({
            "label": "Contact Emergency Services",
            "node": "emergency",
            "payload": "Call 100"
        })
    
    # Fallback button
    if not suggested_actions:
        suggested_actions.append({
            "label": "Chat with Support Team",
            "node": "sahayak",
            "payload": "Request Human Help"
        })
    
    return {
        "final_response": response_msg,
        "suggested_actions": suggested_actions,
        "next_step": END,
        "waiting_for_sexual_offense_choice": False,
        "awaiting_user_input": False,
        "input_prompts": [],
        "show_female_lawyer_panel": show_female_lawyer_panel,
        "show_female_nyayguide_panel": show_female_nyayguide_panel,
        "female_lawyer_profiles": female_lawyer_profiles,
        "female_nyayguide_profiles": female_nyayguide_profiles,
        "structured_report": structured_report,
        "case_id": case_id,
        "user_language": user_language,
    }
