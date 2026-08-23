"""
Question Processor Agent: Collects answers to follow-up questions for case refinement
"""
from langchain_core.messages import SystemMessage
from langgraph.graph import END
from backend.utils import get_llm_for_task

llm = get_llm_for_task("chat_agent.question_processor")
import json
from datetime import datetime
import re

def detect_language(text: str) -> str:
    """
    Detect the language of the input text.
    Returns: 'hindi', 'punjabi', 'marathi', 'bhojpuri', 'haryanvi', 'tamil', 'telugu', 'bengali', or 'english'
    
    Unicode Ranges:
    - Devanagari (Hindi, Marathi, Bhojpuri, Haryanvi): \u0900-\u097F
    - Bengali: \u0980-\u09FF
    - Gujarati: \u0A80-\u0AFF (not used yet)
    - Punjabi (Gurmukhi): \u0A00-\u0A7F
    - Tamil: \u0B80-\u0BFF
    - Telugu: \u0C00-\u0C7F
    - Kannada: \u0C80-\u0CFF (not used yet)
    - Malayalam: \u0D00-\u0D7F (not used yet)
    """
    if not text:
        return "english"
    
    # Tamil detection (Tamil script)
    if re.search(r'[\u0B80-\u0BFF]', text):
        return "tamil"
    
    # Telugu detection (Telugu script)
    if re.search(r'[\u0C00-\u0C7F]', text):
        return "telugu"

    # Kannada detection
    if re.search(r'[\u0C80-\u0CFF]', text):
        return "kannada"

    # Malayalam detection
    if re.search(r'[\u0D00-\u0D7F]', text):
        return "malayalam"

    # Gujarati detection
    if re.search(r'[\u0A80-\u0AFF]', text):
        return "gujarati"

    # Odia detection
    if re.search(r'[\u0B00-\u0B7F]', text):
        return "odia"
    
    # Punjabi detection (Gurmukhi script)
    if re.search(r'[\u0A00-\u0A7F]', text):
        return "punjabi"
    
    # Bengali detection (Bengali script)
    if re.search(r'[\u0980-\u09FF]', text):
        return "bengali"

    # Urdu / Arabic script detection
    if re.search(r'[\u0600-\u06FF]', text):
        return "urdu"
    
    # Devanagari detection (Hindi, Marathi, Bhojpuri, Haryanvi)
    # We return "hindi" as default for Devanagari script.
    if re.search(r'[\u0900-\u097F]', text):
        return "hindi"
    
    # Default to English
    return "english"

