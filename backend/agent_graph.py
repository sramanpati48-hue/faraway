import os
from typing import TypedDict, Annotated, List, Union, Dict, Any, Optional
import operator
import uuid
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_core.messages import SystemMessage, AIMessage, BaseMessage
from backend.utils import get_llm_for_task

llm = get_llm_for_task("chat_agent.supervisor")
import logging

def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
            elif isinstance(item, str):
                parts.append(item)
        return " ".join(parts).strip()
    return str(content or "").strip()


def _supervisor_clarify_response() -> dict:
    msg = (
        "Hello! I'm NyaySahayak, your legal help assistant.\n\n"
        "**What issue are you facing?** For example: online/UPI fraud, a scam call, "
        "a missing person, theft/assault, a property dispute, domestic abuse, "
        "or a document you need reviewed.\n\n"
        "Describe your situation in your own words (any Indian language or English), "
        "and I'll guide you to the right next steps."
    )
    return {
        "messages": [AIMessage(content=msg)],
        "final_response": msg,
        "next_step": END,
        "suggested_actions": [],
    }


def _supervisor_location_ask_response(deferred_query: str = "") -> dict:
    msg = (
        "To connect you with the right local help, I need your area.\n\n"
        "**Which city or district and state are you in?** "
        "For example: `Rohini, Delhi` or `Pune, Maharashtra`."
    )
    out = {
        "messages": [AIMessage(content=msg)],
        "final_response": msg,
        "next_step": END,
        "suggested_actions": [],
        "waiting_for_location": True,
        "awaiting_user_input": True,
        "pending_question": "Which city/district and state are you in?",
        "input_prompts": [
            {
                "id": "user_area",
                "label": "Your area (city/district, state)",
                "hint": "Example: Rohini, Delhi",
                "node_id": "supervisor",
                "kind": "location",
            }
        ],
    }
    if deferred_query:
        out["pending_route_query"] = deferred_query
        out["user_statement"] = deferred_query
    return out


def _effective_location(state: "AgentState") -> dict:
    from backend.agents.common_utils import location_is_usable, normalize_location_dict

    user_details = state.get("user_details") or {}
    candidates = [
        state.get("location"),
        user_details.get("location") if isinstance(user_details, dict) else None,
    ]
    report = state.get("structured_report") or {}
    if isinstance(report, dict):
        candidates.append(report.get("location"))
    for cand in candidates:
        if location_is_usable(cand):
            return normalize_location_dict(cand) or (cand if isinstance(cand, dict) else {})
    return {}


def _parse_user_area_to_location(area_text: str) -> dict:
    """LLM-normalize a free-text area, then forward-geocode."""
    from backend.agents.common_utils import geocode_area_name
    import json as _json

    text = (area_text or "").strip()
    if not text:
        return {}

    city = ""
    state_name = ""
    try:
        prompt = (
            "Extract the Indian city/district and state from the user's area text. "
            "Reply with ONLY JSON: {\"city\": \"...\", \"state\": \"...\"}. "
            f"Area text: {text}"
        )
        resp = llm.invoke([SystemMessage(content=prompt)])
        raw = _message_text(getattr(resp, "content", resp))
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            parsed = _json.loads(raw[start : end + 1])
            city = str(parsed.get("city") or "").strip()
            state_name = str(parsed.get("state") or "").strip()
    except Exception as e:
        logger.warning("Area LLM parse failed: %s", e)

    query = ", ".join([p for p in [city, state_name] if p]) or text
    loc = geocode_area_name(query)
    if city and (not loc.get("city") or loc.get("city") == "Unknown"):
        loc["city"] = city
    if state_name and (not loc.get("state") or loc.get("state") == "Unknown"):
        loc["state"] = state_name
    loc["source"] = "user_area"
    loc["area"] = text
    return loc

# Configure logging — output to console (captured by journalctl on VPS)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import Agents
from backend.agents.cyber_agent import cyber_agent
from backend.agents.civil_agent import civil_agent
from backend.agents.criminal_agent import criminal_agent
from backend.agents.domestic_agent import domestic_agent
from backend.agents.scam_agent import scam_agent
from backend.agents.scam_match import scam_match_agent
from backend.agents.document_agent import document_agent
from backend.agents.sahayak_agent import sahayak_agent
from backend.agents.report_agent import report_generator_agent
from backend.agents.legal_moderator import legal_moderator_agent
from backend.agents.lawyer_forwarder_agent import lawyer_forwarder_agent
from backend.agents.question_processor import question_processor_agent, generate_sexual_offense_intake_questions, detect_language
from backend.agents.nodal_guide_agent import nodal_guide_agent
from backend.agents.sexual_offense_agent import sexual_offense_agent
from backend.agents.sexual_offense_keywords import has_sexual_offense_signal
from backend.agents.finance_agent import finance_agent
from backend.agents.suggested_actions_agent import suggested_actions_agent

