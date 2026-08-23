"""
Voice Moderator Multi-Agent Reasoning Layer.
Implements three cooperating sub-agents (VerificationAgent, SupportAgent, EscalationAgent)
sharing a ConversationState object, with Deepgram STT, incremental database persistence,
and auto-generated NyayGuide handoffs on escalation.

Phase 3 enhancements:
- ConversationState initializes from the existing case DB record (no blank-slate start)
- Context-aware first-turn greeting references known case narration
- Verbatim sensitive-case guardrail enforced on every SupportAgent turn
- SupportAgent retrieves legal context via existing RAG pipeline before responding
- EscalationAgent returns (bool, reason_str) with 4 deterministic trigger conditions
- decision_log audits every agent decision with agent, action, reason, timestamp, turn
- failed_resolve_count tracks whether the same issue failed resolution twice
- is_agent_speaking REST compatibility flag for turn-based barge-in awareness
"""
from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from langchain_core.messages import SystemMessage

from backend.utils import get_llm_for_task
from backend.voice.database import persist_voice_session
from backend.voice.stt_service import transcribe_audio_sarvam

load_dotenv()

llm = get_llm_for_task("chat_agent.supervisor")

# ── Verbatim sensitive-case guardrail ─────────────────────────────────────────
# WARNING: Do not rewrite, paraphrase, expand, or let downstream code mutate this
# constant. It is applied verbatim as the first SystemMessage to SupportAgent
# whenever 'sensitive' is in state.risk_flags.
SENSITIVE_CASE_SYSTEM_PROMPT: str = (
    "You are speaking with someone who may be in distress. "
    "Do not ask for graphic details. "
    "Do not use blame-oriented phrasing. "
    "Say early in the conversation: 'You don't have to explain everything right now.' "
    "Ask only the minimum questions needed to understand urgency and safety. "
    "If asked, offer to connect to a person immediately."
)

# Required sentence that must appear in the first sensitive-case response
_SENSITIVE_REQUIRED_SENTENCE = "You don't have to explain everything right now."

# ── Resolution outcome phrase matchers ────────────────────────────────────────
_UNRESOLVED_PHRASES: Tuple[str, ...] = (
    "that did not help",
    "that didn't help",
    "this does not solve",
    "this doesn't solve",
    "still confused",
    "still need help",
    "i still need help",
    "not helpful",
    "didn't work",
    "did not work",
    "still the same",
    "same problem",
    "i don't understand",
    "i still don't know",
    "doesn't make sense",
    "not clear yet",
    "no that's wrong",
    "that's not right",
)

_RESOLVED_PHRASES: Tuple[str, ...] = (
    "that solved it",
    "i understand now",
    "thank you that helps",
    "thank you, that helps",
    "got it",
    "makes sense now",
    "that makes sense",
    "problem solved",
    "issue resolved",
    "that worked",
    "that's helpful",
    "thank you so much",
    "i'm clear now",
)

import re
from enum import Enum
from pydantic import BaseModel, Field

# ── Validated Voice Agent Action Contract ─────────────────────────────────────
class ActionType(str, Enum):
    NONE = "none"
    ASK_CLARIFICATION = "ask_clarification"
    REQUEST_NYAYGUIDE = "request_nyayguide"
    HUMAN_REVIEW = "human_review"

class AssistanceType(str, Enum):
    DOCUMENT_SUPPORT = "document_support"
    OFFICE_NAVIGATION = "office_navigation"
    COMPLAINT_FILING_SUPPORT = "complaint_filing_support"
    DIGITAL_ASSISTANCE = "digital_assistance"
    OTHER = "other"

class VoiceAgentAction(BaseModel):
    message: str = ""
    action: ActionType = ActionType.NONE
    requires_confirmation: bool = False
    assistance_type: Optional[AssistanceType] = None
    safe_task_summary: Optional[str] = None
    escalation_reason: Optional[str] = None

# ── Explicit Intent Detection Matchers ─────────────────────────────────────────
_NYAYGUIDE_INTENT_PHRASES: Tuple[str, ...] = (
    "i want physical assistance",
    "want physical assistance",
    "need physical assistance",
    "physical assistance",
    "physical help",
    "physically help",
    "on-ground help",
    "on ground help",
    "on-ground assistance",
    "on ground assistance",
    "someone to accompany me",
    "accompany me",
    "connect me to a nyayguide",
    "connect me to nyayguide",
    "request a nyayguide",
    "request nyayguide",
    "i need a nyayguide",
    "need a nyayguide",
    "want a nyayguide",
    "help going to the police station",
    "help me go to the police station",
    "go to the police station with me",
    "someone to help me file this",
    "someone to help me file",
    "help me file this",
    "help me file the complaint",
    "help me file the fir",
    "i need hand-holding",
    "i need hand holding",
    "need handholding",
    "hand-holding",
    "hand holding",
    "handholding",
    "in-person help",
    "in person help",
    "in person assistance",
    "ground support",
    "ground assistance",
    "mujhe physical help chahiye",
    "physical madad",
    "saath chalne ke liye koi",
    "police station chalne me madad",
    "form bharne me physical help",
)

_HUMAN_MODERATOR_PHRASES: Tuple[str, ...] = (
    "human legal moderator",
    "legal moderator",
    "human moderator",
    "human lawyer",
    "human review",
    "speak to a human moderator",
    "talk to a legal moderator",
    "connect me to a legal moderator",
    "i want a human legal moderator",
    "i want a human moderator",
    "lawyer review",
)

