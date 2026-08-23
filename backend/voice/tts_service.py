"""
Sarvam AI Bulbul v3 TTS Service for NyaySahayak Voice Moderator.

Provides:
- VoiceProfile dataclass for Sarvam Bulbul v3 controls (pace, speaker, language, temperature)
- TTSProvider abstract base class with single contract: speak(text, voiceProfile) -> audioStream
- SarvamTTSProvider: Sole production TTS provider using Sarvam Bulbul v3 streaming API
- WebSpeechTTSProvider: Optional dev-only browser fallback behind ENABLE_WEBSPEECH_FALLBACK
- get_tts_provider(): Factory returning the active TTS provider (defaults to Sarvam)
- get_voice_profile_for_risk_flags(): Returns calm, slower-paced voice profile for sensitive cases
"""
from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, asdict
from typing import Any, AsyncIterator, Dict, List, Optional
import httpx
from dotenv import load_dotenv

from backend.voice.config import (
    SARVAM_API_KEY,
    VOICE_TTS_PROVIDER,
    ENABLE_WEBSPEECH_FALLBACK,
    is_sarvam_configured,
)

load_dotenv()

SARVAM_STREAM_TTS_URL = "https://api.sarvam.ai/text-to-speech/stream"
SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"

VALID_SARVAM_LANGUAGES = {
    "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN",
    "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"
}


def normalize_sarvam_tts_language(code: Optional[str] = "en-IN") -> str:
    """Normalizes language codes to Sarvam Bulbul v3 BCP-47 language codes."""
    if not code:
        return "en-IN"
    raw = code.strip()
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
    }
    return mapping.get(short, "en-IN")


@dataclass
class VoiceProfile:
    """
    Voice profile parameters controlling Sarvam Bulbul v3 synthesis.
    For sensitive cases, pace is slowed to 0.85 with a reassuring speaker selection.
    """
    name: str = "standard"
    target_language_code: str = "en-IN"
    speaker: str = "shubh"             # e.g., 'meera', 'shubh', 'arvind', 'amartya'
    pace: float = 1.0                  # 0.85 for sensitive/calm cases, 1.0 for standard
    temperature: float = 0.6           # Slightly lower temperature (0.4) for calm steady delivery
    model: str = "bulbul:v3"
    is_sensitive: bool = False
    enable_preprocessing: bool = False
    output_audio_codec: str = "mp3"
    output_audio_bitrate: str = "128k"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def get_voice_profile_for_risk_flags(
    risk_flags: Optional[List[str]],
    language_hint: Optional[str] = "en-IN",
) -> VoiceProfile:
    """
    Derives the appropriate Sarvam Bulbul v3 voice profile from risk_flags.
    Sensitive cases select a calm, slower-paced voice profile (pace=0.85, soothing speaker).
    """
    flags = [str(f).lower() for f in (risk_flags or [])]
    lang = normalize_sarvam_tts_language(language_hint)

    if "sensitive" in flags:
        return VoiceProfile(
            name="sensitive_calm",
            target_language_code=lang,
            speaker="meera",            # Calmer, empathetic voice persona
            pace=0.85,                  # Slower, calm pacing for sensitive cases
            temperature=0.4,
            model="bulbul:v3",
            is_sensitive=True,
            enable_preprocessing=True,
            output_audio_codec="mp3",
        )

    return VoiceProfile(
        name="standard",
        target_language_code=lang,
        speaker="shubh",
        pace=1.0,
        temperature=0.6,
        model="bulbul:v3",
        is_sensitive=False,
        enable_preprocessing=False,
        output_audio_codec="mp3",
    )


class TTSProvider(ABC):
    """
    TTS Adapter Interface.
    Defines the single method `speak(text, voiceProfile) -> audioStream`.
    """
    provider_name: str = "base"

    @abstractmethod
    async def speak(
        self,
        text: str,
        voiceProfile: Optional[VoiceProfile] = None,
    ) -> AsyncIterator[bytes]:
        """
        Synthesizes text into an audio byte stream according to the specified voiceProfile.
        Returns an async iterator over audio byte chunks.
        """
        pass


class SarvamTTSProvider(TTSProvider):
    """
    Sole production TTS provider using Sarvam Bulbul v3 streaming API.
    """
    provider_name: str = "sarvam"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or SARVAM_API_KEY

    async def speak(
        self,
        text: str,
        voiceProfile: Optional[VoiceProfile] = None,
    ) -> AsyncIterator[bytes]:
        """
        Calls Sarvam Bulbul v3 streaming API and yields chunked MP3 audio.
        """
        profile = voiceProfile or VoiceProfile()

        if not self.api_key:
            print("Warning: SARVAM_API_KEY not configured for TTS. Yielding empty audio stream.")
            return

        headers = {
            "api-subscription-key": self.api_key,
            "Content-Type": "application/json",
        }

        body = {
            "text": text,
            "target_language_code": profile.target_language_code,
            "model": "bulbul:v3",
            "speaker": profile.speaker,
            "pace": profile.pace,
            "temperature": profile.temperature,
            "enable_preprocessing": profile.enable_preprocessing,
            "output_audio_codec": profile.output_audio_codec or "mp3",
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                async with client.stream("POST", SARVAM_STREAM_TTS_URL, headers=headers, json=body) as response:
                    if response.status_code == 200:
                        async for chunk in response.aiter_bytes():
                            if chunk:
                                yield chunk
                    else:
                        error_body = await response.aread()
                        print(f"Sarvam Stream TTS error ({response.status_code}): {error_body.decode('utf-8', errors='ignore')}")
        except Exception as e:
            print(f"Sarvam TTS streaming exception: {e}")


class WebSpeechTTSProvider(TTSProvider):
    """
    Optional development-only fallback provider using the browser's native Web Speech API.
    Enabled only when ENABLE_WEBSPEECH_FALLBACK=true.
    """
    provider_name: str = "webspeech"

    async def speak(
        self,
        text: str,
        voiceProfile: Optional[VoiceProfile] = None,
    ) -> AsyncIterator[bytes]:
        """Web Speech API executes client-side."""
        if False:
            yield b""


def get_tts_provider(provider_name: Optional[str] = None) -> TTSProvider:
    """
    Factory returning the active TTSProvider instance.
    Sarvam is the sole production provider (VOICE_TTS_PROVIDER=sarvam).
    WebSpeech is only available if explicitly enabled via ENABLE_WEBSPEECH_FALLBACK.
    """
    selected = (provider_name or VOICE_TTS_PROVIDER or "sarvam").strip().lower()

    if selected == "webspeech" and ENABLE_WEBSPEECH_FALLBACK:
        return WebSpeechTTSProvider()

    return SarvamTTSProvider()
