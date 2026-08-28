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
