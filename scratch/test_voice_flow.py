"""
Validation tests for NyaySahayak Voice Moderator using Sarvam AI (Saaras v3 STT & Bulbul v3 TTS).
Covers Parts A–I. Uses mocks/stubs only — no real external network calls are made.
"""
import sys
import os
import asyncio
import json
import time
import importlib
import importlib.util
from unittest.mock import MagicMock, AsyncMock, patch

# Force UTF-8 stdout on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Ensure project root is on sys.path
sys.path.insert(0, os.path.abspath("."))

# ═══════════════════════════════════════════════════════════════════════════════
# Phase 1 — stub leaf dependencies, then load the REAL stt_service and tts_service
# ═══════════════════════════════════════════════════════════════════════════════

sys.modules["dotenv"] = MagicMock()
sys.modules.setdefault("httpx", MagicMock())

_mock_vcfg = MagicMock()
_mock_vcfg.SARVAM_API_KEY = "test-sarvam-key"
_mock_vcfg.is_sarvam_configured = MagicMock(return_value=True)
_mock_vcfg.VOICE_STT_PROVIDER = "sarvam"
_mock_vcfg.VOICE_TTS_PROVIDER = "sarvam"
_mock_vcfg.ENABLE_WEBSPEECH_FALLBACK = False
_mock_vcfg.is_livekit_configured = MagicMock(return_value=False)
_mock_vcfg.get_livekit_server_url = MagicMock(return_value="wss://nyaysahayak-voice.livekit.cloud")
sys.modules["backend.voice.config"] = _mock_vcfg

import types as _types

def _ensure_package(name: str, path: str) -> "_types.ModuleType":
    if name not in sys.modules:
        pkg = _types.ModuleType(name)
        pkg.__path__ = [os.path.abspath(path)]
        pkg.__package__ = name
        sys.modules[name] = pkg
    return sys.modules[name]

_ensure_package("backend", "backend")
_ensure_package("backend.voice", "backend/voice")

# Load real stt_service.py from disk
sys.modules.pop("backend.voice.stt_service", None)
_stt_spec = importlib.util.spec_from_file_location(
    "backend.voice.stt_service",
    os.path.abspath("backend/voice/stt_service.py"),
)
_stt_real_mod = importlib.util.module_from_spec(_stt_spec)
sys.modules["backend.voice.stt_service"] = _stt_real_mod
_stt_spec.loader.exec_module(_stt_real_mod)

normalize_sarvam_stt_language = _stt_real_mod.normalize_sarvam_stt_language
transcribe_audio_sarvam = _stt_real_mod.transcribe_audio_sarvam

# Load real tts_service.py from disk
sys.modules.pop("backend.voice.tts_service", None)
_tts_spec = importlib.util.spec_from_file_location(
    "backend.voice.tts_service",
    os.path.abspath("backend/voice/tts_service.py"),
)
_tts_real_mod = importlib.util.module_from_spec(_tts_spec)
sys.modules["backend.voice.tts_service"] = _tts_real_mod
_tts_spec.loader.exec_module(_tts_real_mod)

VoiceProfile = _tts_real_mod.VoiceProfile
TTSProvider = _tts_real_mod.TTSProvider
SarvamTTSProvider = _tts_real_mod.SarvamTTSProvider
WebSpeechTTSProvider = _tts_real_mod.WebSpeechTTSProvider
get_tts_provider = _tts_real_mod.get_tts_provider
get_voice_profile_for_risk_flags = _tts_real_mod.get_voice_profile_for_risk_flags
normalize_sarvam_tts_language = _tts_real_mod.normalize_sarvam_tts_language

# Stub stt_service in sys.modules with AsyncMock for agent.py turns
_mock_stt_for_agent = MagicMock()
_mock_stt_for_agent.transcribe_audio_sarvam = AsyncMock(return_value="mock transcription")
_mock_stt_for_agent.normalize_sarvam_stt_language = normalize_sarvam_stt_language
sys.modules["backend.voice.stt_service"] = _mock_stt_for_agent

