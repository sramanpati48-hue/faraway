"""
Voice Sessions Database Layer.
Provides durable, incremental persistence and access-controlled audit queries
for the `voice_sessions` PostgreSQL/Supabase table.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv

load_dotenv()

from backend.database.postgres_pool import execute, execute_one, execute_void, is_postgres_configured

_supabase = None
if not is_postgres_configured():
    try:
        from supabase import create_client
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_ANON_KEY")
        if url and key:
            _supabase = create_client(url, key)
    except Exception as e:
        print(f"Warning: voice database Supabase init fallback failed: {e}")


class VoiceSchemaMissingError(RuntimeError):
    """Raised when voice_sessions table is missing in production and migration has not been applied."""
    pass


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {}, default=str)


def _json_list(value: Any) -> str:
    return json.dumps(value if value is not None else [], default=str)


_schema_verified = False


def is_runtime_schema_setup_allowed() -> bool:
    """
    Returns True ONLY if runtime DDL schema setup is explicitly enabled for development/tests.
    Defaults to False in production.
    """
    val = os.getenv("ALLOW_RUNTIME_SCHEMA_SETUP", "false").strip().lower()
    return val in ("1", "true", "yes", "on")


def check_voice_sessions_schema_readiness() -> None:
    """
    Lightweight schema readiness check.
    In production (default): Verifies public.voice_sessions exists. If missing, raises VoiceSchemaMissingError.
    In dev/test mode (when ALLOW_RUNTIME_SCHEMA_SETUP=true): Auto-creates table and logs warning.
    """
    global _schema_verified
    if _schema_verified:
        return

    if not is_postgres_configured():
        return

    try:
        row = execute_one("SELECT to_regclass('public.voice_sessions') AS tbl;")
        exists = bool(row and row.get("tbl"))
        if exists:
            _schema_verified = True
            return

        if is_runtime_schema_setup_allowed():
            print("[warn] ALLOW_RUNTIME_SCHEMA_SETUP is enabled: applying development voice_sessions schema at runtime.")
            _setup_runtime_schema_for_dev()
            _schema_verified = True
            return

        error_msg = (
            "Database table 'public.voice_sessions' does not exist. "
            "Runtime DDL schema creation is disabled in production. "
            "Please apply migration 'backend/database/migrations/040_voice_sessions_audit.sql'."
        )
        print(f"[error] {error_msg}")
        raise VoiceSchemaMissingError(error_msg)

    except VoiceSchemaMissingError:
        raise
    except Exception as e:
        if is_runtime_schema_setup_allowed():
            print(f"[warn] Schema check failed, attempting dev setup: {e}")
            _setup_runtime_schema_for_dev()
            _schema_verified = True
        else:
            print(f"[error] Voice sessions schema check error: {e}")
            raise VoiceSchemaMissingError(
                f"Failed to verify voice_sessions schema: {e}. "
                "Ensure migration 040_voice_sessions_audit.sql is applied."
            ) from e


def _setup_runtime_schema_for_dev() -> None:
    """DDL creation exclusively for development and tests when ALLOW_RUNTIME_SCHEMA_SETUP=true."""
    execute_void(
        """
        CREATE TABLE IF NOT EXISTS voice_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            case_id TEXT NOT NULL,
            user_id TEXT,
            session_id TEXT,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ,
            full_transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
            confidence_score_history JSONB NOT NULL DEFAULT '[]'::jsonb,
            risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
            resolution_status TEXT NOT NULL DEFAULT 'in_progress',
            escalation_reason TEXT,
            agent_decision_log JSONB NOT NULL DEFAULT '[]'::jsonb,
            threat_level TEXT,
            escalated BOOLEAN NOT NULL DEFAULT FALSE,
            confidence_score FLOAT,
            conversation_state JSONB NOT NULL DEFAULT '{}'::jsonb,
            handoff_packet JSONB NOT NULL DEFAULT '{}'::jsonb,
            transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_voice_sessions_case_id ON voice_sessions(case_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_voice_sessions_user_id ON voice_sessions(user_id) WHERE user_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_voice_sessions_status ON voice_sessions(resolution_status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_voice_sessions_started_at ON voice_sessions(started_at DESC);
        """
    )


# Alias for backward compatibility
ensure_voice_sessions_table = check_voice_sessions_schema_readiness


def create_voice_session_record(
    case_id: str,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    risk_flags: Optional[List[str]] = None,
    initial_confidence: Optional[float] = 0.5,
    threat_level: Optional[str] = None,
    voice_session_id: Optional[str] = None,
    initial_greeting: Optional[str] = None,
) -> str:
    """
    Creates a new durable voice session record at session start.
    Initializes transcript and confidence history.
    """
    check_voice_sessions_schema_readiness()
    vs_id = voice_session_id or str(uuid.uuid4())
    uid = str(user_id).strip() if user_id and str(user_id).strip() else None

    initial_transcript = []
    if initial_greeting:
        initial_transcript.append({
            "role": "assistant",
            "text": initial_greeting,
            "agent": "VoiceModerator",
            "timestamp": datetime.now().timestamp(),
        })

    initial_conf_history = [{
        "score": initial_confidence or 0.5,
        "turn": 0,
        "timestamp": datetime.now().timestamp(),
    }]

    if is_postgres_configured():
        try:
            execute_void(
                """
                INSERT INTO voice_sessions (
                    id, case_id, user_id, session_id, started_at, resolution_status,
                    confidence_score, confidence_score_history, escalated, threat_level,
                    risk_flags, full_transcript, transcript, agent_decision_log,
                    conversation_state, handoff_packet, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, now(), 'in_progress',
                    %s, %s::jsonb, false, %s,
                    %s::jsonb, %s::jsonb, %s::jsonb, '[]'::jsonb,
                    '{}'::jsonb, '{}'::jsonb, now(), now()
                )
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    vs_id,
                    case_id,
                    uid,
                    session_id,
                    initial_confidence,
                    _json_list(initial_conf_history),
                    threat_level,
                    _json_list(risk_flags),
                    _json_list(initial_transcript),
                    _json_list(initial_transcript),
                ),
            )
            return vs_id
        except Exception as e:
            print(f"Error creating voice session record (postgres): {e}")

    if _supabase:
        try:
            data = {
                "id": vs_id,
                "case_id": case_id,
                "user_id": uid,
                "session_id": session_id,
                "started_at": datetime.now().isoformat(),
                "resolution_status": "in_progress",
                "confidence_score": initial_confidence,
                "confidence_score_history": initial_conf_history,
                "escalated": False,
                "threat_level": threat_level,
                "risk_flags": risk_flags or [],
                "full_transcript": initial_transcript,
                "transcript": initial_transcript,
                "agent_decision_log": [],
                "conversation_state": {},
                "handoff_packet": {},
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
            }
            _supabase.table("voice_sessions").upsert(data).execute()
            return vs_id
        except Exception as e:
            print(f"Error creating voice session record (supabase): {e}")

    return vs_id