def question_processor_agent(state):
    """
    Processes follow-up questions and collects answers.
    This agent is triggered when the report_generator identifies gaps needing clarification.
    Builds a comprehensive situation_summary as answers are collected.
    """
    print("\nQUESTION PROCESSOR AGENT")
    print(f"   Collecting additional information...")
    
    messages = state["messages"]
    raw_questions = state.get("pending_questions", []) or []
    questions_to_ask = []
    for i, q in enumerate(raw_questions):
        if isinstance(q, dict):
            item = dict(q)
            item.setdefault("key", f"q_{i}")
            if not item.get("question") and item.get("text"):
                item["question"] = item["text"]
            questions_to_ask.append(item)
        elif q:
            questions_to_ask.append({"key": f"q_{i}", "question": str(q), "context": ""})
    collected_answers = dict(state.get("collected_answers", {}) or {})
    question_labels = dict(state.get("question_labels") or {})
    for i, item in enumerate(questions_to_ask):
        key = str(item.get("key") or f"q_{i}")
        text = str(item.get("question") or item.get("text") or "").strip()
        if key and text:
            question_labels[key] = text
    situation_summary = state.get("situation_summary", {}) or {}
    user_language = state.get("user_language", "english")
    user_statement = state.get("user_statement", "")
    question_collection_started = state.get("question_collection_started", False)
    intervention_required = state.get("intervention_required", False)
    case_id = state.get("case_id")
    structured_report = state.get("structured_report", {})
    suggested_actions = state.get("suggested_actions", [])
    routing_recommendation = state.get("routing_recommendation")
    show_routing_consent = bool(state.get("show_routing_consent", False))
    sexual_offense_intake_flow = bool(state.get("sexual_offense_intake_flow", False))
    case_category = str(state.get("case_category", ""))

    def _labels_payload() -> dict:
        return {
            "question_labels": question_labels,
            "qa_pairs": [
                {
                    "key": str(k),
                    "question": question_labels.get(str(k), str(k)),
                    "answer": str(v),
                }
                for k, v in collected_answers.items()
            ],
        }

    def _is_yes(v: str) -> bool:
        val = str(v or "").strip().lower()
        yes_tokens = [
            "yes", "haan", "ha", "true", "हाँ", "হ্যাঁ", "yep", "yeah",
            "ಹೌದು", "ஆம்", "అవును", "હા", "ହଁ", "അതെ", "ਹਾਂ", "جی ہاں", "نعم"
        ]
        if val in {"y", "1"}:
            return True
        return any(tok in val for tok in yes_tokens)

    def _is_evasive_answer(answer: str, question: str) -> bool:
        """Reject filler that does not actually answer the current intake question."""
        raw = str(answer or "").strip()
        a = raw.lower()
        q = str(question or "").lower()
        if len(a) < 2:
            return True
        fillers = {
            "whatever", "anything", "something", "stuff", "idk", "i dont know",
            "i don't know", "dont know", "don't know", "dunno", "no idea",
            "nothing", "n/a", "na", "none", "skip", "pass", "idc", "don't care",
            "dont care", "blah", "asdf", "test", "hmm", "hmmm", "lol", "ok",
            "okay", "k", "kk", "fine", "sure", "maybe", "not sure", "nope",
            "whatever you say", "anything is fine", "i don't care",
            "कुछ भी", "जो भी", "पता नहीं", "कुछ नहीं",
        }
        compact = re.sub(r"[^\w\u0900-\u0d7f]+", " ", a).strip()
        if compact in fillers or a in fillers:
            return True
        asks_place = any(
            token in q
            for token in (
                "state", "country", "city", "district", "where", "jurisdiction",
                "issued", "location", "area", "राज्", "शहर", "देश",
            )
        )
        if asks_place:
            if compact in fillers or len(compact) < 3:
                return True
            if not re.search(r"[a-zA-Z\u0900-\u0d7f]{3,}", raw):
                return True
        asks_when = any(token in q for token in ("when", "date", "year", "month", "कब", "तारीख"))
        if asks_when and compact in fillers:
            return True
        return False

    def _reprompt(question: str, context: str, idx: int, baseline: int, *, refused: bool = False) -> dict:
        if refused:
            response = (
                "That doesn’t answer the question, so I can’t continue yet.\n\n"
                f"**{question}**"
            )
            hint = context or "Please answer this specifically — replies like “whatever” don’t help me route your case."
            response += f"\n\n_{hint}_"
        else:
            response = f"**Additional Information Needed:**\n\n{question}" if idx == 0 else f"**{question}**"
            if context:
                response += f"\n\n_{context}_"
        return {
            "chat_text": response,
            "final_response": response,
            "internal_notes": "",
            "next_step": END,
            "user_statement": user_statement,
            "pending_questions": questions_to_ask,
            "current_question_idx": idx,
            "collected_answers": collected_answers,
            "question_labels": question_labels,
            "situation_summary": situation_summary,
            "user_language": user_language,
            "question_collection_started": True,
            "intake_human_baseline": baseline,
            "pdf_ready": False,
            "intervention_required": intervention_required,
            "case_id": case_id,
            "structured_report": structured_report,
            "suggested_actions": suggested_actions,
            "routing_recommendation": routing_recommendation,
            "show_routing_consent": show_routing_consent,
            "sexual_offense_intake_flow": sexual_offense_intake_flow,
            "case_category": case_category,
        }

    if not questions_to_ask:
        # Nothing to collect — hand back to report for scoring / routing
        print(f"   No pending questions → returning to report_generator")
        situation_summary["collected_answers"] = collected_answers
        situation_summary["answers_collection_complete"] = True
        situation_summary["collection_timestamp"] = datetime.now().isoformat()

        return {
            "final_response": state.get("final_response", ""),
            "next_step": "report_generator",
            "user_statement": user_statement,
            "collected_answers": collected_answers,
            "question_labels": question_labels,
            "situation_summary": situation_summary,
            "pdf_ready": False,
            "intervention_required": intervention_required,
            "case_id": case_id,
            "structured_report": structured_report,
            "suggested_actions": suggested_actions,
            "routing_recommendation": routing_recommendation,
            "show_routing_consent": show_routing_consent,
            "sexual_offense_intake_flow": sexual_offense_intake_flow,
            "case_category": case_category,
            "answers_collection_complete": True,
            "pending_questions": [],
        }

    def _is_human(msg) -> bool:
        msg_type = getattr(msg, "type", None)
        if msg_type is None and isinstance(msg, dict):
            msg_type = msg.get("type")
        return msg_type == "human"

    human_count = sum(1 for m in (messages or []) if _is_human(m))

    if not question_collection_started:
        first_question = questions_to_ask[0]["question"]
        first_context = questions_to_ask[0].get("context", "")
        response = f"**Additional Information Needed:**\n\n{first_question}"
        if first_context:
            response += f"\n\n_{first_context}_"

        return {
            "chat_text": response,
            "final_response": response,
            "internal_notes": "",
            "next_step": END,
            "user_statement": user_statement,
            "pending_questions": questions_to_ask,
            "current_question_idx": state.get("current_question_idx", 0),
            "collected_answers": collected_answers,
            "question_labels": question_labels,
            "situation_summary": situation_summary,
            "user_language": user_language,
            "question_collection_started": True,
            # Humans present when intake began; used so re-entry does not re-consume old turns.
            "intake_human_baseline": human_count,
            "pdf_ready": False,
            "intervention_required": intervention_required,
            "case_id": case_id,
            "structured_report": structured_report,
            "suggested_actions": suggested_actions,
            "routing_recommendation": routing_recommendation,
            "show_routing_consent": show_routing_consent,
            "sexual_offense_intake_flow": sexual_offense_intake_flow,
            "case_category": case_category,
        }
    
    # Extract the last user message (their answer to the last question)
    last_user_input = None
    for msg in reversed(messages or []):
        msg_type = getattr(msg, "type", None)
        if msg_type is None and isinstance(msg, dict):
            msg_type = msg.get("type")
        if msg_type != "human":
            continue
        content = getattr(msg, "content", None)
        if content is None and isinstance(msg, dict):
            content = (msg.get("data") or {}).get("content", msg.get("content"))
        if isinstance(content, list):
            last_user_input = "".join(
                c.get("text", "") if isinstance(c, dict) else str(c) for c in content
            )
        else:
            last_user_input = str(content or "")
        break

    current_question_idx = int(state.get("current_question_idx", 0) or 0)
    raw_baseline = state.get("intake_human_baseline")
    if raw_baseline is None:
        # Legacy paused runs: assume latest human (if any) is the resume answer.
        intake_baseline = max(1, human_count - current_question_idx - 1)
    else:
        intake_baseline = int(raw_baseline)
    # Only consume when a new human message arrived for the current index.
    has_new_answer = (
        last_user_input is not None
        and human_count > (intake_baseline + current_question_idx)
    )

    if has_new_answer and current_question_idx < len(questions_to_ask):
        current_question = questions_to_ask[current_question_idx]["question"]
        current_question_key = questions_to_ask[current_question_idx].get("key", current_question)
        current_context = questions_to_ask[current_question_idx].get("context", "")

        if _is_evasive_answer(str(last_user_input or ""), current_question):
            print(f"   Rejected non-answer for Q{current_question_idx + 1}")
            return _reprompt(
                current_question,
                current_context,
                current_question_idx,
                intake_baseline,
                refused=True,
            )

        # Store the answer
        collected_answers[current_question_key] = last_user_input
        if current_question:
            question_labels[str(current_question_key)] = str(current_question)

        # Move to next question
        next_question_idx = current_question_idx + 1

        # Skip call-consent follow-ups when she does not want a Female Nyay Guide.
        if sexual_offense_intake_flow and current_question_key == "female_nyayguide_needed" and not _is_yes(last_user_input):
            next_question_idx = len(questions_to_ask)
        # Skip phone capture when she declines the one-time confirmation call.
        if sexual_offense_intake_flow and current_question_key == "confirm_call_consent" and not _is_yes(last_user_input):
            next_question_idx = len(questions_to_ask)

        if next_question_idx < len(questions_to_ask):
            # Ask next question
            next_question = questions_to_ask[next_question_idx]["question"]
            next_context = questions_to_ask[next_question_idx].get("context", "")

            response = f"Thank you for that information. \n\n**{next_question}**"
            if next_context:
                response += f"\n\n_{next_context}_"

            print(f"   ✓ Answer collected for Q{current_question_idx + 1}")
            print(f"   → Ready for Q{next_question_idx + 1}")

            return {
                "chat_text": response,
                "final_response": response,
                "internal_notes": "",
                "next_step": END,
                "user_statement": user_statement,
                "current_question_idx": next_question_idx,
                "collected_answers": collected_answers,
                "question_labels": question_labels,
                "pending_questions": questions_to_ask,
                "situation_summary": situation_summary,
                "user_language": user_language,
                "question_collection_started": True,
                "intake_human_baseline": intake_baseline,
                "pdf_ready": False,
                "intervention_required": intervention_required,
                "case_id": case_id,
                "structured_report": structured_report,
                "suggested_actions": suggested_actions,
                "routing_recommendation": routing_recommendation,
                "show_routing_consent": show_routing_consent,
                "sexual_offense_intake_flow": sexual_offense_intake_flow,
                "case_category": case_category,
            }

        # All questions answered — return to report_generator to rescore & route
        print(f"   ✓ All {len(questions_to_ask)} questions answered → report_generator")

        if sexual_offense_intake_flow or case_category == "sexual_offence":
            response = "Thank you. Updating your case assessment with these details…"
        else:
            response = (
                "Thank you for the additional details. "
                "Updating your case report and deciding next steps…"
            )

        situation_summary["collected_answers"] = collected_answers
        situation_summary["answers_collection_complete"] = True
        situation_summary["total_questions_asked"] = len(questions_to_ask)
        situation_summary["collection_timestamp"] = datetime.now().isoformat()
        situation_summary.update(_labels_payload())

        return {
            "chat_text": response,
            "final_response": response,
            "internal_notes": "",
            "next_step": "report_generator",
            "user_statement": user_statement,
            "collected_answers": collected_answers,
            "question_labels": question_labels,
            "situation_summary": situation_summary,
            "user_language": user_language,
            "pdf_ready": False,
            "question_collection_started": True,
            "intake_human_baseline": intake_baseline,
            "intervention_required": intervention_required,
            "case_id": case_id,
            "structured_report": structured_report,
            "suggested_actions": suggested_actions,
            "routing_recommendation": routing_recommendation,
            "show_routing_consent": show_routing_consent,
            "sexual_offense_intake_flow": sexual_offense_intake_flow,
            "case_category": case_category,
            "answers_collection_complete": True,
            "pending_questions": [],
        }

    # Re-entry without a new answer — re-prompt the current question (do not advance).
    if question_collection_started and 0 <= current_question_idx < len(questions_to_ask):
        cur = questions_to_ask[current_question_idx]
        cur_q = cur.get("question") or f"Question {current_question_idx + 1}"
        cur_ctx = cur.get("context") or ""
        response = f"**Additional Information Needed:**\n\n{cur_q}"
        if current_question_idx > 0:
            response = f"**{cur_q}**"
        if cur_ctx:
            response += f"\n\n_{cur_ctx}_"
        print(f"   Re-prompting Q{current_question_idx + 1} (no new user answer)")
        return {
            "chat_text": response,
            "final_response": response,
            "internal_notes": "",
            "next_step": END,
            "user_statement": user_statement,
            "current_question_idx": current_question_idx,
            "collected_answers": collected_answers,
            "question_labels": question_labels,
            "pending_questions": questions_to_ask,
            "situation_summary": situation_summary,
            "user_language": user_language,
            "question_collection_started": True,
            "intake_human_baseline": intake_baseline,
            "pdf_ready": False,
            "intervention_required": intervention_required,
            "case_id": case_id,
            "structured_report": structured_report,
            "suggested_actions": suggested_actions,
            "routing_recommendation": routing_recommendation,
            "show_routing_consent": show_routing_consent,
            "sexual_offense_intake_flow": sexual_offense_intake_flow,
            "case_category": case_category,
        }

    # Fallback if no new message
    situation_summary["collected_answers"] = collected_answers
    return {
        "final_response": state.get("final_response") or "",
        "next_step": END,
        "user_statement": user_statement,
        "collected_answers": collected_answers,
        "question_labels": question_labels,
        "situation_summary": situation_summary,
        "user_language": user_language,
        "question_collection_started": question_collection_started,
        "intake_human_baseline": intake_baseline,
        "current_question_idx": current_question_idx,
        "pending_questions": questions_to_ask,
        "intervention_required": intervention_required,
        "case_id": case_id,
        "structured_report": structured_report,
        "suggested_actions": suggested_actions,
        "routing_recommendation": routing_recommendation,
        "show_routing_consent": show_routing_consent,
        "sexual_offense_intake_flow": sexual_offense_intake_flow,
        "case_category": case_category,
    }


