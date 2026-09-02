"""Advisory-only emotion-signal service for the Voice Moderator.

Safety contract (enforced structurally, not by convention):
- Emotion signals NEVER influence verification_status, ai_verification_status,
  nyayguide eligibility, credibility scores, or any routing gate.
- apply_emotion_signal returns a FIXED-SHAPE dict of permitted effect fields,
  so it is impossible for callers to smuggle emotion data into forbidden
  case fields through this module.
- Unreliable signals (low confidence, short/noisy audio, no model) are
  discarded - the policy never guesses.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import os
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
    disagreement: bool = False
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
    model can later be injected via model_fn without changing the policy.
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
        confidence=min(max(confidence, 0.0), 1.0),
        reliable=reliable,
        disagreement=bool(raw.get("disagreement", False)),
        source=str(raw.get("source", "model")),
        detail={"duration_seconds": duration_seconds},
    )


async def async_classify_emotion(
    audio_bytes: Optional[bytes] = None,
    *,
    duration_seconds: float = 0.0,
    transcript_text: str = "",
    model_fn: Optional[Callable[..., Any]] = None,
) -> EmotionSignal:
    """Async variant supporting coroutine model_fn including dual-source."""
    if not callable(model_fn):
        return EmotionSignal(label=LABEL_UNCERTAIN, confidence=0.0, reliable=False, source="shadow")
    if duration_seconds < MIN_UTTERANCE_SECONDS or not audio_bytes:
        return EmotionSignal(label=LABEL_UNCERTAIN, confidence=0.0, reliable=False, source="model_skipped")

    try:
        if inspect.iscoroutinefunction(model_fn):
            sig = inspect.signature(model_fn)
            if "transcript_text" in sig.parameters:
                raw = await model_fn(audio_bytes, transcript_text=transcript_text)
            else:
                raw = await model_fn(audio_bytes)
        else:
            sig = inspect.signature(model_fn)
            if "transcript_text" in sig.parameters:
                raw = model_fn(audio_bytes, transcript_text=transcript_text)
            else:
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
        confidence=min(max(confidence, 0.0), 1.0),
        reliable=reliable,
        disagreement=bool(raw.get("disagreement", False)),
        source=str(raw.get("source", "model")),
        detail=raw.get("detail") or {"duration_seconds": duration_seconds},
    )


def apply_emotion_signal(case_state: Dict[str, Any], signal: EmotionSignal) -> Dict[str, Any]:
    """Returns permitted advisory effects for a case state.

    Returns a new fixed-shape dict; unreliable signals yield an empty dict.
    This function has no access to verification/eligibility fields by
    construction: its output contains only PERMITTED_EFFECT_FIELDS keys.
    """
    if signal.disagreement:
        if signal.confidence >= RELIABLE_CONFIDENCE_THRESHOLD and isinstance(signal.detail, dict):
            return {
                "soft_priority_flag": True,
                "moderator_annotation": {
                    "label": MODERATOR_ANNOTATION_LABEL,
                    "signal": "disagreement",
                    "confidence": round(signal.confidence, 2),
                    "source": signal.source,
                    "detail": signal.detail,
                },
            }
        else:
            return {}

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
    """Per-turn orchestration used by voice routes (Sync)."""
    if not consented:
        return {}

    signal = (classify_fn or classify_emotion)(audio_bytes, duration_seconds=duration_seconds)
    return apply_emotion_signal({}, signal)


_session_emotion_call_counts: Dict[str, int] = {}

async def async_advisory_for_turn(
    *,
    consented: bool,
    session_id: str = "",
    audio_bytes: Optional[bytes] = None,
    duration_seconds: float = 0.0,
    transcript_text: str = "",
    classify_fn: Optional[Callable[..., EmotionSignal]] = None,
    model_fn: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    """Per-turn orchestration used by voice routes (Async)."""
    if not consented:
        return {}

    if session_id:
        try:
            from backend.voice.config import EMOTION_DETECTION_MAX_CALLS_PER_SESSION
            max_calls = EMOTION_DETECTION_MAX_CALLS_PER_SESSION
        except ImportError:
            max_calls = 0
            
        if max_calls > 0 and _session_emotion_call_counts.get(session_id, 0) >= max_calls:
            exhausted_signal = EmotionSignal(
                label=LABEL_UNCERTAIN, 
                confidence=0.0, 
                reliable=False, 
                source="session_budget_exhausted"
            )
            return apply_emotion_signal({}, exhausted_signal)

    if classify_fn and inspect.iscoroutinefunction(classify_fn):
        signal = await classify_fn(audio_bytes, duration_seconds=duration_seconds, transcript_text=transcript_text)
    elif classify_fn:
        signal = classify_fn(audio_bytes, duration_seconds=duration_seconds)
    else:
        signal = await async_classify_emotion(
            audio_bytes,
            duration_seconds=duration_seconds,
            transcript_text=transcript_text,
            model_fn=model_fn
        )

    if session_id and signal.source not in ("model_skipped", "shadow", "session_budget_exhausted"):
        _session_emotion_call_counts[session_id] = _session_emotion_call_counts.get(session_id, 0) + 1

    return apply_emotion_signal({}, signal)


# --- Dual Source Model (Gemini Audio + Groq Text) ---

async def _default_gemini_audio_emotion(audio_bytes: bytes, mime_type: str = "audio/webm") -> Dict[str, Any]:
    from google import genai
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    def _call():
        res = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                {"inline_data": {"mime_type": mime_type, "data": audio_bytes}},
                "Analyze the vocal tone, acoustic stress, pitch, and emotion in this citizen audio for a legal intake service. Output strictly JSON with keys: 'label' (one of: 'distress', 'calm', 'anger', 'fear', 'uncertain') and 'confidence' (float between 0.0 and 1.0)."
            ],
            config={"response_mime_type": "application/json"}
        )
        return json.loads(res.text)
    return await asyncio.to_thread(_call)


async def _default_groq_text_emotion(transcript_text: str) -> Dict[str, Any]:
    from groq import Groq
    client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    def _call():
        prompt = (
            "Analyze the emotional sentiment and distress level from this spoken transcript in a legal intake service. "
            "Output strictly JSON with keys: 'label' (one of: 'distress', 'calm', 'anger', 'fear', 'uncertain') and 'confidence' (float between 0.0 and 1.0).\\n\\n"
            f"Transcript: {transcript_text}"
        )
        res = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.1
        )
        return json.loads(res.choices[0].message.content)
    return await asyncio.to_thread(_call)


def _parse_provider_res(res: Any) -> tuple[str, float, bool]:
    if isinstance(res, Exception) or not isinstance(res, dict):
        return LABEL_UNCERTAIN, 0.0, True
    label = str(res.get("label", LABEL_UNCERTAIN)).strip().lower()
    try:
        conf = float(res.get("confidence", 0.0))
    except (TypeError, ValueError):
        conf = 0.0
    conf = min(max(conf, 0.0), 1.0)
    return label, conf, False


async def dual_source_emotion_model_fn(
    audio_bytes: bytes,
    transcript_text: str = "",
    *,
    mime_type: str = "audio/webm",
    gemini_call_fn: Optional[Callable] = None,
    groq_call_fn: Optional[Callable] = None,
) -> Dict[str, Any]:
    async def _safe_call(fn, *args, **kwargs):
        try:
            return await asyncio.wait_for(fn(*args, **kwargs), timeout=3.0)
        except Exception as e:
            return e

    g_fn = gemini_call_fn or _default_gemini_audio_emotion
    gr_fn = groq_call_fn or _default_groq_text_emotion

    res_gemini, res_groq = await asyncio.gather(
        _safe_call(g_fn, audio_bytes, mime_type=mime_type),
        _safe_call(gr_fn, transcript_text),
        return_exceptions=True
    )

    label1, conf1, err1 = _parse_provider_res(res_gemini)
    label2, conf2, err2 = _parse_provider_res(res_groq)

    if err1 or err2:
        source_label = "dual_source_error"
        if not isinstance(res_gemini, Exception) and not isinstance(res_gemini, dict):
            source_label = "dual_source_invalid_response"
        elif not isinstance(res_groq, Exception) and not isinstance(res_groq, dict):
            source_label = "dual_source_invalid_response"
            
        return {
            "label": LABEL_UNCERTAIN,
            "confidence": 0.0,
            "reliable": False,
            "disagreement": False,
            "source": source_label,
        }

    if conf1 < RELIABLE_CONFIDENCE_THRESHOLD or conf2 < RELIABLE_CONFIDENCE_THRESHOLD:
        return {
            "label": LABEL_UNCERTAIN,
            "confidence": min(conf1, conf2),
            "reliable": False,
            "disagreement": False,
            "source": "dual_source_uncertain",
        }

    if label1 == label2 and label1 != LABEL_UNCERTAIN:
        # Agreement: Use arithmetic mean for joint confidence assessment.
        # Mean smooths out minor confidence differences when models fundamentally agree.
        return {
            "label": label1,
            "confidence": (conf1 + conf2) / 2.0,
            "reliable": True,
            "disagreement": False,
            "source": "dual_source",
        }
    else:
        # Disagreement: Use min confidence to ensure the lower reading governs conflict.
        return {
            "label": f"{label1}_vs_{label2}",
            "confidence": min(conf1, conf2),
            "reliable": False,
            "disagreement": True,
            "source": "dual_source_disagreement",
            "detail": {
                "gemini": {"label": label1, "confidence": conf1},
                "groq": {"label": label2, "confidence": conf2}
            },
        }