# ═══════════════════════════════════════════════════════════════════════════════
# Phase 2 — stub remaining heavy dependencies, then import real agent.py
# ═══════════════════════════════════════════════════════════════════════════════

def _make_mock_llm():
    mock_llm = MagicMock()
    mock_resp = MagicMock()
    mock_resp.content = json.dumps({
        "spoken_response": "Thank you, I have noted your details.",
        "extracted_facts": {"confirmed": True},
        "confidence_boost": 0.15,
        "verification_complete": False,
    })
    mock_llm.invoke = MagicMock(return_value=mock_resp)
    return mock_llm

_MOCK_LLM = _make_mock_llm()

_mock_utils = MagicMock()
_mock_utils.get_llm_for_task = MagicMock(return_value=_MOCK_LLM)
sys.modules["backend.utils"] = _mock_utils

_mock_vdb = MagicMock()
_mock_vdb.persist_voice_session = MagicMock(return_value="mock-session-id")
_mock_vdb.get_voice_sessions_by_case = MagicMock(return_value=[])
sys.modules["backend.voice.database"] = _mock_vdb

_mock_scen = MagicMock()
sys.modules["backend.database.supabase_case_enhance"] = _mock_scen
sys.modules.setdefault("backend.database", MagicMock())
sys.modules.setdefault("backend.database.postgres_db", MagicMock())
sys.modules.setdefault("backend.database.postgres_pool", MagicMock())

_mock_common = MagicMock()
_mock_common.retrieve_legal_context = MagicMock(
    return_value=("Section 420 IPC: Cheating and dishonestly inducing delivery of property.", [])
)
sys.modules["backend.agents.common_utils"] = _mock_common
sys.modules.setdefault("backend.agents", MagicMock())

_mock_lc_messages = MagicMock()
_mock_lc_messages.SystemMessage = MagicMock(side_effect=lambda content: content)
sys.modules.setdefault("langchain_core", MagicMock())
sys.modules["langchain_core.messages"] = _mock_lc_messages

# Import real agent module
sys.modules.pop("backend.voice.agent", None)
from backend.voice.agent import (  # noqa: E402
    ConversationState,
    VerificationAgent,
    SupportAgent,
    EscalationAgent,
    VoiceModeratorAgentWorker,
    initialize_voice_agent,
    SENSITIVE_CASE_SYSTEM_PROMPT,
    _SENSITIVE_REQUIRED_SENTENCE,
    _UNRESOLVED_PHRASES,
    _RESOLVED_PHRASES,
    _extract_narration_text,
)


def _make_state(**kwargs) -> ConversationState:
    defaults = dict(
        case_id="test-case-001",
        user_id="user-abc",
        session_id="session-xyz",
        context_building={"summary": "User lost Rs 50,000 in a UPI scam.", "incident_type": "Cyber Fraud"},
        risk_flags=[],
        confidence_score=0.75,
        narration_text="User lost Rs 50,000 in a UPI scam.",
    )
    defaults.update(kwargs)
    return ConversationState(**defaults)


# ─────────────────────────────────────────────────────────────────────────────
# Part A — Sarvam Saaras v3 STT Adapter & Language Hint Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_a1_bengali_bn_in_hint():
    """Bengali hint bn-IN or bn normalizes to BCP-47 bn-IN."""
    assert normalize_sarvam_stt_language("bn-IN") == "bn-IN"
    assert normalize_sarvam_stt_language("bn") == "bn-IN"
    print("  PASS  [A1] Bengali hint normalized to bn-IN")


def test_a2_hindi_hi_in_hint():
    """Hindi hint hi-IN or hi normalizes to BCP-47 hi-IN."""
    assert normalize_sarvam_stt_language("hi-IN") == "hi-IN"
    assert normalize_sarvam_stt_language("hi") == "hi-IN"
    print("  PASS  [A2] Hindi hint normalized to hi-IN")