def generate_sexual_offense_intake_questions(user_language: str = "english") -> list:
    """
    Generate fixed, minimal, trauma-safe intake questions for sexual offense flow.
    """
    questions_by_lang = {
        "hindi": [
            {"key": "immediate_danger", "question": "क्या आप अभी तुरंत खतरे में हैं?", "context": "हाँ/नहीं — विवरण की ज़रूरत नहीं"},
            {"key": "minor_flag", "question": "क्या पीड़िता 18 वर्ष से कम है?", "context": "हाँ/नहीं — विवरण की ज़रूरत नहीं"},
            {"key": "female_nyayguide_needed", "question": "क्या आप महिला न्यायगाइड से जुड़ना चाहती हैं?", "context": "हाँ/नहीं"},
            {"key": "confirm_call_consent", "question": "एक मॉडरेटर आपको एक बार, बिना किसी शुल्क के, कन्फर्मेशन कॉल कर सकता है। उसके बाद महिला न्यायगाइड को केस सौंपा जाएगा। क्या आप सहमत हैं?", "context": "हाँ/नहीं"},
            {"key": "contact_phone", "question": "कॉल के लिए आपका 10 अंकों का मोबाइल नंबर क्या है?", "context": "केवल नंबर लिखें"},
        ],
        "bengali": [
            {"key": "immediate_danger", "question": "আপনি কি এখনই তাৎক্ষণিক বিপদে?", "context": "হ্যাঁ/না — বিস্তারিত লাগবে না"},
            {"key": "minor_flag", "question": "ভিক্টিম কি ১৮ বছরের কম?", "context": "হ্যাঁ/না — বিস্তারিত লাগবে না"},
            {"key": "female_nyayguide_needed", "question": "আপনি কি মহিলা ন্যায়গাইডের সাথে যুক্ত হতে চান?", "context": "হ্যাঁ/না"},
            {"key": "confirm_call_consent", "question": "একজন মডারেটর আপনাকে একবার, বিনা খরচে, কনফার্মেশন কল করতে পারেন। তারপর মহিলা ন্যায়গাইডকে কেস দেওয়া হবে। আপনি কি রাজি?", "context": "হ্যাঁ/না"},
            {"key": "contact_phone", "question": "কলের জন্য আপনার ১০ সংখ্যার মোবাইল নম্বর কী?", "context": "শুধু নম্বর লিখুন"},
        ],
    }

    default_questions = [
        {"key": "immediate_danger", "question": "Are you in immediate danger right now?", "context": "Yes/No — no extra detail needed"},
        {"key": "minor_flag", "question": "Is the survivor under 18?", "context": "Yes/No — no extra detail needed"},
        {"key": "female_nyayguide_needed", "question": "Would you like to be connected with a female Nyay Guide?", "context": "Yes/No"},
        {"key": "confirm_call_consent", "question": "A moderator can place one confirmation call to you, with no payment, and then assign a female Nyay Guide. Do you consent?", "context": "Yes/No"},
        {"key": "contact_phone", "question": "What 10-digit mobile number should we call?", "context": "Number only"},
    ]

    return questions_by_lang.get(user_language, default_questions)


