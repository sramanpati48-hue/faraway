"""
NyaySahayak Voice Moderator Module.
Provides LiveKit-based real-time voice moderation for the New Case flow.
"""

from backend.voice.routes import router as voice_router

__all__ = ["voice_router"]