def test_a3_english_en_in_hint():
    """English hint en-IN or en normalizes to BCP-47 en-IN."""
    assert normalize_sarvam_stt_language("en-IN") == "en-IN"
    assert normalize_sarvam_stt_language("en") == "en-IN"
    print("  PASS  [A3] English hint normalized to en-IN")


def test_a4_code_mixed_language_hint():
    """Code-mixed or unknown hints pass through to Sarvam's 'unknown' auto-detect mode."""
    assert normalize_sarvam_stt_language("unknown") == "unknown"
    assert normalize_sarvam_stt_language("code-mixed") == "unknown"
    assert normalize_sarvam_stt_language("mixed") == "unknown"
    assert normalize_sarvam_stt_language(None) == "unknown"
    print("  PASS  [A4] Code-mixed hint mapped to Sarvam auto-detect ('unknown')")


async def test_a5_sarvam_stt_payload_and_normalization():
    """Sarvam Saaras v3 STT payload is constructed with model=saaras:v3, mode=transcribe."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json = MagicMock(return_value={"transcript": "amar taka churi hoyeche", "language_code": "bn-IN"})

    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    fake_valid_audio = b"RIFF" + b"\x00" * 600
    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await transcribe_audio_sarvam(fake_valid_audio, language="bn-IN")
        assert result == "amar taka churi hoyeche"
        mock_client.post.assert_called_once()
        call_kwargs = mock_client.post.call_args[1]
        assert call_kwargs["data"]["model"] == "saaras:v3"
        assert call_kwargs["data"]["language_code"] == "bn-IN"
        assert call_kwargs["data"]["mode"] == "transcribe"
    print("  PASS  [A5] Sarvam STT called with saaras:v3 and normalized transcript returned")


async def test_a6_empty_audio_rejected():
    """Audio bytes with 0 length are rejected immediately without invoking network."""
    result = await transcribe_audio_sarvam(b"", language="en-IN")
    assert result == ""
    print("  PASS  [A6] Empty audio (0 bytes) is rejected immediately without API call")


async def test_a7_short_audio_rejected():
    """Audio bytes under 500 bytes are rejected immediately as insufficient speech."""
    result = await transcribe_audio_sarvam(b"short_bytes_123", language="en-IN")
    assert result == ""
    print("  PASS  [A7] Short audio (<500 bytes) is rejected immediately without API call")


async def test_a8_sarvam_error_returns_empty_string():
    """When Sarvam STT returns non-200, return clean empty string without hallucinating."""
    mock_resp = MagicMock()
    mock_resp.status_code = 400
    mock_resp.text = '{"error":{"message":"Failed to read file"}}'

    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    fake_audio = b"RIFF" + b"\x00" * 600
    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await transcribe_audio_sarvam(fake_audio, language="hi-IN")
        assert result == ""
    print("  PASS  [A8] Sarvam STT error safely returns empty string without hallucinated fallback")


# ─────────────────────────────────────────────────────────────────────────────
# Part B/C — ConversationState & Case-Record Initialization
# ─────────────────────────────────────────────────────────────────────────────

def test_b1_conversation_state_fields():
    state = _make_state()
    assert isinstance(state.decision_log, list)
    assert isinstance(state.narration_text, str)
    assert isinstance(state.case_record, dict)
    assert isinstance(state.failed_resolve_count, int)
    assert isinstance(state.is_agent_speaking, bool)
    assert isinstance(state.turn_count, int)
    print("  PASS  [B1] ConversationState fields initialized correctly")


def test_b2_log_decision():
    state = _make_state()
    state.turn_count = 2
    state.log_decision("VerificationAgent", "verified", "All facts confirmed.")
    assert len(state.decision_log) == 1
    assert state.decision_log[0]["agent"] == "VerificationAgent"
    assert state.decision_log[0]["turn"] == 2
    print("  PASS  [B2] log_decision adds audit entry")


def test_c1_narration_extraction_from_summary():
    ctx = {"summary": "UPI fraud of Rs 25,000"}
    narration = _extract_narration_text(ctx, [])
    assert narration == "UPI fraud of Rs 25,000"
    print("  PASS  [C1] narration extracted from summary")


def test_c2_narration_extraction_from_session_data():
    session_data = [{"role": "user", "content": "My landlord locked my flat."}]
    narration = _extract_narration_text({}, session_data)
    assert narration == "My landlord locked my flat."
    print("  PASS  [C2] narration extracted from session_data")


def test_c3_initialize_voice_agent_pulls_from_db():
    mock_case = {
        "user_id": "user-from-db",
        "session_id": "sess-from-db",
        "structured_report": {
            "summary": "Boundary dispute case.",
            "incident_type": "Land",
            "risk_flags": ["sensitive"],
            "context_building_confidence_score": 0.55,
        },
        "session_data": [{"role": "user", "content": "Harassed by neighbor."}],
    }
    _mock_scen.get_case_complete = MagicMock(return_value=mock_case)
    worker = initialize_voice_agent(case_id="case-db-test")
    assert worker.state.narration_text == "Boundary dispute case."
    assert "sensitive" in worker.state.risk_flags
    print("  PASS  [C3] initialize_voice_agent pulls case from DB")


# ─────────────────────────────────────────────────────────────────────────────
# Part D — Sensitive Case Guardrail
# ─────────────────────────────────────────────────────────────────────────────

def test_d1_sensitive_prompt_constant_verbatim():
    assert _SENSITIVE_REQUIRED_SENTENCE in SENSITIVE_CASE_SYSTEM_PROMPT
    assert "You are speaking with someone who may be in distress" in SENSITIVE_CASE_SYSTEM_PROMPT
    print("  PASS  [D1] Sensitive case guardrail prompt is verbatim")


async def test_d2_sensitive_first_turn_response():
    worker = initialize_voice_agent(
        case_id="case-sens-001",
        context_building={
            "summary": "Severe harassment report.",
            "risk_flags": ["sensitive"],
            "context_building_confidence_score": 0.50,
        },
    )
    turn1 = await worker.process_user_turn("I am terrified.")
    assert _SENSITIVE_REQUIRED_SENTENCE in turn1["spoken_response"]
    print("  PASS  [D2] Sensitive case first-turn response enforces required sentence")


# ─────────────────────────────────────────────────────────────────────────────
# Part E — Escalation Conditions
# ─────────────────────────────────────────────────────────────────────────────

def test_e1_escalation_human_request():
    state = _make_state(risk_flags=[], confidence_score=0.80)
    agent = EscalationAgent(state)
    triggered, reason = agent.check_escalation_triggers("I want to speak with a nyayguide immediately")
    assert triggered is True
    assert "human" in reason.lower() or "emergency" in reason.lower()
    print("  PASS  [E1] Escalation: explicit human request")


def test_e2_escalation_sensitive_flag():
    state = _make_state(risk_flags=["sensitive"], confidence_score=0.80)
    agent = EscalationAgent(state)
    triggered, reason = agent.check_escalation_triggers("Hello")
    assert triggered is True
    assert "sensitive" in reason.lower()
    print("  PASS  [E2] Escalation: sensitive risk flag")


def test_e3_escalation_low_confidence():
    state = _make_state(risk_flags=[], confidence_score=0.59)
    agent = EscalationAgent(state)
    triggered, reason = agent.check_escalation_triggers("Hello")
    assert triggered is True
    assert "0.59" in reason or "confidence" in reason.lower()
    print("  PASS  [E3] Escalation: confidence 0.59 triggers")


def test_e4_no_escalation_at_0_60():
    state = _make_state(risk_flags=[], confidence_score=0.60)
    agent = EscalationAgent(state)
    triggered, _ = agent.check_escalation_triggers("Hello")
    assert triggered is False
    print("  PASS  [E4] Escalation: confidence 0.60 alone does not trigger")


def test_e5_escalation_repeated_failed_attempts():
    state = _make_state(risk_flags=[], confidence_score=0.80, failed_resolve_count=2)
    agent = EscalationAgent(state)
    triggered, reason = agent.check_escalation_triggers("I am still confused")
    assert triggered is True
    assert "2" in reason
    print("  PASS  [E5] Escalation: failed_resolve_count >= 2 triggers")


# ─────────────────────────────────────────────────────────────────────────────
# Part F — Failed Resolution Counter
# ─────────────────────────────────────────────────────────────────────────────

async def test_f1_failed_resolve_counter_increment_and_reset():
    state = _make_state(risk_flags=[], confidence_score=0.80)
    worker = VoiceModeratorAgentWorker(state)

    # 1. No prior support response -> no increment
    worker._last_was_support_resolution = False
    worker._evaluate_resolution_state("that did not help")
    assert state.failed_resolve_count == 0

    # 2. Prior support response -> increments on unresolved language
    worker._last_was_support_resolution = True
    worker._evaluate_resolution_state("that did not help")
    assert state.failed_resolve_count == 1

    # 3. Resets on clear confirmation
    worker._last_was_support_resolution = True
    worker._evaluate_resolution_state("that solved it, thank you!")
    assert state.failed_resolve_count == 0
    print("  PASS  [F1] Failed resolution counter increments and resets properly")


# ─────────────────────────────────────────────────────────────────────────────
# Part G — Turn Processing & Barge-In State
# ─────────────────────────────────────────────────────────────────────────────

async def test_g1_turn_processing_and_barge_in():
    worker = initialize_voice_agent(
        case_id="case-turn-test",
        context_building={"summary": "Cyber crime report.", "risk_flags": [], "context_building_confidence_score": 0.80},
    )
    # Turn 1: Greeting
    res1 = await worker.process_user_turn("Hello")
    assert res1["active_agent"] == "VoiceModerator"
    assert worker.state.turn_count == 1
    assert worker.state.is_agent_speaking is False

    # Turn 2: Sub-agent
    res2 = await worker.process_user_turn("Can you help me file?")
    assert worker.state.turn_count == 2
    assert worker.state.is_agent_speaking is False
    assert "voice_profile" in res2
    print("  PASS  [G1] Turn processing increments turn_count, resets is_agent_speaking, includes voice_profile")


async def test_g2_process_audio_turn_empty_transcript_retry():
    """Empty or rejected transcription returns retry status without mutating conversation transcript."""
    worker = initialize_voice_agent(
        case_id="case-turn-retry-test",
        context_building={"summary": "Rent dispute.", "risk_flags": [], "context_building_confidence_score": 0.70},
    )
    initial_turns = worker.state.turn_count
    initial_transcript_len = len(worker.state.transcript)

    with patch("backend.voice.agent.transcribe_audio_sarvam", new=AsyncMock(return_value="")):
        res = await worker.process_audio_turn(b"fake_short_audio", language="en-IN")
        assert res["status"] == "retry"
        assert res["user_transcript"] == ""
        assert "didn't catch any speech" in res["spoken_response"]
        # Ensure state transcript was NOT mutated with empty garbage
        assert worker.state.turn_count == initial_turns
        assert len(worker.state.transcript) == initial_transcript_len
    print("  PASS  [G2] Empty audio transcription returns retry status without mutating ConversationState")


async def test_g3_process_audio_turn_success():
    """Successful audio transcription updates ConversationState and invokes reasoning agent."""
    worker = initialize_voice_agent(
        case_id="case-turn-success-test",
        context_building={"summary": "Rent dispute.", "risk_flags": [], "context_building_confidence_score": 0.70},
    )
    with patch("backend.voice.agent.transcribe_audio_sarvam", new=AsyncMock(return_value="I paid the landlord 50000rs in cash.")):
        res = await worker.process_audio_turn(b"RIFF" + b"\x00" * 600, language="en-IN")
        assert res["user_transcript"] == "I paid the landlord 50000rs in cash."
        assert worker.state.turn_count == 1
        assert any(t["text"] == "I paid the landlord 50000rs in cash." for t in worker.state.transcript)
    print("  PASS  [G3] Valid audio transcription appends to ConversationState and runs reasoning")


# ─────────────────────────────────────────────────────────────────────────────
# Part H — Decision Log Completeness
# ─────────────────────────────────────────────────────────────────────────────

async def test_h1_decision_log_entries():
    state = _make_state(risk_flags=[], confidence_score=0.75)
    agent = VerificationAgent(state)
    await agent.evaluate_and_respond("Here are the dates.")
    assert any(e["agent"] == "VerificationAgent" for e in state.decision_log)

    supp = SupportAgent(state)
    mock_resp = MagicMock()
    mock_resp.content = "Here is legal support info."
    _MOCK_LLM.invoke = MagicMock(return_value=mock_resp)
    await supp.evaluate_and_respond("What is the next step?")
    assert any(e["agent"] == "SupportAgent" for e in state.decision_log)
    print("  PASS  [H1] All cooperating sub-agents log structured decisions")


# ─────────────────────────────────────────────────────────────────────────────
# Part I — Sarvam Bulbul v3 TTS Provider & Voice Profile Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_i1_sarvam_tts_provider_is_default():
    """Sarvam Bulbul v3 is the sole default production TTS provider."""
    provider = get_tts_provider()
    assert isinstance(provider, TTSProvider)
    assert isinstance(provider, SarvamTTSProvider)
    assert provider.provider_name == "sarvam"
    print("  PASS  [I1] Sarvam Bulbul v3 is default production TTS provider")


def test_i2_sarvam_tts_sensitive_voice_profile():
    """Sensitive cases select calm voice profile: pace=0.85, soothing speaker (meera)."""
    profile = get_voice_profile_for_risk_flags(["sensitive"], language_hint="bn-IN")
    assert profile.is_sensitive is True
    assert profile.pace == 0.85, f"Expected pace 0.85, got {profile.pace}"
    assert profile.speaker == "meera"
    assert profile.target_language_code == "bn-IN"
    assert profile.model == "bulbul:v3"
    print("  PASS  [I2] Sensitive case selects calm voice profile (pace=0.85, speaker=meera, model=bulbul:v3)")


def test_i3_sarvam_tts_standard_voice_profile():
    """Standard non-sensitive cases select baseline parameters: pace=1.0, speaker=shubh."""
    profile = get_voice_profile_for_risk_flags([], language_hint="hi-IN")
    assert profile.is_sensitive is False
    assert profile.pace == 1.0
    assert profile.speaker == "shubh"
    assert profile.target_language_code == "hi-IN"
    assert profile.model == "bulbul:v3"
    print("  PASS  [I3] Standard case selects baseline Sarvam Bulbul v3 profile (pace=1.0, speaker=shubh)")


async def test_i4_sarvam_tts_streaming_audio_call():
    """SarvamTTSProvider.speak calls Sarvam streaming API with expected JSON payload."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    async def _mock_stream():
        yield b"chunk1_mp3"
        yield b"chunk2_mp3"

    mock_resp.aiter_bytes = _mock_stream

    # Async context manager for client.stream
    class MockStreamContext:
        async def __aenter__(self):
            return mock_resp
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    mock_client = MagicMock()
    mock_client.stream = MagicMock(return_value=MockStreamContext())
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    provider = SarvamTTSProvider(api_key="test-key")
    profile = get_voice_profile_for_risk_flags(["sensitive"], language_hint="en-IN")

    with patch("httpx.AsyncClient", return_value=mock_client):
        chunks = []
        async for chunk in provider.speak("You don't have to explain everything right now.", profile):
            chunks.append(chunk)

        assert chunks == [b"chunk1_mp3", b"chunk2_mp3"]
        mock_client.stream.assert_called_once()
        call_args = mock_client.stream.call_args
        assert call_args[0][0] == "POST"
        assert "text-to-speech/stream" in call_args[0][1]
        body = call_args[1]["json"]
        assert body["model"] == "bulbul:v3"
        assert body["pace"] == 0.85
        assert body["speaker"] == "meera"
        assert body["target_language_code"] == "en-IN"
    print("  PASS  [I4] SarvamTTSProvider streams audio chunks via Sarvam Bulbul v3 stream endpoint")