def generate_follow_up_questions(
    structured_report: dict,
    user_statement: str,
    incident_type: str,
    user_language: str = "english",
    retrieved_chunks: list | None = None,
) -> list:
    """
    Generate 2-3 contextual follow-up questions based on the case analysis.
    Questions are generated in the user's language (English, Hindi, Bengali).
    
    Args:
        structured_report: The structured case report
        user_statement: User's original statement
        incident_type: Type of incident
        user_language: Detected language ('english', 'hindi', 'bengali')
    
    Returns: List of dicts with "question" and optional "context"
    """
    # Select language instruction
    language_instructions = {
        "hindi": "Generate questions in Hindi (Devanagari script) that are easy to understand.",
        "punjabi": "Generate questions in Punjabi (Gurmukhi script) that are easy to understand.",
        "marathi": "Generate questions in Marathi (Devanagari script) that are easy to understand.",
        "bhojpuri": "Generate questions in Bhojpuri (Devanagari script) that are easy to understand.",
        "haryanvi": "Generate questions in Haryanvi (Devanagari script) that are easy to understand.",
        "tamil": "Generate questions in Tamil script that are easy to understand.",
        "telugu": "Generate questions in Telugu script that are easy to understand.",
        "bengali": "Generate questions in Bengali script that are easy to understand.",
        "english": "Generate questions in clear, simple English."
    }
    
    lang_instruction = language_instructions.get(user_language, language_instructions["english"])
    
    chunk_hint = ""
    if retrieved_chunks:
        bits = []
        for row in retrieved_chunks[:4]:
            if isinstance(row, dict):
                bits.append(f"{row.get('act_name') or ''} {row.get('section_number') or ''}".strip())
        if bits:
            chunk_hint = "Retrieved legal sections to cover in questions: " + "; ".join(bits)

    system_prompt = f"""You are an expert legal assistant generating follow-up questions to understand a legal case better.

    {lang_instruction}
    
    CASE ANALYSIS:
    - Incident Type: {incident_type}
    - User's Statement: {user_statement[:500]}...
    - Risk Level: {structured_report.get('risk_level', 'Low')}
    - Amount Involved: {structured_report.get('amount_involved', 'Not specified')}
    {chunk_hint}
    
    Generate 2-5 specific follow-up questions that would help refine the case report.
    Ask only what the retrieved legal sections actually require (timeline, place, amount, prior complaints, unique identifiers).
    
    Output ONLY a JSON array with this format (questions in {user_language}):
    [
      {{"question": "When did this incident occur?", "context": "This helps establish timeline."}},
      {{"question": "Have you taken any steps yet?", "context": "Understanding prior actions is important."}}
    ]
    
    Generate ONLY valid JSON, no markdown or explanations.
    """
    
    try:
        response = llm.invoke([SystemMessage(content=system_prompt)])
        
        response_content = response.content
        if isinstance(response_content, list):
            content_str = "".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in response_content])
        else:
            content_str = str(response_content)
        
        content_str = content_str.strip()
        if content_str.startswith("```json"):
            content_str = content_str.replace("```json\n", "", 1).replace("```json", "", 1)
        elif content_str.startswith("```"):
            content_str = content_str.replace("```\n", "", 1).replace("```", "", 1)
        
        if content_str.endswith("```"):
            content_str = content_str[:-3]
        
        questions = json.loads(content_str)
        
        # Validate structure and assign stable keys for admin resume / collected_answers.
        valid_questions = []
        for i, q in enumerate(questions):
            if isinstance(q, dict) and "question" in q:
                valid_questions.append({
                    "key": str(q.get("key") or f"q_{i}"),
                    "question": q["question"],
                    "context": q.get("context", ""),
                    "language": user_language
                })
        
        print(f"   ✓ Generated {len(valid_questions)} questions in {user_language}")
        return valid_questions[:5]
        
    except Exception as e:
        print(f"❌ Error generating follow-up questions: {e}")
        # Return default questions in English as fallback
        return [
            {"key": "q_0", "question": "Can you provide more specific dates or timeline for this incident?", "context": "Timeline information is important for case documentation.", "language": "english"},
            {"key": "q_1", "question": "Have you already reported this to any authorities or filed a complaint?", "context": "Knowing prior actions helps determine next steps.", "language": "english"}
        ]
