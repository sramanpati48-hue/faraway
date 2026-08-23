"""
Enhanced case management — Postgres-first with Supabase fallback.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

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
        print(f"Warning: case enhance Supabase init failed: {e}")


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {}, default=str)


def _json_list(value: Any) -> str:
    return json.dumps(value if value is not None else [], default=str)


def update_case_ai_verification_status(
    case_id: str,
    status: str,
    confidence_score: Optional[float] = None,
    source: Optional[str] = None,
    reason: Optional[str] = None,
) -> bool:
    """
    Update the AI verification status of a case and append an entry to transition audit history.
    Valid statuses: 'pending', 'verified', 'flagged', 'rejected'.
    Valid sources: 'text', 'voice', 'human_override'.
    """
    if not case_id:
        return False
    status_clean = str(status or "pending").strip().lower()
    if status_clean not in ("pending", "verified", "flagged", "rejected"):
        status_clean = "pending"
    source_clean = str(source).strip().lower() if source else None
    if source_clean and source_clean not in ("text", "voice", "human_override"):
        source_clean = "text"

    confidence_val = float(confidence_score) if confidence_score is not None else None
    transition_entry = {
        "status": status_clean,
        "confidence": confidence_val,
        "source": source_clean,
        "reason": str(reason) if reason else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if is_postgres_configured():
        try:
            execute_void(
                """
                UPDATE cases
                SET
                    ai_verification_status = %s,
                    ai_verification_confidence = COALESCE(%s, ai_verification_confidence),
                    verification_source = COALESCE(%s, verification_source),
                    verification_updated_at = now(),
                    ai_verification_reason = COALESCE(%s, ai_verification_reason),
                    ai_verification_history = COALESCE(ai_verification_history, '[]'::jsonb) || %s::jsonb,
                    structured_report = jsonb_set(
                        jsonb_set(
                            COALESCE(structured_report, '{}'::jsonb),
                            '{ai_verification_status}',
                            %s::jsonb,
                            true
                        ),
                        '{ai_verification_confidence}',
                        %s::jsonb,
                        true
                    ),
                    updated_at = now()
                WHERE id = %s
                """,
                (
                    status_clean,
                    confidence_val,
                    source_clean,
                    reason,
                    json.dumps([transition_entry]),
                    json.dumps(status_clean),
                    json.dumps(confidence_val),
                    case_id,
                ),
            )
            return True
        except Exception as e:
            print(f"❌ Error updating case AI verification status (postgres): {e}")
            return False

    if not _supabase:
        return False
    try:
        current = _supabase.table("cases").select("ai_verification_history, structured_report").eq("id", case_id).single().execute()
        history = (current.data or {}).get("ai_verification_history") or []
        if isinstance(history, str):
            try:
                history = json.loads(history)
            except Exception:
                history = []
        if not isinstance(history, list):
            history = []
        history.append(transition_entry)

        report = (current.data or {}).get("structured_report") or {}
        if isinstance(report, dict):
            report["ai_verification_status"] = status_clean
            if confidence_val is not None:
                report["ai_verification_confidence"] = confidence_val

        update_payload: Dict[str, Any] = {
            "ai_verification_status": status_clean,
            "verification_source": source_clean,
            "verification_updated_at": datetime.now(timezone.utc).isoformat(),
            "ai_verification_reason": reason,
            "ai_verification_history": history,
            "structured_report": report,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if confidence_val is not None:
            update_payload["ai_verification_confidence"] = confidence_val

        res = _supabase.table("cases").update(update_payload).eq("id", case_id).execute()
        return bool(res.data)
    except Exception as e:
        print(f"❌ Error updating case AI verification status (supabase): {e}")
        return False


def save_case_with_situation_summary(
    uid: str,
    case_id: str,
    session_id: str,
    structured_report: dict,
    situation_summary: dict,
    collected_answers: dict,
    session_data: list,
    pdf_url: Optional[str] = None,
    user_language: str = "english",
) -> bool:
    enriched_report = dict(structured_report or {})
    enriched_report["completion_context"] = {
        "session_id": session_id,
        "situation_summary": situation_summary or {},
        "collected_answers": collected_answers or {},
        "user_language": user_language,
        "has_answers": len(collected_answers or {}) > 0,
        "completed_at": datetime.now().isoformat(),
    }
    user_id = str(uid).strip() if uid and str(uid).strip() else None

    ai_status = enriched_report.get("ai_verification_status")
    ai_confidence = enriched_report.get("ai_verification_confidence")
    ai_source = enriched_report.get("verification_source") or ("text" if ai_status else None)
    ai_reason = enriched_report.get("ai_verification_reason")

    if is_postgres_configured():
        try:
            execute_void(
                """
                INSERT INTO cases (
                  id, user_id, session_id, structured_report, situation_summary, collected_answers,
                  session_data, pdf_url, pdf_updated_at, pdf_generated_at, user_language, status, has_answers,
                  ai_verification_status, ai_verification_confidence, verification_source, verification_updated_at, ai_verification_reason, timestamp
                ) VALUES (
                  %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s,
                  CASE WHEN %s IS NOT NULL THEN now() ELSE NULL END,
                  CASE WHEN %s IS NOT NULL THEN now() ELSE NULL END,
                  %s, 'completed', %s,
                  COALESCE(%s, 'pending'), %s, %s,
                  CASE WHEN %s IS NOT NULL THEN now() ELSE NULL END,
                  %s, now()
                )
                ON CONFLICT (id) DO UPDATE SET
                  user_id = EXCLUDED.user_id,
                  session_id = EXCLUDED.session_id,
                  structured_report = EXCLUDED.structured_report,
                  situation_summary = EXCLUDED.situation_summary,
                  collected_answers = EXCLUDED.collected_answers,
                  session_data = EXCLUDED.session_data,
                  pdf_url = COALESCE(EXCLUDED.pdf_url, cases.pdf_url),
                  pdf_updated_at = COALESCE(EXCLUDED.pdf_updated_at, cases.pdf_updated_at),
                  pdf_generated_at = COALESCE(EXCLUDED.pdf_generated_at, cases.pdf_generated_at),
                  user_language = EXCLUDED.user_language,
                  status = 'completed',
                  has_answers = EXCLUDED.has_answers,
                  ai_verification_status = COALESCE(EXCLUDED.ai_verification_status, cases.ai_verification_status, 'pending'),
                  ai_verification_confidence = COALESCE(EXCLUDED.ai_verification_confidence, cases.ai_verification_confidence),
                  verification_source = COALESCE(EXCLUDED.verification_source, cases.verification_source),
                  verification_updated_at = CASE WHEN EXCLUDED.ai_verification_status IS NOT NULL THEN now() ELSE cases.verification_updated_at END,
                  ai_verification_reason = COALESCE(EXCLUDED.ai_verification_reason, cases.ai_verification_reason),
                  updated_at = now()
                """,
                (
                    case_id,
                    user_id,
                    session_id,
                    _json(enriched_report),
                    _json(situation_summary or {}),
                    _json(collected_answers or {}),
                    _json_list(session_data),
                    pdf_url,
                    pdf_url,
                    pdf_url,
                    user_language,
                    len(collected_answers or {}) > 0,
                    ai_status,
                    ai_confidence,
                    ai_source,
                    ai_status,
                    ai_reason,
                ),
            )
            return True
        except Exception as e:
            print(f"❌ Error saving case with situation summary (postgres): {e}")
            return False

    if not _supabase:
        return False
    try:
        case_data: Dict[str, Any] = {
            "id": case_id,
            "session_id": session_id,
            "structured_report": enriched_report,
            "situation_summary": situation_summary or {},
            "collected_answers": collected_answers or {},
            "session_data": session_data,
            "pdf_url": pdf_url,
            "pdf_updated_at": datetime.now().isoformat() if pdf_url else None,
            "pdf_generated_at": datetime.now().isoformat() if pdf_url else None,
            "user_language": user_language,
            "status": "completed",
            "has_answers": len(collected_answers or {}) > 0,
            "user_id": user_id,
        }
        if ai_status:
            case_data["ai_verification_status"] = ai_status
            case_data["verification_source"] = ai_source
            case_data["verification_updated_at"] = datetime.now().isoformat()
            if ai_confidence is not None:
                case_data["ai_verification_confidence"] = ai_confidence
            if ai_reason:
                case_data["ai_verification_reason"] = ai_reason
        response = _supabase.table("cases").upsert(case_data, on_conflict="id").execute()
        return bool(response.data)
    except Exception as e:
        print(f"❌ Error saving case with situation summary: {e}")
        return False


def update_case_with_pdf(
    case_id: str,
    pdf_url: str,
    cloudinary_folder: Optional[str] = None,
    *,
    user_id: Optional[str] = None,
    structured_report: Optional[Dict[str, Any]] = None,
) -> bool:
    """Persist pdf_url on cases. Upserts a minimal row when the case does not exist yet."""
    if is_postgres_configured():
        try:
            rows = execute(
                """
                UPDATE cases
                SET pdf_url = %s, pdf_updated_at = now(), pdf_generated_at = now(),
                    cloudinary_path = %s, updated_at = now()
                WHERE id = %s
                RETURNING id
                """,
                (pdf_url, cloudinary_folder, case_id),
            )
            if rows:
                return True
            # Case row may not exist yet (report_agent only mints a UUID) — upsert minimal row.
            if user_id:
                execute_void(
                    """
                    INSERT INTO cases (
                      id, user_id, structured_report, session_data, pending,
                      pdf_url, pdf_updated_at, pdf_generated_at, cloudinary_path, timestamp
                    ) VALUES (
                      %s, %s, %s::jsonb, '[]'::jsonb, false,
                      %s, now(), now(), %s, now()
                    )
                    ON CONFLICT (id) DO UPDATE SET
                      pdf_url = EXCLUDED.pdf_url,
                      pdf_updated_at = now(),
                      pdf_generated_at = now(),
                      cloudinary_path = EXCLUDED.cloudinary_path,
                      updated_at = now()
                    """,
                    (
                        case_id,
                        user_id,
                        json.dumps(structured_report or {}, default=str),
                        pdf_url,
                        cloudinary_folder,
                    ),
                )
                return True
            print(f"⚠️ update_case_with_pdf: no row for {case_id} and no user_id to upsert")
            return False
        except Exception as e:
            print(f"❌ Error updating case PDF (postgres): {e}")
            return False
    if not _supabase:
        return False
    try:
        response = (
            _supabase.table("cases")
            .update(
                {
                    "pdf_url": pdf_url,
                    "pdf_updated_at": datetime.now().isoformat(),
                    "pdf_generated_at": datetime.now().isoformat(),
                    "cloudinary_path": cloudinary_folder,
                }
            )
            .eq("id", case_id)
            .execute()
        )
        if response.data:
            return True
        if user_id:
            _supabase.table("cases").upsert(
                {
                    "id": case_id,
                    "user_id": user_id,
                    "structured_report": structured_report or {},
                    "session_data": [],
                    "pending": False,
                    "pdf_url": pdf_url,
                    "pdf_updated_at": datetime.now().isoformat(),
                    "pdf_generated_at": datetime.now().isoformat(),
                    "cloudinary_path": cloudinary_folder,
                }
            ).execute()
            return True
        return False
    except Exception as e:
        print(f"❌ Error updating case PDF: {e}")
        return False


def get_case_complete(case_id: str) -> Optional[Dict[str, Any]]:
    if is_postgres_configured():
        try:
            return execute_one("SELECT * FROM cases WHERE id = %s LIMIT 1", (case_id,))
        except Exception as e:
            print(f"❌ Error retrieving complete case: {e}")
            return None
    if not _supabase:
        return None
    try:
        response = _supabase.table("cases").select("*").eq("id", case_id).single().execute()
        return response.data
    except Exception as e:
        print(f"❌ Error retrieving complete case: {e}")
        return None


def get_user_cases_complete(uid: str):
    if is_postgres_configured():
        try:
            return execute("SELECT * FROM cases WHERE user_id = %s ORDER BY timestamp DESC", (uid,))
        except Exception as e:
            print(f"❌ Error retrieving user cases: {e}")
            return []
    if not _supabase:
        return []
    try:
        response = _supabase.table("cases").select("*").eq("user_id", uid).order("timestamp", desc=True).execute()
        return response.data or []
    except Exception as e:
        print(f"❌ Error retrieving user cases: {e}")
        return []


def get_case_pdf_download_info(case_id: str) -> Optional[Dict[str, str]]:
    row = get_case_complete(case_id)
    if not row or not row.get("pdf_url"):
        return None
    report = row.get("structured_report") or {}
    if isinstance(report, str):
        try:
            report = json.loads(report)
        except Exception:
            report = {}
    return {
        "download_url": row.get("pdf_url"),
        "case_type": report.get("incident_type", "Unknown") if isinstance(report, dict) else "Unknown",
        "created_at": row.get("timestamp"),
        "case_id": case_id,
    }


def search_cases_by_status(uid: str, status: str = "completed"):
    if is_postgres_configured():
        try:
            return execute(
                "SELECT * FROM cases WHERE user_id = %s AND status = %s ORDER BY timestamp DESC",
                (uid, status),
            )
        except Exception as e:
            print(f"❌ Error searching cases by status: {e}")
            return []
    if not _supabase:
        return []
    try:
        response = (
            _supabase.table("cases")
            .select("*")
            .eq("user_id", uid)
            .eq("status", status)
            .order("timestamp", desc=True)
            .execute()
        )
        return response.data or []
    except Exception as e:
        print(f"❌ Error searching cases by status: {e}")
        return []