_EMERGENCY_PHRASES: Tuple[str, ...] = (
    "immediate danger",
    "in immediate danger",
    "kill me",
    "threat to life",
    "suicide",
    "hurt me",
    "trapped",
    "police right now",
    "emergency right now",
)

def infer_assistance_type(lower_text: str, incident_type: str = "") -> AssistanceType:
    """Derives the most appropriate AssistanceType from user utterance and case incident type."""
    if any(k in lower_text for k in ["police station", "station", "office", "court", "go to", "accompany", "navigate", "visit", "reach"]):
        return AssistanceType.OFFICE_NAVIGATION
    if any(k in lower_text for k in ["file", "fir", "complaint", "submission", "submit", "lodge", "report", "draft fir"]):
        return AssistanceType.COMPLAINT_FILING_SUPPORT
    if any(k in lower_text for k in ["document", "paper", "papers", "form", "forms", "organize", "draft", "xerox", "affidavit"]):
        return AssistanceType.DOCUMENT_SUPPORT
    if any(k in lower_text for k in ["digital", "online", "portal", "website", "app", "login", "upload", "cyber portal"]):
        return AssistanceType.DIGITAL_ASSISTANCE
    if any(k in (incident_type or "").lower() for k in ["complaint", "fir", "harass", "threat", "police"]):
        return AssistanceType.COMPLAINT_FILING_SUPPORT
    return AssistanceType.DOCUMENT_SUPPORT

def generate_safe_task_summary(incident_type: str, assistance_type: AssistanceType) -> str:
    """Generates a short, non-graphic, PII-free safe task summary for pre-confirmation."""
    cleaned_type = (incident_type or "Legal Inquiry").strip()
    if assistance_type == AssistanceType.OFFICE_NAVIGATION:
        return f"Accompaniment and procedural navigation to local office/station for {cleaned_type}."
    elif assistance_type == AssistanceType.COMPLAINT_FILING_SUPPORT:
        return f"Procedural hand-holding and assistance with complaint/form submission for {cleaned_type}."
    elif assistance_type == AssistanceType.DOCUMENT_SUPPORT:
        return f"Assistance with organizing documents and procedural paperwork for {cleaned_type}."
    elif assistance_type == AssistanceType.DIGITAL_ASSISTANCE:
        return f"Assistance with digital legal portal navigation and form filling for {cleaned_type}."
    return f"Practical procedural on-ground assistance for {cleaned_type}."

def detect_voice_action_intent(
    user_text: str,
    context: Optional[Dict[str, Any]] = None,
    risk_flags: Optional[List[str]] = None,
) -> VoiceAgentAction:
    """
    Deterministic pre-check that evaluates user utterance before general LLM response.
    Returns validated VoiceAgentAction contract with fallback to ActionType.NONE on invalid.
    """
    try:
        raw_text = (user_text or "").strip()
        cleaned = re.sub(r"[^\w\s]", " ", raw_text.lower())
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        raw_lower = raw_text.lower()
        incident_type = (context or {}).get("incident_type") or "General Inquiry"

        # 1. Emergency safety check
        if any(phrase in raw_lower or phrase in cleaned for phrase in _EMERGENCY_PHRASES):
            return VoiceAgentAction(
                message="Your safety is our top priority. If you are in immediate danger, please contact local emergency services immediately (Dial 112 in India).",
                action=ActionType.HUMAN_REVIEW,
                requires_confirmation=False,
                escalation_reason="Immediate emergency / danger expressed by user",
            )

        # 2. Explicit Physical Assistance / NyayGuide intent
        if any(phrase in raw_lower or phrase in cleaned for phrase in _NYAYGUIDE_INTENT_PHRASES):
            ass_type = infer_assistance_type(raw_lower, incident_type)
            summary = generate_safe_task_summary(incident_type, ass_type)
            return VoiceAgentAction(
                message="",
                action=ActionType.REQUEST_NYAYGUIDE,
                requires_confirmation=True,
                assistance_type=ass_type,
                safe_task_summary=summary,
                escalation_reason="User explicitly requested physical assistance",
            )

        # 3. Explicit Human Legal Moderator Review intent
        if any(phrase in raw_lower or phrase in cleaned for phrase in _HUMAN_MODERATOR_PHRASES):
            return VoiceAgentAction(
                message="I am connecting you with our human legal moderator queue for specialized procedural review.",
                action=ActionType.HUMAN_REVIEW,
                requires_confirmation=True,
                escalation_reason="User requested human legal moderator review",
            )

        return VoiceAgentAction(
            message="",
            action=ActionType.NONE,
            requires_confirmation=False,
        )
    except Exception as err:
        print(f"Warning: detect_voice_action_intent error: {err}")
        return VoiceAgentAction(
            message="",
            action=ActionType.NONE,
            requires_confirmation=False,
        )

