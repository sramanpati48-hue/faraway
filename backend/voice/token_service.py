"""
LiveKit Token Service for NyaySahayak Voice Moderator.
Generates access tokens scoped strictly to a specific `case_id`.
"""
import json
import time
import uuid
from typing import Any, Dict, List, Optional
import jwt

from backend.voice.config import (
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    get_livekit_server_url,
    is_livekit_configured,
)

def format_room_name(case_id: str) -> str:
    """Formats room name consistently scoped to the case_id."""
    clean_id = str(case_id).strip()
    return f"case_{clean_id}" if not clean_id.startswith("case_") else clean_id

def create_case_voice_token(
    case_id: str,
    user_id: Optional[str] = None,
    user_name: Optional[str] = "Citizen",
    transcript: Optional[List[Dict[str, Any]]] = None,
    context_building: Optional[Dict[str, Any]] = None,
    ttl_seconds: int = 3600,
) -> Dict[str, Any]:
    """
    Creates a LiveKit access token scoped to the case_id room.
    Embeds initial case transcript and context building results in metadata
    so the AI Voice Moderator is instantly primed on the user's situation.
    """
    room_name = format_room_name(case_id)
    clean_user_id = str(user_id or uuid.uuid4().hex[:8]).strip()
    clean_case_id = str(case_id).strip()
    participant_identity = f"user_{clean_user_id[:8]}_{clean_case_id[:8]}"
    
    metadata = {
        "case_id": clean_case_id,
        "user_id": user_id,
        "participant_role": "user",
        "context_building": context_building or {},
        "transcript_count": len(transcript or []),
        "created_at": time.time(),
    }
    metadata_json = json.dumps(metadata)

    api_key = LIVEKIT_API_KEY or "devkey"
    api_secret = LIVEKIT_API_SECRET or "secret"

    token_str = ""

    # 1. Attempt using official livekit.api SDK
    try:
        from livekit import api

        grants = api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
        )

        lk_token = (
            api.AccessToken(api_key, api_secret)
            .with_identity(participant_identity)
            .with_name(user_name or "Citizen")
            .with_grants(grants)
            .with_metadata(metadata_json)
            .with_ttl(ttl_seconds)
        )
        token_str = lk_token.to_jwt()
    except Exception as e:
        # 2. Robust PyJWT Fallback
        now = int(time.time())
        payload = {
            "iss": api_key,
            "sub": participant_identity,
            "name": user_name or "Citizen",
            "nbf": now - 5,
            "exp": now + ttl_seconds,
            "video": {
                "room": room_name,
                "roomJoin": True,
                "canPublish": True,
                "canSubscribe": True,
                "canPublishData": True,
            },
            "metadata": metadata_json,
        }
        token_str = jwt.encode(payload, api_secret, algorithm="HS256")

    server_url = get_livekit_server_url()
    print(f"[Voice Session] Token minted: room={room_name}, participant={participant_identity}")

    return {
        "status": "success",
        "token": token_str,
        "server_url": server_url,
        "room_name": room_name,
        "case_id": clean_case_id,
        "participant_identity": participant_identity,
        "metadata": metadata,
        "livekit_configured": is_livekit_configured(),
    }


def create_agent_voice_token(
    case_id: str,
    agent_name: str = "NyaySahayak Voice Moderator",
    ttl_seconds: int = 7200,
) -> str:
    """Generates an access token for the AI Voice Moderator participant."""
    room_name = format_room_name(case_id)
    agent_identity = f"agent_moderator_{case_id}"
    api_key = LIVEKIT_API_KEY or "devkey"
    api_secret = LIVEKIT_API_SECRET or "secret"

    now = int(time.time())
    payload = {
        "iss": api_key,
        "sub": agent_identity,
        "name": agent_name,
        "nbf": now - 5,
        "exp": now + ttl_seconds,
        "video": {
            "room": room_name,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
            "agent": True,
        },
        "metadata": json.dumps({"role": "voice_moderator", "case_id": case_id}),
    }
    return jwt.encode(payload, api_secret, algorithm="HS256")
