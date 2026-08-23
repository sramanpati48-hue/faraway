"""
Nodal Guide Agent
-----------------
Intercepts the flow after report generation / Q&A for LOW-RISK cases.
Asks the user (in their own language) if they would like to connect to a
Gram Nyayalaya Nodal Guide for local legal assistance.

Flow:
  1st call  → nodal_guide_consent_asked not yet True
              Ask the consent question, set next_step = END, return.
  2nd call  → user replied; inspect last human message.
              "yes" / affirmative  → fetch profiles, set show_nodal_guide_panel=True
              "no"  / negative     → send normal wrap-up message, show_nodal_guide_panel=False
"""

from langchain_core.messages import AIMessage
from langgraph.graph import END
import backend.database.supabase_db as supabase_db
from backend.agents.question_processor import detect_language


# Affirmative/negative keywords across major Indian languages
_YES_WORDS = {
    # English
    "yes", "yeah", "yep", "sure", "ok", "okay", "please", "connect", "agree",
    "definitely", "absolutely", "of course", "go ahead",
    # Hindi / Devanagari transliterated
    "haan", "ha", "ji", "bilkul", "zaroor", "theek",
    # Hindi Devanagari
    "हाँ", "हां", "जी", "बिल्कुल", "ज़रूर", "ठीक",
    # Bengali
    "হ্যাঁ", "জি", "হ্যা",
    # Tamil
    "ஆம்", "சரி",
    # Telugu
    "అవును", "సరే",
    # Marathi
    "होय",
    # Gujarati
    "હા", "ઠીક",
    # Kannada
    "ಹೌದು",
    # Malayalam
    "അതെ",
    # Punjabi
    "ਹਾਂ", "ਜੀ",
    # Urdu
    "ہاں", "جی",
    # Odia
    "ହଁ",
}

_NO_WORDS = {
    # English
    "no", "nope", "nah", "not", "don't", "dont", "skip", "cancel", "ignore",
    "decline", "pass",
    # Hindi transliterated
    "nahi", "nahin", "nahi", "mat",
    # Hindi Devanagari
    "नहीं", "नही", "मत",
    # Bengali
    "না",
    # Tamil
    "இல்லை",
    # Telugu
    "లేదు",
    # Marathi
    "नाही",
    # Gujarati
    "ના",
    # Kannada
    "ಇಲ್ಲ",
    # Malayalam
    "ഇല്ല",
    # Punjabi
    "ਨਹੀਂ",
    # Urdu
    "نہیں",
    # Odia
    "ନାହିଁ",
}

# Consent questions per language
_CONSENT_MESSAGES = {
    "hindi": (
        "आपका मामला दर्ज हो गया है। 📋\n\n"
        "आपके क्षेत्र में एक **Gram Nyayalaya Nodal Guide** उपलब्ध है जो "
        "आपकी स्थानीय कानूनी मदद कर सकता/सकती है।\n\n"
        "**क्या आप एक Nodal Guide से जुड़ना चाहते हैं?** (हाँ / नहीं)"
    ),
    "bengali": (
        "আপনার মামলা নথিবদ্ধ হয়েছে। 📋\n\n"
        "আপনার এলাকায় একজন **Gram Nyayalaya Nodal Guide** পাওয়া যাচ্ছে।\n\n"
        "**আপনি কি একজন Nodal Guide-এর সাথে সংযুক্ত হতে চান?** (হ্যাঁ / না)"
    ),
    "tamil": (
        "உங்கள் வழக்கு பதிவு செய்யப்பட்டுள்ளது. 📋\n\n"
        "உங்கள் பகுதியில் ஒரு **Gram Nyayalaya Nodal Guide** கிடைக்கிறார்.\n\n"
        "**நீங்கள் ஒரு Nodal Guide உடன் இணைய விரும்புகிறீர்களா?** (ஆம் / இல்லை)"
    ),
    "telugu": (
        "మీ కేసు నమోదు చేయబడింది. 📋\n\n"
        "మీ ప్రాంతంలో ఒక **Gram Nyayalaya Nodal Guide** అందుబాటులో ఉన్నారు.\n\n"
        "**మీరు ఒక Nodal Guide తో కనెక్ట్ అవ్వాలనుకుంటున్నారా?** (అవును / లేదు)"
    ),
    "english": (
        "Your case has been documented. 📋\n\n"
        "A **Gram Nyayalaya Nodal Guide** is available in your area who can provide "
        "local, in-person legal guidance at no cost.\n\n"
        "**Would you like to connect with a Nodal Guide?** *(Yes / No)*"
    ),
}