@dataclass
class ConversationState:
    """
    Shared conversation state accessible by VerificationAgent, SupportAgent, and EscalationAgent.
    Initializes from the existing case DB record; never starts from zero.
    """
    # Core identifiers
    case_id: str
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    voice_session_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    # Transcript
    transcript: List[Dict[str, Any]] = field(default_factory=list)
    prior_chat_transcript: List[Dict[str, Any]] = field(default_factory=list)

    # Case context (merged from DB on init)
    context_building: Dict[str, Any] = field(default_factory=dict)
    risk_flags: List[str] = field(default_factory=list)
    threat_level_assessment: Optional[Dict[str, Any]] = None
    narration_text: str = ""
    case_record: Dict[str, Any] = field(default_factory=dict)

    # Scoring and resolution
    confidence_score: float = 0.5
    resolution_status: str = "in_progress"  # 'in_progress', 'verified', 'escalate', 'completed'
    failed_resolve_count: int = 0

    # Escalation
    handoff_packet: Optional[Dict[str, Any]] = None
    escalated: bool = False

    # Agent coordination
    active_agent: str = "VerificationAgent"
    verified_facts: Dict[str, Any] = field(default_factory=dict)
    summary_notes: str = ""

    # Phase 3: audit + barge-in compatibility flag + turn tracking + durable persistence
    decision_log: List[Dict[str, Any]] = field(default_factory=list)
    confidence_score_history: List[Dict[str, Any]] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    ended_at: Optional[float] = None
    escalation_reason: Optional[str] = None
    is_agent_speaking: bool = False
    turn_count: int = 0

    def add_utterance(self, role: str, text: str, agent_name: Optional[str] = None) -> None:
        """Appends a turn to the live voice transcript."""
        self.transcript.append({
            "role": role,
            "text": text,
            "agent": agent_name or self.active_agent,
            "timestamp": time.time(),
        })

    def log_decision(self, agent: str, decision: str, reason: str) -> None:
        """
        Records a structured audit entry.  Called by every sub-agent on every
        normal return path and every important early-return / error-safe path.
        """
        self.decision_log.append({
            "agent": agent,
            "decision": decision,
            "reason": reason,
            "timestamp": time.time(),
            "turn": self.turn_count,
        })

    def get_voice_profile(self) -> Dict[str, Any]:
        """
        Returns voice profile parameters derived from risk_flags.
        Sensitive cases yield a calm, slower-paced voice profile (lower rate, warmer pitch).
        """
        from backend.voice.tts_service import get_voice_profile_for_risk_flags
        return get_voice_profile_for_risk_flags(self.risk_flags).to_dict()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ── Sub-agents ────────────────────────────────────────────────────────────────

class VerificationAgent:
    """
    Silently cross-checks live narrative against the original case intake record.
    Updates confidence_score and extracted facts in the background.
    Does NOT interrogate the user about facts already recorded in the case.
    """
    def __init__(self, state: ConversationState) -> None:
        self.state = state

    async def evaluate_and_respond(self, user_text: str) -> Tuple[str, float]:
        """
        Clarifies missing specifics (dates, financial loss, counterparty) without
        repeating past questions.  Returns (spoken_response, updated_confidence_score).
        """
        ctx = self.state.context_building or {}
        prior_facts = json.dumps({
            "incident_type": ctx.get("incident_type"),
            "summary": ctx.get("summary"),
            "location": ctx.get("location"),
            "amount": ctx.get("amount_involved"),
            "verified_facts": self.state.verified_facts,
        }, default=str)

        prompt = (
            f"You are the NyaySahayak Verification Voice Moderator.\n"
            f"The user is speaking with you to clarify details about their legal situation.\n\n"
            f"CRITICAL INSTRUCTIONS:\n"
            f"1. NEVER ask the user to repeat what they have already stated in the prior context.\n"
            f"2. Ground your questions on what is already known:\n"
            f"   PRIOR CONTEXT: {prior_facts}\n"
            f"3. If the user provided new details, acknowledge them concisely and verify missing critical items.\n"
            f"4. Keep spoken responses short, natural, warm, and clear (1-3 sentences maximum).\n\n"
            f"User just said: \"{user_text}\"\n"
            f"Voice conversation history: {json.dumps(self.state.transcript[-4:], default=str)}\n\n"
            f"Respond with JSON:\n"
            f"{{\n"
            f'  "spoken_response": "your short spoken message to user",\n'
            f'  "extracted_facts": {{"key": "value"}},\n'
            f'  "confidence_boost": 0.15,\n'
            f'  "verification_complete": false\n'
            f"}}"
        )
        try:
            resp = llm.invoke([SystemMessage(content=prompt)])
            content = resp.content if isinstance(resp.content, str) else str(resp.content)
            clean = content.strip().replace("```json", "").replace("```", "").strip()
            data = json.loads(clean)
            spoken = data.get(
                "spoken_response",
                "Thank you for explaining that. I have noted those details.",
            )
            if data.get("extracted_facts"):
                self.state.verified_facts.update(data["extracted_facts"])
            boost = float(data.get("confidence_boost", 0.1))
            new_score = round(min(1.0, self.state.confidence_score + boost), 2)
            if data.get("verification_complete") or new_score >= 0.85:
                self.state.resolution_status = "verified"
                self.state.log_decision(
                    "VerificationAgent",
                    "verification_complete",
                    f"Confidence reached {new_score}; verification_complete flag={data.get('verification_complete')}.",
                )
            else:
                self.state.log_decision(
                    "VerificationAgent",
                    "verification_in_progress",
                    f"Confidence score updated to {new_score}; continuing clarification.",
                )
            return spoken, new_score
        except Exception as exc:
            print(f"VerificationAgent error: {exc}")
            self.state.log_decision(
                "VerificationAgent",
                "error_fallback",
                f"LLM call failed — {exc}.",
            )
            return (
                "Thank you for sharing that. I am updating your case record with these details.",
                min(1.0, self.state.confidence_score + 0.1),
            )


