from langchain_core.messages import SystemMessage
from langgraph.graph import END
from backend.utils import get_llm_for_task

llm = get_llm_for_task("chat_agent.report_generator")
import json
import uuid
import threading
import re
from backend.database.vector_db import VectorDB
from backend.database import supabase_db
from backend.agents.common_utils import get_user_location_context
from backend.agents.scam_match import match_case_to_mock_scams
from backend.agents.question_processor import generate_follow_up_questions, detect_language, generate_sexual_offense_intake_questions
from backend.agents.sexual_offense_keywords import has_sexual_offense_signal
from backend.agents.response_sanitize import strip_classification_block
from backend.services.nyayguide_eligibility import build_nyayguide_suggestion
from backend.agents.so_call_flow import (
    compose_so_rights_message,
    consented_to_confirmation_call,
    enqueue_so_confirmation_call,
    wants_female_nyayguide,
)


def _is_alert_worthy_scam(report: dict) -> bool:
    incident = str(report.get("incident_type", "")).lower()
    risk = str(report.get("risk_level", "")).lower()
    summary = str(report.get("summary", "")).lower()
    has_scam_signal = ("scam" in incident) or ("fraud" in incident)
    pattern_keywords = ["otp", "upi", "phishing", "kyc", "link", "wallet", "bank", "telegram", "loan app"]
    has_pattern = any(keyword in summary for keyword in pattern_keywords)
    return has_scam_signal and (risk in {"medium", "high"} or has_pattern)


def _normalize_state_for_routing(state_name: str) -> str:
    state = (state_name or "").strip().lower()
    if not state:
        return "ALL"
    if "delhi" in state:
        return "Delhi"
    if "bihar" in state:
        return "Bihar"
    if "uttar pradesh" in state or state == "up":
        return "Uttar Pradesh"
    if "west bengal" in state or state == "bengal":
        return "West Bengal"
    return "ALL"


def _is_criminal_matter(raw_user_statement: str, incident_type: str, summary: str = "") -> bool:
    text = f"{raw_user_statement} {incident_type} {summary}".lower()
    criminal_markers = [
        "criminal", "missing person", "missing child", "lost daughter", "lost son",
        "lost child", "kidnapping", "abduction", "assault", "murder", "homicide",
        "robbery", "dacoity", "theft", "burglary", "fir", "police complaint",
        "cognizable", "ipc", "bnss", "hit and run", "attempt to murder",
        "गुमना", "अपहरण", "लापता", "চুরি", "খুন",
    ]
    if any(k in text for k in criminal_markers):
        # Phone-only "missing phone" is not a person-crime track.
        phone_only = any(k in text for k in ["phone", "mobile", "handset", "imei", "sim"]) and not any(
            k in text for k in ["daughter", "son", "child", "wife", "husband", "person", "kid", "girl", "boy"]
        )
        return not phone_only
    return False


def _infer_issue_type_for_routing(raw_user_statement: str, incident_type: str) -> str:
    text = f"{raw_user_statement} {incident_type}".lower()

    phone_context = any(k in text for k in [
        "phone", "mobile", "handset", "smartphone", "sim", "imei", "मोबाइल", "फोन"
    ])

    theft_indicators = [
        "stolen", "snatched", "pickpocket", "robbed", "theft", "chori", "चोरी", "लूट"
    ]
    fraud_indicators = [
        "otp", "bank", "upi", "sim", "whatsapp", "account", "fraud", "misuse", "phishing"
    ]
    lost_indicators = [
        "lost", "missing", "misplaced", "gum", "lost phone", "missing phone", "खो गया", "गुम"
    ]

    if phone_context:
        if any(k in text for k in fraud_indicators):
            return "phone_fraud_risk"
        if any(k in text for k in theft_indicators):
            return "phone_theft_route"
        if any(k in text for k in lost_indicators):
            return "phone_lost_only"

    incident = (incident_type or "").lower()
    if _is_criminal_matter(raw_user_statement, incident_type):
        return "criminal_matter"
    if any(k in incident for k in ["domestic", "violence"]):
        return "domestic_violence"
    if any(k in incident for k in ["maintenance", "family", "divorce"]):
        return "maintenance_family"
    if any(k in incident for k in ["wage", "salary", "labour", "labor"]):
        return "wage_dispute"
    if any(k in incident for k in ["land", "possession", "property"]):
        return "land_possession"
    if any(k in incident for k in ["water", "irrigation"]):
        return "water_irrigation"
    if any(k in incident for k in ["pathway", "boundary"]):
        return "pathway_boundary"
    return "other"


def _has_sexual_violence_signal(raw_user_statement: str, incident_type: str, summary: str) -> bool:
    return has_sexual_offense_signal(raw_user_statement, incident_type, summary)


def _parse_binary_answer(value: str) -> bool | None:
    """Parse free-form binary answers. Returns True/False/None (unknown)."""
    v = str(value or "").strip().lower()
    if not v:
        return None

    yes_tokens = {
        "yes", "y", "haan", "ha", "true", "1", "हाँ", "হ্যাঁ", "yes please", "yep", "yeah",
        "ಹೌದು", "ஆம்", "అవును", "હા", "ହଁ", "അതെ", "ਹਾਂ", "جی ہاں", "نعم"
    }
    no_tokens = {
        "no", "n", "nah", "nope", "false", "0", "नहीं", "না",
        "ಇಲ್ಲ", "இல்லை", "కాదు", "ના", "ନା", "ഇല്ല", "ਨਹੀਂ", "نہیں", "لا"
    }
    uncertain_tokens = {
        "maybe", "not sure", "unsure", "idk", "i dont know", "i don't know", "perhaps",
        "शायद", "হয়তো", "ಬಹುಶಃ", "கூட இருக்கலாம்", "బహుశా", "કદાચ", "ଶାୟଦ", "ശായദ്", "شاید"
    }

    if v in yes_tokens or any(tok in v for tok in yes_tokens):
        return True
    if v in no_tokens or any(tok in v for tok in no_tokens):
        return False
    if v in uncertain_tokens or any(tok in v for tok in uncertain_tokens):
        return None
    return None


