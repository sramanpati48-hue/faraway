"""
Configuration for LiveKit Voice Moderator and Sarvam AI Voice (STT & TTS) services.
Uses environment variables (never hardcoded credentials).
"""
import os
from dotenv import load_dotenv
from backend.paths import REPO_ROOT

load_dotenv()
load_dotenv(dotenv_path=REPO_ROOT / ".env")
load_dotenv(dotenv_path=REPO_ROOT / "backend" / "agents" / ".env")

# LiveKit Cloud configuration (Free Tier)
LIVEKIT_URL = (os.getenv("LIVEKIT_URL") or os.getenv("NEXT_PUBLIC_LIVEKIT_URL") or "").strip()
LIVEKIT_API_KEY = (os.getenv("LIVEKIT_API_KEY") or "").strip()
LIVEKIT_API_SECRET = (os.getenv("LIVEKIT_API_SECRET") or "").strip()

# Sarvam AI STT & TTS configuration (sole production voice provider)
VOICE_STT_PROVIDER = (os.getenv("VOICE_STT_PROVIDER") or "sarvam").strip().lower()
VOICE_TTS_PROVIDER = (os.getenv("VOICE_TTS_PROVIDER") or "sarvam").strip().lower()

SARVAM_API_KEY = (os.getenv("SARVAM_API_KEY") or "").strip()

# Optional dev-only browser SpeechSynthesis fallback
ENABLE_WEBSPEECH_FALLBACK = (
    os.getenv("ENABLE_WEBSPEECH_FALLBACK", "false").strip().lower() in ("true", "1", "yes")
)


def is_livekit_configured() -> bool:
    """Checks if LiveKit credentials are available in environment."""
    return bool(LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET)


def get_livekit_server_url() -> str:
    """Returns the LiveKit URL or fallback mock URL."""
    return LIVEKIT_URL or "wss://nyaysahayak-voice.livekit.cloud"


def is_sarvam_configured() -> bool:
    """Checks if Sarvam AI API key is configured."""
    return bool(SARVAM_API_KEY)


def validate_voice_configuration():
    """Validates Sarvam voice provider configuration on startup."""
    if not is_sarvam_configured():
        print(
            "⚠️ [Voice Moderator] SARVAM_API_KEY is not configured in environment. "
            "Sarvam Saaras v3 STT and Bulbul v3 TTS will require SARVAM_API_KEY for live audio processing."
        )


# Validate configuration on module import
validate_voice_configuration()