class SupportAgent:
    """
    Listens and responds conversationally.  Retrieves legal context from the
    existing knowledge-base RAG pipeline before formulating answers.
    Applies the verbatim SENSITIVE_CASE_SYSTEM_PROMPT when risk_flags contains 'sensitive'.
    Asks only clarifying questions NOT already answered in the case record.
    """
    def __init__(self, state: ConversationState) -> None:
        self.state = state

    async def evaluate_and_respond(self, user_text: str) -> str:
        is_sensitive = "sensitive" in self.state.risk_flags

        # ── Step 1: retrieve legal context via existing RAG pipeline ──────────
        legal_context_text = ""
        retrieval_available = False
        try:
            from backend.agents.common_utils import retrieve_legal_context
            search_query = user_text or self.state.context_building.get("summary", "")
            legal_context_text, _ = retrieve_legal_context(
                search_query, graph_id="chat_agent"
            )
            retrieval_available = bool(legal_context_text and legal_context_text.strip())
        except Exception as exc:
            print(f"SupportAgent: legal retrieval unavailable — {exc}")
            self.state.log_decision(
                "SupportAgent",
                "legal_retrieval_failed",
                f"retrieve_legal_context raised: {exc}",
            )

        if retrieval_available:
            # Compact injection — cap at 2 000 chars to keep prompt manageable
            legal_block = (
                "\n\nRELEVANT LEGAL CONTEXT (NyaySahayak knowledge base — "
                "rely only on these sources for legal-specific claims; "
                "if no relevant source is returned for a claim, state that you cannot verify it):\n"
                + legal_context_text[:2000]
            )
        else:
            legal_block = (
                "\n\n[Legal knowledge retrieval was unavailable for this turn. "
                "Do not cite specific laws, sections, or legal precedents you cannot verify.]"
            )

        ctx = self.state.context_building or {}
        base_prompt = (
            f"You are the NyaySahayak Support Voice Moderator.\n\n"
            f"ALREADY RECORDED CONTEXT — do NOT ask the user to repeat these:\n"
            f"  Case summary  : {ctx.get('summary', 'Not yet available')}\n"
            f"  Incident type : {ctx.get('incident_type', 'General')}\n"
            f"  Risk flags    : {self.state.risk_flags}\n"
            f"  Verified facts: {json.dumps(self.state.verified_facts, default=str)}\n"
            f"{legal_block}\n\n"
            f"INSTRUCTIONS:\n"
            f"1. Ask only clarifying questions that are missing from the above context and decision-relevant.\n"
            f"2. Provide concrete next steps, recommended actions, or a resolution plan when possible.\n"
            f"3. Keep responses warm, clear, and 2–3 sentences for spoken delivery.\n"
            f"4. For legal-specific claims, rely strictly on the provided legal context above.\n\n"
            f"User just said: \"{user_text}\"\n"
            f"Recent voice conversation: {json.dumps(self.state.transcript[-4:], default=str)}\n\n"
            f"Respond with a clear, empathetic spoken message."
        )

        # Build message list — sensitive guardrail prepended verbatim as first SystemMessage
        messages = []
        if is_sensitive:
            messages.append(SystemMessage(content=SENSITIVE_CASE_SYSTEM_PROMPT))
        messages.append(SystemMessage(content=base_prompt))

        try:
            resp = llm.invoke(messages)
            spoken = (
                resp.content if isinstance(resp.content, str) else str(resp.content)
            ).strip()

            # Enforce required sensitive-case sentence in early turns
            if is_sensitive and self.state.turn_count <= 2:
                if _SENSITIVE_REQUIRED_SENTENCE not in spoken:
                    spoken = f"{_SENSITIVE_REQUIRED_SENTENCE} {spoken}"

            self.state.log_decision(
                "SupportAgent",
                "support_response",
                (
                    f"Responded — legal_retrieval_available={retrieval_available}; "
                    f"sensitive={is_sensitive}."
                ),
            )
            return spoken

        except Exception as exc:
            print(f"SupportAgent error: {exc}")
            self.state.log_decision(
                "SupportAgent",
                "error_fallback",
                f"LLM call failed — {exc}.",
            )
            fallback = (
                "You are in a safe space, and we are here to support you every step of the way. "
                "Take all the time you need."
            )
            if is_sensitive:
                fallback = f"{_SENSITIVE_REQUIRED_SENTENCE} {fallback}"
            return fallback


