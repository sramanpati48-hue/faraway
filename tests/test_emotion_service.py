"""Advisory-only emotion-signal tests (synthetic fixtures, no model required)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.emotion_service import (  # noqa: E402
    DISTRESS_MIN_CONFIDENCE,
    FORBIDDEN_FIELDS,
    LABEL_DISTRESS,
    LABEL_UNCERTAIN,
    PERMITTED_EFFECT_FIELDS,
    RELIABLE_CONFIDENCE_THRESHOLD,
    EmotionSignal,
    advisory_for_turn,
    apply_emotion_signal,
    classify_emotion,
)
from backend.services.nyayguide_eligibility import (  # noqa: E402
    build_nyayguide_suggestion,
    evaluate_nyayguide_eligibility,
)

sys.path.insert(0, str(ROOT / "tests"))
from test_nyayguide_eligibility import _eligible_case  # noqa: E402


# ---------------------------------------------------------------------------
# Classifier reliability
# ---------------------------------------------------------------------------


def test_shadow_mode_returns_unreliable_signal():
    signal = classify_emotion(b"fake-audio", duration_seconds=5.0)
    assert signal.reliable is False
    assert signal.label == LABEL_UNCERTAIN
    assert apply_emotion_signal({}, signal) == {}


def test_short_audio_is_discarded_even_with_model():
    calls = []

    def model_fn(audio):
        calls.append(audio)
        return {"label": "distress", "confidence": 0.99}

    signal = classify_emotion(b"audio", duration_seconds=0.4, model_fn=model_fn)
    assert signal.reliable is False
    assert calls == []


def test_low_confidence_is_discarded_not_guessed():
    signal = classify_emotion(
        b"audio",
        duration_seconds=3.0,
        model_fn=lambda a: {"label": "distress", "confidence": RELIABLE_CONFIDENCE_THRESHOLD - 0.05},
    )
    assert signal.reliable is False
    assert apply_emotion_signal({}, signal) == {}


def test_model_exception_degrades_to_unreliable():
    def boom(audio):
        raise RuntimeError("model down")

    signal = classify_emotion(b"audio", duration_seconds=3.0, model_fn=boom)
    assert signal.reliable is False


# ---------------------------------------------------------------------------
# Permitted-effect policy
# ---------------------------------------------------------------------------


def _distress_signal(confidence=0.9):
    return EmotionSignal(label=LABEL_DISTRESS, confidence=confidence, reliable=True, source="model")


def test_high_confidence_distress_sets_only_permitted_effects():
    effects = apply_emotion_signal({}, _distress_signal(0.9))
    assert set(effects.keys()) <= PERMITTED_EFFECT_FIELDS
    assert effects["soft_priority_flag"] is True
    assert effects["suggest_counsellor"] is True
    assert "tone_adjustment" in effects
    assert effects["moderator_annotation"]["label"].startswith("AI-estimated")


def test_moderate_distress_never_sets_soft_priority_flag():
    effects = apply_emotion_signal({}, _distress_signal(DISTRESS_MIN_CONFIDENCE))
    assert "soft_priority_flag" not in effects
    assert effects.get("suggest_counsellor") is True


def test_calm_signal_only_adjusts_tone_and_annotates():
    signal = EmotionSignal(label="calm", confidence=0.95, reliable=True, source="model")
    effects = apply_emotion_signal({}, signal)
    assert set(effects.keys()) <= PERMITTED_EFFECT_FIELDS
    assert "soft_priority_flag" not in effects
    assert "suggest_counsellor" not in effects


@pytest.mark.parametrize(
    "signal",
    [
        EmotionSignal(label="verified", confidence=0.99, reliable=True),
        EmotionSignal(label=LABEL_DISTRESS, confidence=1.0, reliable=True),
        EmotionSignal(label="anger", confidence=0.8, reliable=True),
    ],
    ids=["adversarial-label", "max-distress", "anger"],
)
def test_output_can_never_contain_forbidden_fields(signal):
    effects = apply_emotion_signal({}, signal)
    assert not (set(effects.keys()) & FORBIDDEN_FIELDS)


# ---------------------------------------------------------------------------
# Structural immunity of verification / NyayGuide eligibility
# ---------------------------------------------------------------------------


def test_emotion_fields_cannot_change_nyayguide_eligibility():
    baseline_row = _eligible_case()
    poisoned_row = _eligible_case()
    poisoned_row["emotion_signal"] = {
        "label": LABEL_DISTRESS,
        "confidence": 1.0,
        "reliable": True,
    }
    poisoned_row["structured_report"]["emotion_analysis"] = {"label": LABEL_DISTRESS}
    poisoned_row["soft_priority_flag"] = True
    poisoned_row["credibility_score"] = -100

    assert evaluate_nyayguide_eligibility(poisoned_row) == evaluate_nyayguide_eligibility(baseline_row)


def test_emotion_fields_cannot_unlock_blocked_cases():
    blocked = _eligible_case()
    blocked["structured_report"]["ai_verification_status"] = "flagged"
    blocked["emotion_signal"] = {"label": "calm", "confidence": 1.0, "reliable": True}

    result = evaluate_nyayguide_eligibility(blocked)
    assert result["allowed"] is False
    assert result["code"] == "HUMAN_REVIEW_REQUIRED"

    suggestion = build_nyayguide_suggestion(blocked["structured_report"])
    assert suggestion is None


def test_emotion_fields_cannot_downgrade_verified_to_incomplete():
    row = _eligible_case()
    baseline = evaluate_nyayguide_eligibility(row)
    row["structured_report"]["emotion_signal"] = {"label": LABEL_DISTRESS, "confidence": 0.99}
    assert evaluate_nyayguide_eligibility(row) == baseline


# ---------------------------------------------------------------------------
# Consent gating + bias resistance at the policy layer
# ---------------------------------------------------------------------------


def test_declined_consent_never_invokes_the_classifier():
    calls = []

    def spy_classify(audio=None, *, duration_seconds=0.0):
        calls.append(1)
        return _distress_signal()

    effects = advisory_for_turn(consented=False, audio_bytes=b"x", classify_fn=spy_classify)
    assert effects == {}
    assert calls == []


def test_granted_consent_uses_classifier_and_applies_policy():
    effects = advisory_for_turn(
        consented=True,
        audio_bytes=b"x",
        classify_fn=lambda audio=None, *, duration_seconds=0.0: _distress_signal(),
    )
    assert effects["soft_priority_flag"] is True


SPEAKER_PROFILES = [
    {"accent": "en-IN neutral"},
    {"accent": "bn-IN regional", "dialect": "bengali-mixed"},
    {"accent": "hi-IN rural", "speech_pattern": "slow"},
    {"accent": "unknown", "speech_pattern": "trauma-flat-affect"},
]


@pytest.mark.parametrize("profile", SPEAKER_PROFILES)
def test_policy_outcome_identical_across_speaker_profiles(profile):
    def make_classifier(label, confidence):
        return lambda audio=None, *, duration_seconds=0.0: EmotionSignal(
            label=label, confidence=confidence, reliable=True, source="model", detail=dict(profile)
        )

    for label, confidence in [("distress", 0.9), ("calm", 0.9), ("uncertain", 0.5)]:
        outcome_a = advisory_for_turn(
            consented=True, audio_bytes=b"a", classify_fn=make_classifier(label, confidence)
        )
        outcome_b = advisory_for_turn(
            consented=True, audio_bytes=b"a", classify_fn=make_classifier(label, confidence)
        )
        assert outcome_a == outcome_b
        assert not (set(outcome_a.keys()) & FORBIDDEN_FIELDS)


def test_policy_signature_has_no_speaker_or_accent_inputs():
    import inspect

    sig = inspect.signature(apply_emotion_signal)
    assert list(sig.parameters.keys()) == ["case_state", "signal"]

# --- Dual Source Tests ---

import asyncio
from backend.services.emotion_service import dual_source_emotion_model_fn, async_advisory_for_turn

@pytest.mark.asyncio
async def test_dual_source_agree_above_threshold():
    async def _mock_gemini(a, mime_type=None): return {"label": "distress", "confidence": 0.8}
    async def _mock_groq(t): return {"label": "distress", "confidence": 0.9}

    res = await dual_source_emotion_model_fn(
        b"audio", "help me", gemini_call_fn=_mock_gemini, groq_call_fn=_mock_groq
    )
    assert res["reliable"] is True
    assert res["disagreement"] is False
    assert res["label"] == "distress"
    import math
    assert math.isclose(res["confidence"], 0.85, rel_tol=1e-9)

@pytest.mark.asyncio
async def test_dual_source_one_or_both_below_threshold():
    async def _mock_gemini(a, mime_type=None): return {"label": "distress", "confidence": 0.8}
    async def _mock_groq(t): return {"label": "distress", "confidence": 0.5} # Below 0.7

    res = await dual_source_emotion_model_fn(
        b"audio", "help me", gemini_call_fn=_mock_gemini, groq_call_fn=_mock_groq
    )
    assert res["reliable"] is False
    assert res["disagreement"] is False
    assert res["label"] == "uncertain"
    assert res["confidence"] == 0.5  # min(0.8, 0.5)

@pytest.mark.asyncio
async def test_dual_source_confident_disagree():
    async def _mock_gemini(a, mime_type=None): return {"label": "distress", "confidence": 0.8}
    async def _mock_groq(t): return {"label": "calm", "confidence": 0.9}

    res = await dual_source_emotion_model_fn(
        b"audio", "help me", gemini_call_fn=_mock_gemini, groq_call_fn=_mock_groq
    )
    assert res["reliable"] is False
    assert res["disagreement"] is True
    assert res["label"] == "distress_vs_calm"
    assert res["confidence"] == 0.8  # min(0.8, 0.9)

@pytest.mark.asyncio
async def test_dual_source_disagreement_immune_from_forbidden_fields():
    async def _mock_gemini(a, mime_type=None): return {"label": "distress", "confidence": 0.8}
    async def _mock_groq(t): return {"label": "calm", "confidence": 0.9}

    async def wrapper(a, transcript_text):
        return await dual_source_emotion_model_fn(
            a, transcript_text, gemini_call_fn=_mock_gemini, groq_call_fn=_mock_groq
        )

    effects = await async_advisory_for_turn(
        consented=True,
        audio_bytes=b"0"*32000, # 1 second
        duration_seconds=1.0,
        transcript_text="text",
        model_fn=wrapper
    )
    
    # Check that forbidden fields are absent
    assert not (set(effects.keys()) & FORBIDDEN_FIELDS)
    # Check that it ONLY emitted allowed soft_priority_flag and annotation
    assert effects.get("soft_priority_flag") is True
    assert effects["moderator_annotation"]["signal"] == "disagreement"

@pytest.mark.asyncio
async def test_dual_source_consent_declined():
    # If consent is declined, model is never called, returns empty effects
    called = []
    async def _mock_gemini(a, mime_type=None): 
        called.append("gemini")
        return {"label": "distress", "confidence": 0.9}
    async def _mock_groq(t): 
        called.append("groq")
        return {"label": "distress", "confidence": 0.9}

    async def wrapper(a, transcript_text):
        return await dual_source_emotion_model_fn(
            a, transcript_text, gemini_call_fn=_mock_gemini, groq_call_fn=_mock_groq
        )

    effects = await async_advisory_for_turn(
        consented=False,
        audio_bytes=b"0"*32000,
        duration_seconds=1.0,
        transcript_text="text",
        model_fn=wrapper
    )
    assert effects == {}
    assert len(called) == 0

@pytest.mark.asyncio
async def test_dual_source_provider_exception_fallback():
    async def _mock_gemini(a, mime_type=None): return {"label": "distress", "confidence": 0.9}
    async def _mock_groq_fail(t): raise ValueError("Timeout or Provider Error")

    res = await dual_source_emotion_model_fn(
        b"audio", "help me", gemini_call_fn=_mock_gemini, groq_call_fn=_mock_groq_fail
    )
    
    assert res["reliable"] is False
    assert res["label"] == "uncertain"
    assert res["confidence"] == 0.0
    assert res["source"] == "dual_source_error"

    # Also test actual timeout wrapping via asyncio.sleep
    async def _mock_groq_slow(t):
        await asyncio.sleep(4.0)
        return {"label": "distress", "confidence": 0.9}
        
    res_slow = await dual_source_emotion_model_fn(
        b"audio", "help me", gemini_call_fn=_mock_gemini, groq_call_fn=_mock_groq_slow
    )
    
    assert res_slow["reliable"] is False
    assert res_slow["label"] == "uncertain"
    assert res_slow["source"] == "dual_source_error"


@pytest.mark.asyncio
async def test_dual_source_budget_exhaustion():
    from backend.services.emotion_service import _session_emotion_call_counts, EmotionSignal
    import backend.voice.config as config
    
    # Store original and set limit
    orig_limit = getattr(config, 'EMOTION_DETECTION_MAX_CALLS_PER_SESSION', 0)
    config.EMOTION_DETECTION_MAX_CALLS_PER_SESSION = 1
    session_id = "test_exhaustion_session"
    _session_emotion_call_counts[session_id] = 0
    
    called = []
    async def _mock_gemini(a, mime_type=None):
        called.append("gemini")
        return {"label": "distress", "confidence": 0.8}
    async def _mock_groq(t):
        called.append("groq")
        return {"label": "distress", "confidence": 0.8}
        
    async def wrapper(a, transcript_text):
        return await dual_source_emotion_model_fn(
            a, transcript_text, gemini_call_fn=_mock_gemini, groq_call_fn=_mock_groq
        )

    # First turn (within budget)
    effects1 = await async_advisory_for_turn(
        consented=True,
        session_id=session_id,
        audio_bytes=b"0"*32000,
        duration_seconds=1.0,
        transcript_text="hello",
        model_fn=wrapper
    )
    assert "soft_priority_flag" in effects1
    assert len(called) == 2
    
    called.clear()
    
    # Second turn (budget exhausted)
    effects2 = await async_advisory_for_turn(
        consented=True,
        session_id=session_id,
        audio_bytes=b"0"*32000,
        duration_seconds=1.0,
        transcript_text="hello again",
        model_fn=wrapper
    )
    
    # No effects emitted because it returns unreliable
    assert effects2 == {}
    assert len(called) == 0  # Prove 0 provider calls made
    
    # Restore
    config.EMOTION_DETECTION_MAX_CALLS_PER_SESSION = orig_limit


@pytest.mark.asyncio
async def test_dual_source_low_confidence_disagreement_no_effects():
    # Construct a low-confidence disagreement signal directly
    from backend.services.emotion_service import apply_emotion_signal, EmotionSignal
    signal = EmotionSignal(
        label="distress_vs_calm",
        confidence=0.5, # Below 0.7
        reliable=False,
        disagreement=True,
        detail={"gemini": {"label": "distress", "confidence": 0.8}, "groq": {"label": "calm", "confidence": 0.5}}
    )
    effects = apply_emotion_signal({}, signal)
    # Because confidence < 0.7, soft_priority_flag should NOT be emitted
    assert effects == {}


@pytest.mark.asyncio
async def test_dual_source_invalid_response():
    # Non-dict return
    async def _mock_gemini(a, mime_type=None): return ["not", "a", "dict"]
    async def _mock_groq(t): return {"label": "distress", "confidence": 0.8}

    res = await dual_source_emotion_model_fn(
        b"audio", "test", gemini_call_fn=_mock_gemini, groq_call_fn=_mock_groq
    )
    assert res["reliable"] is False
    assert res["source"] == "dual_source_invalid_response"
    assert res["confidence"] == 0.0


@pytest.mark.asyncio
async def test_dual_source_malformed_confidence():
    # String confidence instead of float, out of bounds, etc.
    async def _mock_gemini(a, mime_type=None): return {"label": "distress", "confidence": "high"}
    async def _mock_groq(t): return {"label": "distress", "confidence": 1.5} # > 1.0 clamped

    res = await dual_source_emotion_model_fn(
        b"audio", "test", gemini_call_fn=_mock_gemini, groq_call_fn=_mock_groq
    )
    # Gemini's "high" becomes 0.0 (ValueError -> 0.0)
    # Groq's 1.5 becomes 1.0
    # Because conf1=0.0 < 0.7, reliable is False, source is uncertain
    assert res["reliable"] is False
    assert res["source"] == "dual_source_uncertain"
    # min(0.0, 1.0) == 0.0
    assert res["confidence"] == 0.0