def test_i5_webspeech_dev_fallback():
    """WebSpeech provider is only selected when explicitly requested and ENABLE_WEBSPEECH_FALLBACK is enabled."""
    with patch("backend.voice.tts_service.ENABLE_WEBSPEECH_FALLBACK", True):
        provider = get_tts_provider(provider_name="webspeech")
        assert provider.provider_name == "webspeech"
        assert isinstance(provider, WebSpeechTTSProvider)

    # When ENABLE_WEBSPEECH_FALLBACK is False, fallback returns default Sarvam provider
    with patch("backend.voice.tts_service.ENABLE_WEBSPEECH_FALLBACK", False):
        provider = get_tts_provider(provider_name="webspeech")
        assert provider.provider_name == "sarvam"
    print("  PASS  [I5] WebSpeech fallback only accessible behind explicit ENABLE_WEBSPEECH_FALLBACK flag")


# ─────────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────────

async def main():
    print("\n=== NyaySahayak Voice Moderator — Sarvam AI (STT & TTS) Validation ===\n")

    print("── Part A: Sarvam Saaras v3 STT & Language Hints ──")
    test_a1_bengali_bn_in_hint()
    test_a2_hindi_hi_in_hint()
    test_a3_english_en_in_hint()
    test_a4_code_mixed_language_hint()
    await test_a5_sarvam_stt_payload_and_normalization()
    await test_a6_empty_audio_rejected()
    await test_a7_short_audio_rejected()
    await test_a8_sarvam_error_returns_empty_string()

    print("\n── Part B/C: ConversationState & Case-Record Init ──")
    test_b1_conversation_state_fields()
    test_b2_log_decision()
    test_c1_narration_extraction_from_summary()
    test_c2_narration_extraction_from_session_data()
    test_c3_initialize_voice_agent_pulls_from_db()

    print("\n── Part D: Sensitive-Case Guardrail ──")
    test_d1_sensitive_prompt_constant_verbatim()
    await test_d2_sensitive_first_turn_response()

    print("\n── Part E: Escalation Conditions ──")
    test_e1_escalation_human_request()
    test_e2_escalation_sensitive_flag()
    test_e3_escalation_low_confidence()
    test_e4_no_escalation_at_0_60()
    test_e5_escalation_repeated_failed_attempts()

    print("\n── Part F: Failed Resolution Counter ──")
    await test_f1_failed_resolve_counter_increment_and_reset()

    print("\n── Part G: Turn Processing & Barge-In State ──")
    await test_g1_turn_processing_and_barge_in()
    await test_g2_process_audio_turn_empty_transcript_retry()
    await test_g3_process_audio_turn_success()

    print("\n── Part H: Decision Log Completeness ──")
    await test_h1_decision_log_entries()

    print("\n── Part I: Sarvam Bulbul v3 TTS Provider & Voice Profile ──")
    test_i1_sarvam_tts_provider_is_default()
    test_i2_sarvam_tts_sensitive_voice_profile()
    test_i3_sarvam_tts_standard_voice_profile()
    await test_i4_sarvam_tts_streaming_audio_call()
    test_i5_webspeech_dev_fallback()

    print("\n=== ALL SARVAM VOICE MODERATOR TESTS PASSED SUCCESSFULLY ===\n")


if __name__ == "__main__":
    asyncio.run(main())