class AgentState(TypedDict, total=False):
    """
    State definition for the agent graph.
    Includes fields for comprehensive case management with situation summary and Q&A.
    total=False makes all fields optional to allow flexible state updates.
    """
    # Core fields — add_messages so resume turns APPEND (not replace) the chat history
    messages: Annotated[List[BaseMessage], add_messages]
    next_step: str
    user_details: Dict[str, Any]
    final_response: str
    suggested_actions: List[Dict[str, str]]
    structured_report: Dict[str, Any]
    case_id: str
    intervention_required: bool
    
    # User context — original incident text; must survive Q&A turns
    user_statement: str
    location: Dict[str, Any]
    user_id: str
    user_name: str
    session_id: str
    
    # Question processor fields (side-node loop: report → questions → report)
    pending_questions: List[Dict[str, str]]
    current_question_idx: int
    collected_answers: Dict[str, str]
    question_labels: Dict[str, str]
    question_collection_started: bool
    answers_collection_complete: bool
    
    # Situation context
    situation_summary: Dict[str, Any]
    user_language: str
    
    # PDF generation
    pdf_ready: bool
    pdf_url: str

    # Retrieval context
    retrieved_legal_chunks: List[Dict[str, Any]]
    matched_scam_trends: List[Dict[str, Any]]
    scam_similarity_note: str
    scam_match_done: bool

    # Nodal Guide fields
    nodal_guide_consent_asked: bool
    nodal_guide_profiles: List[Dict[str, Any]]
    show_nodal_guide_panel: bool
    waiting_for_nodal_guide_consent: bool
    
    # Sexual Offense / Female Lawyer & Counsellor fields
    female_lawyer_profiles: List[Dict[str, Any]]
    female_nyayguide_profiles: List[Dict[str, Any]]
    show_female_lawyer_panel: bool
    show_female_nyayguide_panel: bool
    high_sensitivity: bool
    case_category: str
    show_sexual_offense_screening: bool
    sexual_offense_screening_answers: Dict[str, Any]
    screening_data: Dict[str, Any]
    sexual_offense_intake_flow: bool
    waiting_for_sexual_offense_choice: bool
    waiting_for_moderator_resolution: bool
    waiting_for_location: bool
    awaiting_user_input: bool
    input_prompts: List[Dict[str, Any]]
    pending_question: str
    pending_route_query: str

    # Multi-agent plan (supervisor → plan_runner → specialists → report)
    agent_plan: List[str]
    plan_index: int
    phase: str
    user_facing_delta: str
    legal_draft: str
    document_analysis: str
    awaiting_document_summary: bool
    document_reviewed: bool
    waiting_for_so_call_confirmation: bool
    so_call_confirmation_id: str
    victim_phone: str
    suggested_links: List[Dict[str, str]]
    attachments: List[Dict[str, Any]]
    lawyer_needed: bool
    lawyer_category: Optional[str]
    explicit_lawyer_request: bool
    show_suggestions_rail: bool
    question_rounds: int
    local_forum: Dict[str, Any]
    small_local_dispute: bool
    ask_nyaysahayak: bool
    show_nodal_guide_suggest: bool
    active_policy_notes: str