class EscalationAgent:
    """
    Monitors every turn continuously.
    Sets resolution_status = 'escalate' and builds a handoff packet when triggered.
    check_escalation_triggers() returns (bool, reason_str) with 4 deterministic conditions.
    """
    def __init__(self, state: ConversationState) -> None:
        self.state = state

    def check_escalation_triggers(self, user_text: str) -> Tuple[bool, str]:
        """
        Returns (should_escalate: bool, reason: str).
        Conditions evaluated in deterministic priority order:
          (a) Explicit human/NyayGuide request or emergency keywords
          (b) risk_flags contains 'sensitive'
          (c) confidence_score < 0.6
          (d) failed_resolve_count >= 2
        """
        lower = user_text.lower()

        # (a) Explicit human legal moderator or emergency request — highest priority
        human_request_phrases = (
            "need a human", "want a human", "speak to a human", "talk to a human",
            "need a person", "want a person", "connect me to a person",
            "legal moderator", "human moderator", "real person",
            "talk to someone", "speak to someone",
            "danger", "kill me", "threat", "suicide", "police now",
            "urgent help", "hurt me", "trapped", "emergency",
        )
        if any(phrase in lower for phrase in human_request_phrases):
            reason = "User explicitly requested human assistance or expressed an emergency"
            self.state.log_decision("EscalationAgent", "escalate", reason)
            return True, reason

        # (b) Sensitive risk flag
        if "sensitive" in self.state.risk_flags:
            reason = "Case risk_flags contains 'sensitive'"
            self.state.log_decision("EscalationAgent", "escalate", reason)
            return True, reason

        # (c) Low confidence
        if self.state.confidence_score < 0.6:
            reason = (
                f"Confidence score {self.state.confidence_score:.2f} is below threshold (0.60)"
            )
            self.state.log_decision("EscalationAgent", "escalate", reason)
            return True, reason

        # (d) Repeated unresolved resolution attempts
        if self.state.failed_resolve_count >= 2:
            reason = (
                f"Issue failed to resolve after {self.state.failed_resolve_count} consecutive attempts"
            )
            self.state.log_decision("EscalationAgent", "escalate", reason)
            return True, reason

        # No escalation
        self.state.log_decision(
            "EscalationAgent",
            "no_escalation",
            (
                f"No escalation conditions met — score={self.state.confidence_score:.2f}, "
                f"failed_resolve_count={self.state.failed_resolve_count}."
            ),
        )
        return False, ""

    async def build_handoff_packet(self, reason: str) -> Dict[str, Any]:
        """Auto-generates a structured handoff packet for the NyayGuide."""
        packet: Dict[str, Any] = {
            "case_id": self.state.case_id,
            "user_id": self.state.user_id,
            "session_id": self.state.session_id,
            "voice_session_id": self.state.voice_session_id,
            "urgency_level": "Critical" if "sensitive" in self.state.risk_flags else "High",
            "escalation_reason": reason,
            "incident_type": self.state.context_building.get("incident_type", "General"),
            "risk_flags": self.state.risk_flags,
            "threat_level_assessment": self.state.threat_level_assessment,
            "initial_confidence_score": self.state.confidence_score,
            "verified_facts": self.state.verified_facts,
            "voice_transcript_excerpt": self.state.transcript[-6:],
            "decision_log_excerpt": self.state.decision_log[-10:],
            "recommended_action": "Immediate NyayGuide Human Outreach & Support",
            "timestamp": time.time(),
        }
        self.state.handoff_packet = packet
        self.state.escalated = True
        self.state.resolution_status = "escalate"
        return packet

    async def execute_nyayguide_handoff(self, packet: Dict[str, Any]) -> bool:
        """Calls backend database/intervention queue to notify NyayGuide."""
        try:
            from backend.database.postgres_db import create_intervention_case

            report = {
                **(self.state.context_building or {}),
                "handoff_packet": packet,
                "escalation_source": "voice_moderator_agent",
                "voice_session_id": self.state.voice_session_id,
            }
            res = create_intervention_case(
                user_id=self.state.user_id,
                collection_name="sahayak",
                structured_report=report,
                session_id=self.state.session_id or f"voice_{self.state.case_id}",
                user_statement=f"[VOICE MODERATOR ESCALATION] {packet.get('escalation_reason')}",
                location=self.state.context_building.get("location") or {},
                case_id=self.state.case_id,
            )
            print(f"✅ NyayGuide handoff successfully queued: {res}")
            return True
        except Exception as exc:
            print(f"⚠️ Error creating NyayGuide handoff: {exc}")
            return False


# ── Main worker ───────────────────────────────────────────────────────────────