def _build_state_legal_aid_link(state_name: str) -> str:
    state_map = {
        "Delhi": "https://dslsa.org",
        "Bihar": "https://bslsa.bihar.gov.in",
        "Uttar Pradesh": "https://upslsa.up.nic.in",
        "West Bengal": "https://wbslsa.bangla.gov.in",
    }
    return state_map.get(state_name, "https://legalaid.gov.in")


def _need_more_questions(report: dict, answers: dict, statement: str) -> bool:
    if len(answers or {}) >= 6:
        return False
    blob = f"{statement} {json.dumps(answers, ensure_ascii=False)}".lower()
    incident = str((report or {}).get("incident_type") or "").lower()
    if ("fraud" in incident or "scam" in incident or "cyber" in incident) and not (report or {}).get("amount_involved"):
        if "₹" not in blob and "rs" not in blob and "rupee" not in blob:
            return True
    if "missing" in incident and not any(k in blob for k in ("when", "last seen", "yesterday", "today", "date", "time")):
        return True
    return False


def _compose_complete_guidance(legal_draft: str, report: dict, answers: dict, statement: str) -> str:
    """Turn the intake draft + answers into one full user-facing memo (no classification tags)."""
    existing = strip_classification_block(legal_draft or "")
    low = existing.lower()
    if existing and "i need a little more clarification" not in low and len(existing) > 500:
        return existing
    try:
        prompt = f"""Write the full next-steps guidance for the user now that intake answers are in.
Use markdown. Do NOT include Classification Data or [Cognizable:] tags.
Do NOT ask more questions. Police/safety first when relevant.

USER STATEMENT:
{statement[:1500]}

INTAKE ANSWERS:
{json.dumps(answers or {}, ensure_ascii=False)[:2000]}

DRAFT NOTES:
{existing[:2500]}

STRUCTURED SUMMARY:
{json.dumps({k: (report or {}).get(k) for k in ("incident_type", "summary", "statutory_sections", "checklist")}, ensure_ascii=False)}
"""
        resp = llm.invoke([SystemMessage(content=prompt)])
        raw = getattr(resp, "content", resp)
        if isinstance(raw, list):
            raw = "".join((c.get("text") or "") if isinstance(c, dict) else str(c) for c in raw)
        return strip_classification_block(raw)
    except Exception as exc:
        print(f"⚠️ compose complete guidance failed: {exc}")
        return existing or strip_classification_block((report or {}).get("summary") or "")


def _attach_ai_verification_to_report(
    structured_report: dict,
    state: dict,
    raw_user_statement: str,
    answers_collection_complete: bool,
    is_sexual_offense: bool,
    should_escalate_to_moderator: bool,
    risk_level: str,
    case_id: str | None = None,
) -> dict:
    raw_flags = structured_report.get("risk_flags") or state.get("risk_flags") or []
    if isinstance(raw_flags, str):
        risk_flags = [raw_flags.lower()]
    elif isinstance(raw_flags, list):
        risk_flags = [str(f).lower() for f in raw_flags]
    else:
        risk_flags = []

    if is_sexual_offense and "sensitive" not in risk_flags:
        risk_flags.append("sensitive")

    existing_conf = (
        structured_report.get("confidence_score")
        or structured_report.get("context_building_confidence_score")
        or state.get("confidence_score")
    )
    if existing_conf is not None:
        try:
            conf_score = float(existing_conf)
        except Exception:
            conf_score = 0.75
    else:
        has_substance = len(raw_user_statement) >= 25 and bool(structured_report.get("summary"))
        if answers_collection_complete and has_substance:
            conf_score = 0.85
        elif has_substance and risk_level != "high":
            conf_score = 0.75
        else:
            conf_score = 0.55

    is_sensitive_matter = ("sensitive" in risk_flags) or is_sexual_offense
    threat_level = structured_report.get("threat_level_assessment") or {}
    threat_status_unclear = isinstance(threat_level, dict) and threat_level.get("status") == "unclear"

    is_clear_low_risk = (
        not is_sensitive_matter
        and not threat_status_unclear
        and not should_escalate_to_moderator
        and risk_level != "high"
        and answers_collection_complete
    )

    if is_clear_low_risk and conf_score >= 0.70:
        ai_verification_status = "verified"
        verification_source = "text"
        ai_verification_reason = f"Clear low-risk text intake verified with confidence {conf_score:.2f}."
    elif is_sensitive_matter or should_escalate_to_moderator or risk_level == "high":
        ai_verification_status = "flagged" if should_escalate_to_moderator else "pending"
        verification_source = "text"
        ai_verification_reason = "Case flagged for human moderator review due to sensitivity or risk level."
    else:
        ai_verification_status = "pending"
        verification_source = "text"
        ai_verification_reason = f"Verification pending voice clarification (confidence: {conf_score:.2f})."

    structured_report["ai_verification_status"] = ai_verification_status
    structured_report["ai_verification_confidence"] = conf_score
    structured_report["verification_source"] = verification_source
    structured_report["ai_verification_reason"] = ai_verification_reason
    structured_report["risk_flags"] = risk_flags
    structured_report["context_building_confidence_score"] = conf_score

    if case_id and hasattr(supabase_db, "update_case_ai_verification_status"):
        try:
            supabase_db.update_case_ai_verification_status(
                case_id=case_id,
                status=ai_verification_status,
                confidence_score=conf_score,
                source=verification_source,
                reason=ai_verification_reason,
            )
        except Exception as verify_persist_err:
            print(f"   ⚠️ update_case_ai_verification_status skipped: {verify_persist_err}")

    return structured_report