def supervisor_agent(state: AgentState):
    """
    Core agent that routes the query to the appropriate specialist agent.
    Enhanced with:
    - Skip redundant agents if user is answering questions
    - Detect new cases mid-conversation
    - Smart routing based on conversation context
    - GPS or supervisor area ask before specialist routing
    """
    try:
        print("\nSUPERVISOR AGENT")
        print("   Analyzing query intent...")
    except Exception:
        pass
    logger.info("Supervisor analyzing query...")
    messages = state["messages"]
    
    # Check if there are pending questions from a previous turn
    pending_questions = state.get("pending_questions", [])
    current_question_idx = state.get("current_question_idx", None)
    
    # If we have pending questions and user just provided input, this is likely an answer
    # Check for markers that indicate they're answering a question vs starting new case
    latest_user_msg = None
    latest_user_raw = None
    if len(messages) > 0 and hasattr(messages[-1], "type") and messages[-1].type == "human":
        latest_user_raw = _message_text(messages[-1].content)
        latest_user_msg = latest_user_raw.lower()

    location_updates: Dict[str, Any] = {}
    # After area answer, route using the original complaint — not the area text
    route_query = (
        state.get("pending_route_query")
        or state.get("user_statement")
        or latest_user_raw
    )

    # --- LOCATION ANSWER: user replied with area after supervisor ask ---
    if state.get("waiting_for_location") and latest_user_raw:
        print("   ✓ Parsing user area for location")
        loc = _parse_user_area_to_location(latest_user_raw)
        if loc and (loc.get("city") or loc.get("state")):
            user_details = dict(state.get("user_details") or {})
            user_details["location"] = loc
            location_updates = {
                "location": loc,
                "user_details": user_details,
                "waiting_for_location": False,
                "awaiting_user_input": False,
                "input_prompts": [],
                "pending_question": "",
                "pending_route_query": "",
            }
            # Prefer deferred complaint for subsequent intent routing
            if route_query and route_query != latest_user_raw:
                latest_user_raw = str(route_query)
                latest_user_msg = latest_user_raw.lower()
            print(f"   Location set from user area: {loc.get('city')}, {loc.get('state')}")
        else:
            print("   ⚠️ Could not parse area — asking again")
            ask = _supervisor_location_ask_response(
                deferred_query=str(state.get("pending_route_query") or state.get("user_statement") or "")
            )
            ask["final_response"] = (
                "I couldn't place that area. Please share your **city/district and state** "
                "(e.g. `Rohini, Delhi`)."
            )
            ask["messages"] = [AIMessage(content=ask["final_response"])]
            return ask

    has_case_context = bool(
        state.get("structured_report")
        or state.get("case_id")
        or state.get("pending_questions")
        or state.get("waiting_for_nodal_guide_consent")
        or state.get("waiting_for_sexual_offense_choice")
        or state.get("waiting_for_moderator_resolution")
        or state.get("waiting_for_so_call_confirmation")
        or state.get("waiting_for_location")
        or location_updates.get("location")
    )

    # Resolve location if present; gate is applied only after LLM says this is a problem.
    effective_loc = location_updates.get("location") or _effective_location(state)
    if effective_loc and not location_updates.get("location"):
        user_details = dict(state.get("user_details") or {})
        user_details["location"] = effective_loc
        location_updates = {
            "location": effective_loc,
            "user_details": user_details,
            "waiting_for_location": False,
        }

    def _route(payload: dict) -> dict:
        """Merge resolved location into every supervisor routing decision."""
        return {**location_updates, **payload} if location_updates else payload

    # --- INSTANT GREETING FAST-PATH: Answer greetings immediately without LLM latency ---
    FAST_GREETINGS = {
        "hi", "hello", "hey", "namaste", "namaskar", "good morning", "good evening",
        "good afternoon", "hii", "hiii", "hiiii", "helloo", "helo", "start", "help",
        "hola", "vanakkam", "kem cho", "kaise ho", "kemon acho", "sat sri akal",
        "pranam", "adab", "salam", "assalam alaikum", "hi nyaysahayak", "hello nyaysahayak"
    }
    cleaned_input = (latest_user_msg or "").strip().rstrip("!.,?").strip()
    if (
        cleaned_input in FAST_GREETINGS
        and not has_case_context
        and not pending_questions
        and not state.get("waiting_for_location")
    ):
        print("   ⚡ Instant Greeting Fast-Path -> Clarify")
        logger.info("Instant greeting fast-path triggered")
        return _route(_supervisor_clarify_response())

    # --- SMART ROUTE -1: Detect Sexual Offense Cases ---
    # Flow order: question_processor intake -> report_generator -> sexual_offense choices.
    case_category = state.get("case_category", "")
    high_sensitivity = state.get("high_sensitivity", False)
    sexual_offense_intake_flow = bool(state.get("sexual_offense_intake_flow", False))
    waiting_for_sexual_offense_choice = bool(state.get("waiting_for_sexual_offense_choice", False))

    if waiting_for_sexual_offense_choice:
        print("   ✓ Waiting for user sexual-offense support choice")
        logger.info("Routing back to sexual_offense for user choice")
        return _route({"next_step": "sexual_offense"})

    if state.get("waiting_for_so_call_confirmation"):
        print("   ✓ Sexual-offence confirmation call still pending")
        logger.info("Holding flow until moderator confirmation call")
        return _route(
            {
                "next_step": END,
                "final_response": (
                    "A confirmation call is still pending. A moderator will call you once, "
                    "free of charge, and then connect you with a female Nyay Guide."
                ),
                "awaiting_user_input": True,
                "waiting_for_so_call_confirmation": True,
            }
        )

    if state.get("waiting_for_moderator_resolution"):
        print("   ✓ Waiting for moderator resolution input")
        logger.info("Routing back to legal_moderator for resolution")
        return _route({"next_step": "legal_moderator"})

    if sexual_offense_intake_flow and pending_questions:
        print("   ✓ Sexual-offense intake in progress")
        logger.info("Routing to question_processor for intake")
        return _route({"next_step": "question_processor"})

    # --- SMART ROUTE 0: Mid-intake answers (must beat keyword/intent routes) ---
    # While follow-up questions are open, keep sending turns to question_processor.
    # Otherwise resume can fall through to specialists → report_generator, which
    # regenerates Q1 and looks like the UI is stuck on 1/N.
    answers_collection_complete = bool(state.get("answers_collection_complete")) or bool(
        (state.get("situation_summary") or {}).get("answers_collection_complete")
    )
    if pending_questions and not answers_collection_complete:
        new_case_keywords = [
            "new case", "different issue", "something else", "another problem",
            "different problem", "new issue", "unrelated", "change topic",
            "नया मामला", "अलग समस्या", "दूसरी बात",
            "নতুন মামলা", "আলাদা সমস্যা",
            "కొత్త కేసు", "వేరే సమస్య",
            "नवीन केस", "वेगळी समस्या",
            "புதிய வழக்கு", "வேறு பிரச்சனை",
            "નવો કેસ", "અલગ સમસ્યા",
            "ಹೊಸ ಪ್ರಕರಣ", "ಬೇರೆ ಸಮಸ್ಯೆ",
            "ਨਵਾਂ ਕੇਸ", "ਵੱਖਰੀ ਸਮੱਸਿਆ",
            "പുതിയ കേസ്", "വേറൊരു പ്രശ്നം",
        ]
        if latest_user_msg and any(kw in latest_user_msg for kw in new_case_keywords):
            print("   ⚠️  User requesting new case during intake")
            confirmation_msg = (
                "I notice you'd like to discuss a different issue. "
                "\n\n**Would you like to:**\n"
                "1. Finish with the current case first?\n"
                "2. Start a new case about the new issue?\n\n"
                "Please let me know your preference."
            )
            return _route({
                "next_step": "civil",
                "final_response": confirmation_msg,
            })
        q_idx = int(current_question_idx if current_question_idx is not None else 0)
        print(f"   ✓ Detected user answering question #{q_idx + 1}")
        logger.info("Routing to question_processor for answer collection")
        return _route({"next_step": "question_processor"})

    # Attachments go to document_agent first; its summary returns here for case-type routing.
    attachments_now = list(state.get("attachments") or [])
    details_now = state.get("user_details") or {}
    if isinstance(details_now, dict) and details_now.get("attachments"):
        attachments_now = list(details_now.get("attachments") or attachments_now)
    if (
        attachments_now
        and not state.get("document_reviewed")
        and not state.get("document_analysis")
        and not pending_questions
        and not sexual_offense_intake_flow
        and not state.get("structured_report")
        and not state.get("case_id")
    ):
        print("   Attachments present — sending to document agent before case routing")
        logger.info("Supervisor → document_agent for attachment summary")
        return _route(
            {
                "next_step": "document",
                "awaiting_document_summary": True,
                "document_reviewed": False,
                "attachments": attachments_now,
                "pending_route_query": latest_user_raw or state.get("pending_route_query") or "",
                "user_statement": state.get("user_statement") or latest_user_raw or "",
            }
        )

    so_signal_text = " ".join(
        [
            latest_user_msg or "",
            str(state.get("document_analysis") or ""),
            str(state.get("user_statement") or ""),
        ]
    )
    if so_signal_text and has_sexual_offense_signal(so_signal_text):
        print("   🚨 SEXUAL OFFENSE KEYWORDS DETECTED")
        logger.info("Starting sexual-offense intake via question_processor")
        intake_questions = generate_sexual_offense_intake_questions(detect_language(messages[-1].content if messages else ""))
        return _route({
            "next_step": "question_processor",
            "case_id": str(uuid.uuid4()),
            "user_statement": messages[-1].content if messages else "",
            "high_sensitivity": True,
            "case_category": "sexual_offence",
            "human_takeover_required": True,
            "manual_review_required": True,
            "ai_detail_mode": "minimal",
            "priority_escalation": "immediate",
            "nyay_guide_flow": False,
            "connect_lawyer_enabled": True,
            "female_nyayguide_support_enabled": True,
            "sexual_offense_intake_flow": True,
            "pending_questions": intake_questions,
            "current_question_idx": 0,
            "collected_answers": {},
            "question_collection_started": False,
        })

    if case_category == "sexual_offence" or high_sensitivity:
        print("   🚨 SEXUAL OFFENSE CASE CONTEXT DETECTED")
        logger.info("Continuing sexual-offense flow")
        if pending_questions:
            return _route({"next_step": "question_processor"})
        return _route({"next_step": "sexual_offense"})

    # --- SMART ROUTE 0.5: User answering Nodal Guide consent ---
    waiting_for_nodal_guide_consent = state.get("waiting_for_nodal_guide_consent", False)
    if waiting_for_nodal_guide_consent:
        print("   ✓ Detected user answering Nodal Guide consent")
        logger.info("Routing back to nodal_guide for consent reply")
        return _route({"next_step": "nodal_guide"})

    # --- SMART ROUTE 0.75: Deterministic action intents in active case sessions ---
    # If the user explicitly asks for human guide/lawyer, skip report/question/moderator loop
    # and route directly to the requested handoff agent.
    if latest_user_msg:
        # Lawyer intent keywords — all 22 scheduled Indian languages
        lawyer_intents = [
            # English
            "connect lawyer", "connect to lawyer", "recommend lawyer", "lawyer",
            "advocate", "legal counsel", "forward to lawyer", "need a lawyer",
            # Hindi
            "वकील", "वकील चाहिए", "वकील से बात", "vakil", "advocate chahiye",
            # Bengali
            "আইনজীবী", "উকিল", "আইনজীবী দরকার",
            # Telugu
            "న్యాయవాది", "లాయర్", "న్యాయవాది కావాలి",
            # Marathi
            "वकील", "वकील हवा", "वकील लागतो",
            # Tamil
            "வக்கீல்", "வழக்கறிஞர்", "வக்கீல் வேண்டும்",
            # Urdu
            "وکیل", "وکیل چاہیے", "قانونی مدد",
            # Gujarati
            "વકીલ", "વકીલ જોઈએ", "વકીલ સાથે વાત",
            # Kannada
            "ವಕೀಲ", "ವಕೀಲರು ಬೇಕು", "ಲಾಯರ್",
            # Odia
            "ଓକିଲ", "ଉକିଲ ଦରକାର",
            # Malayalam
            "അഭിഭാഷകൻ", "വക്കീൽ", "ലോയർ വേണം",
            # Punjabi
            "ਵਕੀਲ", "ਵਕੀਲ ਚਾਹੀਦਾ", "ਵਕੀਲ ਨਾਲ ਗੱਲ",
            # Assamese
            "উকীল", "আইনজীৱী",
            # Maithili
            "वकील चाही",
            # Nepali
            "वकील", "कानुनी सहायता",
            # Kashmiri
            "وکیل",
            # Sindhi
            "وکيل",
            # Konkani
            "वकील हाय",
            # Dogri
            "वकील चाहिदा",
            # Manipuri
            "ওকিল",
            # Santali
            "lawyer darka",
        ]
        # Sahayak / human help keywords — all 22 scheduled Indian languages
        sahayak_intents = [
            # English
            "sahayak", "nyaysahayak", "nyay guide", "human help", "talk to human",
            "connect to nyay guide", "connect to sahayak", "human support",
            # Hindi
            "इंसान से बात", "सहायक", "न्यायसहायक", "मदद चाहिए", "इंसानी मदद",
            # Bengali
            "মানুষের সাহায্য", "সাহায্য দরকার", "মানুষের সাথে কথা",
            # Telugu
            "మానవ సహాయం", "సహాయకుడు", "మనిషితో మాట్లాడు",
            # Marathi
            "माणसाची मदत", "सहायक हवा", "माणसाशी बोलायचे",
            # Tamil
            "மனித உதவி", "உதவி வேண்டும்", "மனிதனிடம் பேசணும்",
            # Urdu
            "انسانی مدد", "مدد چاہیے", "انسان سے بات",
            # Gujarati
            "મદદ જોઈએ", "માણસ સાથે વાત", "સહાય",
            # Kannada
            "ಸಹಾಯ ಬೇಕು", "ಮಾನವ ಸಹಾಯ", "ಮನುಷ್ಯನೊಂದಿಗೆ ಮಾತನಾಡಿ",
            # Odia
            "ସାହାଯ୍ୟ ଦରକାର", "ମଣିଷ ସହ କଥା",
            # Malayalam
            "മനുഷ്യ സഹായം", "സഹായം വേണം", "മനുഷ്യനോട് സംസാരിക്കണം",
            # Punjabi
            "ਮਦਦ ਚਾਹੀਦੀ", "ਇਨਸਾਨੀ ਮਦਦ", "ਬੰਦੇ ਨਾਲ ਗੱਲ",
            # Assamese
            "সহায় লাগে", "মানুহৰ সৈতে কথা",
            # Maithili
            "मदति चाही",
            # Nepali
            "मद्दत चाहियो", "मानिससँग कुरा गर्नु",
            # Kashmiri
            "مدد چھُ ضرور",
            # Sindhi
            "مدد گهرجي",
            # Konkani
            "मदत जाय",
            # Dogri
            "मदद चाहिदी",
            # Manipuri
            "সাহায্য দরকার",
            # Santali
            "help darka",
        ]

        has_existing_case_context = bool(state.get("structured_report") or state.get("case_id"))
        if has_existing_case_context and any(term in latest_user_msg for term in lawyer_intents):
            print("   ✓ Explicit lawyer intent detected in active case -> routing directly to lawyer_forwarder")
            logger.info("Direct intent route: lawyer_forwarder")
            return _route({"next_step": "lawyer_forwarder"})

        if has_existing_case_context and any(term in latest_user_msg for term in sahayak_intents):
            print("   ✓ Explicit sahayak intent detected in active case -> routing directly to sahayak")
            logger.info("Direct intent route: sahayak")
            return _route({"next_step": "sahayak"})

    if answers_collection_complete and has_case_context:
        print("   ✓ Existing case context — resume via plan_runner (skip specialist re-run)")
        return _route({
            "next_step": "plan_runner",
            "agent_plan": list(state.get("agent_plan") or []),
            "plan_index": len(list(state.get("agent_plan") or [])),
            "phase": "complete",
        })
    
    # --- SMART ROUTE 2: Detect new cases mid-conversation ---
    if len(messages) > 4:  # Only after initial back-and-forth
        # Check for case change indicators
        new_case_markers = {
            "different_issue": [
                "now ", "also ", "other ", "separate ", "another ",
                "doesn't involve", "not related", "completely different"
            ],
            "multiple_cases": [
                "i also have", "i'm also dealing with", "also experiencing",
                "in addition", "furthermore",
            ]
        }
        
        if latest_user_msg:
            for marker_type, keywords in new_case_markers.items():
                if any(kw in latest_user_msg for kw in keywords):
                    # Potential new case detected - ask user for clarification
                    print(f"   ⚠️  Potential new case detected (marker: {marker_type})")
                    confirmation_msg = (
                        "I notice you might be referring to a different situation. "
                        "\n\n**Would you like to:**\n"
                        "1. Continue discussing the original issue?\n"
                        "2. Start a new case about this new issue?\n\n"
                        "Please clarify so I can help you better."
                    )
                    return _route({
                        "next_step": "civil",  # Route to civil to handle this clarification
                        "final_response": confirmation_msg
                    })
    
    # --- LLM decides: is this a problem? If yes, which agent; if not → clarify ---
    system_prompt = """You are the supervisor for NyayaSahayak, an Indian legal AI assistant.

Decide from the latest user message (any Indian language or English):

STEP 1 — Is the user stating a real-world problem or situation they need help with?
- YES (a problem): they describe harm, loss, dispute, fear, missing person, abuse, fraud, documents, police/court issues, or ask for help about a specific situation — even if brief or informal.
- NO (not a problem): greetings, thanks, bye, small talk, empty/unclear chat, jokes, asking who you are, or "help" with no situation.

STEP 2 — Reply with ONE word only:
- If NO problem → clarify
- If YES problem → pick exactly one of:
  cyber | criminal | civil | domestic | scam | document | finance | sahayak | legal_moderator | lawyer_forwarder

Agent meanings:
- cyber: money lost via UPI/bank/OTP/online fraud/phone scam
- criminal: missing person/lost child/family member, kidnapping, assault, theft/robbery, homicide threats, cognizable IPC offences, police FIR matters (not cyber-fraud, not domestic family abuse)
- civil: property, divorce, tenant, consumer, contracts, other non-criminal legal help
- domestic: physical/emotional abuse by family (dowry, violence) — not money issues
- scam: suspicious call/message but NO money lost yet
- document: analyze RTI, FIR, court notice, contract
- finance: loans, cheque bounce, banking/RBI, recovery agents, EMI disputes (not UPI OTP fraud)
- sahayak: ONLY if they explicitly ask for a human Nyay Guide / Sahayak / talk to a human
- legal_moderator: explicitly wants legal moderator review
- lawyer_forwarder: explicitly wants a lawyer

Rules:
- You decide problem vs not-a-problem. Do not use clarify if they already stated a situation.
- Missing person / lost child / kidnapping → criminal (never civil).
- Product name "NyayaSahayak"/"Sahayak" alone is NOT a sahayak route.
- Reply with ONE word only."""

    from backend.agents.common_utils import active_policy_prompt_block

    system_prompt += active_policy_prompt_block("chat_agent.supervisor")

    # When we just collected area, bias routing on the original complaint
    routing_messages = list(messages)
    doc_summary = str(state.get("document_analysis") or "").strip()
    if doc_summary:
        routing_messages = [
            SystemMessage(content=f"DOCUMENT SUMMARY FROM DOCUMENT AGENT:\n{doc_summary[:3500]}")
        ] + routing_messages
    deferred = (state.get("pending_route_query") or state.get("user_statement") or "").strip()
    if location_updates.get("location") and deferred and deferred.lower() != (latest_user_raw or "").lower():
        from langchain_core.messages import HumanMessage as _HM
        routing_messages = [m for m in routing_messages if not (hasattr(m, "type") and m.type == "human" and _message_text(m.content) == latest_user_raw)]
        routing_messages.append(_HM(content=deferred))

    response = llm.invoke([SystemMessage(content=system_prompt)] + routing_messages)

    content = response.content
    if isinstance(content, list):
        content = "".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in content])
    elif not isinstance(content, str):
        content = str(content)

    route = content.strip().lower()
    for token in route.replace(",", " ").split():
        token = token.strip().strip(".").lower()
        if token in {
            "clarify", "cyber", "criminal", "civil", "domestic", "scam", "document",
            "finance", "sahayak", "legal_moderator", "lawyer_forwarder", "question_processor",
        }:
            route = token
            break

    # Not a problem (LLM) → ask what issue they face; do not run specialist graph.
    if route == "clarify" or route not in {
        "cyber", "criminal", "civil", "domestic", "scam", "document", "finance",
        "sahayak", "legal_moderator", "lawyer_forwarder", "question_processor",
    }:
        print("   CLARIFY: LLM decided no problem stated — asking for the issue")
        logger.info("Supervisor clarify (LLM: not a problem)")
        return _route(_supervisor_clarify_response())

    # Guard: never open Nyay Guide handoff unless user explicitly asked
    sahayak_intents_guard = [
        "sahayak", "nyaysahayak", "nyay guide", "human help", "talk to human",
        "connect to nyay guide", "connect to sahayak", "human support",
        "इंसान से बात", "सहायक", "न्यायसहायक", "इंसानी मदद",
    ]
    if route == "sahayak":
        explicit_sahayak = bool(
            latest_user_msg and any(term in latest_user_msg for term in sahayak_intents_guard)
        )
        if not explicit_sahayak:
            print("   Blocked sahayak misroute (no explicit Nyay Guide intent) -> clarify")
            logger.info("Blocked sahayak without explicit intent; clarifying instead")
            return _route(_supervisor_clarify_response())

    # Problem path: ask for area before specialists when we have none yet.
    mid_flow = bool(
        pending_questions
        or state.get("waiting_for_nodal_guide_consent")
        or state.get("waiting_for_sexual_offense_choice")
        or state.get("waiting_for_moderator_resolution")
        or state.get("answers_collection_complete")
        or has_case_context
    )
    if (
        not effective_loc
        and not state.get("waiting_for_location")
        and not mid_flow
    ):
        print("   Problem detected, no location — asking user for area")
        logger.info("Supervisor asking for area after LLM problem route")
        return _route(
            _supervisor_location_ask_response(deferred_query=latest_user_raw or "")
        )

    print(f"   ROUTING TO: {route.upper()}")
    logger.info(f"Supervisor decided routing to: {route}")

    handoff = {
        "sahayak",
        "legal_moderator",
        "lawyer_forwarder",
        "question_processor",
        "nodal_guide",
        "sexual_offense",
    }
    attachments = list(state.get("attachments") or [])
    details = state.get("user_details") or {}
    if isinstance(details, dict) and details.get("attachments"):
        attachments = list(details.get("attachments") or attachments)
    explicit_lawyer = route == "lawyer_forwarder" or bool(
        latest_user_msg
        and any(
            term in latest_user_msg
            for term in ("need a lawyer", "recommend lawyer", "connect lawyer", "वकील", "advocate")
        )
    )
    if route in handoff and not (route == "lawyer_forwarder" and not has_case_context):
        return _route(
            {
                "next_step": route,
                "attachments": attachments,
                "explicit_lawyer_request": explicit_lawyer,
                "lawyer_needed": explicit_lawyer,
            }
        )

    domain = route
    if domain == "lawyer_forwarder":
        text = latest_user_msg or ""
        if any(k in text for k in ("upi", "otp", "bank", "cyber", "phishing")):
            domain = "cyber"
        elif any(k in text for k in ("missing", "stolen", "theft", "assault", "fir", "kidnap")):
            domain = "criminal"
        elif any(k in text for k in ("loan", "cheque", "emi", "ombudsman", "rbi")):
            domain = "finance"
        elif any(k in text for k in ("dowry", "domestic", "husband", "wife", "abuse")):
            domain = "domestic"
        else:
            domain = "civil"

    plan: list[str] = []
    if attachments and "document" not in plan and not state.get("document_reviewed"):
        plan.append("document")
    if domain in {
        "cyber",
        "criminal",
        "civil",
        "domestic",
        "scam",
        "document",
        "finance",
    } and domain not in plan:
        plan.append(domain)
    if not plan:
        plan = [domain if domain in {"cyber", "criminal", "civil", "domestic", "scam", "document", "finance"} else "civil"]
    if "scam_match" not in plan:
        plan.insert(0, "scam_match")

    print(f"   agent_plan={plan}")
    return _route(
        {
            "next_step": "plan_runner",
            "agent_plan": plan,
            "plan_index": 0,
            "phase": "intake",
            "attachments": attachments,
            "explicit_lawyer_request": explicit_lawyer,
            "lawyer_needed": explicit_lawyer,
            "case_category": domain if domain != "document" else (state.get("case_category") or "document"),
        }
    )