class VoiceModeratorAgentWorker:
    """
    Unified AI Voice Moderator coordinating VerificationAgent, SupportAgent, and
    EscalationAgent over a shared ConversationState.
    """
    def __init__(self, state: ConversationState) -> None:
        self.state = state
        self.verification_agent = VerificationAgent(state)
        self.support_agent = SupportAgent(state)
        self.escalation_agent = EscalationAgent(state)
        # Internal flag: tracks whether SupportAgent completed a resolution attempt
        # on the immediately preceding turn (used for failed_resolve_count logic).
        self._last_was_support_resolution: bool = False

    # ── Turn processing ───────────────────────────────────────────────────────

    async def process_user_turn(self, user_text: str) -> Dict[str, Any]:
        """
        Executes one reasoning turn across cooperating sub-agents with validated action contract.

        Turn order:
          1. Increment turn count & append utterance
          2. Evaluate deterministic action intent (detect_voice_action_intent)
          3. If action is REQUEST_NYAYGUIDE:
             - Formulate SupportAgent confirmation response
             - Return structured action with requires_confirmation=True (never auto-dispatch!)
          4. If action is HUMAN_REVIEW and emergency:
             - Formulate emergency EscalationAgent response
          5. If first turn (and no special intent):
             - Return context-aware greeting
          6. Sub-agent reasoning:
             - VerificationAgent: updates confidence and facts
             - Check escalation triggers (sensitive flag, low confidence, repeated unresolved)
             - SupportAgent: formulate response with legal context
        """
        # 1. Increment turn count at the very start of each genuine user turn
        self.state.turn_count += 1
        self.state.add_utterance("user", user_text)

        # 2. Check deterministic action intent first (Physical Assistance / Emergency / Human Review)
        action_contract = detect_voice_action_intent(
            user_text,
            context=self.state.context_building or {},
            risk_flags=self.state.risk_flags,
        )

        # 3. Handle explicit Physical Assistance / NyayGuide intent
        if action_contract.action == ActionType.REQUEST_NYAYGUIDE:
            self.state.active_agent = "SupportAgent"
            is_sensitive = "sensitive" in self.state.risk_flags
            spoken = (
                "I understand that you want practical, on-ground assistance. "
                "I can prepare a NyayGuide request for help with the complaint process. "
                "Please review and confirm the request before we search for a nearby NyayGuide."
            )
            if is_sensitive and self.state.turn_count <= 2:
                if _SENSITIVE_REQUIRED_SENTENCE not in spoken:
                    spoken = f"{_SENSITIVE_REQUIRED_SENTENCE} {spoken}"

            self.state.add_utterance("assistant", spoken, "SupportAgent")
            self.state.log_decision(
                "SupportAgent",
                "nyayguide_intent_detected",
                "User explicitly requested physical assistance; prepared confirmation action.",
            )
            self._last_was_support_resolution = False
            self._persist_current_state()

            return {
                "status": "success",
                "spoken_response": spoken,
                "text": spoken,
                "action": action_contract.action.value,
                "requires_confirmation": True,
                "assistance_type": action_contract.assistance_type.value if action_contract.assistance_type else "complaint_filing_support",
                "safe_task_summary": action_contract.safe_task_summary,
                "escalation_reason": action_contract.escalation_reason,
                "resolution_status": self.state.resolution_status,
                "active_agent": "SupportAgent",
                "confidence_score": self.state.confidence_score,
                "voice_profile": self.state.get_voice_profile(),
                "state": self.state.to_dict(),
            }

        # 4. Handle Emergency Intent
        if action_contract.action == ActionType.HUMAN_REVIEW and not action_contract.requires_confirmation:
            self.state.active_agent = "EscalationAgent"
            spoken = action_contract.message or "Your safety is our top priority. If you are in immediate danger, please contact local emergency services immediately (Dial 112 in India)."
            self.state.add_utterance("assistant", spoken, "EscalationAgent")
            self.state.log_decision(
                "EscalationAgent",
                "emergency_escalation",
                action_contract.escalation_reason or "Emergency condition triggered.",
            )
            self._last_was_support_resolution = False
            self._persist_current_state()
            return {
                "status": "success",
                "spoken_response": spoken,
                "text": spoken,
                "action": ActionType.HUMAN_REVIEW.value,
                "requires_confirmation": False,
                "assistance_type": None,
                "safe_task_summary": None,
                "escalation_reason": action_contract.escalation_reason,
                "resolution_status": "escalate",
                "active_agent": "EscalationAgent",
                "confidence_score": self.state.confidence_score,
                "voice_profile": self.state.get_voice_profile(),
                "state": self.state.to_dict(),
            }

        # 5. First turn: return personalized greeting; skip sub-agent pipeline if general conversation
        if self.state.turn_count == 1:
            greeting = self._build_first_turn_greeting()
            self.state.active_agent = "VoiceModerator"
            self.state.add_utterance("assistant", greeting, "VoiceModerator")
            self.state.log_decision(
                "VoiceModerator",
                "first_turn_greeting",
                "Acknowledged known case context on first user turn without asking user to restate facts.",
            )
            self._persist_current_state()
            return {
                "status": "success",
                "spoken_response": greeting,
                "text": greeting,
                "action": ActionType.NONE.value,
                "requires_confirmation": False,
                "assistance_type": None,
                "safe_task_summary": None,
                "escalation_reason": None,
                "resolution_status": self.state.resolution_status,
                "active_agent": "VoiceModerator",
                "confidence_score": self.state.confidence_score,
                "voice_profile": self.state.get_voice_profile(),
                "state": self.state.to_dict(),
            }

        # 6. Maintain failed-resolution counter based on current user input
        self._evaluate_resolution_state(user_text)

        # is_agent_speaking is a REST-compatibility flag for turn-based barge-in awareness.
        self.state.is_agent_speaking = True
        try:
            # 7. VerificationAgent: silent background pass — updates confidence/facts
            self.state.active_agent = "VerificationAgent"
            _verify_msg, new_score = await self.verification_agent.evaluate_and_respond(user_text)
            self.state.confidence_score = new_score
            self.state.confidence_score_history.append({
                "score": new_score,
                "turn": self.state.turn_count,
                "timestamp": time.time(),
            })

            # 8. EscalationAgent: check all 4 conditions using updated confidence
            should_escalate, escalation_reason = self.escalation_agent.check_escalation_triggers(
                user_text
            )
            if should_escalate:
                self.state.active_agent = "EscalationAgent"
                self.state.escalation_reason = escalation_reason
                packet = await self.escalation_agent.build_handoff_packet(escalation_reason)
                spoken = (
                    "I have flagged your case for our specialized human moderator review team so you receive direct support. "
                    "Everything we discussed has been securely preserved."
                )
                self.state.add_utterance("assistant", spoken, "EscalationAgent")
                self._last_was_support_resolution = False
                self._persist_current_state()
                return {
                    "status": "success",
                    "spoken_response": spoken,
                    "text": spoken,
                    "action": ActionType.HUMAN_REVIEW.value,
                    "requires_confirmation": True if "human" in str(escalation_reason).lower() else False,
                    "assistance_type": None,
                    "safe_task_summary": None,
                    "escalation_reason": escalation_reason,
                    "resolution_status": "escalate",
                    "active_agent": "EscalationAgent",
                    "confidence_score": self.state.confidence_score,
                    "voice_profile": self.state.get_voice_profile(),
                    "handoff_packet": packet,
                    "state": self.state.to_dict(),
                }

            # 9. SupportAgent: respond with legal context
            self.state.active_agent = "SupportAgent"
            support_msg = await self.support_agent.evaluate_and_respond(user_text)
            self._last_was_support_resolution = True
            self.state.add_utterance("assistant", support_msg, "SupportAgent")
            self._persist_current_state()
            return {
                "status": "success",
                "spoken_response": support_msg,
                "text": support_msg,
                "action": ActionType.NONE.value,
                "requires_confirmation": False,
                "assistance_type": None,
                "safe_task_summary": None,
                "escalation_reason": None,
                "resolution_status": self.state.resolution_status,
                "active_agent": "SupportAgent",
                "confidence_score": self.state.confidence_score,
                "voice_profile": self.state.get_voice_profile(),
                "state": self.state.to_dict(),
            }

        finally:
            # Always reset the barge-in flag — regardless of success or error
            self.state.is_agent_speaking = False

    async def process_audio_turn(
        self,
        audio_bytes: bytes,
        mime_type: str = "audio/webm",
        language: str = "en-IN",
    ) -> Dict[str, Any]:
        """Transcribes incoming speech using Sarvam Saaras v3 and processes the turn."""
        transcript_text = await transcribe_audio_sarvam(
            audio_bytes, mime_type=mime_type, language=language
        )
        cleaned = (transcript_text or "").strip()
        if not cleaned:
            return {
                "status": "retry",
                "spoken_response": "I didn't catch any speech. Please hold the microphone and speak clearly.",
                "user_transcript": "",
                "confidence_score": self.state.confidence_score,
                "voice_profile": self.state.get_voice_profile(),
                "state": self.state.to_dict(),
            }
        result = await self.process_user_turn(cleaned)
        result["user_transcript"] = cleaned
        return result

    # ── Helper methods ────────────────────────────────────────────────────────

    def _build_first_turn_greeting(self) -> str:
        """
        Builds a context-aware greeting for the user's first utterance.
        References known narration from the case record without exposing unnecessary PII.
        Falls back to a neutral greeting when no safe summary is available.
        """
        is_sensitive = "sensitive" in self.state.risk_flags
        narration = (self.state.narration_text or "").strip()

        if narration:
            # Safe short excerpt — max 120 chars, cut at word boundary
            excerpt = narration[:120].strip()
            if len(narration) > 120:
                last_space = excerpt.rfind(" ")
                if last_space > 60:
                    excerpt = excerpt[:last_space] + "…"

            if is_sensitive:
                return (
                    f"{_SENSITIVE_REQUIRED_SENTENCE} "
                    f"I can see you mentioned {excerpt}. "
                    f"I'm here to help, and you can share only what feels comfortable."
                )
            return (
                f"I can see you mentioned {excerpt}. "
                f"I'd like to understand a bit more to help you further. "
                f"Please feel free to add any details you think would be helpful."
            )

        # No safe narration excerpt — neutral fallback
        if is_sensitive:
            return (
                f"{_SENSITIVE_REQUIRED_SENTENCE} "
                "I'm here to support you. Please share only what feels comfortable."
            )
        return (
            "Thank you for speaking with me. I've reviewed the details from your case, "
            "and I'm here to help clarify a few points."
        )

    def _evaluate_resolution_state(self, user_text: str) -> None:
        """
        Updates failed_resolve_count based on user feedback after a SupportAgent
        resolution attempt on the preceding turn.

        Increments only when:
          - SupportAgent provided a concrete answer on the previous turn, AND
          - The current user text matches unresolved-outcome phrases.

        Resets when the user confirms resolution.
        Neutral acknowledgements do NOT trigger an increment.
        """
        lower = user_text.lower().strip()

        # Check for explicit resolution confirmation first
        if any(phrase in lower for phrase in _RESOLVED_PHRASES):
            if self.state.failed_resolve_count > 0 or self._last_was_support_resolution:
                old_count = self.state.failed_resolve_count
                self.state.failed_resolve_count = 0
                self.state.log_decision(
                    "VoiceModeratorAgentWorker",
                    "resolution_confirmed",
                    f"User confirmed resolution; failed_resolve_count reset from {old_count} to 0.",
                )
            self._last_was_support_resolution = False
            return

        # Only evaluate unresolved signal when SupportAgent answered on previous turn
        if self._last_was_support_resolution:
            if any(phrase in lower for phrase in _UNRESOLVED_PHRASES):
                self.state.failed_resolve_count += 1
                self.state.log_decision(
                    "VoiceModeratorAgentWorker",
                    "resolution_failed",
                    (
                        f"User indicated issue unresolved after SupportAgent response; "
                        f"failed_resolve_count now {self.state.failed_resolve_count}."
                    ),
                )

        # Reset tracking flag — evaluated fresh each turn
        self._last_was_support_resolution = False

    def _persist_current_state(self) -> None:
        """Persists state incrementally to the voice_sessions database table."""
        try:
            persist_voice_session(
                case_id=self.state.case_id,
                user_id=self.state.user_id,
                session_id=self.state.session_id,
                resolution_status=self.state.resolution_status,
                confidence_score=self.state.confidence_score,
                escalated=self.state.escalated,
                threat_level=(
                    self.state.threat_level_assessment.get("level")
                    if self.state.threat_level_assessment
                    else None
                ),
                risk_flags=self.state.risk_flags,
                conversation_state=self.state.to_dict(),
                transcript=self.state.transcript,
                handoff_packet=self.state.handoff_packet,
                voice_session_id=self.state.voice_session_id,
                agent_decision_log=self.state.decision_log,
                confidence_score_history=self.state.confidence_score_history,
                escalation_reason=self.state.escalation_reason,
            )
        except Exception as exc:
            print(f"Voice state incremental persistence notice: {exc}")

        # Synchronize verification status to the parent case record
        if self.state.case_id:
            try:
                from backend.database.supabase_case_enhance import update_case_ai_verification_status
                if self.state.resolution_status == "verified":
                    update_case_ai_verification_status(
                        case_id=self.state.case_id,
                        status="verified",
                        confidence_score=self.state.confidence_score,
                        source="voice",
                        reason=f"Voice verification complete (confidence {self.state.confidence_score:.2f}).",
                    )
                elif self.state.resolution_status == "escalate" or self.state.escalated:
                    update_case_ai_verification_status(
                        case_id=self.state.case_id,
                        status="flagged",
                        confidence_score=self.state.confidence_score,
                        source="voice",
                        reason=self.state.escalation_reason or "Escalated by Voice EscalationAgent.",
                    )
            except Exception as e_case:
                print(f"⚠️ Case AI verification sync skipped: {e_case}")