_DEFAULT_CONSENT_MSG = _CONSENT_MESSAGES["english"]

_NO_RESPONSE_MESSAGES = {
    "hindi": (
        "कोई बात नहीं। आपका मामला और रिपोर्ट सुरक्षित रखी गई है। "
        "अगर आपको और मदद चाहिए तो आप किसी भी समय वकील या सहायक से जुड़ सकते हैं।"
    ),
    "english": (
        "No problem! Your case report is saved. "
        "You can always ask to **connect to a lawyer**, request a **Nyay Guide**, "
        "or come back anytime you need more help. 🙏"
    ),
}


def _is_affirmative(text: str) -> bool:
    lower = text.lower().strip()
    return any(word in lower for word in _YES_WORDS)


def _is_negative(text: str) -> bool:
    lower = text.lower().strip()
    return any(word in lower for word in _NO_WORDS)


def nodal_guide_agent(state):
    print(f"\n🏛️  NODAL GUIDE AGENT ACTIVATED")

    messages = state.get("messages", [])
    user_language = state.get("user_language", "english")
    consent_asked = state.get("nodal_guide_consent_asked", False)
    structured_report = state.get("structured_report", {})
    suggested_actions = state.get("suggested_actions", [])
    case_id = state.get("case_id")
    final_response = state.get("final_response", "")
    location = state.get("location") or {}

    # ── First call: ask for consent ──
    if not consent_asked:
        consent_msg = _CONSENT_MESSAGES.get(user_language, _DEFAULT_CONSENT_MSG)
        print(f"   → Asking consent in language: {user_language}")
        return {
            "final_response": consent_msg,
            "next_step": END,
            "nodal_guide_consent_asked": True,
            "waiting_for_nodal_guide_consent": True,
            "show_nodal_guide_panel": False,
            "nodal_guide_profiles": [],
            "structured_report": structured_report,
            "suggested_actions": suggested_actions,
            "case_id": case_id,
            "user_language": user_language,
        }

    # ── Second call: check user reply ──
    last_user_input = ""
    for msg in reversed(messages):
        if hasattr(msg, "type") and msg.type == "human":
            last_user_input = msg.content.strip()
            break

    if _is_affirmative(last_user_input):
        print("   ✅ User said YES — fetching Nodal Guide by location")

        lat = location.get("lat") or location.get("latitude")
        lon = location.get("lon") or location.get("longitude")

        guide_row = None
        if lat is not None and lon is not None:
            try:
                guide_row = supabase_db.get_nodal_guide_by_location(float(lat), float(lon))
            except Exception as ex:
                print(f"   ⚠️  Location lookup failed: {ex}")

        if guide_row:
            state_name = guide_row.get("state", "Nearby")
            print(f"   📍 Matched state: {state_name}")
            nodal_guide_profiles = [{
                "uid":            str(guide_row.get("id", "")),
                "name":           guide_row.get("name", "Nodal Guide"),
                "location":       guide_row.get("location", "Nearby"),
                "occupation":     guide_row.get("occupation", "Gram Nyayalaya Officer"),
                "bio":            guide_row.get("bio", ""),
                "avatar":         guide_row.get("avatar", ""),
                "contact_number": guide_row.get("contact_number", ""),
                "email":          guide_row.get("email", ""),
                "availability":   guide_row.get("availability", "Available"),
                "rating":         float(guide_row.get("rating") or 4.5),
                "cases_resolved": int(guide_row.get("cases_resolved") or 0),
                "languages":      guide_row.get("languages") or ["Hindi", "English"],
            }]
        else:
            print("   ⚠️  No guide found — returning empty panel")
            nodal_guide_profiles = []

        user_details = state.get("user_details") or {}
        user_id = state.get("user_id") or user_details.get("user_id") or ""
        session_id = state.get("session_id") or user_details.get("session_id") or ""
        user_name = state.get("user_name") or user_details.get("user_name") or "User"
        pdf_url = state.get("pdf_url") or (
            structured_report.get("pdf_url") if isinstance(structured_report, dict) else None
        )
        nodal_case_id = None
        if user_id:
            try:
                nodal_case_id = supabase_db.forward_case_to_sahayak(
                    user_id=user_id,
                    user_name=user_name,
                    structured_report=structured_report if isinstance(structured_report, dict) else {},
                    session_id=session_id,
                    location=location if isinstance(location, dict) else {},
                    pdf_url=pdf_url,
                )
                if nodal_case_id:
                    supabase_db.mark_case_forwarded(
                        role="nodal_guide",
                        target_id=str(nodal_case_id),
                        case_id=str(case_id or nodal_case_id),
                        session_id=session_id,
                        user_id=user_id,
                        structured_report=structured_report if isinstance(structured_report, dict) else {},
                        pdf_url=pdf_url,
                    )
            except Exception as fwd_err:
                print(f"   ⚠️ nodal guide forward skipped: {fwd_err}")

        intro_msg = (
            "Great! Here is your Gram Nyayalaya Nodal Guide. "
            "They provide free, local legal assistance and can visit you if needed. 🏛️"
        )
        return {
            "final_response": intro_msg,
            "messages": [AIMessage(content=intro_msg)],
            "next_step": END,
            "show_nodal_guide_panel": True,
            "nodal_guide_profiles": nodal_guide_profiles,
            "nodal_guide_consent_asked": True,
            "waiting_for_nodal_guide_consent": False,
            "structured_report": structured_report,
            "suggested_actions": [],
            "case_id": case_id,
            "user_language": user_language,
            "sahayak_case_id": nodal_case_id,
            "forwarded_role": "nodal_guide" if nodal_case_id else None,
            "forwarded_target_id": nodal_case_id,
            "pdf_url": pdf_url,
        }

    elif _is_negative(last_user_input):
        print("   ❌ User said NO — returning normal suggestions")
        no_msg = _NO_RESPONSE_MESSAGES.get(user_language, _NO_RESPONSE_MESSAGES["english"])
        # Re-surface the final response from before (e.g. the specialist agent's advice)
        combined = f"{final_response}\n\n---\n{no_msg}".strip() if final_response else no_msg

        return {
            "final_response": combined,
            "next_step": END,
            "show_nodal_guide_panel": False,
            "nodal_guide_profiles": [],
            "nodal_guide_consent_asked": True,
            "waiting_for_nodal_guide_consent": False,
            "structured_report": structured_report,
            "suggested_actions": suggested_actions,
            "case_id": case_id,
            "user_language": user_language,
        }

    else:
        # Ambiguous — re-ask
        print("   ❓ Ambiguous input — re-asking consent")
        clarify_msg = (
            "I didn't catch that. **Would you like to connect to a Gram Nyayalaya Nodal Guide?**\n\n"
            "Please reply with **Yes** or **No**."
        )
        return {
            "final_response": clarify_msg,
            "next_step": END,
            "nodal_guide_consent_asked": True,
            "waiting_for_nodal_guide_consent": True,
            "show_nodal_guide_panel": False,
            "nodal_guide_profiles": [],
            "structured_report": structured_report,
            "suggested_actions": suggested_actions,
            "case_id": case_id,
            "user_language": user_language,
        }