SPECIALIST_NODES = {
    "scam_match",
    "cyber",
    "criminal",
    "civil",
    "domestic",
    "scam",
    "document",
    "finance",
}


def plan_runner_agent(state: AgentState):
    """Walk the supervisor's ordered specialist list, then hand off to report."""
    pending_questions = state.get("pending_questions") or []
    answers_done = bool(state.get("answers_collection_complete"))
    if pending_questions and not answers_done:
        return {"next_step": "question_processor", "phase": "questioning"}
    if answers_done:
        return {"next_step": "report_generator", "phase": "questioning"}

    plan = [n for n in (state.get("agent_plan") or []) if n in SPECIALIST_NODES]
    idx = int(state.get("plan_index") or 0)
    if idx >= len(plan):
        return {"next_step": "report_generator"}
    node = plan[idx]
    print(f"   ▶ plan_runner → {node} ({idx + 1}/{len(plan)})")
    return {"next_step": node, "plan_index": idx + 1, "phase": "intake"}

# --- Graph Construction ---

workflow = StateGraph(AgentState)

workflow.add_node("supervisor", supervisor_agent)
workflow.add_node("plan_runner", plan_runner_agent)
workflow.add_node("scam_match", scam_match_agent)
workflow.add_node("cyber", cyber_agent)
workflow.add_node("criminal", criminal_agent)
workflow.add_node("civil", civil_agent)
workflow.add_node("domestic", domestic_agent)
workflow.add_node("scam", scam_agent)
workflow.add_node("document", document_agent)
workflow.add_node("finance", finance_agent)
workflow.add_node("sahayak", sahayak_agent)
workflow.add_node("legal_moderator", legal_moderator_agent)
workflow.add_node("lawyer_forwarder", lawyer_forwarder_agent)
workflow.add_node("question_processor", question_processor_agent)
workflow.add_node("report_generator", report_generator_agent)
workflow.add_node("suggested_actions", suggested_actions_agent)
workflow.add_node("nodal_guide", nodal_guide_agent)
workflow.add_node("sexual_offense", sexual_offense_agent)