def report_generator_agent(state):
    print(f"\nREPORT GENERATOR AGENT ACTIVATED")
    print(f"   Standardizing output and generating actions...")

    messages = state["messages"]
    # Specialist intake text (already short). Never re-emit classification tags.
    final_response = strip_classification_block(state.get("final_response", "") or "")
    legal_draft = strip_classification_block(state.get("legal_draft") or final_response)


    if not final_response:
        final_response = strip_classification_block(
            messages[-1].content if messages else "No info available."
        )

    # Extract verbatim user query with priority to preserved incident statement.
    # Never treat the latest Q&A answer as the case text.
    user_details = state.get("user_details", {}) or {}
    situation_summary = state.get("situation_summary") or {}
    prior_report = state.get("structured_report") or {}

    candidates = [
        str(state.get("user_statement", "") or "").strip(),
        str(situation_summary.get("user_query", "") or "").strip(),
        str(prior_report.get("user_verbatim", "") or "").strip(),
        str(user_details.get("query", "") or "").strip(),
        str(state.get("user_query", "") or "").strip(),
        str(state.get("query", "") or "").strip(),
    ]
    # Prefer the longest non-trivial candidate (original incident >> short "dfgd" answers)
    candidates = [c for c in candidates if c and c.lower() not in {"yes", "no", "haan", "nahi"}]
    raw_user_statement = max(candidates, key=len) if candidates else ""

    # Last resort: first human message only (not the latest answer)
    if not raw_user_statement:
        for m in messages:
            if hasattr(m, "type") and m.type == "human" and m.content:
                raw_user_statement = str(m.content).strip()
                break

    # Extract location early — prefer top-level state.location (supervisor/GPS), then user_details
    from backend.agents.common_utils import normalize_location_dict, location_is_usable

    location_data = state.get("location") or user_details.get("location")
    location_ctx = {}
    loc_display = "Unknown"
    state_for_routing = "ALL"
    if location_is_usable(location_data):
        normalized = normalize_location_dict(location_data)
        if normalized:
            location_ctx = normalized
        else:
            city, state_name, _ = get_user_location_context(location_data)
            location_ctx = {
                "city": city,
                "state": state_name,
                "lat": (location_data or {}).get("lat"),
                "lon": (location_data or {}).get("lon"),
            }
        city = location_ctx.get("city") or "Unknown"
        state_name = location_ctx.get("state") or "Unknown"
        state_for_routing = _normalize_state_for_routing(state_name)
        loc_display = f"{city}, {state_name}" if city != "Unknown" else "Unknown"

    sexual_offense_intake_flow = bool(state.get("sexual_offense_intake_flow", False))
    collected_answers = state.get("collected_answers", {}) or {}
    # Side-node return: question_processor finished → this pass rescores and chooses the next node.
    answers_collection_complete = bool(state.get("answers_collection_complete")) or bool(
        (state.get("situation_summary") or {}).get("answers_collection_complete")
    )
    if answers_collection_complete:
        print(f"   ↻ Rescore pass after intake ({len(collected_answers)} answers)")

    answers_block = ""
    if collected_answers:
        try:
            answers_json = json.dumps(collected_answers, ensure_ascii=False, indent=2)
        except Exception:
            answers_json = str(collected_answers)
        answers_block = f"""

    FOLLOW-UP INTAKE ANSWERS (authoritative — use to fill gaps and RESCORE risk/flags):
    {answers_json}
"""
        if prior_report and answers_collection_complete:
            answers_block += f"""
    PRIOR DRAFT REPORT (update/correct using intake answers; do not ignore new facts):
    {json.dumps({k: prior_report.get(k) for k in ("incident_type", "risk_level", "cognizable", "is_complex_mlat", "fraud_under_10k", "amount_involved", "summary") if k in prior_report}, ensure_ascii=False)}
"""

    matched_trends = state.get("matched_scam_trends") or []
    trends_block = ""
    if matched_trends:
        trend_lines = []
        for t in matched_trends[:5]:
            if not isinstance(t, dict):
                continue
            trend_lines.append(
                f"- {t.get('title') or t.get('scam_type') or 'Scam'} "
                f"({t.get('city') or 'India'}) sim={t.get('similarity', '')}: "
                f"{(t.get('description') or '')[:280]}"
            )
        if trend_lines:
            trends_block = (
                "\n\nSIMILAR KNOWN SCAM TRENDS (from mock_scams RAG — ground risk/summary on these when relevant):\n"
                + "\n".join(trend_lines)
                + "\n"
            )

    # System Prompt to Extract Structured Data
    system_prompt = f"""You are the Report Generator Agent.
    Your task is to analyze the USER'S EXACT WORDS and the AI response to generate a STRUCTURED JSON REPORT.
    {"This is a RESCORE pass after follow-up Q&A — update risk_level, cognizable, amounts, and summary using the intake answers." if answers_collection_complete else ""}

    USER'S EXACT WORDS (this is the ground truth — read carefully):
    "{raw_user_statement}"

    USER LOCATION: {loc_display}

    AI RESPONSE / LEGAL DRAFT TO ANALYZE:
    {legal_draft or final_response}
    {answers_block}{trends_block}
    TASK:
    Generate a JSON object with:
    1. 'incident_type': specific category (e.g., Missing Person, Kidnapping, Assault, Theft/Robbery, Financial Fraud, Identity Theft, General Query).
       For missing child/family member, assault, kidnapping, robbery use a clear criminal label (e.g. 'Missing Person', 'Criminal Assault').
    2. 'risk_level': 'High' (Financial loss/Imminent threat/person safety), 'Medium', or 'Low'.
    **CRITICAL RULE**: ALWAYS set 'risk_level' to 'High' and 'cognizable' true for missing persons, kidnapping, serious assault, or homicide threats.
    **CRITICAL RULE**: ALWAYS set 'risk_level' to 'Low' for village/local disputes such as:
       - Small thefts (crops, goats, bicycles <= 20k INR)
       - Criminal intimidation over land boundaries
       - Verbal abuse / insults provoking village quarrels
       - House breaking / trespass in villages
       - Agricultural/labor wage disputes (non-payment, delay, minimum wage, equal pay)
       - Domestic violence or maintenance claims by wives in villages
       - Village pasture or irrigation water timing disputes
       - Small money suits for unpaid seed loans.
       For these cases, ALSO set 'cognizable' and 'is_complex_mlat' to false if possible.
    EXCEPTION: Do NOT classify sexual harassment/sexual assault/molestation/groping/stalking/rape-related incidents as Low risk.
    3. 'cognizable': boolean, true if the offense is cognizable based on the AI response's classification tags.
    4. 'is_complex_mlat': boolean, true if it involves MLATs or complex treaties based on classification tags.
    5. 'fraud_under_10k': boolean or null, true if explicitly stated fraud is < 10,000 INR, false if > 10,000, null if NA.
    6. 'summary': MANDATORY — Write a concise 2-4 sentence factual summary in plain English based on the user statement and response context. Include incident nature, urgency, and key facts known so far. Do NOT copy user text verbatim.
    7. 'amount_involved': Extract the specific financial amount mentioned by the user (e.g., "₹4,00,000", "400000 INR"). Set to null if no amount mentioned.
    8. 'statutory_sections': List of ONLY THE TOP 2 most relevant laws mentioned (e.g., ["IT Act Section 66C", "IPC Section 420"]). Do NOT include more than 2.
    9. 'checklist': List of 3-4 immediate steps from the response. **IF LOCAL SCAM WAS MENTIONED, ADD A STEP TO VERIFY IT.**

    Output MUST be valid JSON only. Do not wrap in code blocks.
    """

    from backend.agents.common_utils import active_policy_prompt_block

    system_prompt += active_policy_prompt_block("chat_agent.report_generator")

    try:
        response = llm.invoke([SystemMessage(content=system_prompt)] + messages)
        
        # Extract string from response.content in case it's a multimodal list block
        response_content = response.content
        if isinstance(response_content, list):
            content_str = "".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in response_content])
        elif not isinstance(response_content, str):
            content_str = str(response_content)
        else:
            content_str = response_content
            
        # Clean response string to ensure JSON parsing
        content_str = content_str.strip()
        if content_str.startswith("```json"):
            content_str = content_str.replace("```json\n", "", 1).replace("```json", "", 1)
        elif content_str.startswith("```"):
            content_str = content_str.replace("```\n", "", 1).replace("```", "", 1)
            
        if content_str.endswith("```"):
            if hasattr(content_str, "removesuffix"):
                content_str = content_str.removesuffix("```")
            else:
                # Fallback for Python < 3.9
                content_str = content_str[:len(content_str)-3]

        content_str = content_str.strip()
        if not content_str:
            raise ValueError("LLM returned empty response for structured report JSON")

        data = json.loads(content_str)

        # Use concise fallback if LLM summary missing
        llm_summary = data.get("summary", "").strip()
        final_summary = llm_summary if llm_summary else f"Reported issue: {raw_user_statement}"

        structured_report = {
            "incident_type": data.get("incident_type", "General"),
            "risk_level": data.get("risk_level", "Low"),
            "cognizable": data.get("cognizable", False),
            "is_complex_mlat": data.get("is_complex_mlat", False),
            "fraud_under_10k": data.get("fraud_under_10k", None),
            "summary": final_summary,
            "amount_involved": data.get("amount_involved", None),
            "user_verbatim": raw_user_statement,
            "location": location_ctx,
            "statutory_sections": data.get("statutory_sections", []),
            "checklist": data.get("checklist", [])
        }

        matched = match_case_to_mock_scams(state)
        if matched.get("matches"):
            structured_report["matched_scam_trends"] = matched["matches"]
            structured_report["scam_similarity"] = matched.get("note") or ""
            checklist = list(structured_report.get("checklist") or [])
            note = structured_report["scam_similarity"]
            if note and not any("similar" in str(step).lower() and "scam" in str(step).lower() for step in checklist):
                checklist.append(f"Verify similar scams already reported in your area: {note}")
                structured_report["checklist"] = checklist

        # Safety floor: sexual violence/harassment cases must never be low risk.
        is_sexual_offense = _has_sexual_violence_signal(
            raw_user_statement,
            structured_report.get("incident_type", ""),
            structured_report.get("summary", "")
        ) or bool(state.get("high_sensitivity", False)) or str(state.get("case_category", "")) == "sexual_offence"
        
        if is_sexual_offense:
            structured_report["risk_level"] = "High"
            structured_report["cognizable"] = True
            structured_report["incident_type"] = "Sexual Offence / Harassment"
            # Add sexual offense specific flags
            structured_report["high_sensitivity"] = True
            structured_report["case_category"] = "sexual_offence"
            structured_report["human_takeover_required"] = True
            structured_report["manual_review_required"] = True
            structured_report["ai_detail_mode"] = "minimal"
            structured_report["nyay_guide_flow"] = False
            structured_report["connect_lawyer_enabled"] = True
            structured_report["female_lawyer_preferred"] = True
            structured_report["female_nyayguide_support_enabled"] = True
            structured_report["priority_escalation"] = "immediate"

            # Map minimal-intake answers into structured flags when available.
            immediate_danger_val = str(collected_answers.get("immediate_danger", "")).strip().lower()
            minor_flag_val = str(collected_answers.get("minor_flag", "")).strip().lower()
            female_pref_val = str(collected_answers.get("female_lawyer_preference", "")).strip().lower()
            nyayguide_val = str(
                collected_answers.get("female_nyayguide_needed", collected_answers.get("counsellor_needed", ""))
            ).strip().lower()
            call_consent_val = str(collected_answers.get("confirm_call_consent", "")).strip().lower()
            contact_phone_val = str(collected_answers.get("contact_phone") or "").strip()

            immediate_danger_ans = _parse_binary_answer(immediate_danger_val)
            minor_flag_ans = _parse_binary_answer(minor_flag_val)
            female_pref_ans = _parse_binary_answer(female_pref_val)
            nyayguide_ans = _parse_binary_answer(nyayguide_val)

            # Safety-first: uncertain immediate danger is treated as potential risk.
            structured_report["immediate_danger"] = True if immediate_danger_ans is None else bool(immediate_danger_ans)
            structured_report["minor_flag"] = bool(minor_flag_ans) if minor_flag_ans is not None else False
            structured_report["female_lawyer_preferred"] = bool(female_pref_ans) if female_pref_ans is not None else True
            structured_report["female_nyayguide_support_enabled"] = bool(nyayguide_ans)
            structured_report["confirm_call_consent"] = bool(_parse_binary_answer(call_consent_val))
            structured_report["contact"] = contact_phone_val or structured_report.get("contact")
            structured_report["contact_preference"] = "call" if structured_report["confirm_call_consent"] else "chat"

            if not structured_report.get("summary"):
                structured_report["summary"] = "Sexual harassment incident reported by user; high-sensitivity handling and human-led support are required."

            # If she wants a Female Nyay Guide, queue a one-time unpaid confirmation call
            # instead of assigning the guide from chat.
            nyayguide_direct_connect = wants_female_nyayguide(collected_answers, structured_report)

            # Hard guard: if sexual offense is detected but intake flow did not run,
            # force the predefined intake questions BEFORE any escalation/choices.
            if not sexual_offense_intake_flow and not collected_answers:
                case_id = str(uuid.uuid4())
                structured_report = _attach_ai_verification_to_report(
                    structured_report=structured_report,
                    state=state,
                    raw_user_statement=raw_user_statement,
                    answers_collection_complete=False,
                    is_sexual_offense=True,
                    should_escalate_to_moderator=True,
                    risk_level="High",
                    case_id=case_id,
                )
                intake_questions = generate_sexual_offense_intake_questions(detect_language(raw_user_statement))
                situation_summary = {
                    "user_query": raw_user_statement,
                    "case_type": "sexual_offence",
                    "risk_level": "High",
                    "location": location_ctx,
                    "user_language": detect_language(raw_user_statement),
                    "amount_involved": structured_report.get("amount_involved"),
                    "collected_answers": {},
                }
                return {
                    "structured_report": structured_report,
                    "suggested_actions": [],
                    "final_response": "You do not need to share full details right now. We will ask only essential safety questions first.",
                    "next_step": "question_processor",
                    "case_id": case_id,
                    "intervention_required": True,
                    "user_statement": raw_user_statement,
                    "location": location_ctx,
                    "pending_questions": intake_questions,
                    "current_question_idx": 0,
                    "collected_answers": {},
                    "question_labels": {
                        str(q.get("key") or f"q_{i}"): str(q.get("question") or "")
                        for i, q in enumerate(intake_questions)
                        if isinstance(q, dict) and q.get("question")
                    },
                    "question_collection_started": False,
                    "answers_collection_complete": False,
                    "situation_summary": situation_summary,
                    "user_language": detect_language(raw_user_statement),
                    "routing_recommendation": None,
                    "show_routing_consent": False,
                    "sexual_offense_intake_flow": True,
                    "waiting_for_sexual_offense_choice": False,
                    "high_sensitivity": True,
                    "case_category": "sexual_offence",
                }

        # Determine Criticality & Routing
        # Escalate to legal moderator only for genuinely high-severity situations.
        actions = []
        risk = structured_report["risk_level"]
        incident = structured_report["incident_type"].lower()
        cognizable = structured_report["cognizable"]
        is_complex = structured_report["is_complex_mlat"]
        fraud_under_10k = structured_report["fraud_under_10k"]
        intervention_req = False

        def _extract_amount_value(raw_amount):
            if raw_amount is None:
                return None
            if isinstance(raw_amount, (int, float)):
                return int(raw_amount)
            if isinstance(raw_amount, str):
                cleaned = re.sub(r"[^0-9.]", "", raw_amount)
                if not cleaned:
                    return None
                try:
                    return int(float(cleaned))
                except Exception:
                    return None
            return None

        # Escalate when any routing flag is true (cognizable, MLAT, or fraud over ₹10k).
        amount_value = _extract_amount_value(structured_report.get("amount_involved"))
        fraud_over_10k = fraud_under_10k is False or (
            amount_value is not None and amount_value > 10000 and (
                "fraud" in incident or "scam" in incident or "cyber" in incident
            )
        )
        should_escalate_to_moderator = bool(cognizable or is_complex or fraud_over_10k)

        risk_level = str(risk or "").strip().lower()
        is_high_risk = risk_level == "high"

        is_criminal = _is_criminal_matter(
            raw_user_statement,
            structured_report.get("incident_type", ""),
            structured_report.get("summary", ""),
        ) or str(state.get("case_category") or "").lower() == "criminal"

        # Criminal (missing person, assault, etc.): escalate when high-risk or cognizable.
        if is_criminal and (is_high_risk or cognizable):
            should_escalate_to_moderator = True

        # Route to legal_moderator by default if High Criticality
        next_step = END
        criticality = "Low/Unknown"
        female_lawyer_profiles = []
        female_nyayguide_profiles = []
        nyayguide_direct_connect = wants_female_nyayguide(collected_answers, structured_report) if is_sexual_offense else False
        so_enqueue: dict = {}

        if is_sexual_offense:
            # Mandatory order for sexual-offense cases:
            # intake questions -> report generation -> lawyer/female-nyayguide options.
            criticality = "High Criticality"
            structured_report["criticality"] = criticality
            next_step = END if nyayguide_direct_connect else "sexual_offense"
            intervention_req = False if nyayguide_direct_connect else True

            lat = location_ctx.get("lat")
            lon = location_ctx.get("lon")
            state_name = location_ctx.get("state", "Delhi")
            if state_name in {"", "Unknown", "ALL", None}:
                if str(location_ctx.get("city", "")).strip().lower() == "delhi":
                    state_name = "Delhi"
                else:
                    state_name = "Delhi"
            try:
                female_lawyer_profiles = supabase_db.get_female_lawyers_by_location(lat, lon, state_name)
                female_nyayguide_profiles = supabase_db.get_female_nyayguides_by_location(lat, lon, state_name)
            except Exception as e:
                print(f"   ⚠️  Error fetching female lawyers/nyayguides: {e}")
        elif should_escalate_to_moderator:
            criticality = "High Criticality"
            next_step = "legal_moderator"
            intervention_req = True
            structured_report["criticality"] = criticality
        elif fraud_under_10k is True or risk_level == "low":
            criticality = "Moderate Criticality (Small Matter)"
            structured_report["criticality"] = criticality
            # For sexual offenses, NEVER show nodal guide — must go to legal moderator or end
            if is_sexual_offense:
                next_step = END  # Will show female lawyer/female-nyayguide panel in frontend
            elif is_criminal:
                # Criminal matters end with lawyer / Nyay Guide choices — not Gram Nyayalaya.
                next_step = END
            else:
                # Low-risk / small-value cases → offer Gram Nyayalaya Nodal Guide
                next_step = "nodal_guide"
        else:
            criticality = "Moderate Criticality"
            structured_report["criticality"] = criticality

        # Supabase-backed routing matrix lookup at flow end.
        issue_type_for_routing = _infer_issue_type_for_routing(raw_user_statement, structured_report.get("incident_type", ""))
        routing_rule = supabase_db.get_routing_rule(issue_type_for_routing, state_for_routing)
        routing_recommendation = None
        show_routing_consent = False

        if routing_rule:
            links = routing_rule.get("action_links") or {}
            if routing_rule.get("legal_aid_support"):
                links = {
                    **links,
                    "nalsa": links.get("nalsa") or "https://nalsa.gov.in",
                    "legal_aid": links.get("legal_aid") or "https://legalaid.gov.in",
                    "state_legal_aid": _build_state_legal_aid_link(state_for_routing),
                }

            routing_recommendation = {
                "issue_type": issue_type_for_routing,
                "state": state_for_routing,
                "primary_forum": routing_rule.get("primary_forum"),
                "secondary_forum": routing_rule.get("secondary_forum"),
                "legal_aid_support": {
                    "enabled": bool(routing_rule.get("legal_aid_support")),
                    "level": routing_rule.get("legal_aid_level") or "DLSA/SLSA",
                    "reason": routing_rule.get("reason") or "Free legal aid may help with drafting, filing, and forum guidance."
                },
                "routing_message": routing_rule.get("routing_message") or "Follow the recommended forum path for this case.",
                "links": links,
            }

        # Lost/stolen/misuse phone routes must not go to Gram Nyayalaya.
        if (not is_sexual_offense) and issue_type_for_routing in {"phone_lost_only", "phone_theft_route", "phone_fraud_risk"}:
            next_step = END
            show_routing_consent = True

        # Criminal pipeline must not land on nodal_guide.
        if is_criminal and next_step == "nodal_guide":
            next_step = END

        # user_statement and location_ctx are already extracted above — always available


        # Dynamic Actions based on Risk & Content
        actions = []
        incident = structured_report["incident_type"].lower()
        financial_or_cyber = any(
            k in incident
            for k in (
                "fraud",
                "scam",
                "cyber",
                "upi",
                "phishing",
                "financial",
                "bank",
                "cheque",
                "otp",
            )
        )

        # 1930 / bank freeze is for financial fraud — never for sexual-offense or other high-risk crimes.
        if (
            (not is_sexual_offense)
            and financial_or_cyber
            and criticality == "High Criticality"
        ):
            actions.append(
                {"label": "Contact Bank immediately", "action": "show_helpline", "payload": "1930"}
            )

        if (not is_sexual_offense) and ("fraud" in incident or "scam" in incident or "cyber" in incident):
            actions.append(
                {"label": "File Complaint Guide", "action": "show_guide", "payload": "cyber_crime_steps"}
            )

        if "civil" in incident or "domestic" in incident or "property" in incident or "divorce" in incident or "family" in incident:
             # Do not append a custom Connect to Lawyer action here; we will handle it in the final satisfaction check instead.
             pass

        # Default Nyay Guide action is emitted as a typed nyayguide_suggestion
        # only after AI verification completes (see end of this agent).

        # Suggested actions live in the right-hand rail, not in the chat body.
        if is_sexual_offense:
            if nyayguide_direct_connect and consented_to_confirmation_call(collected_answers):
                actions = []
                if answers_collection_complete or collected_answers:
                    so_enqueue = enqueue_so_confirmation_call(state, structured_report)
                final_response = so_enqueue.get("final_response") or compose_so_rights_message(structured_report)
            elif nyayguide_direct_connect:
                actions = [
                    {"label": "Connect with Female NyayGuide", "node": "sexual_offense", "payload": "connect female nyayguide"},
                ]
                final_response = compose_so_rights_message(structured_report)
            else:
                actions = [
                    {"label": "Connect Lawyer", "node": "sexual_offense", "payload": "connect lawyer"},
                    {"label": "Connect Female Lawyer", "node": "sexual_offense", "payload": "connect female lawyer"},
                    {"label": "Connect Female NyayGuide", "node": "sexual_offense", "payload": "connect female nyayguide"},
                    {"label": "Get Urgent Help Now", "node": "sexual_offense", "payload": "urgent help"},
                ]
                final_response = compose_so_rights_message(structured_report) + (
                    "\n\nChoose an option below if you want support. You can also say **No**."
                )

        if "case_id" not in locals():
            case_id = str(uuid.uuid4())

        if matched.get("matches") and hasattr(supabase_db, "persist_case_scam_matches"):
            try:
                supabase_db.persist_case_scam_matches(
                    case_id,
                    matched.get("matches") or [],
                    matched.get("note") or "",
                )
            except Exception as persist_err:  # noqa: BLE001
                print(f"   ⚠️ persist_case_scam_matches skipped: {persist_err}")

        # ─── Side-node intake: report → question_processor → report (rescore once) ───
        needs_questions = False
        pending_questions = []
        user_language = detect_language(raw_user_statement)

        has_amount = bool(structured_report.get("amount_involved"))
        risk_level = str(structured_report.get("risk_level", "Low")).strip().lower()
        is_medium_or_high_risk = risk_level in {"medium", "high"}
        is_complex = structured_report.get("is_complex_mlat", False)
        query_len = len(raw_user_statement)

        # Mid-intake resume sometimes misroutes back here. Never restart Q&A while
        # question_processor is still collecting answers — hand the turn back.
        intake_in_progress = bool(state.get("question_collection_started")) and bool(
            state.get("pending_questions")
        )
        if intake_in_progress and not answers_collection_complete:
            print("   ↩ Intake still in progress → returning to question_processor (no reset)")
            structured_report = _attach_ai_verification_to_report(
                structured_report=structured_report,
                state=state,
                raw_user_statement=raw_user_statement,
                answers_collection_complete=False,
                is_sexual_offense=is_sexual_offense,
                should_escalate_to_moderator=should_escalate_to_moderator,
                risk_level=risk_level,
                case_id=case_id if "case_id" in locals() else None,
            )
            return {
                "structured_report": structured_report,
                "suggested_actions": actions,
                "final_response": state.get("final_response") or final_response,
                "next_step": "question_processor",
                "case_id": case_id,
                "intervention_required": False,
                "user_statement": raw_user_statement,
                "location": location_ctx,
                "pending_questions": state.get("pending_questions") or [],
                "current_question_idx": int(state.get("current_question_idx") or 0),
                "collected_answers": collected_answers,
                "question_collection_started": True,
                "answers_collection_complete": False,
                "situation_summary": state.get("situation_summary") or {},
                "user_language": user_language,
                "routing_recommendation": routing_recommendation,
                "show_routing_consent": False,
                "female_lawyer_profiles": female_lawyer_profiles,
                "female_nyayguide_profiles": female_nyayguide_profiles,
                "show_female_lawyer_panel": False,
                "show_female_nyayguide_panel": False,
                "sexual_offense_intake_flow": sexual_offense_intake_flow,
                "waiting_for_sexual_offense_choice": False,
            }

        # First pass: always clarify with questions (specialist already gave a short legal-context summary).
        if (
            (not answers_collection_complete)
            and (not intake_in_progress)
            and (not is_sexual_offense)
        ):
            needs_questions = True
            pending_questions = generate_follow_up_questions(
                structured_report,
                raw_user_statement,
                structured_report.get("incident_type", "General"),
                user_language,
                retrieved_chunks=state.get("retrieved_legal_chunks") or [],
            )

        question_rounds = int(state.get("question_rounds") or 0)
        if (
            answers_collection_complete
            and (not is_sexual_offense)
            and question_rounds < 2
            and _need_more_questions(structured_report, collected_answers, raw_user_statement)
        ):
            extra_qs = generate_follow_up_questions(
                structured_report,
                raw_user_statement,
                structured_report.get("incident_type", "General"),
                user_language,
                retrieved_chunks=state.get("retrieved_legal_chunks") or [],
            )
            asked = {str(v).strip().lower() for v in (collected_answers or {}).values()}
            extra_qs = [
                q for q in extra_qs
                if str(q.get("question") or "").strip().lower() not in asked
            ]
            if extra_qs:
                needs_questions = True
                pending_questions = extra_qs
                answers_collection_complete = False
                question_rounds += 1

        situation_summary = {
            "user_query": raw_user_statement,
            "case_type": structured_report.get("incident_type", "General"),
            "risk_level": structured_report.get("risk_level", "Low"),
            "location": location_ctx,
            "user_language": user_language,
            "amount_involved": structured_report.get("amount_involved"),
            "collected_answers": collected_answers if answers_collection_complete else {},
            "answers_collection_complete": answers_collection_complete,
        }

        # Ensure AI verification fields are attached to structured_report
        structured_report = _attach_ai_verification_to_report(
            structured_report=structured_report,
            state=state,
            raw_user_statement=raw_user_statement,
            answers_collection_complete=answers_collection_complete,
            is_sexual_offense=is_sexual_offense,
            should_escalate_to_moderator=should_escalate_to_moderator,
            risk_level=risk_level,
            case_id=case_id if "case_id" in locals() else None,
        )

        if needs_questions and pending_questions:
            print(
                f"   ❓ Side-node intake: {len(pending_questions)} questions "
                f"(Language: {user_language}) → question_processor, then back here to rescore"
            )
            return {
                "structured_report": structured_report,
                "suggested_actions": actions,
                "final_response": strip_classification_block(final_response),
                "user_facing_delta": "",
                "next_step": "question_processor",
                "case_id": case_id,
                "intervention_required": False,  # routing decided only after rescore
                "user_statement": raw_user_statement,
                "location": location_ctx,
                "pending_questions": pending_questions,
                "current_question_idx": 0,
                "collected_answers": collected_answers if question_rounds else {},
                "question_labels": {
                    str(q.get("key") or f"q_{i}"): str(q.get("question") or q.get("text") or "")
                    for i, q in enumerate(pending_questions)
                    if isinstance(q, dict) and (q.get("question") or q.get("text"))
                },
                "question_collection_started": False,
                "answers_collection_complete": False,
                "question_rounds": question_rounds,
                "phase": "questioning",
                "pdf_ready": False,
                "situation_summary": situation_summary,
                "user_language": user_language,
                "routing_recommendation": routing_recommendation,
                "show_routing_consent": False,
                "female_lawyer_profiles": female_lawyer_profiles,
                "female_nyayguide_profiles": female_nyayguide_profiles,
                "show_female_lawyer_panel": False,
                "show_female_nyayguide_panel": False,
                "sexual_offense_intake_flow": sexual_offense_intake_flow,
                "waiting_for_sexual_offense_choice": False,
            }

        # Persist scam alerts only on the final report pass (not the draft before intake)
        if _is_alert_worthy_scam(structured_report) and len(structured_report["summary"]) > 20:
            if location_ctx and location_ctx.get("city") not in ("Unknown", "India", None):
                _city = location_ctx["city"]
                _state_name = location_ctx["state"]
                _lat = location_ctx.get("lat")
                _lon = location_ctx.get("lon")
                _incident = structured_report.get("incident_type", "Scam/Fraud")
                _risk = structured_report.get("risk_level", "Medium")
                _summary = structured_report["summary"]

                def store_scam():
                    try:
                        vdb = VectorDB()
                        vdb.add_scam(
                            description=_summary,
                            metadata={"city": _city, "state": _state_name, "source": "user_report"}
                        )

                        if _lat is not None and _lon is not None:
                            supabase_db.insert_mock_scam_with_embedding(
                                title=f"{_incident} alert in {_city}",
                                description=_summary,
                                scam_type=_incident,
                                risk_level=_risk,
                                city=_city,
                                lat=float(_lat),
                                lon=float(_lon),
                            )
                    except Exception as e:
                        print(f"Error storing scam in background: {e}")

                threading.Thread(target=store_scam).start()
                print("   📝 Alert-worthy scam report generated - storing in Postgres scam_reports + mock_scams (background).")

        if answers_collection_complete and not is_sexual_offense:
            final_response = _compose_complete_guidance(
                legal_draft or final_response,
                structured_report,
                collected_answers,
                raw_user_statement,
            )

        # ── AI Verification Status Evaluation (Text Path) ─────────────────────
        raw_flags = structured_report.get("risk_flags") or state.get("risk_flags") or []
        if isinstance(raw_flags, str):
            risk_flags = [raw_flags.lower()]
        elif isinstance(raw_flags, list):
            risk_flags = [str(f).lower() for f in raw_flags]
        else:
            risk_flags = []

        if is_sexual_offense and "sensitive" not in risk_flags:
            risk_flags.append("sensitive")

        # Determine confidence score: use explicitly computed score or infer from completeness
        existing_conf = structured_report.get("confidence_score") or structured_report.get("context_building_confidence_score") or state.get("confidence_score")
        if existing_conf is not None:
            try:
                conf_score = float(existing_conf)
            except Exception:
                conf_score = 0.75
        else:
            # Baseline confidence based on detail completeness
            has_substance = len(raw_user_statement) >= 25 and bool(structured_report.get("summary"))
            if answers_collection_complete and has_substance:
                conf_score = 0.85
            elif has_substance and not is_high_risk:
                conf_score = 0.75
            else:
                conf_score = 0.55

        is_sensitive_matter = ("sensitive" in risk_flags) or is_sexual_offense
        threat_level = structured_report.get("threat_level_assessment") or {}
        threat_status_unclear = isinstance(threat_level, dict) and threat_level.get("status") == "unclear"

        is_clear_low_risk = (
            not is_sensitive_matter
            and not threat_status_unclear
            and not should_escalate_to_moderator
            and risk_level != "high"
        )

        if is_clear_low_risk and conf_score >= 0.70:
            ai_verification_status = "verified"
            verification_source = "text"
            ai_verification_reason = f"Clear low-risk text intake verified with confidence {conf_score:.2f}."
        elif is_sensitive_matter or should_escalate_to_moderator or risk_level == "high":
            ai_verification_status = "flagged" if should_escalate_to_moderator else "pending"
            verification_source = "text"
            ai_verification_reason = "Case flagged for human moderator review due to sensitivity or risk level."
        else:
            ai_verification_status = "pending"
            verification_source = "text"
            ai_verification_reason = f"Verification pending voice clarification (confidence: {conf_score:.2f})."

        structured_report["ai_verification_status"] = ai_verification_status
        structured_report["ai_verification_confidence"] = conf_score
        structured_report["verification_source"] = verification_source
        structured_report["ai_verification_reason"] = ai_verification_reason
        structured_report["risk_flags"] = risk_flags
        structured_report["context_building_confidence_score"] = conf_score

        if case_id and hasattr(supabase_db, "update_case_ai_verification_status"):
            try:
                supabase_db.update_case_ai_verification_status(
                    case_id=case_id,
                    status=ai_verification_status,
                    confidence_score=conf_score,
                    source=verification_source,
                    reason=ai_verification_reason,
                )
            except Exception as verify_persist_err:
                print(f"   ⚠️ update_case_ai_verification_status skipped: {verify_persist_err}")

        if not is_sexual_offense and ai_verification_status == "verified":
            structured_report["nyayguide_support_needed"] = True
            nyayguide_suggestion = build_nyayguide_suggestion(
                structured_report,
                support_needs_met=bool(answers_collection_complete),
                case_id=str(case_id) if "case_id" in locals() else None,
            )
            if nyayguide_suggestion and nyayguide_suggestion.get("enabled"):
                actions.append(nyayguide_suggestion)

        # Final routing decision (AI END / nodal_guide / legal_moderator / sexual_offense)
        # Signal PDF generation when this is a final report pass (no more intake questions).
        return {
            "structured_report": structured_report,
            "suggested_actions": actions,
            "final_response": strip_classification_block(final_response),
            "user_facing_delta": strip_classification_block(final_response) if answers_collection_complete or is_sexual_offense else "",
            "next_step": next_step,
            "case_id": case_id,
            "intervention_required": intervention_req,
            "user_statement": raw_user_statement,
            "location": location_ctx,
            "situation_summary": situation_summary,
            "user_language": user_language,
            "pending_questions": [],
            "current_question_idx": 0,
            "collected_answers": collected_answers,
            "question_collection_started": False,
            "answers_collection_complete": answers_collection_complete,
            "question_rounds": int(state.get("question_rounds") or 0),
            "phase": "complete" if answers_collection_complete or is_sexual_offense else "intake",
            "pdf_ready": True if (answers_collection_complete or is_sexual_offense) else False,
            "routing_recommendation": routing_recommendation,
            "show_routing_consent": show_routing_consent,
            "female_lawyer_profiles": female_lawyer_profiles,
            "female_nyayguide_profiles": female_nyayguide_profiles,
            "show_female_lawyer_panel": False,
            "show_female_nyayguide_panel": False,
            "sexual_offense_intake_flow": sexual_offense_intake_flow,
            "waiting_for_sexual_offense_choice": is_sexual_offense and (not nyayguide_direct_connect) and (not so_enqueue.get("waiting_for_so_call_confirmation")),
            "waiting_for_so_call_confirmation": bool(so_enqueue.get("waiting_for_so_call_confirmation")),
            "so_call_confirmation_id": so_enqueue.get("so_call_confirmation_id") or "",
            "victim_phone": so_enqueue.get("victim_phone") or structured_report.get("contact") or "",
            "matched_scam_trends": matched.get("matches") or state.get("matched_scam_trends") or [],
            "scam_similarity_note": matched.get("note") or state.get("scam_similarity_note") or "",
            "scam_match_done": True,
        }
        
    except Exception as e:
        print(f"❌ Error in Report Generator: {e}")
        import traceback
        traceback.print_exc()
        return {
            "structured_report": {"error": "Failed to generate report"}, 
            "suggested_actions": [{"label": "Talk to Human", "node": "sahayak"}],
            "next_step": END,
            "pending_questions": [],
            "current_question_idx": 0,
            "collected_answers": {},
            "situation_summary": {"error": str(e)}
        }
