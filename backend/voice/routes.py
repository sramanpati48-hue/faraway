"""
FastAPI Routes for NyaySahayak Voice Moderator, LiveKit Voice Sessions,
and Moderator/Admin Voice Audit Logs.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Request, Depends, UploadFile, File, Form, Query, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.voice.config import (
    get_livekit_server_url,
    is_livekit_configured,
    is_sarvam_configured,
    VOICE_STT_PROVIDER,
    VOICE_TTS_PROVIDER,
)
from backend.voice.token_service import create_case_voice_token, format_room_name
from backend.voice.agent import initialize_voice_agent, VoiceModeratorAgentWorker, ConversationState
from backend.voice.database import (
    get_voice_sessions_by_case,
    persist_voice_session,
    complete_voice_session_record,
    get_all_voice_sessions_audit,
    get_voice_session_audit_detail,
)
from backend.voice.tts_service import (
    get_tts_provider,
    get_voice_profile_for_risk_flags,
    VoiceProfile,
)

router = APIRouter(tags=["voice-session"])

# In-memory active workers keyed by case_id for active sessions
_active_workers: Dict[str, VoiceModeratorAgentWorker] = {}


class VoiceSessionRequest(BaseModel):
    case_id: str = Field(..., description="Target Case ID for the voice session")
    user_id: Optional[str] = Field(None, description="Citizen/User UID")
    session_id: Optional[str] = Field(None, description="Chat session ID")
    user_name: Optional[str] = Field("Citizen", description="Citizen display name")
    context_building: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Step 4 context building result object")
    transcript: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Existing chat transcript")


class VoiceTurnRequest(BaseModel):
    user_text: str = Field(..., description="User transcript/utterance")


class VoiceTTSRequest(BaseModel):
    text: str = Field(..., description="Text to synthesize using Sarvam Bulbul v3")
    case_id: Optional[str] = Field(None, description="Optional Case ID to derive risk flags and voice profile")
    is_sensitive: Optional[bool] = Field(False, description="Whether to use calm, slower-paced sensitive voice profile (pace=0.85)")
    target_language_code: Optional[str] = Field("en-IN", description="Target BCP-47 language (en-IN, hi-IN, bn-IN)")
    voice_profile: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Optional custom voice profile overrides")


@router.post("/api/voice-session")
@router.get("/api/voice-session")
async def get_or_create_voice_session(
    payload: Optional[VoiceSessionRequest] = None,
    case_id: Optional[str] = None,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
):
    """
    Creates or retrieves a LiveKit voice session scoped to `case_id`.
    Embeds existing transcript and context building result into the voice agent's initial state
    so the AI Voice Moderator does not ask the user to repeat themselves.
    """
    raw_case_id = payload.case_id if payload and payload.case_id else case_id or ""
    target_case_id = str(raw_case_id).strip()
    if not target_case_id:
        raise HTTPException(status_code=400, detail="case_id is required to create a voice session")

    print(f"[Voice Session] Request received for case_id={target_case_id}")

    raw_user_id = payload.user_id if payload and payload.user_id else user_id or ""
    target_user_id = str(raw_user_id).strip() or None

    raw_session_id = payload.session_id if payload and payload.session_id else session_id or ""
    target_session_id = str(raw_session_id).strip() or None

    ctx_building = payload.context_building if payload and payload.context_building else {}
    transcript_list = payload.transcript if payload and payload.transcript else []

    # If context or transcript was not passed in request body, retrieve from database
    if not ctx_building or not transcript_list:
        try:
            from backend.database.supabase_case_enhance import get_case_complete
            case_record = get_case_complete(target_case_id)
            if case_record:
                if not target_user_id:
                    target_user_id = case_record.get("user_id")
                if not target_session_id:
                    target_session_id = case_record.get("session_id")
                
                # Extract context building result
                structured_report = case_record.get("structured_report") or {}
                if not ctx_building:
                    ctx_building = (
                        case_record.get("context_building")
                        or structured_report.get("context_building")
                        or {
                            "context_building_confidence_score": case_record.get("context_building_confidence_score") or structured_report.get("context_building_confidence_score", 0.6),
                            "risk_flags": case_record.get("risk_flags") or structured_report.get("risk_flags", []),
                            "threat_level_assessment": case_record.get("threat_level_assessment") or structured_report.get("threat_level_assessment"),
                            "summary": structured_report.get("summary", ""),
                            "incident_type": structured_report.get("incident_type", "General"),
                        }
                    )
                if not transcript_list:
                    transcript_list = case_record.get("session_data") or []
        except Exception as e:
            print(f"Notice: loading case record for voice session: {e}")

    # Generate LiveKit Token scoped to case_id
    token_data = create_case_voice_token(
        case_id=target_case_id,
        user_id=target_user_id,
        user_name=payload.user_name if payload else "Citizen",
        transcript=transcript_list,
        context_building=ctx_building,
    )

    # Initialize AI Voice Moderator Worker primed with case context
    worker = initialize_voice_agent(
        case_id=target_case_id,
        user_id=target_user_id,
        session_id=target_session_id,
        context_building=ctx_building,
        transcript=transcript_list,
    )
    _active_workers[target_case_id] = worker

    return {
        "status": "success",
        "case_id": target_case_id,
        "room_name": token_data["room_name"],
        "server_url": token_data["server_url"],
        "token": token_data["token"],
        "participant_identity": token_data["participant_identity"],
        "agent_status": "ready",
        "context_building": ctx_building,
        "confidence_score": worker.state.confidence_score,
        "voice_session_id": worker.state.voice_session_id,
        "livekit_configured": token_data["livekit_configured"],
        "stt_provider": VOICE_STT_PROVIDER,
        "tts_provider": VOICE_TTS_PROVIDER,
        "sarvam_configured": is_sarvam_configured(),
        "voice_profile": worker.state.get_voice_profile(),
    }


@router.post("/api/voice-session/{case_id}/turn")
async def voice_session_turn(case_id: str, payload: VoiceTurnRequest):
    """
    Processes a user speech turn through the cooperating VerificationAgent,
    SupportAgent, and EscalationAgent sub-agents.
    """
    worker = _active_workers.get(case_id)
    if not worker:
        worker = initialize_voice_agent(case_id=case_id)
        _active_workers[case_id] = worker

    result = await worker.process_user_turn(payload.user_text)
    return {
        "status": "success",
        "case_id": case_id,
        **result,
    }


@router.post("/api/voice-session/{case_id}/audio-turn")
async def voice_session_audio_turn(
    case_id: str,
    file: UploadFile = File(...),
    language: str = Form("en-IN"),
):
    """
    Processes audio bytes using Sarvam Saaras v3 STT and runs the sub-agent reasoning turn.
    """
    worker = _active_workers.get(case_id)
    if not worker:
        worker = initialize_voice_agent(case_id=case_id)
        _active_workers[case_id] = worker

    audio_bytes = await file.read()
    if not audio_bytes or len(audio_bytes) < 500:
        raise HTTPException(
            status_code=400,
            detail="Audio payload is empty or too short. Please speak clearly into the microphone."
        )

    print(
        f"[Voice Route] Audio turn for case_id={case_id}, bytes={len(audio_bytes)}, "
        f"content_type={file.content_type}, lang={language}"
    )

    result = await worker.process_audio_turn(
        audio_bytes,
        mime_type=file.content_type or "audio/webm",
        language=language,
    )
    return {
        "status": result.get("status", "success"),
        "case_id": case_id,
        **result,
    }


@router.post("/api/voice-session/{case_id}/tts")
@router.post("/api/voice-session/tts")
async def voice_session_tts(
    payload: VoiceTTSRequest,
    case_id: Optional[str] = None,
):
    """
    Synthesizes speech using Sarvam Bulbul v3 TTS.
    Returns streaming audio/mpeg from Sarvam streaming endpoint.
    """
    target_case_id = payload.case_id or case_id
    worker = _active_workers.get(target_case_id) if target_case_id else None

    # Derive voice profile
    lang_hint = payload.target_language_code or "en-IN"
    if worker:
        profile_dict = worker.state.get_voice_profile()
        profile = VoiceProfile(**{k: v for k, v in profile_dict.items() if hasattr(VoiceProfile, k)})
    elif payload.is_sensitive:
        profile = get_voice_profile_for_risk_flags(["sensitive"], language_hint=lang_hint)
    else:
        profile = get_voice_profile_for_risk_flags([], language_hint=lang_hint)

    # Apply custom overrides if provided
    if payload.voice_profile:
        for k, v in payload.voice_profile.items():
            if hasattr(profile, k) and v is not None:
                setattr(profile, k, v)

    tts_provider = get_tts_provider()

    if tts_provider.provider_name == "sarvam":
        audio_stream = tts_provider.speak(payload.text, profile)
        return StreamingResponse(audio_stream, media_type="audio/mpeg")

    # WebSpeech / dev fallback: return client instruction with voice profile parameters
    return {
        "status": "success",
        "provider": "webspeech",
        "text": payload.text,
        "voice_profile": profile.to_dict(),
        "instruction": "Use browser SpeechSynthesis with provided voice_profile parameters",
    }


@router.post("/api/voice-session/{case_id}/complete")
async def complete_voice_session(case_id: str):
    """
    Marks the voice session completed and updates the case record with refined insights.
    """
    worker = _active_workers.get(case_id)
    if worker:
        worker.state.resolution_status = "completed"
        worker._persist_current_state()
        complete_voice_session_record(worker.state.voice_session_id)
        state_dict = worker.state.to_dict()
    else:
        state_dict = {}

    return {
        "status": "success",
        "case_id": case_id,
        "message": "Voice session completed and case context updated",
        "state": state_dict,
    }


@router.get("/api/voice-session/{case_id}/history")
async def get_voice_history(case_id: str):
    """Retrieves all voice session records for a case."""
    sessions = get_voice_sessions_by_case(case_id)
    return {
        "status": "success",
        "case_id": case_id,
        "sessions": sessions,
    }


# ── Moderator & Admin Read-Only Audit Endpoints ───────────────────────────────

def _get_auth_dep():
    """Helper to lazily import auth dependencies without circular imports."""
    try:
        from backend.database.auth_middleware import require_roles
        return require_roles("moderator", "admin", "super_admin")
    except Exception:
        async def _dummy():
            return {"role": "admin"}
        return _dummy


@router.get("/api/moderator/voice-audit")
@router.get("/api/admin/voice-audit")
async def get_moderator_voice_audit_list(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(_get_auth_dep()),
):
    """
    Retrieves a list of voice sessions for the Moderator/Admin Audit Panel.
    Restricted to moderator and admin roles.
    """
    try:
        sessions = get_all_voice_sessions_audit(limit=limit, offset=offset, requesting_user=user)
        return {
            "status": "success",
            "count": len(sessions),
            "sessions": sessions,
        }
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except Exception as e:
        print(f"Error fetching voice audit list: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch voice audit records: {e}")


@router.get("/api/moderator/voice-audit/{session_id}")
@router.get("/api/admin/voice-audit/{session_id}")
async def get_moderator_voice_audit_detail(
    session_id: str,
    user: dict = Depends(_get_auth_dep()),
):
    """
    Retrieves full audit data (transcript, agent decision log, confidence history, escalation state)
    for a specific voice session.
    Restricted to moderator and admin roles.
    Never exposes internal prompts or secrets.
    """
    try:
        detail = get_voice_session_audit_detail(session_id, requesting_user=user)
        if not detail:
            raise HTTPException(status_code=404, detail="Voice session audit record not found")
        return {
            "status": "success",
            "session": detail,
        }
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching voice audit detail: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch voice session detail: {e}")