def persist_voice_session(
    case_id: str,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    resolution_status: str = "in_progress",
    confidence_score: Optional[float] = None,
    escalated: bool = False,
    threat_level: Optional[str] = None,
    risk_flags: Optional[List[str]] = None,
    conversation_state: Optional[Dict[str, Any]] = None,
    transcript: Optional[List[Dict[str, Any]]] = None,
    handoff_packet: Optional[Dict[str, Any]] = None,
    voice_session_id: Optional[str] = None,
    agent_decision_log: Optional[List[Dict[str, Any]]] = None,
    confidence_score_history: Optional[List[Dict[str, Any]]] = None,
    escalation_reason: Optional[str] = None,
    ended_at: Optional[datetime] = None,
) -> Optional[str]:
    """
    Incrementally updates/persists voice session state after each turn.
    Preserves partial data even if a call disconnects or encounters an error.
    Does NOT store raw audio; stores transcript and structured decision log only.
    """
    check_voice_sessions_schema_readiness()
    vs_id = voice_session_id or str(uuid.uuid4())
    uid = str(user_id).strip() if user_id and str(user_id).strip() else None

    # Derive decision_log from state if not passed directly
    decision_log = agent_decision_log
    if decision_log is None and conversation_state and isinstance(conversation_state, dict):
        decision_log = conversation_state.get("decision_log") or []

    # Derive confidence history if not passed directly
    conf_history = confidence_score_history
    if conf_history is None and conversation_state and isinstance(conversation_state, dict):
        conf_history = conversation_state.get("confidence_score_history")

    # Derive escalation reason if not passed directly
    esc_reason = escalation_reason
    if not esc_reason and handoff_packet and isinstance(handoff_packet, dict):
        esc_reason = handoff_packet.get("escalation_reason")

    if is_postgres_configured():
        try:
            execute_void(
                """
                INSERT INTO voice_sessions (
                    id, case_id, user_id, session_id, started_at, ended_at,
                    resolution_status, confidence_score, confidence_score_history,
                    escalated, escalation_reason, threat_level, risk_flags,
                    conversation_state, full_transcript, transcript,
                    agent_decision_log, handoff_packet, updated_at
                ) VALUES (
                    %s, %s, %s, %s, now(), %s,
                    %s, %s, %s::jsonb,
                    %s, %s, %s, %s::jsonb,
                    %s::jsonb, %s::jsonb, %s::jsonb,
                    %s::jsonb, %s::jsonb, now()
                )
                ON CONFLICT (id) DO UPDATE SET
                    ended_at = COALESCE(EXCLUDED.ended_at, voice_sessions.ended_at),
                    resolution_status = EXCLUDED.resolution_status,
                    confidence_score = EXCLUDED.confidence_score,
                    confidence_score_history = CASE 
                        WHEN EXCLUDED.confidence_score_history IS NOT NULL AND jsonb_array_length(EXCLUDED.confidence_score_history) > 0 
                        THEN EXCLUDED.confidence_score_history 
                        ELSE voice_sessions.confidence_score_history 
                    END,
                    escalated = EXCLUDED.escalated,
                    escalation_reason = COALESCE(EXCLUDED.escalation_reason, voice_sessions.escalation_reason),
                    threat_level = EXCLUDED.threat_level,
                    risk_flags = EXCLUDED.risk_flags,
                    conversation_state = EXCLUDED.conversation_state,
                    full_transcript = EXCLUDED.full_transcript,
                    transcript = EXCLUDED.transcript,
                    agent_decision_log = EXCLUDED.agent_decision_log,
                    handoff_packet = EXCLUDED.handoff_packet,
                    updated_at = now()
                """,
                (
                    vs_id,
                    case_id,
                    uid,
                    session_id,
                    ended_at,
                    resolution_status,
                    confidence_score,
                    _json_list(conf_history or []),
                    escalated,
                    esc_reason,
                    threat_level,
                    _json_list(risk_flags),
                    _json(conversation_state),
                    _json_list(transcript),
                    _json_list(transcript),
                    _json_list(decision_log or []),
                    _json(handoff_packet),
                ),
            )
            return vs_id
        except Exception as e:
            print(f"Error persisting voice session (postgres): {e}")

    if _supabase:
        try:
            data = {
                "id": vs_id,
                "case_id": case_id,
                "user_id": uid,
                "session_id": session_id,
                "resolution_status": resolution_status,
                "confidence_score": confidence_score,
                "confidence_score_history": conf_history or [],
                "escalated": escalated,
                "escalation_reason": esc_reason,
                "threat_level": threat_level,
                "risk_flags": risk_flags or [],
                "conversation_state": conversation_state or {},
                "full_transcript": transcript or [],
                "transcript": transcript or [],
                "agent_decision_log": decision_log or [],
                "handoff_packet": handoff_packet or {},
                "updated_at": datetime.now().isoformat(),
            }
            if ended_at:
                data["ended_at"] = ended_at.isoformat()
            _supabase.table("voice_sessions").upsert(data).execute()
            return vs_id
        except Exception as e:
            print(f"Error persisting voice session (supabase): {e}")

    return vs_id


