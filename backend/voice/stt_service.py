"""
Sarvam AI Saaras v3 STT Service for NyaySahayak Voice Moderator.
Provides streaming and buffer transcription using Sarvam Saaras v3 with multilingual
and code-mixed support for English (en-IN), Hindi (hi-IN), Bengali (bn-IN), and other Indian languages.
"""
from __future__ import annotations

import os
import asyncio
from typing import Optional, Dict, Any
import httpx
from dotenv import load_dotenv

from backend.voice.config import SARVAM_API_KEY, is_sarvam_configured

load_dotenv()

SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"

VALID_SARVAM_LANGUAGES = {
    "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN",
    "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN", "unknown"
}


def normalize_sarvam_stt_language(language: Optional[str]) -> str:
    """
    Normalizes incoming language hints to Sarvam Saaras v3 BCP-47 language codes.
    Accepts full BCP-47 tags (en-IN, hi-IN, bn-IN) or short ISO codes (en, hi, bn)
    and maps them to valid Sarvam language_code values.
    """
    if not language:
        return "unknown"
    raw = language.strip()
    if raw in VALID_SARVAM_LANGUAGES:
        return raw

    short = raw.split("-")[0].lower()
    mapping: Dict[str, str] = {
        "bn": "bn-IN",
        "en": "en-IN",
        "hi": "hi-IN",
        "gu": "gu-IN",
        "kn": "kn-IN",
        "ml": "ml-IN",
        "mr": "mr-IN",
        "od": "od-IN",
        "or": "od-IN",
        "pa": "pa-IN",
        "ta": "ta-IN",
        "te": "te-IN",
        "code-mixed": "unknown",
        "mixed": "unknown",
        "auto": "unknown",
    }
    return mapping.get(short, "unknown")


async def transcribe_audio_sarvam(
    audio_bytes: bytes,
    mime_type: str = "audio/webm",
    language: str = "unknown",
) -> str:
    """
    Transcribes audio using Sarvam Saaras v3 API.
    Supports code-mixed input, Indian English (en-IN), Hindi (hi-IN), Bengali (bn-IN), etc.

    Parameters:
      - audio_bytes: Raw audio byte buffer
      - mime_type: MIME type of audio (default: audio/webm)
      - language: BCP-47 language hint (e.g. en-IN, hi-IN, bn-IN, or unknown for auto/code-mixed)

    Returns:
      - Clean transcription string normalized for the ConversationState pipeline.
    """
    if not audio_bytes or len(audio_bytes) < 500:
        print(f"[STT Service] Audio payload too short ({len(audio_bytes) if audio_bytes else 0} bytes) - rejecting.")
        return ""

    if not is_sarvam_configured():
        print("[STT Service] SARVAM_API_KEY is not configured.")
        return ""

    normalized_lang = normalize_sarvam_stt_language(language)
    clean_mime = (mime_type or "audio/webm").split(";")[0].strip()
    ext = "wav" if "wav" in clean_mime else ("mp3" if "mp3" in clean_mime or "mpeg" in clean_mime else "webm")

    print(
        f"[STT Service] Transcribing with Sarvam Saaras v3: bytes={len(audio_bytes)}, "
        f"mime_type={clean_mime}, language={normalized_lang}"
    )

    files = {
        "file": (f"user_audio.{ext}", audio_bytes, clean_mime),
    }
    data = {
        "model": "saaras:v3",
        "language_code": normalized_lang,
        "mode": "transcribe",
    }
    headers = {
        "api-subscription-key": SARVAM_API_KEY,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                SARVAM_STT_URL,
                headers=headers,
                files=files,
                data=data,
            )
            if resp.status_code == 200:
                result = resp.json()
                transcript = str(
                    result.get("transcript")
                    or result.get("text")
                    or result.get("data")
                    or ""
                ).strip()
                print(f"[STT Service] Transcription success: length={len(transcript)} chars")
                return transcript
            print(f"[STT Service] Sarvam STT returned status {resp.status_code}: {resp.text[:120]}")
    except Exception as e:
        print(f"[STT Service] Sarvam STT exception: {type(e).__name__}")

    return ""


# Alias for backward compatibility
transcribe_audio = transcribe_audio_sarvam