# ── Initialization ────────────────────────────────────────────────────────────

def _extract_narration_text(
    context_building: Dict[str, Any],
    session_data: List[Any],
) -> str:
    """
    Extracts a safe narration summary from the case record using priority order:
    1. structured_report / context_building summary field
    2. First human/user message in session_data
    3. Empty string (fallback)
    """
    # Priority 1: summary in context_building (already merged from structured_report)
    summary = (context_building or {}).get("summary", "")
    if summary and isinstance(summary, str) and summary.strip():
        return summary.strip()

    # Priority 2: first human message in session_data chat history
    for entry in session_data or []:
        if not isinstance(entry, dict):
            continue
        role = str(entry.get("role") or entry.get("type") or "").lower()
        if role in ("human", "user"):
            content = entry.get("content") or entry.get("text") or ""
            if content and isinstance(content, str) and content.strip():
                return content.strip()

    return ""


def initialize_voice_agent(
    case_id: str,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    context_building: Optional[Dict[str, Any]] = None,
    transcript: Optional[List[Dict[str, Any]]] = None,
) -> VoiceModeratorAgentWorker:
    """
    Initializes a Voice Moderator agent worker primed with the full existing case context.
    When context is not supplied by the caller, fetches it from the database so the AI
    never starts from a blank slate and never asks the user to restate recorded facts.
    """
    ctx = context_building or {}
    prior_transcript = transcript or []
    case_record: Dict[str, Any] = {}

    # ── Load from DB if context is incomplete ─────────────────────────────────
    if not ctx or not prior_transcript:
        try:
            from backend.database.supabase_case_enhance import get_case_complete
            record = get_case_complete(case_id)
            if record and isinstance(record, dict):
                case_record = record

                if not user_id:
                    user_id = record.get("user_id")
                if not session_id:
                    session_id = record.get("session_id")

                structured_report = record.get("structured_report") or {}

                if not ctx:
                    # Prefer a dedicated context_building key; fall back to reconstructing
                    # from the structured_report fields we know about
                    ctx = (
                        record.get("context_building")
                        or structured_report.get("context_building")
                        or {
                            "context_building_confidence_score": (
                                record.get("context_building_confidence_score")
                                or structured_report.get("context_building_confidence_score", 0.6)
                            ),
                            "risk_flags": (
                                record.get("risk_flags")
                                or structured_report.get("risk_flags", [])
                            ),
                            "threat_level_assessment": (
                                record.get("threat_level_assessment")
                                or structured_report.get("threat_level_assessment")
                            ),
                            "summary": structured_report.get("summary", ""),
                            "incident_type": structured_report.get("incident_type", "General"),
                            "location": (
                                record.get("location")
                                or structured_report.get("location", {})
                            ),
                            "amount_involved": structured_report.get("amount_involved"),
                        }
                    )

                if not prior_transcript:
                    prior_transcript = record.get("session_data") or []

        except Exception as exc:
            print(f"Notice: initialize_voice_agent — could not load case from DB: {exc}")

    # ── Safe field extraction with guards ─────────────────────────────────────
    threat_level = ctx.get("threat_level_assessment")
    if not isinstance(threat_level, dict):
        threat_level = None  # Guard: skip if undefined/null (Step 7 not yet run)

    risk_flags = list(ctx.get("risk_flags") or [])
    conf_score = float(ctx.get("context_building_confidence_score") or 0.6)

    # ── Extract narration text ────────────────────────────────────────────────
    session_data_for_narration = case_record.get("session_data") or prior_transcript
    narration = _extract_narration_text(ctx, session_data_for_narration)

    # ── Build initial welcome greeting (spoken before user says anything) ─────
    if "sensitive" in risk_flags:
        initial_greeting = (
            "Hello, I am your NyaySahayak Voice Moderator. "
            f"{_SENSITIVE_REQUIRED_SENTENCE} "
            "You are in a safe and supportive space. "
            "I have your initial notes, and we can discuss whatever you feel comfortable sharing."
        )
    elif narration:
        initial_greeting = (
            "Hello, I am your NyaySahayak Voice Moderator. "
            "I've reviewed the details you shared earlier and I'm here to help. "
            "Whenever you're ready, please tell me if you'd like to add anything."
        )
    elif conf_score < 0.7:
        initial_greeting = (
            "Hello, I am your NyaySahayak Voice Moderator. "
            "I've reviewed what you wrote earlier and just wanted to quickly clarify "
            "a couple of key points so your case report is accurate."
        )
    else:
        initial_greeting = (
            "Hello, I am your NyaySahayak Voice Moderator. "
            "I'm here to help clarify a few details so we can assist you effectively."
        )

    # ── Construct ConversationState ───────────────────────────────────────────
    confidence_history = [{
        "score": conf_score,
        "turn": 0,
        "timestamp": time.time(),
    }]
    state = ConversationState(
        case_id=case_id,
        user_id=user_id,
        session_id=session_id,
        prior_chat_transcript=prior_transcript,
        context_building=ctx,
        risk_flags=risk_flags,
        threat_level_assessment=threat_level,
        confidence_score=conf_score,
        confidence_score_history=confidence_history,
        narration_text=narration,
        case_record=case_record,
    )
    state.add_utterance("assistant", initial_greeting, "VoiceModerator")

    worker = VoiceModeratorAgentWorker(state)
    worker._persist_current_state()
    return worker