workflow.set_entry_point("supervisor")

def router(state: AgentState):
    return state.get("next_step", "plan_runner")

workflow.add_conditional_edges(
    "supervisor",
    router,
    {
        "plan_runner": "plan_runner",
        "scam_match": "scam_match",
        "cyber": "cyber",
        "criminal": "criminal",
        "civil": "civil",
        "domestic": "domestic",
        "scam": "scam",
        "document": "document",
        "finance": "finance",
        "sahayak": "sahayak",
        "legal_moderator": "legal_moderator",
        "lawyer_forwarder": "lawyer_forwarder",
        "question_processor": "question_processor",
        "nodal_guide": "nodal_guide",
        "sexual_offense": "sexual_offense",
        END: END,
    }
)

workflow.add_conditional_edges(
    "plan_runner",
    router,
    {
        "scam_match": "scam_match",
        "cyber": "cyber",
        "criminal": "criminal",
        "civil": "civil",
        "domestic": "domestic",
        "scam": "scam",
        "document": "document",
        "finance": "finance",
        "report_generator": "report_generator",
        "question_processor": "question_processor",
        END: END,
    },
)

for _spec in ("scam_match", "cyber", "criminal", "scam", "civil", "domestic", "finance"):
    workflow.add_edge(_spec, "plan_runner")