def complete_voice_session_record(voice_session_id: str) -> bool:
    """Marks a voice session cleanly completed and sets ended_at."""
    check_voice_sessions_schema_readiness()
    if is_postgres_configured():
        try:
            execute_void(
                """
                UPDATE voice_sessions
                SET ended_at = now(),
                    resolution_status = CASE WHEN resolution_status = 'in_progress' THEN 'completed' ELSE resolution_status END,
                    updated_at = now()
                WHERE id = %s::uuid OR id::text = %s
                """,
                (voice_session_id, voice_session_id),
            )
            return True
        except Exception as e:
            print(f"Error completing voice session record (postgres): {e}")
            return False

    if _supabase:
        try:
            _supabase.table("voice_sessions").update({
                "ended_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
            }).eq("id", voice_session_id).execute()
            return True
        except Exception as e:
            print(f"Error completing voice session record (supabase): {e}")
            return False

    return False


def get_voice_sessions_by_case(
    case_id: str,
    requesting_user: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Retrieves all voice sessions for a case.
    Enforces access control:
      - Moderators / Admins / Super Admins can access any case's sessions.
      - Case owners can access only their own sessions.
    """
    check_voice_sessions_schema_readiness()

    # If requesting_user is provided, verify authorization
    if requesting_user:
        role = str(requesting_user.get("role") or "").lower()
        req_uid = str(requesting_user.get("id") or requesting_user.get("uid") or "").strip()
        is_mod_or_admin = role in ("moderator", "admin", "super_admin")

        if not is_mod_or_admin:
            # Check case ownership from cases table
            try:
                from backend.database.supabase_case_enhance import get_case_complete
                case_record = get_case_complete(case_id)
                case_owner_id = str((case_record or {}).get("user_id") or "").strip()
                if case_owner_id and case_owner_id != req_uid:
                    raise PermissionError("Forbidden: You do not have permission to access this case's voice sessions.")
            except PermissionError:
                raise
            except Exception as e:
                print(f"Notice during voice session case owner check: {e}")

    if is_postgres_configured():
        try:
            rows = execute(
                """
                SELECT 
                    id, case_id, user_id, session_id, started_at, ended_at,
                    full_transcript, confidence_score_history, risk_flags,
                    resolution_status, escalation_reason, agent_decision_log,
                    confidence_score, escalated, threat_level, created_at, updated_at
                FROM voice_sessions
                WHERE case_id = %s
                ORDER BY created_at DESC
                """,
                (case_id,),
            )
            return rows
        except Exception as e:
            print(f"Error fetching voice sessions: {e}")
            return []

    if _supabase:
        try:
            res = _supabase.table("voice_sessions").select("*").eq("case_id", case_id).order("created_at", desc=True).execute()
            return res.data or []
        except Exception as e:
            print(f"Error fetching voice sessions from supabase: {e}")
            return []

    return []


def get_all_voice_sessions_audit(
    limit: int = 50,
    offset: int = 0,
    requesting_user: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Retrieves a list of voice sessions for the Moderator/Admin Audit Panel.
    Restricted to moderator/admin roles.
    """
    check_voice_sessions_schema_readiness()
    if requesting_user:
        role = str(requesting_user.get("role") or "").lower()
        if role not in ("moderator", "admin", "super_admin"):
            raise PermissionError("Forbidden: Moderator/Admin privileges required to view voice session audits.")

    if is_postgres_configured():
        try:
            rows = execute(
                """
                SELECT 
                    vs.id, vs.case_id, vs.user_id, vs.session_id,
                    vs.started_at, vs.ended_at, vs.resolution_status,
                    vs.confidence_score, vs.escalated, vs.escalation_reason,
                    vs.risk_flags, vs.threat_level,
                    jsonb_array_length(vs.full_transcript) AS transcript_turns,
                    jsonb_array_length(vs.agent_decision_log) AS decision_count,
                    vs.created_at, vs.updated_at,
                    COALESCE(c.structured_report->>'incident_type', 'Legal Case') AS incident_type,
                    COALESCE(c.structured_report->>'summary', '') AS case_summary
                FROM voice_sessions vs
                LEFT JOIN cases c ON c.id = vs.case_id
                ORDER BY vs.started_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset),
            )
            return rows
        except Exception as e:
            print(f"Error querying voice audit sessions: {e}")
            return []

    if _supabase:
        try:
            res = _supabase.table("voice_sessions").select("*").order("started_at", desc=True).range(offset, offset + limit - 1).execute()
            return res.data or []
        except Exception as e:
            print(f"Error querying voice audit sessions from supabase: {e}")
            return []

    return []


def get_voice_session_audit_detail(
    voice_session_id: str,
    requesting_user: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Retrieves full audit details (transcript and agent_decision_log) for a specific session.
    Restricted to moderator/admin roles. Never exposes model prompts or API keys.
    """
    check_voice_sessions_schema_readiness()
    if requesting_user:
        role = str(requesting_user.get("role") or "").lower()
        if role not in ("moderator", "admin", "super_admin"):
            raise PermissionError("Forbidden: Moderator/Admin privileges required to view voice session audit details.")

    if is_postgres_configured():
        try:
            row = execute_one(
                """
                SELECT 
                    vs.id, vs.case_id, vs.user_id, vs.session_id,
                    vs.started_at, vs.ended_at, vs.resolution_status,
                    vs.confidence_score, vs.confidence_score_history,
                    vs.escalated, vs.escalation_reason, vs.risk_flags,
                    vs.threat_level, vs.full_transcript, vs.agent_decision_log,
                    vs.handoff_packet, vs.created_at, vs.updated_at,
                    COALESCE(c.structured_report->>'incident_type', 'Legal Case') AS incident_type,
                    COALESCE(c.structured_report->>'summary', '') AS case_summary
                FROM voice_sessions vs
                LEFT JOIN cases c ON c.id = vs.case_id
                WHERE vs.id = %s::uuid OR vs.id::text = %s
                LIMIT 1
                """,
                (voice_session_id, voice_session_id),
            )
            return row
        except Exception as e:
            print(f"Error querying voice session audit detail: {e}")
            return None

    if _supabase:
        try:
            res = _supabase.table("voice_sessions").select("*").eq("id", voice_session_id).single().execute()
            return res.data
        except Exception as e:
            print(f"Error querying voice session audit detail from supabase: {e}")
            return None

    return None
