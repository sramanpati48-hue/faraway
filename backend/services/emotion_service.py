"""Advisory-only emotion-signal service for the Voice Moderator.

Safety contract (enforced structurally, not by convention):
- Emotion signals NEVER influence verification_status, ai_verification_status,
  nyayguide eligibility, credibility scores, or any routing gate.
- apply_emotion_signal returns a FIXED-SHAPE dict of permitted effect fields,
  so it is impossible for callers to smuggle emotion data into forbidden
  case fields through this module.
- Unreliable signals (low confidence, short/noisy audio, no model) are
  discarded — the policy never guesses.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

RELIABLE_CONFIDENCE_THRESHOLD = 0.7
DISTRESS_MIN_CONFIDENCE = 0.7
MIN_UTTERANCE_SECONDS = 1.0

LABEL_DISTRESS = "distress"
LABEL_UNCERTAIN = "uncertain"

# The ONLY keys apply_emotion_signal may ever emit.
PERMITTED_EFFECT_FIELDS = frozenset(
    {"soft_priority_flag", "suggest_counsellor", "tone_adjustment", "moderator_annotation"}
)

# Fields emotion data must never reach; asserted in tests and referenced by
# reviewers. Kept here as executable documentation of the fence.
FORBIDDEN_FIELDS = frozenset(
    {
        "verification_status",
        "ai_verification_status",
        "credibility_score",
        "nyayguide_eligible",
        "nyayguide_support_needed",
        "workflow_state",
        "resolution_status",
    }
)

MODERATOR_ANNOTATION_LABEL = "AI-estimated signal, not verified"


@dataclass(frozen=True)
class EmotionSignal:
    label: str = LABEL_UNCERTAIN
    confidence: float = 0.0
    reliable: bool = False
    source: str = "shadow"
    detail: Dict[str, Any] = field(default_factory=dict)


def classify_emotion(
    audio_bytes: Optional[bytes] = None,
    *,
    duration_seconds: float = 0.0,
    model_fn: Optional[Callable[[bytes], Dict[str, Any]]] = None,
) -> EmotionSignal:
    """Advisory classifier entry point.

    Shadow-mode default: with no production SER model wired in, this always
    returns an unreliable signal so nothing downstream may act on it. A real
    model can later be injected via `model_fn` without changing the policy.
    """
    if not callable(model_fn):
        return EmotionSignal(label=LABEL_UNCERTAIN, confidence=0.0, reliable=False, source="shadow")
    if duration_seconds < MIN_UTTERANCE_SECONDS or not audio_bytes:
        return EmotionSignal(label=LABEL_UNCERTAIN, confidence=0.0, reliable=False, source="model_skipped")

    try:
        raw = model_fn(audio_bytes)
    except Exception:
        return EmotionSignal(label=LABEL_UNCERTAIN, confidence=0.0, reliable=False, source="model_error")

    label = str(raw.get("label") or LABEL_UNCERTAIN).strip().lower()
    try:
        confidence = float(raw.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    reliable = (
        bool(raw.get("reliable", True))
        and label not in {"", LABEL_UNCERTAIN}
        and confidence >= RELIABLE_CONFIDENCE_THRESHOLD
    )
    return EmotionSignal(
        label=label,
        confidence=min(confidence, 1.0),
        reliable=reliable,
        source="model",
        detail={"duration_seconds": duration_seconds},
    )


def apply_emotion_signal(case_state: Dict[str, Any], signal: EmotionSignal) -> Dict[str, Any]:
    """Returns permitted advisory effects for a case state.

    Returns a new fixed-shape dict; unreliable signals yield an empty dict.
    This function has no access to verification/eligibility fields by
    construction: its output contains only PERMITTED_EFFECT_FIELDS keys.
    """
    if not signal.reliable:
        return {}

    if signal.label == LABEL_DISTRESS and signal.confidence > DISTRESS_MIN_CONFIDENCE:
        return {
            "soft_priority_flag": True,
            "suggest_counsellor": True,
            "tone_adjustment": {"pace": 0.8, "warmth": 1.15},
            "moderator_annotation": {
                "label": MODERATOR_ANNOTATION_LABEL,
                "signal": signal.label,
                "confidence": round(signal.confidence, 2),
                "source": signal.source,
            },
        }

    if signal.label == LABEL_DISTRESS:
        return {
            "suggest_counsellor": True,
            "moderator_annotation": {
                "label": MODERATOR_ANNOTATION_LABEL,
                "signal": signal.label,
                "confidence": round(signal.confidence, 2),
                "source": signal.source,
            },
        }

    return {
        "tone_adjustment": {"pace": 0.95},
        "moderator_annotation": {
            "label": MODERATOR_ANNOTATION_LABEL,
            "signal": signal.label,
            "confidence": round(signal.confidence, 2),
            "source": signal.source,
        },
    }


def advisory_for_turn(
    *,
    consented: bool,
    audio_bytes: Optional[bytes] = None,
    duration_seconds: float = 0.0,
    classify_fn: Optional[Callable[[Optional[bytes]], EmotionSignal]] = None,
) -> Dict[str, Any]:
    """Per-turn orchestration used by voice routes.

    Without explicit consent the classifier is never invoked at all —
    declining produces byte-identical behavior to a session without the feature.
    """
    if not consented:
        return {}

    signal = (classify_fn or classify_emotion)(audio_bytes, duration_seconds=duration_seconds)
    return apply_emotion_signal({}, signal)