def document_router(state: AgentState):
    if state.get("next_step") == "supervisor":
        return "supervisor"
    return "plan_runner"


workflow.add_conditional_edges(
    "document",
    document_router,
    {
        "supervisor": "supervisor",
        "plan_runner": "plan_runner",
    },
)

def report_router(state: AgentState):
    next_s = state.get("next_step", END)
    if next_s == "question_processor":
        return "question_processor"
    if next_s == "sexual_offense":
        return "sexual_offense"
    return "suggested_actions"

workflow.add_conditional_edges(
    "report_generator",
    report_router,
    {
        "question_processor": "question_processor",
        "suggested_actions": "suggested_actions",
        "sexual_offense": "sexual_offense",
        END: END,
    },
)

def suggested_router(state: AgentState):
    next_s = state.get("next_step", END)
    if next_s == "legal_moderator":
        return "legal_moderator"
    if next_s == "lawyer_forwarder":
        return "lawyer_forwarder"
    if next_s == "nodal_guide":
        return "nodal_guide"
    return END

workflow.add_conditional_edges(
    "suggested_actions",
    suggested_router,
    {
        "legal_moderator": "legal_moderator",
        "lawyer_forwarder": "lawyer_forwarder",
        "nodal_guide": "nodal_guide",
        END: END,
    },
)

def question_router(state: AgentState):
    next_s = state.get("next_step", END)
    if next_s == "report_generator":
        return "report_generator"
    return END

workflow.add_conditional_edges(
    "question_processor",
    question_router,
    {
        "report_generator": "report_generator",
        END: END,
    },
)

workflow.add_edge("legal_moderator", END)
workflow.add_edge("lawyer_forwarder", END)
workflow.add_edge("sahayak", END)
workflow.add_edge("nodal_guide", END)

def sexual_offense_router(state: AgentState):
    next_s = state.get("next_step", END)
    if next_s == "legal_moderator":
        return "legal_moderator"
    return END

workflow.add_conditional_edges(
    "sexual_offense",
    sexual_offense_router,
    {
        "legal_moderator": "legal_moderator",
        END: END,
    },
)

from backend.database.graph_checkpointer import build_checkpointer

# Compile with durable Postgres checkpointer when DATABASE_URL is set
checkpointer = build_checkpointer()
agent_graph = workflow.compile(checkpointer=checkpointer)
