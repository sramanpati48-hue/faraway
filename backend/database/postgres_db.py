"""Postgres-backed data access with the same public API as supabase_db."""
from __future__ import annotations

import json
import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from dotenv import load_dotenv

from backend.database.postgres_pool import execute, execute_one, execute_void, is_postgres_configured

load_dotenv()

MOCK_SCAM_EMBEDDING_DIM = 768

# Compatibility shim — callers check `supabase` for availability.
supabase = True if is_postgres_configured() else None


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {}, default=str)


def _json_list(value: Any) -> str:
    return json.dumps(value if value is not None else [], default=str)


def _normalize_pdf_url(pdf_url: Optional[str]) -> Optional[str]:
    if isinstance(pdf_url, str) and ".pdf.pdf" in pdf_url:
        return pdf_url.replace(".pdf.pdf", ".pdf")
    return pdf_url


def _format_pgvector(values: list[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"


def _to_fixed_embedding_dim(values: list[float], target_dim: int = MOCK_SCAM_EMBEDDING_DIM) -> list[float]:
    cleaned = [float(v) for v in values]
    if len(cleaned) >= target_dim:
        return cleaned[:target_dim]
    return cleaned + [0.0] * (target_dim - len(cleaned))


def _embed_text_for_mock_scam(text: str) -> Optional[list[float]]:
    try:
        from backend.services.text_embeddings import embed_document

        vec = embed_document(text)
        if vec:
            return _to_fixed_embedding_dim(vec)
    except Exception as e:
        print(f"⚠️ embed failed for mock scam insert: {e}")
    return None


def _parse_embedding(raw_embedding: Any) -> Optional[list[float]]:
    if raw_embedding is None:
        return None
    if isinstance(raw_embedding, list):
        try:
            return [float(v) for v in raw_embedding]
        except Exception:
            return None
    if isinstance(raw_embedding, str):
        text = raw_embedding.strip()
        if text.startswith("[") and text.endswith("]"):
            text = text[1:-1]
        parts = [p.strip() for p in text.split(",") if p.strip()]
        try:
            return [float(v) for v in parts]
        except Exception:
            return None
    return None


def _cosine_similarity(v1: list[float], v2: list[float]) -> float:
    if not v1 or not v2:
        return 0.0
    n = min(len(v1), len(v2))
    if n == 0:
        return 0.0
    a, b = v1[:n], v2[:n]
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def insert_mock_scam_with_embedding(
    title: str,
    description: str,
    scam_type: str,
    risk_level: str,
    city: str,
    lat: float | None = None,
    lon: float | None = None,
    embedding: list[float] | None = None,
) -> Optional[str]:
    """Insert into mock_scams. Returns the new row id, or None on failure."""
    try:
        text_to_embed = (f"{title}. {description or ''}").strip()
        vec = embedding if embedding else _embed_text_for_mock_scam(text_to_embed)
        lat_v = float(lat) if lat is not None else None
        lon_v = float(lon) if lon is not None else None
        # mock_scams.id is text (no serial default after migration 007)
        scam_id = str(uuid.uuid4())
        if vec:
            execute_void(
                """
                INSERT INTO mock_scams (id, title, description, scam_type, risk_level, city, lat, lon, embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::vector)
                """,
                (scam_id, title, description, scam_type, risk_level, city, lat_v, lon_v, _format_pgvector(vec)),
            )
        else:
            execute_void(
                """
                INSERT INTO mock_scams (id, title, description, scam_type, risk_level, city, lat, lon)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (scam_id, title, description, scam_type, risk_level, city, lat_v, lon_v),
            )
        return scam_id
    except Exception as e:
        print(f"Error inserting mock scam with embedding: {e}")
        return None


def find_similar_mock_scam_trends(
    query_text: str,
    city: Optional[str] = None,
    limit: int = 3,
    candidate_limit: int = 120,
    similarity_threshold: float = 0.78,
    lookback_days: int = 180,
):
    if not query_text:
        return []
    try:
        query_embedding = _embed_text_for_mock_scam(query_text)
        if not query_embedding:
            return []
        sql = """
            SELECT id, title, description, scam_type, risk_level, city, lat, lon, timestamp, embedding::text AS embedding
            FROM mock_scams
            WHERE 1=1
        """
        params: list[Any] = []
        city_key = (city or "").strip()
        if city_key and city_key.lower() not in ("unknown", "india"):
            sql += " AND (lower(btrim(COALESCE(city, ''))) = lower(%s) OR lower(COALESCE(city, '')) LIKE %s)"
            params.extend([city_key, f"%{city_key.lower()}%"])
        sql += " ORDER BY timestamp DESC NULLS LAST LIMIT %s"
        params.append(candidate_limit)
        candidates = execute(sql, params)
        if lookback_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
            filtered = []
            for row in candidates:
                ts = row.get("timestamp")
                try:
                    if ts and ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    if ts and ts < cutoff:
                        continue
                except Exception:
                    pass
                filtered.append(row)
            candidates = filtered
        scored = []
        for row in candidates:
            emb = _parse_embedding(row.get("embedding"))
            if not emb:
                continue
            score = _cosine_similarity(query_embedding, emb)
            if score >= similarity_threshold:
                item = dict(row)
                item.pop("embedding", None)
                item["similarity"] = score
                scored.append(item)
        scored.sort(key=lambda x: x.get("similarity", 0), reverse=True)
        return scored[:limit]
    except Exception as e:
        print(f"Error finding similar mock scam trends: {e}")
        return []


def create_or_update_user(uid: str, email: str, role: str):
    try:
        incoming_role = (role or "victim").strip().lower()
        role_priority = {"victim": 0, "sahayak": 1, "lawyer": 1, "moderator": 2, "admin": 3, "super_admin": 4}
        row = execute_one(
            "SELECT id, role, firebase_uid FROM users WHERE firebase_uid = %s OR id::text = %s LIMIT 1",
            (uid, uid),
        )
        if row:
            existing = (row.get("role") or "victim").strip().lower()
            effective = existing if role_priority.get(existing, 0) > role_priority.get(incoming_role, 0) else incoming_role
            execute_void(
                "UPDATE users SET email = %s, role = %s, firebase_uid = COALESCE(firebase_uid, %s), updated_at = now() WHERE id = %s",
                (email, effective, uid, row["id"]),
            )
        else:
            execute_void(
                """
                INSERT INTO users (firebase_uid, email, role, status, password_reset_required)
                VALUES (%s, %s, %s, 'pending_reset', true)
                """,
                (uid, email, incoming_role),
            )
        return True
    except Exception as e:
        print(f"Error syncing user to Postgres: {e}")
        return False


def get_user_role(uid: str) -> Optional[str]:
    try:
        role_priority = {"victim": 0, "sahayak": 1, "lawyer": 1, "moderator": 2, "admin": 3, "super_admin": 4}
        rows = execute(
            "SELECT role FROM users WHERE firebase_uid = %s OR id::text = %s",
            (uid, uid),
        )
        if not rows:
            return None
        roles = [(r.get("role") or "victim").strip().lower() for r in rows]
        return max(roles, key=lambda r: role_priority.get(r, 0))
    except Exception as e:
        print(f"Error fetching user role: {e}")
        return None


def get_chat_history(uid: str, session_id: Optional[str] = None):
    try:
        if session_id:
            row = execute_one(
                "SELECT session_data FROM chat_history WHERE user_id = %s AND id = %s ORDER BY timestamp DESC LIMIT 1",
                (uid, session_id),
            )
        else:
            row = execute_one(
                "SELECT session_data FROM chat_history WHERE user_id = %s ORDER BY timestamp DESC LIMIT 1",
                (uid,),
            )
        if not row:
            return []
        data = row.get("session_data") or []
        return data if isinstance(data, list) else json.loads(data)
    except Exception as e:
        print(f"Error fetching chat history: {e}")
        return []


def save_chat_history(uid: str, session_id: str, session_data: list):
    try:
        execute_void(
            """
            INSERT INTO chat_history (id, user_id, session_data, timestamp)
            VALUES (%s, %s, %s::jsonb, now())
            ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, session_data = EXCLUDED.session_data, timestamp = now()
            """,
            (session_id, uid, _json_list(session_data)),
        )
        return True
    except Exception as e:
        print(f"Error saving chat history: {e}")
        return False


def get_all_chat_sessions(uid: str):
    try:
        return execute(
            "SELECT id, timestamp, session_data FROM chat_history WHERE user_id = %s ORDER BY timestamp DESC",
            (uid,),
        )
    except Exception as e:
        print(f"Error fetching chat sessions: {e}")
        return []


def delete_chat_session(uid: str, session_id: str) -> bool:
    try:
        execute_void(
            "DELETE FROM chat_history WHERE id = %s AND user_id = %s",
            (session_id, uid),
        )
        return True
    except Exception as e:
        print(f"Error deleting chat session: {e}")
        return False


def save_user_case(uid: str, case_id: str, structured_report: dict, session_data: list):
    try:
        execute_void(
            """
            INSERT INTO cases (id, user_id, structured_report, session_data, pending, timestamp)
            VALUES (%s, %s, %s::jsonb, %s::jsonb, false, now())
            ON CONFLICT (id) DO UPDATE SET
              user_id = EXCLUDED.user_id,
              structured_report = EXCLUDED.structured_report,
              session_data = EXCLUDED.session_data,
              pending = false,
              updated_at = now()
            """,
            (case_id, uid, _json(structured_report), _json_list(session_data)),
        )
        return True
    except Exception as e:
        print(f"Error saving user case: {e}")
        return False


def get_pending_intervention_case_ids(user_id: str, collection_name: str = "moderator") -> set[str]:
    try:
        rows = execute(
            """
            SELECT id FROM interventions
            WHERE user_id = %s AND collection_name = %s AND status = 'pending'
            """,
            (user_id, collection_name),
        )
        return {str(r["id"]) for r in rows if r.get("id") is not None}
    except Exception as e:
        print(f"Error fetching pending intervention case IDs: {e}")
        return set()


def set_case_pending_status(case_id: str, is_pending: bool) -> bool:
    if not case_id:
        return False
    try:
        rows = execute(
            "UPDATE cases SET pending = %s, updated_at = now() WHERE id = %s RETURNING id",
            (bool(is_pending), case_id),
        )
        return bool(rows)
    except Exception as e:
        print(f"Error updating case pending status: {e}")
        return False


FORWARD_ROLE_LABELS = {
    "moderator": "Legal Moderator",
    "lawyer": "Lawyer",
    "sahayak": "Nyay Guide",
    "nodal_guide": "Nodal Guide",
}


def _append_followup_to_report(report: dict | None, statement: str, created_at: str) -> dict:
    data = dict(report) if isinstance(report, dict) else {}
    raw_follow_ups = data.get("follow_ups") or []
    follow_ups = [fu for fu in raw_follow_ups if isinstance(fu, dict) and fu.get("statement")]
    follow_ups.append({"statement": statement, "created_at": created_at})
    data["follow_ups"] = follow_ups
    summary = str(data.get("summary") or "").rstrip()
    block = f"Follow-up: {statement}"
    data["summary"] = f"{summary}\n\n{block}".strip() if summary else block
    return data


def mark_case_forwarded(
    *,
    role: str,
    target_id: str,
    case_id: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
    structured_report: dict | None = None,
    pdf_url: str | None = None,
    queue_status: str = "queued",
) -> dict | None:
    if role not in FORWARD_ROLE_LABELS or not target_id:
        return None
    cid = case_id or target_id
    report = dict(structured_report or {})
    if pdf_url:
        report["pdf_url"] = pdf_url
    try:
        execute_void(
            """
            INSERT INTO cases (
              id, user_id, session_id, structured_report, pending,
              forwarded_role, forwarded_target_id, queue_status, pdf_url, timestamp
            )
            VALUES (%s, %s, %s, %s::jsonb, true, %s, %s, %s, %s, now())
            ON CONFLICT (id) DO UPDATE SET
              session_id = COALESCE(EXCLUDED.session_id, cases.session_id),
              user_id = COALESCE(EXCLUDED.user_id, cases.user_id),
              pending = true,
              forwarded_role = EXCLUDED.forwarded_role,
              forwarded_target_id = EXCLUDED.forwarded_target_id,
              queue_status = EXCLUDED.queue_status,
              pdf_url = COALESCE(EXCLUDED.pdf_url, cases.pdf_url),
              structured_report = CASE
                WHEN cases.structured_report IS NULL OR cases.structured_report = '{}'::jsonb
                THEN EXCLUDED.structured_report
                ELSE cases.structured_report
              END,
              updated_at = now()
            """,
            (
                cid,
                user_id,
                session_id,
                _json(report),
                role,
                target_id,
                queue_status,
                pdf_url,
            ),
        )
        return get_session_forward_state(session_id) if session_id else {
            "role": role,
            "role_label": FORWARD_ROLE_LABELS[role],
            "target_id": target_id,
            "case_id": cid,
            "queue_status": queue_status,
            "pdf_url": _normalize_pdf_url(pdf_url),
            "follow_ups": [],
        }
    except Exception as e:
        print(f"Error marking case forwarded: {e}")
        return None


def _resolve_followup_keys(
    *,
    role: str,
    session_id: str | None,
    case_id: str | None,
    target_id: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Normalize chat session / case / queue ids so follow-ups stick to the real forward."""
    sid = (session_id or "").strip() or None
    cid = (case_id or "").strip() or None
    tid = (target_id or "").strip() or None
    key = sid or cid or tid
    try:
        if cid:
            crow = execute_one(
                """
                SELECT id, session_id, forwarded_role, forwarded_target_id
                FROM cases WHERE id = %s LIMIT 1
                """,
                (cid,),
            )
            if crow:
                sid = (crow.get("session_id") or sid or cid) or None
                tid = tid or crow.get("forwarded_target_id") or crow.get("id")
        elif key:
            crow = execute_one(
                """
                SELECT id, session_id, forwarded_role, forwarded_target_id
                FROM cases
                WHERE session_id = %s OR id = %s
                ORDER BY COALESCE(updated_at, timestamp) DESC NULLS LAST
                LIMIT 1
                """,
                (key, key),
            )
            if crow:
                cid = crow.get("id")
                sid = (crow.get("session_id") or sid or key) or None
                tid = tid or crow.get("forwarded_target_id") or crow.get("id")

        if role == "moderator":
            iv_key = tid or cid or sid
            if iv_key:
                iv = execute_one(
                    """
                    SELECT id, session_id FROM interventions
                    WHERE id = %s OR session_id = %s
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (iv_key, iv_key),
                )
                if iv:
                    tid = tid or iv.get("id")
                    cid = cid or iv.get("id")
                    sid = (iv.get("session_id") or sid or cid) or None
        elif role == "lawyer":
            lk = tid or cid or sid
            if lk:
                row = execute_one(
                    """
                    SELECT id, session_id FROM lawyer_cases
                    WHERE id = %s OR session_id = %s
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (lk, lk),
                )
                if row:
                    tid = tid or row.get("id")
                    cid = cid or row.get("id")
                    sid = (row.get("session_id") or sid or cid) or None
        elif role in {"sahayak", "nodal_guide"}:
            sk = tid or cid or sid
            if sk:
                row = execute_one(
                    """
                    SELECT id, session_id FROM sahayak_cases
                    WHERE id = %s OR session_id = %s
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (sk, sk),
                )
                if row:
                    tid = tid or row.get("id")
                    cid = cid or row.get("id")
                    sid = (row.get("session_id") or sid or cid) or None
    except Exception as e:
        print(f"Error resolving follow-up keys: {e}")
    return sid, cid, tid


def append_case_followup(
    statement: str,
    role: str,
    target_id: str | None = None,
    case_id: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
) -> dict | None:
    text = (statement or "").strip()
    if not text or role not in FORWARD_ROLE_LABELS:
        return None
    created_at = datetime.now(timezone.utc).isoformat()
    sid, cid, tid = _resolve_followup_keys(
        role=role,
        session_id=session_id,
        case_id=case_id,
        target_id=target_id,
    )
    try:
        rows = execute(
            """
            INSERT INTO case_followups (session_id, user_id, case_id, target_role, target_id, statement)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
            """,
            (sid, user_id, cid, role, tid, text),
        )
        if rows and rows[0].get("created_at"):
            created_at = str(rows[0]["created_at"])

        if cid:
            case_row = execute_one("SELECT structured_report FROM cases WHERE id = %s LIMIT 1", (cid,))
            if case_row:
                updated = _append_followup_to_report(case_row.get("structured_report"), text, created_at)
                execute_void(
                    "UPDATE cases SET structured_report = %s::jsonb, updated_at = now() WHERE id = %s",
                    (_json(updated), cid),
                )

        if role == "moderator" and tid:
            row = execute_one(
                "SELECT structured_report, user_statement FROM interventions WHERE id = %s LIMIT 1",
                (tid,),
            )
            if row:
                updated = _append_followup_to_report(row.get("structured_report"), text, created_at)
                existing = str(row.get("user_statement") or "").rstrip()
                user_statement = f"{existing}\n\nFollow-up: {text}".strip() if existing else text
                execute_void(
                    """
                    UPDATE interventions
                    SET structured_report = %s::jsonb, user_statement = %s, updated_at = now()
                    WHERE id = %s
                    """,
                    (_json(updated), user_statement, tid),
                )
        elif role == "lawyer" and tid:
            row = execute_one("SELECT structured_report FROM lawyer_cases WHERE id = %s LIMIT 1", (tid,))
            if row:
                updated = _append_followup_to_report(row.get("structured_report"), text, created_at)
                execute_void(
                    "UPDATE lawyer_cases SET structured_report = %s::jsonb, updated_at = now() WHERE id = %s",
                    (_json(updated), tid),
                )
        elif role in {"sahayak", "nodal_guide"} and tid:
            row = execute_one("SELECT structured_report FROM sahayak_cases WHERE id = %s LIMIT 1", (tid,))
            if row:
                updated = _append_followup_to_report(row.get("structured_report"), text, created_at)
                execute_void(
                    "UPDATE sahayak_cases SET structured_report = %s::jsonb, updated_at = now() WHERE id = %s",
                    (_json(updated), tid),
                )

        # Prefer canonical session lookup; never 500 after a successful write if lookup misses.
        state = None
        if sid:
            state = get_session_forward_state(sid)
        if not state and cid and cid != sid:
            state = get_session_forward_state(cid)
        if state:
            return state
        return {
            "role": role,
            "role_label": FORWARD_ROLE_LABELS[role],
            "target_id": tid,
            "case_id": cid,
            "queue_status": "queued",
            "follow_ups": [{"statement": text, "created_at": created_at}],
        }
    except Exception as e:
        print(f"Error appending case follow-up: {e}")
        return None


def get_latest_case_for_session(session_id: str | None) -> dict | None:
    if not session_id:
        return None
    try:
        return execute_one(
            """
            SELECT * FROM cases
            WHERE session_id = %s
            ORDER BY COALESCE(updated_at, timestamp) DESC NULLS LAST
            LIMIT 1
            """,
            (session_id,),
        )
    except Exception as e:
        print(f"Error fetching latest case for session: {e}")
        return None


def get_case_by_id(case_id: str | None) -> dict | None:
    if not case_id:
        return None
    try:
        return execute_one("SELECT * FROM cases WHERE id = %s LIMIT 1", (str(case_id),))
    except Exception as e:
        print(f"Error fetching case: {e}")
        return None


def pick_nyaysahayak_for_area(state_name: str | None = None) -> dict | None:
    profiles = get_sahayak_profiles_for_area(state_name, limit=8)
    if not profiles:
        return None
    for profile in profiles:
        uid = str(profile.get("uid") or "")
        if not uid:
            continue
        try:
            user = execute_one(
                """
                SELECT id FROM users
                WHERE id::text = %s OR firebase_uid = %s
                LIMIT 1
                """,
                (uid, uid),
            )
        except Exception:
            user = None
        if user:
            out = dict(profile)
            out["uid"] = str(user["id"])
            return out
    return profiles[0]


def get_session_forward_state(session_id: str | None) -> dict | None:
    if not session_id:
        return None
    key = str(session_id).strip()
    if not key:
        return None
    try:
        case_row = execute_one(
            """
            SELECT id, session_id, forwarded_role, forwarded_target_id, queue_status, pdf_url, structured_report
            FROM cases
            WHERE (session_id = %s OR id = %s) AND forwarded_role IS NOT NULL
            ORDER BY COALESCE(updated_at, timestamp) DESC NULLS LAST
            LIMIT 1
            """,
            (key, key),
        )
        role = None
        target_id = None
        case_id = None
        queue_status = "queued"
        pdf_url = None
        canonical_session = key
        if case_row:
            role = case_row.get("forwarded_role")
            target_id = case_row.get("forwarded_target_id")
            case_id = case_row.get("id")
            canonical_session = case_row.get("session_id") or key
            queue_status = case_row.get("queue_status") or "queued"
            pdf_url = _normalize_pdf_url(case_row.get("pdf_url"))
            report = case_row.get("structured_report") if isinstance(case_row.get("structured_report"), dict) else {}
            pdf_url = pdf_url or _normalize_pdf_url((report or {}).get("pdf_url"))

        if not role:
            intervention = execute_one(
                """
                SELECT id, session_id, structured_report, status FROM interventions
                WHERE session_id = %s OR id = %s
                ORDER BY created_at DESC LIMIT 1
                """,
                (key, key),
            )
            if intervention:
                role = "moderator"
                target_id = intervention.get("id")
                case_id = intervention.get("id")
                canonical_session = intervention.get("session_id") or key
                status = str(intervention.get("status") or "pending").lower()
                queue_status = "resolved" if status in {"reviewed", "resolved"} else "queued"
                report = intervention.get("structured_report") if isinstance(intervention.get("structured_report"), dict) else {}
                pdf_url = _normalize_pdf_url((report or {}).get("pdf_url"))
            else:
                lawyer = execute_one(
                    """
                    SELECT id, session_id, structured_report, pdf_url, status FROM lawyer_cases
                    WHERE session_id = %s OR id = %s
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (key, key),
                )
                if lawyer:
                    role = "lawyer"
                    target_id = lawyer.get("id")
                    case_id = lawyer.get("id")
                    canonical_session = lawyer.get("session_id") or key
                    status = str(lawyer.get("status") or "pending").lower()
                    queue_status = "accepted" if status == "accepted" else ("queued" if status == "pending" else status)
                    report = lawyer.get("structured_report") if isinstance(lawyer.get("structured_report"), dict) else {}
                    pdf_url = _normalize_pdf_url(lawyer.get("pdf_url") or (report or {}).get("pdf_url"))
                else:
                    sahayak = execute_one(
                        """
                        SELECT id, session_id, structured_report, pdf_url, status FROM sahayak_cases
                        WHERE session_id = %s OR id = %s
                        ORDER BY created_at DESC LIMIT 1
                        """,
                        (key, key),
                    )
                    if sahayak:
                        role = "sahayak"
                        target_id = sahayak.get("id")
                        case_id = sahayak.get("id")
                        canonical_session = sahayak.get("session_id") or key
                        status = str(sahayak.get("status") or "pending").lower()
                        queue_status = "accepted" if status == "accepted" else ("queued" if status == "pending" else status)
                        report = sahayak.get("structured_report") if isinstance(sahayak.get("structured_report"), dict) else {}
                        pdf_url = _normalize_pdf_url(sahayak.get("pdf_url") or (report or {}).get("pdf_url"))

        if not role:
            return None

        # Collect follow-ups under chat session id, case id, or canonical session.
        follow_keys = [k for k in {key, canonical_session, str(case_id or "")} if k]
        follow_rows = []
        if len(follow_keys) == 1:
            follow_rows = execute(
                """
                SELECT statement, created_at FROM case_followups
                WHERE session_id = %s OR case_id = %s
                ORDER BY created_at ASC
                """,
                (follow_keys[0], follow_keys[0]),
            ) or []
        elif follow_keys:
            follow_rows = execute(
                """
                SELECT statement, created_at FROM case_followups
                WHERE session_id = ANY(%s) OR case_id = ANY(%s)
                ORDER BY created_at ASC
                """,
                (follow_keys, follow_keys),
            ) or []
        follow_ups = [
            {"statement": r.get("statement"), "created_at": str(r.get("created_at"))}
            for r in follow_rows
            if r.get("statement")
        ]
        return {
            "role": role,
            "role_label": FORWARD_ROLE_LABELS.get(str(role), str(role)),
            "target_id": target_id,
            "case_id": case_id,
            "queue_status": queue_status,
            "pdf_url": pdf_url,
            "follow_ups": follow_ups,
        }
    except Exception as e:
        print(f"Error fetching session forward state: {e}")
        return None


def get_user_cases(uid: str):
    try:
        rows = execute("SELECT * FROM cases WHERE user_id = %s ORDER BY timestamp DESC", (uid,))
        pending_case_ids = get_pending_intervention_case_ids(uid, "moderator")
        cases = []
        for row in rows:
            case_id = row.get("id")
            cases.append(
                {
                    "case_id": case_id,
                    "structured_report": row.get("structured_report"),
                    "session": row.get("session_data"),
                    "timestamp": row.get("timestamp"),
                    "session_id": row.get("session_id"),
                    "pdf_url": _normalize_pdf_url(row.get("pdf_url")),
                    "pending": str(case_id) in pending_case_ids if case_id else False,
                    "forwarded_role": row.get("forwarded_role"),
                    "forwarded_target_id": row.get("forwarded_target_id"),
                    "queue_status": row.get("queue_status"),
                }
            )
        return cases
    except Exception as e:
        print(f"Error fetching user cases: {e}")
        return []


def create_intervention_case(
    user_id: str,
    structured_report: dict,
    collection_name: str = "moderator",
    session_id: Optional[str] = None,
    user_statement: str = "",
    location: dict = None,
    case_id: Optional[str] = None,
    pdf_url: Optional[str] = None,
):
    try:
        enriched_report = dict(structured_report or {})
        if pdf_url:
            enriched_report["pdf_url"] = pdf_url
        uid = str(user_id).strip() if user_id and str(user_id).strip() else None
        if case_id:
            existing = execute_one("SELECT id, status FROM interventions WHERE id = %s LIMIT 1", (case_id,))
            if existing and str(existing.get("status") or "").lower() in {"reviewed", "resolved"}:
                return existing.get("id")
            rows = execute(
                """
                INSERT INTO interventions (id, user_id, collection_name, structured_report, status, session_id, user_statement, location)
                VALUES (%s, %s, %s, %s::jsonb, 'pending', %s, %s, %s::jsonb)
                ON CONFLICT (id) DO UPDATE SET
                  user_id = EXCLUDED.user_id,
                  collection_name = EXCLUDED.collection_name,
                  structured_report = EXCLUDED.structured_report,
                  status = 'pending',
                  session_id = EXCLUDED.session_id,
                  user_statement = EXCLUDED.user_statement,
                  location = EXCLUDED.location,
                  updated_at = now()
                RETURNING id
                """,
                (case_id, uid, collection_name, _json(enriched_report), session_id, user_statement or "", _json(location or {})),
            )
            set_case_pending_status(case_id, True)
            return rows[0]["id"] if rows else case_id
        new_id = str(uuid.uuid4())
        rows = execute(
            """
            INSERT INTO interventions (id, user_id, collection_name, structured_report, status, session_id, user_statement, location)
            VALUES (%s, %s, %s, %s::jsonb, 'pending', %s, %s, %s::jsonb)
            RETURNING id
            """,
            (new_id, uid, collection_name, _json(enriched_report), session_id, user_statement or "", _json(location or {})),
        )
        return rows[0]["id"] if rows else new_id
    except Exception as e:
        print(f"Error creating intervention case: {e}")
        return None


def list_pending_intervention_rows(limit: int = 50) -> list[dict]:
    """Raw pending intervention rows for the webhook poller."""
    try:
        return execute(
            """
            SELECT * FROM interventions
            WHERE status = 'pending'
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        ) or []
    except Exception as e:
        print(f"Error listing pending interventions: {e}")
        return []


def list_pending_sahayak_case_rows(limit: int = 50) -> list[dict]:
    """Raw pending sahayak_cases rows for the webhook poller."""
    try:
        return execute(
            """
            SELECT * FROM sahayak_cases
            WHERE status = 'pending'
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        ) or []
    except Exception as e:
        print(f"Error listing pending sahayak cases: {e}")
        return []


def get_active_clash_mock_cases() -> list[dict]:
    try:
        return execute(
            """
            SELECT id, title, summary, facts, tags
            FROM clash_mock_cases
            WHERE active = true
            ORDER BY id
            """
        ) or []
    except Exception as e:
        print(f"Error fetching clash mock cases: {e}")
        return []


def get_pending_interventions(collection_name: str = "sahayak", notified_uid: str | None = None):
    """Pending interventions. If notified_uid is set, only cases assigned/notified to that moderator."""
    try:
        if notified_uid:
            rows = execute(
                """
                SELECT * FROM interventions
                WHERE collection_name = %s
                  AND status = 'pending'
                  AND (
                    assigned_moderator_id = %s
                    OR %s = ANY(COALESCE(notified_user_ids, '{}'))
                  )
                ORDER BY assigned_at ASC NULLS LAST, created_at DESC
                """,
                (collection_name, notified_uid, notified_uid),
            )
        else:
            rows = execute(
                """
                SELECT * FROM interventions
                WHERE collection_name = %s AND status = 'pending'
                ORDER BY created_at DESC
                """,
                (collection_name,),
            )
        interventions = []
        for row in rows:
            report = row.get("structured_report") or {}
            interventions.append(
                {
                    "case_id": row.get("id"),
                    "user_id": row.get("user_id"),
                    "structured_report": report,
                    "status": row.get("status"),
                    "created_at": row.get("created_at"),
                    "assigned_at": row.get("assigned_at"),
                    "assigned_moderator_id": row.get("assigned_moderator_id"),
                    "delay_score": int(row.get("delay_score") or 0),
                    "sla_breached_at": row.get("sla_breached_at"),
                    "session_id": row.get("session_id"),
                    "pdf_url": _normalize_pdf_url((report or {}).get("pdf_url") if isinstance(report, dict) else None),
                    "user_statement": row.get("user_statement", ""),
                    "location": row.get("location") or {},
                    "notified_user_ids": row.get("notified_user_ids") or [],
                    "routing_recommendation": get_intervention_routing_recommendation(
                        report if isinstance(report, dict) else {},
                        row.get("user_statement", ""),
                        row.get("location") or {},
                    ),
                }
            )
        return interventions
    except Exception as e:
        print(f"Error fetching pending interventions: {e}")
        return []


def forward_case_to_sahayak(
    user_id: str,
    user_name: str,
    structured_report: dict,
    session_id: str = None,
    location: dict = None,
    pdf_url: str = None,
) -> str | None:
    try:
        uid = str(user_id).strip() if user_id and str(user_id).strip() else None
        new_id = str(uuid.uuid4())
        loc = location if isinstance(location, dict) else {}
        if not loc and isinstance(structured_report, dict):
            nested = structured_report.get("location")
            if isinstance(nested, dict):
                loc = nested
        # Prefer explicit pdf_url, else pull from structured_report
        pdf = pdf_url or (structured_report.get("pdf_url") if isinstance(structured_report, dict) else None)
        rows = execute(
            """
            INSERT INTO sahayak_cases (id, user_id, user_name, structured_report, status, session_id, location, pdf_url)
            VALUES (%s, %s, %s, %s::jsonb, 'pending', %s, %s::jsonb, %s)
            RETURNING id
            """,
            (new_id, uid, user_name, _json(structured_report), session_id, _json(loc or {}), pdf),
        )
        return rows[0]["id"] if rows else new_id
    except Exception as e:
        print(f"Error forwarding case to sahayak: {e}")
        return None


def set_intervention_notified_users(case_id: str, uids: list[str]) -> bool:
    try:
        execute_void(
            "UPDATE interventions SET notified_user_ids = %s, updated_at = now() WHERE id = %s",
            (list(uids or []), case_id),
        )
        return True
    except Exception as e:
        print(f"Error setting intervention notified users: {e}")
        return False


def set_sahayak_case_notified_users(case_id: str, uids: list[str]) -> bool:
    try:
        execute_void(
            "UPDATE sahayak_cases SET notified_user_ids = %s, updated_at = now() WHERE id = %s",
            (list(uids or []), case_id),
        )
        return True
    except Exception as e:
        print(f"Error setting sahayak notified users: {e}")
        return False


def assign_pending_nodal_guide(case_id: str, guide_id: str, guide_name: str = "") -> bool:
    """Prefer a nodal guide while keeping the case pending for queue review."""
    try:
        execute_void(
            """
            UPDATE sahayak_cases
            SET assigned_sahayak_id = %s,
                assigned_sahayak_name = %s,
                status = 'pending',
                updated_at = now()
            WHERE id = %s
            """,
            (guide_id, guide_name or "Nodal Guide", case_id),
        )
        return True
    except Exception as e:
        print(f"Error assigning pending nodal guide: {e}")
        return False


def count_notified_pending_interventions(uid: str) -> int:
    try:
        row = execute_one(
            """
            SELECT COUNT(*)::int AS n FROM interventions
            WHERE status = 'pending' AND %s = ANY(COALESCE(notified_user_ids, '{}'))
            """,
            (uid,),
        )
        return int((row or {}).get("n") or 0)
    except Exception:
        return 0


def count_notified_pending_sahayak_cases(uid: str) -> int:
    try:
        row = execute_one(
            """
            SELECT COUNT(*)::int AS n FROM sahayak_cases
            WHERE status = 'pending' AND %s = ANY(COALESCE(notified_user_ids, '{}'))
            """,
            (uid,),
        )
        return int((row or {}).get("n") or 0)
    except Exception:
        return 0


def get_intervention_row(case_id: str) -> dict | None:
    try:
        return execute_one("SELECT * FROM interventions WHERE id = %s LIMIT 1", (case_id,))
    except Exception:
        return None


def get_sahayak_case_row(case_id: str) -> dict | None:
    try:
        return execute_one("SELECT * FROM sahayak_cases WHERE id = %s LIMIT 1", (case_id,))
    except Exception:
        return None


def get_sahayak_case_by_session(session_id: str):
    try:
        case = execute_one(
            "SELECT * FROM sahayak_cases WHERE session_id = %s ORDER BY created_at DESC LIMIT 1",
            (session_id,),
        )
        if not case:
            return None
        assigned_id = case.get("assigned_sahayak_id")
        if assigned_id:
            profile = execute_one("SELECT * FROM sahayak_profiles WHERE uid = %s", (assigned_id,))
            case["assigned_sahayak_profile"] = profile
        return case
    except Exception as e:
        print(f"Error fetching sahayak case by session: {e}")
        return None


def get_sahayak_case_for_session(session_id: str):
    case = get_sahayak_case_by_session(session_id)
    if case and case.get("status") == "accepted" and case.get("assigned_sahayak_id") and "assigned_sahayak_profile" not in case:
        case["assigned_sahayak_profile"] = get_sahayak_profile(case["assigned_sahayak_id"])
    return case


def get_all_sahayak_profiles(limit: int | None = None) -> list:
    """Return sahayak profiles. If limit is set, return top-rated subset."""
    try:
        if limit is None:
            return execute("SELECT * FROM sahayak_profiles ORDER BY rating DESC NULLS LAST")
        return execute(
            """
            SELECT uid, name, location, state, city, occupation, bio, avatar, contact_number, email,
                   availability, rating, cases_resolved, languages
            FROM sahayak_profiles
            ORDER BY rating DESC NULLS LAST
            LIMIT %s
            """,
            (limit,),
        )
    except Exception as e:
        print(f"Error fetching sahayak profiles: {e}")
        return []


_LAWYER_PROFILE_COLS = """
    id, user_id, name, email, specialization, lawyer_type, experience, hourly_rate,
    bio, about, headline, location, city, state, avatar, cover_image, contact_number,
    bar_registration_number, rating, verified, practice_areas, courts_practiced,
    languages, availability_hours, consultation_modes, website_url, linkedin_url,
    profile_extras, created_at, updated_at
"""


def _canonical_practice_areas_for_incident(incident_type: str) -> list[str]:
    """Map case/incident labels to directory practice-area chips."""
    text = (incident_type or "").lower()
    areas: list[str] = []
    if any(k in text for k in ("cyber", "upi", "otp", "phishing", "online fraud", "scam", "financial fraud")):
        areas.extend(["Cyber & Financial Fraud", "Cyber Law"])
    if any(k in text for k in ("criminal", "missing", "kidnap", "assault", "theft", "robbery", "fir", "homicide", "murder", "bail")):
        areas.extend(["Criminal Law", "Criminal Defense"])
    if any(k in text for k in ("sexual", "harassment", "posh", "rape")):
        areas.extend(["Sexual Offence Law", "Criminal Law", "Criminal Defense"])
    if any(k in text for k in ("domestic", "dowry", "divorce", "family", "matrimonial", "maintenance")):
        areas.extend(["Family & Matrimonial", "Family Law"])
    if any(k in text for k in ("property", "land", "tenant", "possession", "title", "real estate")):
        areas.extend(["Property & Land", "Property & Real Estate"])
    if any(
        k in text
        for k in (
            "civil",
            "consumer",
            "contract",
            "cheque",
            "notice",
            "injunction",
            "suit",
            "tenant",
            "landlord",
        )
    ):
        areas.extend(["Civil & Consumer Disputes", "Civil Law"])
    if any(k in text for k in ("employment", "wage", "labour", "labor", "business")):
        areas.extend(["Business & Employment", "Labour Law"])
    if any(k in text for k in ("claim", "compensation", "insurance", "motor")):
        areas.extend(["Claims & Compensation"])
    # de-dupe preserve order
    seen = set()
    out = []
    for a in areas:
        if a not in seen:
            seen.add(a)
            out.append(a)
    return out


def search_lawyers_by_specialization(incident_type: str, limit: int = 5):
    areas = _canonical_practice_areas_for_incident(incident_type)
    try:
        cols = _LAWYER_PROFILE_COLS.strip()
        if areas:
            rows = execute(
                f"""
                SELECT {cols} FROM lawyers
                WHERE practice_areas && %s::text[]
                   OR specialization = ANY(%s)
                   OR specialization ILIKE ANY(%s)
                ORDER BY rating DESC NULLS LAST, updated_at DESC NULLS LAST
                LIMIT %s
                """,
                (areas, areas, [f"%{a.split('&')[0].strip()}%" for a in areas], limit),
            )
            if rows:
                return rows
            # Fallback short-token ILIKE for older rows
            token = areas[0].split()[0]
            rows = execute(
                f"""
                SELECT {cols} FROM lawyers
                WHERE specialization ILIKE %s OR EXISTS (
                  SELECT 1 FROM unnest(practice_areas) pa WHERE pa ILIKE %s
                )
                ORDER BY rating DESC NULLS LAST LIMIT %s
                """,
                (f"%{token}%", f"%{token}%", limit),
            )
            if rows:
                return rows
        return execute(
            f"SELECT {cols} FROM lawyers ORDER BY rating DESC NULLS LAST LIMIT %s",
            (limit,),
        )
    except Exception as e:
        print(f"Error searching lawyers: {e}")
        return []


_MODERATOR_OUTCOME_WORKFLOW = {
    "approved_for_next_step": "MODERATOR_APPROVED",
    "digital_guidance": "MODERATOR_APPROVED",
    "nyayguide_recommended": "MODERATOR_APPROVED",
    "unable_to_verify": "UNABLE_TO_VERIFY",
    "emergency_escalation": "EMERGENCY_ESCALATION",
}


def _report_flag_truthy(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "required", "active"}
    return bool(value)


def _load_case_structured_report(case_id: str) -> Optional[dict]:
    row = execute_one(
        "SELECT structured_report, ai_verification_status FROM cases WHERE id = %s",
        (case_id,),
    )
    if not row:
        return None
    report = row.get("structured_report")
    if isinstance(report, str):
        try:
            report = json.loads(report)
        except Exception:
            report = {}
    if not isinstance(report, dict):
        report = {}
    if not report.get("ai_verification_status") and row.get("ai_verification_status"):
        report["ai_verification_status"] = row["ai_verification_status"]
    return report


def _apply_moderator_review_outcome(
    case_id: str,
    *,
    review_outcome: Optional[str] = None,
    support_needed: Optional[bool] = None,
    assistance_type: Optional[str] = None,
) -> Optional[dict]:
    """Persist the moderator's canonical workflow outcome onto the case row.

    Emergency escalation is non-overridable: an active EMERGENCY_ESCALATION
    state is never replaced with MODERATOR_APPROVED. MODERATOR_APPROVED does
    not imply NyayGuide support — support is only persisted when the outcome
    or an explicit flag says so. Returns a fresh server-authoritative case
    snapshot (workflow_state, structured_report, typed suggested_actions).
    """
    from backend.services.nyayguide_eligibility import build_nyayguide_suggestion

    if not case_id:
        return None

    report = _load_case_structured_report(case_id)
    if report is None:
        return None

    outcome = str(review_outcome or "").strip().lower()
    workflow_now = str(report.get("workflow_state") or "").strip().upper()
    emergency_active = (
        workflow_now == "EMERGENCY_ESCALATION"
        or _report_flag_truthy(report.get("emergency_escalation_active"))
    )

    now_iso = datetime.now(timezone.utc).isoformat()

    if emergency_active:
        # Fail closed: never downgrade an active emergency to approved.
        snapshot = {
            "workflow_state": "EMERGENCY_ESCALATION",
            "ai_verification_status": report.get("ai_verification_status") or "pending",
            "nyayguide_support_needed": False,
            "suggested_actions": [],
            "version": now_iso,
        }
        snapshot["structured_report"] = {**report, "workflow_state": "EMERGENCY_ESCALATION"}
        return snapshot

    workflow_state = _MODERATOR_OUTCOME_WORKFLOW.get(outcome, "MODERATOR_APPROVED")

    if support_needed is not None:
        nyayguide_needed = bool(support_needed)
    else:
        # Explicit outcome is the only auto-enable path; default fail-closed.
        nyayguide_needed = outcome == "nyayguide_recommended"

    report["workflow_state"] = workflow_state
    report["nyayguide_support_needed"] = nyayguide_needed
    if nyayguide_needed and assistance_type:
        report["nyayguide_assistance_type"] = str(assistance_type)
    elif not nyayguide_needed:
        report.pop("nyayguide_assistance_type", None)

    verification_status = report.get("ai_verification_status") or "pending"
    if workflow_state == "MODERATOR_APPROVED":
        # Human review concluded: the case is verified for its next step even
        # though the original AI pass flagged it.
        verification_status = "verified_for_next_step"
        report["ai_verification_status"] = verification_status
    elif workflow_state == "UNABLE_TO_VERIFY" and verification_status == "flagged":
        verification_status = "rejected"
        report["ai_verification_status"] = verification_status

    report["moderator_review_outcome"] = outcome or (
        "approved_for_next_step" if workflow_state == "MODERATOR_APPROVED" else outcome
    )
    report["moderator_reviewed_at"] = now_iso

    execute_void(
        """
        UPDATE cases
        SET structured_report = %s::jsonb,
            ai_verification_status = %s,
            updated_at = now()
        WHERE id = %s
        """,
        (_json(report), verification_status, case_id),
    )

    suggested_actions = []
    if workflow_state == "MODERATOR_APPROVED" and nyayguide_needed:
        action = build_nyayguide_suggestion(
            report, support_needs_met=True, case_id=str(case_id)
        )
        if action is not None:
            suggested_actions.append(action)

    return {
        "workflow_state": workflow_state,
        "structured_report": report,
        "ai_verification_status": verification_status,
        "nyayguide_support_needed": nyayguide_needed,
        "suggested_actions": suggested_actions,
        "version": now_iso,
    }


def resolve_intervention_case(
    case_id: str,
    moderator_text: str,
    options: list,
    routing_recommendation: Optional[dict] = None,
    moderator_id: Optional[str] = None,
    moderator_summary: Optional[str] = None,
    moderator_notes: Optional[str] = None,
    moderator_report: Optional[dict] = None,
    moderator_suggested_links: Optional[list] = None,
    review_outcome: Optional[str] = None,
    nyayguide_support_needed: Optional[bool] = None,
    nyayguide_assistance_type: Optional[str] = None,
):
    try:
        normalized_options = list(options or [])
        if routing_recommendation and isinstance(routing_recommendation, dict):
            has_bundle = any(isinstance(o, dict) and o.get("type") == "routing_bundle" for o in normalized_options)
            if not has_bundle:
                normalized_options.append(
                    {
                        "label": "Open recommended official route",
                        "payload": "routing_bundle",
                        "type": "routing_bundle",
                        "routing_recommendation": routing_recommendation,
                    }
                )
        rows = execute(
            """
            UPDATE interventions
            SET status = 'reviewed',
                moderator_response = %s,
                moderator_options = %s::jsonb,
                resolved_at = now(),
                updated_at = now(),
                assigned_moderator_id = COALESCE(assigned_moderator_id, %s)
            WHERE id = %s AND status = 'pending'
            RETURNING id, user_id, session_id, assigned_moderator_id
            """,
            (moderator_text, _json_list(normalized_options), moderator_id, case_id),
        )
        if not rows:
            existing = execute_one("SELECT id, user_id, session_id, status FROM interventions WHERE id = %s", (case_id,))
            status = str((existing or {}).get("status") or "").lower()
            if existing and status in {"reviewed", "resolved"}:
                return {
                    "success": True,
                    "user_id": existing.get("user_id"),
                    "session_id": existing.get("session_id"),
                    "case_id": case_id,
                    "moderator_response": moderator_text,
                    "moderator_options": normalized_options,
                    "routing_recommendation": routing_recommendation,
                }
            return False

        user_id = rows[0].get("user_id")
        session_id = rows[0].get("session_id")
        new_msg = {"role": "assistant", "content": moderator_text, "agent": "legal_moderator"}
        if normalized_options:
            new_msg["options"] = normalized_options
        if routing_recommendation:
            new_msg["routing_recommendation"] = routing_recommendation

        set_case_pending_status(case_id, False)

        case_row = execute_one("SELECT session_data FROM cases WHERE id = %s", (case_id,))
        if case_row:
            session_data = case_row.get("session_data") or []
            if not isinstance(session_data, list):
                session_data = json.loads(session_data)
            session_data.append(new_msg)
            execute_void(
                "UPDATE cases SET session_data = %s::jsonb, updated_at = now() WHERE id = %s",
                (_json_list(session_data), case_id),
            )

        if session_id:
            chat_row = execute_one("SELECT session_data FROM chat_history WHERE id = %s", (session_id,))
            if chat_row:
                chat_session_data = chat_row.get("session_data") or []
                if not isinstance(chat_session_data, list):
                    chat_session_data = json.loads(chat_session_data)
                chat_session_data.append(new_msg)
                execute_void(
                    "UPDATE chat_history SET session_data = %s::jsonb, timestamp = now() WHERE id = %s",
                    (_json_list(chat_session_data), session_id),
                )

        resolved_by = moderator_id or (rows[0].get("assigned_moderator_id") if rows else None)
        try:
            update_moderator_case_revision_on_resolve(
                intervention_id=case_id,
                moderator_id=str(resolved_by) if resolved_by else None,
                moderator_payload={
                    "moderator_response": moderator_text,
                    "moderator_options": normalized_options,
                    "routing_recommendation": routing_recommendation,
                },
                moderator_response=moderator_text,
            )
            if resolved_by:
                from backend.services.moderator_queue import embed_revision_async

                rev = execute_one(
                    """
                    SELECT id, search_text FROM moderator_case_revisions
                    WHERE intervention_id = %s ORDER BY updated_at DESC LIMIT 1
                    """,
                    (case_id,),
                )
                if rev and rev.get("search_text"):
                    embed_revision_async(str(rev["id"]), str(rev["search_text"]))
        except Exception as rev_err:
            print(f"Warning: revision update on resolve failed: {rev_err}")

        try:
            complete_moderator_updatation(
                intervention_id=case_id,
                moderator_id=str(resolved_by) if resolved_by else None,
                moderator_chat_response=moderator_text,
                moderator_suggested_actions=normalized_options,
                moderator_suggested_links=moderator_suggested_links,
                moderator_summary=moderator_summary,
                moderator_notes=moderator_notes,
                moderator_report=moderator_report,
            )
        except Exception as upd_err:
            print(f"Warning: moderator_updatation complete failed: {upd_err}")

        snapshot = _apply_moderator_review_outcome(
            case_id,
            review_outcome=review_outcome,
            support_needed=nyayguide_support_needed,
            assistance_type=nyayguide_assistance_type,
        )

        result = {
            "success": True,
            "user_id": user_id,
            "session_id": session_id,
            "case_id": case_id,
            "moderator_response": moderator_text,
            "moderator_options": normalized_options,
            "routing_recommendation": routing_recommendation,
            "moderator_id": resolved_by,
        }
        if isinstance(snapshot, dict):
            result["case_snapshot"] = snapshot
        return result
    except Exception as e:
        print(f"Error resolving intervention case: {e}")
        return False


def update_pending_intervention_pdf(case_id: str, pdf_url: str, collection_name: str = "moderator") -> bool:
    if not case_id or not pdf_url:
        return False
    try:
        row = execute_one(
            """
            SELECT structured_report FROM interventions
            WHERE id = %s AND collection_name = %s AND status = 'pending'
            LIMIT 1
            """,
            (case_id, collection_name),
        )
        if not row:
            return False
        current_report = row.get("structured_report") or {}
        if not isinstance(current_report, dict):
            current_report = json.loads(current_report)
        current_report["pdf_url"] = pdf_url
        rows = execute(
            """
            UPDATE interventions SET structured_report = %s::jsonb, updated_at = now()
            WHERE id = %s AND collection_name = %s AND status = 'pending'
            RETURNING id
            """,
            (_json(current_report), case_id, collection_name),
        )
        return bool(rows)
    except Exception as e:
        print(f"Error updating pending intervention PDF: {e}")
        return False


def search_lawyers():
    try:
        return execute("SELECT * FROM lawyers ORDER BY rating DESC NULLS LAST")
    except Exception as e:
        print(f"Error searching lawyers: {e}")
        return []


def _as_text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        # comma-separated fallback
        return [p.strip() for p in value.split(",") if p.strip()]
    return []


def _as_extras(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def register_lawyer_directory(uid: str, data: dict):
    try:
        specialization = data.get("specialization") or ""
        practice_areas = _as_text_list(data.get("practiceAreas") or data.get("practice_areas"))
        if not practice_areas and specialization:
            practice_areas = [specialization]
        about = data.get("about") or data.get("bio") or ""
        extras = _as_extras(data.get("profileExtras") or data.get("profile_extras"))
        execute_void(
            """
            INSERT INTO lawyers (
              user_id, name, email, specialization, lawyer_type, experience, hourly_rate,
              bio, about, headline, location, city, state, avatar, cover_image,
              contact_number, bar_registration_number, practice_areas, courts_practiced,
              languages, availability_hours, consultation_modes, website_url, linkedin_url,
              profile_extras
            ) VALUES (
              %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb
            )
            ON CONFLICT (user_id) DO UPDATE SET
              name = EXCLUDED.name, email = EXCLUDED.email, specialization = EXCLUDED.specialization,
              lawyer_type = EXCLUDED.lawyer_type, experience = EXCLUDED.experience,
              hourly_rate = EXCLUDED.hourly_rate, bio = EXCLUDED.bio, about = EXCLUDED.about,
              headline = EXCLUDED.headline, location = EXCLUDED.location, city = EXCLUDED.city,
              state = EXCLUDED.state, avatar = EXCLUDED.avatar, cover_image = EXCLUDED.cover_image,
              contact_number = EXCLUDED.contact_number,
              bar_registration_number = EXCLUDED.bar_registration_number,
              practice_areas = EXCLUDED.practice_areas, courts_practiced = EXCLUDED.courts_practiced,
              languages = EXCLUDED.languages, availability_hours = EXCLUDED.availability_hours,
              consultation_modes = EXCLUDED.consultation_modes, website_url = EXCLUDED.website_url,
              linkedin_url = EXCLUDED.linkedin_url, profile_extras = EXCLUDED.profile_extras,
              updated_at = now()
            """,
            (
                uid,
                data.get("name"),
                data.get("email"),
                specialization,
                data.get("lawyerType") or data.get("lawyer_type"),
                data.get("experience"),
                data.get("hourlyRate") or data.get("hourly_rate"),
                data.get("bio") or about,
                about,
                data.get("headline") or "",
                data.get("location"),
                data.get("city"),
                data.get("state"),
                data.get("avatar"),
                data.get("coverImage") or data.get("cover_image"),
                data.get("contactNumber") or data.get("contact_number") or "",
                data.get("barRegistrationNumber") or data.get("bar_registration_number") or "",
                practice_areas,
                _as_text_list(data.get("courtsPracticed") or data.get("courts_practiced")),
                _as_text_list(data.get("languages")),
                data.get("availabilityHours") or data.get("availability_hours") or "",
                _as_text_list(data.get("consultationModes") or data.get("consultation_modes")),
                data.get("websiteUrl") or data.get("website_url") or "",
                data.get("linkedinUrl") or data.get("linkedin_url") or "",
                _json(extras),
            ),
        )
        return True
    except Exception as e:
        print(f"Error upserting lawyer directory: {e}")
        return False


def get_lawyers_by_ids(lawyer_ids: list):
    if not lawyer_ids:
        return []
    try:
        return execute(
            f"SELECT {_LAWYER_PROFILE_COLS} FROM lawyers WHERE user_id = ANY(%s)",
            (list(lawyer_ids),),
        )
    except Exception as e:
        print(f"Error fetching lawyers by IDs: {e}")
        return []


def get_lawyer_profile(uid: str) -> Optional[dict]:
    try:
        return execute_one(
            f"SELECT {_LAWYER_PROFILE_COLS} FROM lawyers WHERE user_id = %s LIMIT 1",
            (uid,),
        )
    except Exception as e:
        print(f"Error fetching lawyer profile: {e}")
        return None


def update_lawyer_profile(uid: str, data: dict):
    try:
        field_map = {
            "name": "name",
            "email": "email",
            "specialization": "specialization",
            "lawyerType": "lawyer_type",
            "lawyer_type": "lawyer_type",
            "experience": "experience",
            "hourlyRate": "hourly_rate",
            "hourly_rate": "hourly_rate",
            "bio": "bio",
            "about": "about",
            "headline": "headline",
            "location": "location",
            "city": "city",
            "state": "state",
            "avatar": "avatar",
            "coverImage": "cover_image",
            "cover_image": "cover_image",
            "barRegistrationNumber": "bar_registration_number",
            "bar_registration_number": "bar_registration_number",
            "contactNumber": "contact_number",
            "contact_number": "contact_number",
            "availabilityHours": "availability_hours",
            "availability_hours": "availability_hours",
            "websiteUrl": "website_url",
            "website_url": "website_url",
            "linkedinUrl": "linkedin_url",
            "linkedin_url": "linkedin_url",
        }
        list_fields = {
            "practiceAreas": "practice_areas",
            "practice_areas": "practice_areas",
            "courtsPracticed": "courts_practiced",
            "courts_practiced": "courts_practiced",
            "languages": "languages",
            "consultationModes": "consultation_modes",
            "consultation_modes": "consultation_modes",
        }
        updates = []
        params: list[Any] = []
        for src, col in field_map.items():
            if src in data:
                updates.append(f"{col} = %s")
                params.append(data[src])
        for src, col in list_fields.items():
            if src in data:
                updates.append(f"{col} = %s")
                params.append(_as_text_list(data[src]))
        if "profileExtras" in data or "profile_extras" in data:
            updates.append("profile_extras = %s::jsonb")
            params.append(_json(_as_extras(data.get("profileExtras") or data.get("profile_extras"))))
        # Keep specialization in sync with first practice area when multi-select used
        if "practiceAreas" in data or "practice_areas" in data:
            areas = _as_text_list(data.get("practiceAreas") or data.get("practice_areas"))
            if areas and "specialization" not in data:
                updates.append("specialization = %s")
                params.append(areas[0])
        if "about" in data and "bio" not in data:
            updates.append("bio = %s")
            params.append(data["about"])
        if not updates:
            return False
        updates.append("updated_at = now()")
        params.append(uid)
        rows = execute(
            f"UPDATE lawyers SET {', '.join(updates)} WHERE user_id = %s RETURNING id",
            params,
        )
        if rows:
            return get_lawyer_profile(uid)
        return False
    except Exception as e:
        print(f"Error updating lawyer profile: {e}")
        return False


def create_or_get_lawyer_thread(
    victim_user_id: str,
    lawyer_user_id: str,
    lawyer_case_id: Optional[str] = None,
) -> Optional[dict]:
    try:
        existing = execute_one(
            """
            SELECT * FROM lawyer_threads
            WHERE victim_user_id = %s AND lawyer_user_id = %s
            LIMIT 1
            """,
            (victim_user_id, lawyer_user_id),
        )
        if existing:
            if lawyer_case_id and not existing.get("lawyer_case_id"):
                rows = execute(
                    """
                    UPDATE lawyer_threads
                    SET lawyer_case_id = %s, updated_at = now()
                    WHERE id = %s
                    RETURNING *
                    """,
                    (lawyer_case_id, existing["id"]),
                )
                return rows[0] if rows else existing
            return existing
        rows = execute(
            """
            INSERT INTO lawyer_threads (victim_user_id, lawyer_user_id, lawyer_case_id)
            VALUES (%s, %s, %s)
            RETURNING *
            """,
            (victim_user_id, lawyer_user_id, lawyer_case_id),
        )
        return rows[0] if rows else None
    except Exception as e:
        print(f"Error creating lawyer thread: {e}")
        return None


def list_lawyer_threads_for_user(user_id: str, role: str = "victim") -> list[dict]:
    try:
        if (role or "").lower() == "lawyer":
            return execute(
                """
                SELECT t.*,
                       l.name AS lawyer_name, l.avatar AS lawyer_avatar,
                       l.specialization AS lawyer_specialization, l.headline AS lawyer_headline,
                       l.practice_areas AS lawyer_practice_areas,
                       (
                         SELECT m.body FROM lawyer_messages m
                         WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
                       ) AS last_message,
                       (
                         SELECT m.created_at FROM lawyer_messages m
                         WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
                       ) AS last_message_at,
                       u.display_name AS victim_name, u.email AS victim_email
                FROM lawyer_threads t
                LEFT JOIN lawyers l ON l.user_id = t.lawyer_user_id
                LEFT JOIN users u ON u.id::text = t.victim_user_id OR u.firebase_uid = t.victim_user_id
                WHERE t.lawyer_user_id = %s
                ORDER BY COALESCE(
                  (SELECT m.created_at FROM lawyer_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1),
                  t.updated_at
                ) DESC
                """,
                (user_id,),
            )
        return execute(
            """
            SELECT t.*,
                   l.name AS lawyer_name, l.avatar AS lawyer_avatar,
                   l.specialization AS lawyer_specialization, l.headline AS lawyer_headline,
                   l.practice_areas AS lawyer_practice_areas, l.rating AS lawyer_rating,
                   l.location AS lawyer_location, l.verified AS lawyer_verified,
                   (
                     SELECT m.body FROM lawyer_messages m
                     WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
                   ) AS last_message,
                   (
                     SELECT m.created_at FROM lawyer_messages m
                     WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
                   ) AS last_message_at
            FROM lawyer_threads t
            LEFT JOIN lawyers l ON l.user_id = t.lawyer_user_id
            WHERE t.victim_user_id = %s
            ORDER BY COALESCE(
              (SELECT m.created_at FROM lawyer_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1),
              t.updated_at
            ) DESC
            """,
            (user_id,),
        )
    except Exception as e:
        print(f"Error listing lawyer threads: {e}")
        return []


def get_lawyer_thread(thread_id: str, user_id: str) -> Optional[dict]:
    try:
        return execute_one(
            """
            SELECT * FROM lawyer_threads
            WHERE id = %s AND (victim_user_id = %s OR lawyer_user_id = %s)
            LIMIT 1
            """,
            (thread_id, user_id, user_id),
        )
    except Exception as e:
        print(f"Error fetching lawyer thread: {e}")
        return None


def list_lawyer_messages(thread_id: str, after: Optional[str] = None, limit: int = 100) -> list[dict]:
    try:
        if after:
            return execute(
                """
                SELECT * FROM lawyer_messages
                WHERE thread_id = %s AND created_at > %s
                ORDER BY created_at ASC
                LIMIT %s
                """,
                (thread_id, after, limit),
            )
        return execute(
            """
            SELECT * FROM lawyer_messages
            WHERE thread_id = %s
            ORDER BY created_at ASC
            LIMIT %s
            """,
            (thread_id, limit),
        )
    except Exception as e:
        print(f"Error listing lawyer messages: {e}")
        return []


def send_lawyer_message(thread_id: str, sender_user_id: str, body: str) -> Optional[dict]:
    try:
        text = (body or "").strip()
        if not text:
            return None
        rows = execute(
            """
            INSERT INTO lawyer_messages (thread_id, sender_user_id, body)
            VALUES (%s, %s, %s)
            RETURNING *
            """,
            (thread_id, sender_user_id, text[:4000]),
        )
        execute_void(
            "UPDATE lawyer_threads SET updated_at = now() WHERE id = %s",
            (thread_id,),
        )
        return rows[0] if rows else None
    except Exception as e:
        print(f"Error sending lawyer message: {e}")
        return None


def create_or_get_sahayak_thread(
    victim_user_id: str,
    sahayak_user_id: str,
    sahayak_case_id: Optional[str] = None,
) -> Optional[dict]:
    try:
        existing = execute_one(
            """
            SELECT * FROM sahayak_threads
            WHERE victim_user_id = %s AND sahayak_user_id = %s
            LIMIT 1
            """,
            (victim_user_id, sahayak_user_id),
        )
        if existing:
            if sahayak_case_id and not existing.get("sahayak_case_id"):
                rows = execute(
                    """
                    UPDATE sahayak_threads
                    SET sahayak_case_id = %s, updated_at = now()
                    WHERE id = %s
                    RETURNING *
                    """,
                    (sahayak_case_id, existing["id"]),
                )
                return rows[0] if rows else existing
            return existing
        rows = execute(
            """
            INSERT INTO sahayak_threads (victim_user_id, sahayak_user_id, sahayak_case_id)
            VALUES (%s, %s, %s)
            RETURNING *
            """,
            (victim_user_id, sahayak_user_id, sahayak_case_id),
        )
        return rows[0] if rows else None
    except Exception as e:
        print(f"Error creating sahayak thread: {e}")
        return None


def list_sahayak_threads_for_user(user_id: str, role: str = "victim") -> list[dict]:
    try:
        if (role or "").lower() in {"sahayak", "guide", "nyay_guide"}:
            return execute(
                """
                SELECT t.*,
                       s.name AS sahayak_name, s.avatar AS sahayak_avatar,
                       s.occupation AS sahayak_occupation, s.location AS sahayak_location,
                       s.city AS sahayak_city, s.state AS sahayak_state,
                       s.rating AS sahayak_rating, s.bio AS sahayak_bio,
                       s.languages AS sahayak_languages, s.availability AS sahayak_availability,
                       s.contact_number AS sahayak_contact, s.email AS sahayak_email,
                       s.cases_resolved AS sahayak_cases_resolved,
                       (
                         SELECT m.body FROM sahayak_messages m
                         WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
                       ) AS last_message,
                       (
                         SELECT m.created_at FROM sahayak_messages m
                         WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
                       ) AS last_message_at,
                       u.display_name AS victim_name, u.email AS victim_email
                FROM sahayak_threads t
                LEFT JOIN sahayak_profiles s ON s.uid = t.sahayak_user_id
                LEFT JOIN users u ON u.id::text = t.victim_user_id OR u.firebase_uid = t.victim_user_id
                WHERE t.sahayak_user_id = %s
                ORDER BY COALESCE(
                  (SELECT m.created_at FROM sahayak_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1),
                  t.updated_at
                ) DESC
                """,
                (user_id,),
            )
        return execute(
            """
            SELECT t.*,
                   s.name AS sahayak_name, s.avatar AS sahayak_avatar,
                   s.occupation AS sahayak_occupation, s.location AS sahayak_location,
                   s.city AS sahayak_city, s.state AS sahayak_state,
                   s.rating AS sahayak_rating, s.bio AS sahayak_bio,
                   s.languages AS sahayak_languages, s.availability AS sahayak_availability,
                   s.contact_number AS sahayak_contact, s.email AS sahayak_email,
                   s.cases_resolved AS sahayak_cases_resolved,
                   (
                     SELECT m.body FROM sahayak_messages m
                     WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
                   ) AS last_message,
                   (
                     SELECT m.created_at FROM sahayak_messages m
                     WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
                   ) AS last_message_at
            FROM sahayak_threads t
            LEFT JOIN sahayak_profiles s ON s.uid = t.sahayak_user_id
            WHERE t.victim_user_id = %s
            ORDER BY COALESCE(
              (SELECT m.created_at FROM sahayak_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1),
              t.updated_at
            ) DESC
            """,
            (user_id,),
        )
    except Exception as e:
        print(f"Error listing sahayak threads: {e}")
        return []


def get_sahayak_thread(thread_id: str, user_id: str) -> Optional[dict]:
    try:
        return execute_one(
            """
            SELECT * FROM sahayak_threads
            WHERE id = %s AND (victim_user_id = %s OR sahayak_user_id = %s)
            LIMIT 1
            """,
            (thread_id, user_id, user_id),
        )
    except Exception as e:
        print(f"Error fetching sahayak thread: {e}")
        return None


def list_sahayak_messages(thread_id: str, after: Optional[str] = None, limit: int = 100) -> list[dict]:
    try:
        if after:
            return execute(
                """
                SELECT * FROM sahayak_messages
                WHERE thread_id = %s AND created_at > %s
                ORDER BY created_at ASC
                LIMIT %s
                """,
                (thread_id, after, limit),
            )
        return execute(
            """
            SELECT * FROM sahayak_messages
            WHERE thread_id = %s
            ORDER BY created_at ASC
            LIMIT %s
            """,
            (thread_id, limit),
        )
    except Exception as e:
        print(f"Error listing sahayak messages: {e}")
        return []


def send_sahayak_message(thread_id: str, sender_user_id: str, body: str) -> Optional[dict]:
    try:
        text = (body or "").strip()
        if not text:
            return None
        rows = execute(
            """
            INSERT INTO sahayak_messages (thread_id, sender_user_id, body)
            VALUES (%s, %s, %s)
            RETURNING *
            """,
            (thread_id, sender_user_id, text[:4000]),
        )
        execute_void(
            "UPDATE sahayak_threads SET updated_at = now() WHERE id = %s",
            (thread_id,),
        )
        return rows[0] if rows else None
    except Exception as e:
        print(f"Error sending sahayak message: {e}")
        return None


def mark_chat_thread_read(channel: str, thread_id: str, user_id: str) -> bool:
    try:
        ch = (channel or "").strip().lower()
        if ch not in {"lawyer", "sahayak"}:
            return False
        execute_void(
            """
            INSERT INTO chat_thread_reads (channel, thread_id, user_id, last_read_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (channel, thread_id, user_id)
            DO UPDATE SET last_read_at = now()
            """,
            (ch, thread_id, user_id),
        )
        return True
    except Exception as e:
        print(f"Error marking chat thread read: {e}")
        return False


def list_unread_chat_items(user_id: str, limit: int = 20) -> list[dict]:
    """Unread previews across lawyer + sahayak threads for the header bell."""
    try:
        lawyer_rows = execute(
            """
            SELECT
              'lawyer'::text AS channel,
              t.id::text AS thread_id,
              t.lawyer_case_id AS case_id,
              CASE WHEN t.victim_user_id = %s THEN t.lawyer_user_id ELSE t.victim_user_id END AS peer_user_id,
              CASE
                WHEN t.victim_user_id = %s THEN COALESCE(l.name, 'Advocate')
                ELSE COALESCE(u.display_name, u.email, 'Client')
              END AS peer_name,
              (
                SELECT m.body FROM lawyer_messages m
                WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
              ) AS last_message,
              (
                SELECT m.created_at FROM lawyer_messages m
                WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
              ) AS last_message_at,
              (
                SELECT COUNT(*) FROM lawyer_messages m
                WHERE m.thread_id = t.id
                  AND m.sender_user_id <> %s
                  AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)
              ) AS unread_count
            FROM lawyer_threads t
            LEFT JOIN lawyers l ON l.user_id = t.lawyer_user_id
            LEFT JOIN users u ON u.id::text = t.victim_user_id OR u.firebase_uid = t.victim_user_id
            LEFT JOIN chat_thread_reads r
              ON r.channel = 'lawyer' AND r.thread_id = t.id AND r.user_id = %s
            WHERE (t.victim_user_id = %s OR t.lawyer_user_id = %s)
              AND EXISTS (
                SELECT 1 FROM lawyer_messages m
                WHERE m.thread_id = t.id
                  AND m.sender_user_id <> %s
                  AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)
              )
            """,
            (user_id, user_id, user_id, user_id, user_id, user_id, user_id),
        )
        sahayak_rows = execute(
            """
            SELECT
              'sahayak'::text AS channel,
              t.id::text AS thread_id,
              t.sahayak_case_id AS case_id,
              CASE WHEN t.victim_user_id = %s THEN t.sahayak_user_id ELSE t.victim_user_id END AS peer_user_id,
              CASE
                WHEN t.victim_user_id = %s THEN COALESCE(s.name, 'Nyay Guide')
                ELSE COALESCE(u.display_name, u.email, 'Client')
              END AS peer_name,
              (
                SELECT m.body FROM sahayak_messages m
                WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
              ) AS last_message,
              (
                SELECT m.created_at FROM sahayak_messages m
                WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
              ) AS last_message_at,
              (
                SELECT COUNT(*) FROM sahayak_messages m
                WHERE m.thread_id = t.id
                  AND m.sender_user_id <> %s
                  AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)
              ) AS unread_count
            FROM sahayak_threads t
            LEFT JOIN sahayak_profiles s ON s.uid = t.sahayak_user_id
            LEFT JOIN users u ON u.id::text = t.victim_user_id OR u.firebase_uid = t.victim_user_id
            LEFT JOIN chat_thread_reads r
              ON r.channel = 'sahayak' AND r.thread_id = t.id AND r.user_id = %s
            WHERE (t.victim_user_id = %s OR t.sahayak_user_id = %s)
              AND EXISTS (
                SELECT 1 FROM sahayak_messages m
                WHERE m.thread_id = t.id
                  AND m.sender_user_id <> %s
                  AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)
              )
            """,
            (user_id, user_id, user_id, user_id, user_id, user_id, user_id),
        )
        merged = list(lawyer_rows or []) + list(sahayak_rows or [])
        merged.sort(
            key=lambda r: r.get("last_message_at") or "",
            reverse=True,
        )
        return merged[:limit]
    except Exception as e:
        print(f"Error listing unread chat items: {e}")
        return []


def count_lawyer_cases_for_lawyer(uid: str) -> dict:
    try:
        row = execute_one(
            """
            SELECT
              COUNT(*) FILTER (WHERE status = 'pending') AS pending,
              COUNT(*) FILTER (WHERE status = 'accepted' AND assigned_lawyer_id = %s) AS accepted,
              COUNT(*) FILTER (WHERE assigned_lawyer_id = %s OR status = 'pending') AS total
            FROM lawyer_cases
            """,
            (uid, uid),
        )
        return {
            "pending": int((row or {}).get("pending") or 0),
            "accepted": int((row or {}).get("accepted") or 0),
            "total": int((row or {}).get("total") or 0),
        }
    except Exception as e:
        print(f"Error counting lawyer cases: {e}")
        return {"pending": 0, "accepted": 0, "total": 0}


def get_lawyer_cases(uid: str):
    try:
        return execute(
            """
            SELECT * FROM lawyer_cases
            WHERE assigned_lawyer_id = %s OR status = 'pending'
            ORDER BY created_at DESC
            """,
            (uid,),
        )
    except Exception as e:
        print(f"Error fetching lawyer cases: {e}")
        return []


def get_lawyer_case(case_id: str) -> Optional[dict]:
    try:
        return execute_one("SELECT * FROM lawyer_cases WHERE id = %s LIMIT 1", (case_id,))
    except Exception as e:
        print(f"Error fetching lawyer case: {e}")
        return None


def accept_lawyer_case(case_id: str, lawyer_id: str):
    try:
        rows = execute(
            """
            UPDATE lawyer_cases
            SET assigned_lawyer_id = %s, status = 'accepted', updated_at = now()
            WHERE id = %s
            RETURNING id
            """,
            (lawyer_id, case_id),
        )
        return bool(rows)
    except Exception as e:
        print(f"Error accepting lawyer case: {e}")
        return False


def forward_case_to_lawyer(
    user_id: str,
    structured_report: dict,
    session_id: str = None,
    user_name: str = None,
    pdf_url: str = None,
) -> str | None:
    """Create a pending lawyer case."""
    try:
        new_id = str(uuid.uuid4())
        pdf = pdf_url or (structured_report.get("pdf_url") if isinstance(structured_report, dict) else None)
        rows = execute(
            """
            INSERT INTO lawyer_cases (id, user_id, user_name, structured_report, status, session_id, pdf_url)
            VALUES (%s, %s, %s, %s::jsonb, 'pending', %s, %s)
            RETURNING id
            """,
            (new_id, user_id, user_name, _json(structured_report), session_id, pdf),
        )
        return rows[0]["id"] if rows else new_id
    except Exception as e:
        print(f"Error forwarding case to lawyer: {e}")
        return None


def get_sahayak_cases(uid: str):
    """Cases assigned to this sahayak, or pending ones they were notified about
    (plus orphan pending with empty notify list so nothing is stranded offline).
    Excludes cases this guide has declined."""
    try:
        return execute(
            """
            SELECT * FROM sahayak_cases
            WHERE (
                assigned_sahayak_id = %s
                OR (
                  status = 'pending'
                  AND (
                    %s = ANY(COALESCE(notified_user_ids, '{}'))
                    OR COALESCE(cardinality(notified_user_ids), 0) = 0
                  )
                )
              )
              AND NOT (%s = ANY(COALESCE(declined_user_ids, '{}')))
            ORDER BY created_at DESC
            """,
            (uid, uid, uid),
        )
    except Exception as e:
        print(f"Error fetching sahayak cases: {e}")
        return []


def decline_sahayak_case(case_id: str, sahayak_id: str) -> bool:
    """Remove this guide from a pending case queue without assigning anyone."""
    try:
        rows = execute(
            """
            UPDATE sahayak_cases
            SET declined_user_ids = (
                  CASE
                    WHEN %s = ANY(COALESCE(declined_user_ids, '{}'))
                    THEN COALESCE(declined_user_ids, '{}')
                    ELSE array_append(COALESCE(declined_user_ids, '{}'), %s)
                  END
                ),
                notified_user_ids = array_remove(COALESCE(notified_user_ids, '{}'), %s),
                updated_at = now()
            WHERE id = %s AND status = 'pending'
            RETURNING id
            """,
            (sahayak_id, sahayak_id, sahayak_id, case_id),
        )
        return bool(rows)
    except Exception as e:
        print(f"Error declining sahayak case: {e}")
        return False


def accept_sahayak_case(case_id: str, sahayak_id: str, sahayak_name: str = ""):
    try:
        row = execute_one("SELECT * FROM sahayak_cases WHERE id = %s LIMIT 1", (case_id,))
        if not row:
            return False
        if str(row.get("status") or "").lower() != "pending":
            return False
        notified = list(row.get("notified_user_ids") or [])
        # Allow accept if notified list empty (legacy) or caller was notified
        if notified and sahayak_id not in notified:
            # Victim-side accept from browser panel may use any guide — allow if not a closed notify set conflict
            # Still allow: victim can pick any recommended guide
            pass
        rows = execute(
            """
            UPDATE sahayak_cases
            SET assigned_sahayak_id = %s, assigned_sahayak_name = %s, status = 'accepted', updated_at = now()
            WHERE id = %s AND status = 'pending'
            RETURNING id, notified_user_ids
            """,
            (sahayak_id, sahayak_name, case_id),
        )
        return bool(rows)
    except Exception as e:
        print(f"Error accepting sahayak case: {e}")
        return False


def accept_sahayak_case_with_meta(case_id: str, sahayak_id: str, sahayak_name: str = "") -> dict | None:
    """Accept case and return row metadata (for claim notifications)."""
    try:
        rows = execute(
            """
            UPDATE sahayak_cases
            SET assigned_sahayak_id = %s, assigned_sahayak_name = %s, status = 'accepted', updated_at = now()
            WHERE id = %s AND status = 'pending'
            RETURNING id, notified_user_ids, assigned_sahayak_id
            """,
            (sahayak_id, sahayak_name, case_id),
        )
        return rows[0] if rows else None
    except Exception as e:
        print(f"Error accepting sahayak case: {e}")
        return None


def get_sahayak_profile(uid: str):
    try:
        return execute_one("SELECT * FROM sahayak_profiles WHERE uid = %s", (uid,))
    except Exception:
        return None


def update_case_pdf_url(case_id: str, pdf_url: str):
    try:
        rows = execute(
            "UPDATE cases SET pdf_url = %s, pdf_updated_at = now(), updated_at = now() WHERE id = %s RETURNING id",
            (pdf_url, case_id),
        )
        return bool(rows)
    except Exception as e:
        print(f"Error updating case PDF URL: {e}")
        return False


def get_case_pdf_url(case_id: str):
    try:
        row = execute_one("SELECT pdf_url FROM cases WHERE id = %s LIMIT 1", (case_id,))
        url = _normalize_pdf_url(row.get("pdf_url")) if row else None
        if url:
            return url

        # Lawyer-forwarded briefs live in lawyer_cases (may also store pdf on the report JSON).
        lawyer_row = execute_one(
            "SELECT pdf_url, structured_report FROM lawyer_cases WHERE id = %s LIMIT 1",
            (case_id,),
        )
        if not lawyer_row:
            return None
        url = _normalize_pdf_url(lawyer_row.get("pdf_url"))
        if url:
            return url
        report = lawyer_row.get("structured_report") or {}
        if isinstance(report, str):
            try:
                report = json.loads(report)
            except Exception:
                report = {}
        if isinstance(report, dict):
            return _normalize_pdf_url(report.get("pdf_url"))
        return None
    except Exception as e:
        print(f"Error fetching case PDF URL: {e}")
        return None


def add_case_attachment(case_id: str, file_url: str, file_type: str, file_name: str, file_size: int = None, uploaded_by: str = None):
    try:
        rows = execute(
            """
            INSERT INTO case_attachments (case_id, file_url, file_type, file_name, file_size, uploaded_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (case_id, file_url, file_type, file_name, file_size, uploaded_by),
        )
        return bool(rows)
    except Exception as e:
        print(f"Error adding case attachment: {e}")
        return False


def get_case_attachments(case_id: str):
    try:
        return execute(
            "SELECT * FROM case_attachments WHERE case_id = %s ORDER BY uploaded_at DESC",
            (case_id,),
        )
    except Exception as e:
        print(f"Error retrieving case attachments: {e}")
        return []


def get_case_file_by_type(case_id: str, file_type: str):
    try:
        return execute_one(
            """
            SELECT * FROM case_attachments
            WHERE case_id = %s AND file_type = %s
            ORDER BY uploaded_at DESC LIMIT 1
            """,
            (case_id, file_type),
        )
    except Exception as e:
        print(f"Error retrieving case file by type: {e}")
        return None


def get_all_mock_scams(limit: int = 1000):
    try:
        return execute("SELECT * FROM mock_scams ORDER BY timestamp DESC LIMIT %s", (limit,))
    except Exception as e:
        print(f"Error fetching mock scams: {e}")
        return []


def persist_case_scam_matches(
    case_id: str | None,
    matches: list[dict] | None,
    note: str | None = None,
) -> bool:
    if not case_id:
        return False
    payload = [m for m in (matches or []) if isinstance(m, dict)]
    extra = {"matched_scam_trends": payload}
    if note:
        extra["scam_similarity"] = note
    try:
        execute_void(
            """
            UPDATE cases
            SET matched_scam_trends = COALESCE(%s::jsonb, '[]'::jsonb),
                structured_report = COALESCE(structured_report, '{}'::jsonb) || %s::jsonb,
                updated_at = now()
            WHERE id = %s
            """,
            (_json(payload), _json(extra), str(case_id)),
        )
        return True
    except Exception as e:
        print(f"Error persisting case scam matches: {e}")
        return False


def upsert_sahayak_profile(uid: str, data: dict):
    try:
        field_map = {
            "name": "name",
            "email": "email",
            "contactNumber": "contact_number",
            "location": "location",
            "occupation": "occupation",
            "bio": "bio",
            "avatar": "avatar",
            "languages": "languages",
            "availability": "availability",
            "state": "state",
            "city": "city",
        }
        cols = {"uid": uid}
        for k, col in field_map.items():
            if k in data:
                cols[col] = data[k]
        columns = list(cols.keys())
        values = [cols[c] for c in columns]
        placeholders = ", ".join(["%s"] * len(columns))
        updates = ", ".join([f"{c} = EXCLUDED.{c}" for c in columns if c != "uid"])
        execute_void(
            f"""
            INSERT INTO sahayak_profiles ({', '.join(columns)})
            VALUES ({placeholders})
            ON CONFLICT (uid) DO UPDATE SET {updates}, updated_at = now()
            """,
            values,
        )
        return True
    except Exception as e:
        print(f"Error upserting sahayak profile: {e}")
        return False


def get_nodal_guide_by_location(lat: float, lon: float) -> dict | None:
    try:
        guides = execute("SELECT * FROM nodal_guides")
        if not guides:
            return None
        for g in guides:
            try:
                if float(g["lat_min"]) <= lat <= float(g["lat_max"]) and float(g["lon_min"]) <= lon <= float(g["lon_max"]):
                    return g
            except (KeyError, TypeError, ValueError):
                continue
        return guides[0]
    except Exception as e:
        print(f"Error fetching nodal guide by location: {e}")
        return None


def get_nodal_guides_for_area(state_name: str | None = None, lat=None, lon=None, limit: int = 4) -> list[dict]:
    from backend.agents.local_justice import normalize_state_name

    try:
        guides = execute("SELECT * FROM nodal_guides") or []
        if not guides:
            return []
        key = normalize_state_name(state_name)
        matched: list[dict] = []
        if key:
            for g in guides:
                gst = normalize_state_name(str(g.get("state") or ""))
                if gst == key:
                    matched.append(g)
        if lat is not None and lon is not None:
            try:
                flat, flon = float(lat), float(lon)
            except (TypeError, ValueError):
                flat = flon = None
            if flat is not None:
                geo = []
                for g in matched or guides:
                    try:
                        if float(g["lat_min"]) <= flat <= float(g["lat_max"]) and float(g["lon_min"]) <= flon <= float(g["lon_max"]):
                            geo.append(g)
                    except (KeyError, TypeError, ValueError):
                        continue
                if geo:
                    matched = geo
        pool = matched or guides
        return pool[: max(1, int(limit))]
    except Exception as e:
        print(f"Error fetching nodal guides for area: {e}")
        return []


def get_nodal_guide_by_id(guide_id: str) -> dict | None:
    if not guide_id:
        return None
    try:
        row = execute_one("SELECT * FROM nodal_guides WHERE id::text = %s LIMIT 1", (str(guide_id),))
        return row
    except Exception as e:
        print(f"Error fetching nodal guide: {e}")
        return None


def get_sahayak_profiles_for_area(state_name: str | None = None, limit: int = 5) -> list[dict]:
    from backend.agents.local_justice import normalize_state_name

    try:
        key = normalize_state_name(state_name)
        if key:
            rows = execute(
                """
                SELECT * FROM sahayak_profiles
                WHERE lower(btrim(COALESCE(state, ''))) = %s
                   OR lower(COALESCE(location, '')) LIKE %s
                ORDER BY rating DESC NULLS LAST
                LIMIT %s
                """,
                (key, f"%{key}%", limit),
            )
            if rows:
                return rows
        return get_all_sahayak_profiles(limit=limit)
    except Exception as e:
        print(f"Error fetching sahayak profiles for area: {e}")
        return []


def create_nyaysahayak_booking(
    *,
    user_id: str,
    session_id: str | None,
    case_id: str | None,
    sahayak_uid: str | None,
    sahayak_name: str | None,
    area: str | None,
    razorpay_order_id: str,
    amount_paise: int = 4900,
) -> str | None:
    try:
        rows = execute(
            """
            INSERT INTO nyaysahayak_bookings (
              user_id, session_id, case_id, sahayak_uid, sahayak_name, area,
              amount_paise, status, razorpay_order_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending', %s)
            RETURNING id
            """,
            (user_id, session_id, case_id, sahayak_uid, sahayak_name, area, amount_paise, razorpay_order_id),
        )
        return str(rows[0]["id"]) if rows else None
    except Exception as e:
        print(f"Error creating nyaysahayak booking: {e}")
        return None


def complete_nyaysahayak_booking(
    *,
    razorpay_order_id: str,
    razorpay_payment_id: str,
    thread_id: str | None = None,
    sahayak_case_id: str | None = None,
    sahayak_uid: str | None = None,
    sahayak_name: str | None = None,
) -> dict | None:
    try:
        row = execute_one(
            """
            UPDATE nyaysahayak_bookings
            SET status = 'paid',
                razorpay_payment_id = %s,
                thread_id = COALESCE(%s, thread_id),
                sahayak_case_id = COALESCE(%s, sahayak_case_id),
                sahayak_uid = COALESCE(%s, sahayak_uid),
                sahayak_name = COALESCE(%s, sahayak_name),
                updated_at = now()
            WHERE razorpay_order_id = %s
            RETURNING *
            """,
            (razorpay_payment_id, thread_id, sahayak_case_id, sahayak_uid, sahayak_name, razorpay_order_id),
        )
        return row
    except Exception as e:
        print(f"Error completing nyaysahayak booking: {e}")
        return None


def get_nyaysahayak_booking_by_order(razorpay_order_id: str) -> dict | None:
    try:
        return execute_one(
            "SELECT * FROM nyaysahayak_bookings WHERE razorpay_order_id = %s LIMIT 1",
            (razorpay_order_id,),
        )
    except Exception as e:
        print(f"Error fetching nyaysahayak booking: {e}")
        return None


def get_routing_rule(issue_type: str, state_name: Optional[str] = None) -> dict | None:
    issue = (issue_type or "").strip()
    state = (state_name or "ALL").strip() or "ALL"
    if not issue:
        return None
    try:
        rows = execute(
            """
            SELECT * FROM routing_rules
            WHERE active = true AND issue_type = %s AND state_name = ANY(%s)
            """,
            (issue, [state, "ALL"]),
        )
        if not rows:
            return None
        rows.sort(key=lambda r: (0 if r.get("state_name") == state else 1, int(r.get("priority") or 100)))
        return rows[0]
    except Exception as e:
        print(f"Error fetching routing rule: {e}")
        return None


def _normalize_state_for_routing(state_name: str) -> str:
    state = (state_name or "").strip().lower()
    if not state:
        return "ALL"
    if "delhi" in state:
        return "Delhi"
    if "bihar" in state:
        return "Bihar"
    if "uttar pradesh" in state or state == "up":
        return "Uttar Pradesh"
    if "west bengal" in state or state == "bengal":
        return "West Bengal"
    return "ALL"


def _infer_issue_type_for_routing(raw_text: str, incident_type: str) -> str:
    text = f"{raw_text} {incident_type}".lower()
    phone_context = any(k in text for k in ["phone", "mobile", "handset", "smartphone", "sim", "imei", "मोबाइल", "फोन"])
    theft_indicators = ["stolen", "snatched", "pickpocket", "robbed", "theft", "चोरी", "लूट", "chori"]
    fraud_indicators = ["otp", "bank", "upi", "sim", "whatsapp", "account", "fraud", "misuse", "phishing"]
    lost_indicators = ["lost", "missing", "misplaced", "गुम", "खो गया"]
    if phone_context:
        if any(k in text for k in fraud_indicators):
            return "phone_fraud_risk"
        if any(k in text for k in theft_indicators):
            return "phone_theft_route"
        if any(k in text for k in lost_indicators):
            return "phone_lost_only"
    incident = (incident_type or "").lower()
    if any(k in incident for k in ["domestic", "violence"]):
        return "domestic_violence"
    if any(k in incident for k in ["maintenance", "family", "divorce"]):
        return "maintenance_family"
    if any(k in incident for k in ["wage", "salary", "labour", "labor"]):
        return "wage_dispute"
    if any(k in incident for k in ["land", "possession", "property"]):
        return "land_possession"
    if any(k in incident for k in ["water", "irrigation"]):
        return "water_irrigation"
    if any(k in incident for k in ["pathway", "boundary"]):
        return "pathway_boundary"
    return "other"


def _build_state_legal_aid_link(state_name: str) -> str:
    state_map = {
        "Delhi": "https://dslsa.org",
        "Bihar": "https://bslsa.bihar.gov.in",
        "Uttar Pradesh": "https://upslsa.up.nic.in",
        "West Bengal": "https://wbslsa.bangla.gov.in",
    }
    return state_map.get(state_name, "https://legalaid.gov.in")


def get_intervention_routing_recommendation(structured_report: dict, user_statement: str = "", location: dict | None = None) -> dict | None:
    report = structured_report or {}
    loc = location or {}
    raw_text = f"{report.get('summary', '')} {user_statement}".strip()
    incident_type = str(report.get("incident_type", ""))
    issue_type = _infer_issue_type_for_routing(raw_text, incident_type)
    state_name = _normalize_state_for_routing(str(loc.get("state") or ""))
    rule = get_routing_rule(issue_type, state_name)
    if not rule:
        return None
    links = dict(rule.get("action_links") or {})
    if rule.get("legal_aid_support"):
        links["nalsa"] = links.get("nalsa") or "https://nalsa.gov.in"
        links["legal_aid"] = links.get("legal_aid") or "https://legalaid.gov.in"
        links["state_legal_aid"] = _build_state_legal_aid_link(state_name)
    return {
        "issue_type": issue_type,
        "state": state_name,
        "primary_forum": rule.get("primary_forum"),
        "secondary_forum": rule.get("secondary_forum"),
        "routing_message": rule.get("routing_message"),
        "legal_aid_support": {
            "enabled": bool(rule.get("legal_aid_support")),
            "level": rule.get("legal_aid_level") or "DLSA/SLSA",
            "reason": rule.get("reason") or "Free legal aid may help with drafting and forum guidance.",
        },
        "links": links,
    }


def _filter_by_bbox(rows: list[dict], lat: float, lon: float) -> list[dict]:
    matched = []
    for row in rows:
        try:
            if row.get("lat_min") and row.get("lat_max") and row.get("lon_min") and row.get("lon_max"):
                if float(row["lat_min"]) <= lat <= float(row["lat_max"]) and float(row["lon_min"]) <= lon <= float(row["lon_max"]):
                    matched.append(row)
        except (TypeError, ValueError):
            continue
    return matched


def get_female_lawyers_by_location(lat: float, lon: float, state: str = "Delhi") -> list[dict]:
    try:
        normalized_state = (state or "").strip()
        if normalized_state in {"", "Unknown", "ALL"}:
            normalized_state = "Delhi"
        lawyers = execute(
            "SELECT * FROM female_lawyers WHERE state = %s AND verified = true",
            (normalized_state,),
        )
        if lat is not None and lon is not None:
            matched = _filter_by_bbox(lawyers, lat, lon)
            return (matched or lawyers)[:4]
        return lawyers[:4]
    except Exception as e:
        print(f"Error fetching female lawyers: {e}")
        return []


def get_female_nyayguides_by_location(lat: float, lon: float, state: str = "Delhi") -> list[dict]:
    try:
        normalized_state = (state or "").strip()
        if normalized_state in {"", "Unknown", "ALL"}:
            normalized_state = "Delhi"
        rows: list[dict] = []
        for table_name in ("female_nyayguides", "female_counsellors"):
            try:
                rows = execute(
                    f"SELECT * FROM {table_name} WHERE state = %s AND verified = true",
                    (normalized_state,),
                )
                if rows:
                    break
            except Exception:
                continue
        if lat is not None and lon is not None:
            matched = _filter_by_bbox(rows, lat, lon)
            return (matched or rows)[:4]
        return rows[:4]
    except Exception as e:
        print(f"Error fetching female NyayGuides: {e}")
        return []


def get_female_counsellors_by_location(lat: float, lon: float, state: str = "Delhi") -> list[dict]:
    return get_female_nyayguides_by_location(lat, lon, state)


def match_legal_documents(query_embedding: list[float], match_count: int = 5, filter_category: str | None = None):
    try:
        return execute(
            "SELECT * FROM match_legal_documents(%s::vector, %s, %s)",
            (_format_pgvector(query_embedding), int(match_count), filter_category),
        )
    except Exception as e:
        print(f"Error in match_legal_documents: {e}")
        return []


# ---------------------------------------------------------------------------
# Articles (knowledge base + semantic search)
# ---------------------------------------------------------------------------

_ARTICLE_LIST_COLS = (
    "id, slug, title, category, summary, author, tags, read_minutes, "
    "hero_image, published_at"
)


def list_articles(
    limit: int = 24,
    offset: int = 0,
    category: str | None = None,
) -> list[dict]:
    try:
        params: list[Any] = []
        where = ""
        if category:
            where = "WHERE category = %s"
            params.append(category)
        params.extend([int(limit), int(offset)])
        return execute(
            f"""
            SELECT {_ARTICLE_LIST_COLS}
            FROM public.articles
            {where}
            ORDER BY published_at DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params),
        )
    except Exception as e:
        print(f"Error in list_articles: {e}")
        return []


def list_articles_diverse(limit: int = 3) -> list[dict]:
    """Prefer one latest article per category; pad with same-category recents if needed."""
    cap = max(1, int(limit))
    try:
        diverse = execute(
            f"""
            SELECT {_ARTICLE_LIST_COLS}
            FROM (
                SELECT DISTINCT ON (lower(btrim(category)))
                    {_ARTICLE_LIST_COLS}
                FROM public.articles
                WHERE category IS NOT NULL AND btrim(category) <> ''
                ORDER BY lower(btrim(category)), published_at DESC NULLS LAST
            ) one_per_category
            ORDER BY published_at DESC NULLS LAST
            LIMIT %s
            """,
            (cap,),
        )
        if len(diverse) >= cap:
            return diverse[:cap]
        picked = {str(row.get("id")) for row in diverse}
        extras = list_articles(limit=cap * 4, offset=0)
        for row in extras:
            rid = str(row.get("id") or "")
            if not rid or rid in picked:
                continue
            diverse.append(row)
            picked.add(rid)
            if len(diverse) >= cap:
                break
        return diverse[:cap]
    except Exception as e:
        print(f"Error in list_articles_diverse: {e}")
        return []


def admin_list_articles(
    limit: int = 25,
    offset: int = 0,
    category: str | None = None,
    q: str | None = None,
) -> list[dict]:
    try:
        clauses: list[str] = []
        params: list[Any] = []
        if category:
            clauses.append("category = %s")
            params.append(category)
        if q:
            clauses.append("(title ILIKE %s OR summary ILIKE %s OR category ILIKE %s)")
            like = f"%{q}%"
            params.extend([like, like, like])
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        params.extend([int(limit), int(offset)])
        return execute(
            f"""
            SELECT id, slug, title, category, summary, author, tags, read_minutes,
                   hero_image, published_at, updated_at,
                   meta_title, meta_description, robots,
                   (embedding IS NOT NULL) AS has_embedding
            FROM public.articles
            {where}
            ORDER BY updated_at DESC NULLS LAST, published_at DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params),
        )
    except Exception as e:
        print(f"Error in admin_list_articles: {e}")
        return []


def admin_count_articles(category: str | None = None, q: str | None = None) -> int:
    try:
        clauses: list[str] = []
        params: list[Any] = []
        if category:
            clauses.append("category = %s")
            params.append(category)
        if q:
            clauses.append("(title ILIKE %s OR summary ILIKE %s OR category ILIKE %s)")
            like = f"%{q}%"
            params.extend([like, like, like])
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        row = execute_one(
            f"SELECT count(*) AS n FROM public.articles {where}",
            tuple(params) if params else None,
        )
        return int(row["n"]) if row else 0
    except Exception as e:
        print(f"Error in admin_count_articles: {e}")
        return 0


def list_article_categories() -> list[str]:
    try:
        rows = execute("SELECT DISTINCT category FROM public.articles ORDER BY category")
        return [r["category"] for r in rows if r.get("category")]
    except Exception as e:
        print(f"Error in list_article_categories: {e}")
        return []


def count_articles(category: str | None = None) -> int:
    try:
        if category:
            row = execute_one(
                "SELECT count(*) AS n FROM public.articles WHERE category = %s",
                (category,),
            )
        else:
            row = execute_one("SELECT count(*) AS n FROM public.articles")
        return int(row["n"]) if row else 0
    except Exception as e:
        print(f"Error in count_articles: {e}")
        return 0


_ARTICLE_DETAIL_COLS = (
    "id, slug, title, category, summary, content, author, tags, "
    "read_minutes, hero_image, published_at, "
    "meta_title, meta_description, meta_keywords, og_image, robots, "
    "canonical_path, structured_data"
)


def get_article(article_id: str) -> dict | None:
    try:
        return execute_one(
            f"""
            SELECT {_ARTICLE_DETAIL_COLS}
            FROM public.articles
            WHERE id = %s OR slug = %s
            LIMIT 1
            """,
            (article_id, article_id),
        )
    except Exception as e:
        print(f"Error in get_article: {e}")
        return None


def list_article_slugs(limit: int = 500) -> list[dict]:
    """Lightweight rows for sitemap / SEO expansion."""
    try:
        return execute(
            """
            SELECT id, slug, published_at, updated_at
            FROM public.articles
            ORDER BY published_at DESC NULLS LAST
            LIMIT %s
            """,
            (int(limit),),
        )
    except Exception as e:
        print(f"Error in list_article_slugs: {e}")
        return []


def match_articles(
    query_embedding: list[float],
    match_count: int = 10,
    filter_category: str | None = None,
) -> list[dict]:
    try:
        return execute(
            "SELECT * FROM match_articles(%s::vector, %s, %s)",
            (_format_pgvector(query_embedding), int(match_count), filter_category),
        )
    except Exception as e:
        print(f"Error in match_articles: {e}")
        return []


_ARTICLE_WRITE_FIELDS = (
    "slug", "title", "category", "summary", "content", "author",
    "tags", "read_minutes", "hero_image", "published_at",
    "meta_title", "meta_description", "meta_keywords", "og_image",
    "robots", "canonical_path", "structured_data",
)


def _slugify(text: str) -> str:
    import re

    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    s = re.sub(r"-{2,}", "-", s)
    return s or f"article-{uuid.uuid4().hex[:8]}"


def _ensure_unique_slug(base_slug: str, exclude_id: str | None = None) -> str:
    slug = base_slug
    n = 1
    while True:
        if exclude_id:
            row = execute_one(
                "SELECT id FROM public.articles WHERE slug = %s AND id <> %s LIMIT 1",
                (slug, exclude_id),
            )
        else:
            row = execute_one("SELECT id FROM public.articles WHERE slug = %s LIMIT 1", (slug,))
        if not row:
            return slug
        n += 1
        slug = f"{base_slug}-{n}"


def create_article(data: dict, embedding: list[float] | None = None) -> dict | None:
    try:
        title = (data.get("title") or "").strip()
        base_slug = (data.get("slug") or "").strip() or _slugify(title)
        slug = _ensure_unique_slug(_slugify(base_slug))
        tags = data.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        row = execute_one(
            f"""
            INSERT INTO public.articles
              (slug, title, category, summary, content, author, tags, read_minutes,
               hero_image, published_at, embedding,
               meta_title, meta_description, meta_keywords, og_image, robots,
               canonical_path, structured_data)
            VALUES (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, now()), %s,
              %s, %s, %s, %s, COALESCE(%s, 'index,follow'), %s, %s::jsonb
            )
            RETURNING {_ARTICLE_DETAIL_COLS}
            """,
            (
                slug,
                title,
                (data.get("category") or "General").strip(),
                data.get("summary") or "",
                data.get("content") or "",
                (data.get("author") or "NyaySahayak Editorial").strip(),
                tags,
                int(data.get("read_minutes") or 5),
                data.get("hero_image"),
                data.get("published_at"),
                _format_pgvector(embedding) if embedding else None,
                data.get("meta_title"),
                data.get("meta_description"),
                data.get("meta_keywords"),
                data.get("og_image"),
                data.get("robots") or "index,follow",
                data.get("canonical_path"),
                json.dumps(data.get("structured_data")) if data.get("structured_data") is not None else None,
            ),
        )
        return row
    except Exception as e:
        print(f"Error in create_article: {e}")
        raise


def update_article(article_id: str, data: dict, embedding: list[float] | None = None) -> dict | None:
    try:
        sets: list[str] = []
        params: list[Any] = []
        for field in _ARTICLE_WRITE_FIELDS:
            if field not in data:
                continue
            value = data[field]
            if field == "slug":
                value = _ensure_unique_slug(_slugify(value or ""), exclude_id=article_id)
            if field == "tags" and isinstance(value, str):
                value = [t.strip() for t in value.split(",") if t.strip()]
            if field == "read_minutes":
                value = int(value or 5)
            if field == "structured_data":
                sets.append("structured_data = %s::jsonb")
                params.append(json.dumps(value) if value is not None else None)
                continue
            sets.append(f"{field} = %s")
            params.append(value)
        if embedding is not None:
            sets.append("embedding = %s::vector")
            params.append(_format_pgvector(embedding))
        if not sets:
            return get_article(article_id)
        params.append(article_id)
        row = execute_one(
            f"""
            UPDATE public.articles
            SET {', '.join(sets)}, updated_at = now()
            WHERE id = %s
            RETURNING {_ARTICLE_DETAIL_COLS}
            """,
            tuple(params),
        )
        return row
    except Exception as e:
        print(f"Error in update_article: {e}")
        raise


def delete_article(article_id: str) -> bool:
    try:
        rows = execute(
            "DELETE FROM public.articles WHERE id = %s RETURNING id",
            (article_id,),
        )
        return bool(rows)
    except Exception as e:
        print(f"Error in delete_article: {e}")
        raise


def article_has_embedding_map(ids: list[str]) -> dict[str, bool]:
    if not ids:
        return {}
    try:
        rows = execute(
            "SELECT id, (embedding IS NOT NULL) AS has_embedding FROM public.articles WHERE id = ANY(%s)",
            (ids,),
        )
        return {r["id"]: bool(r["has_embedding"]) for r in rows}
    except Exception as e:
        print(f"Error in article_has_embedding_map: {e}")
        return {}


# ---------------------------------------------------------------------------
# Sidebar section content (legal rights, document/case templates, site content)
# ---------------------------------------------------------------------------

def list_legal_rights() -> list[dict]:
    try:
        return execute(
            """
            SELECT id, title, description, action_prompt, category, icon_key
            FROM public.legal_rights
            WHERE active = true
            ORDER BY sort_order ASC, title ASC
            """
        )
    except Exception as e:
        print(f"Error in list_legal_rights: {e}")
        return []


def list_document_templates(category: str | None = None) -> list[dict]:
    try:
        params: list[Any] = []
        where = "WHERE active = true"
        if category:
            where += " AND category = %s"
            params.append(category)
        return execute(
            f"""
            SELECT id, title, category, description, body, fields, format
            FROM public.document_templates
            {where}
            ORDER BY sort_order ASC, title ASC
            """,
            tuple(params) if params else None,
        )
    except Exception as e:
        print(f"Error in list_document_templates: {e}")
        return []


def list_case_filing_templates(category: str | None = None) -> list[dict]:
    try:
        params: list[Any] = []
        where = "WHERE active = true"
        if category:
            where += " AND category = %s"
            params.append(category)
        return execute(
            f"""
            SELECT id, title, category, description, steps, required_docs,
                   estimated_time, authority, action_prompt
            FROM public.case_filing_templates
            {where}
            ORDER BY sort_order ASC, title ASC
            """,
            tuple(params) if params else None,
        )
    except Exception as e:
        print(f"Error in list_case_filing_templates: {e}")
        return []


def get_case_filing_template(template_id: str) -> dict | None:
    try:
        return execute_one(
            """
            SELECT id, title, category, description, steps, required_docs,
                   estimated_time, authority, action_prompt
            FROM public.case_filing_templates
            WHERE id = %s AND active = true
            """,
            (template_id,),
        )
    except Exception as e:
        print(f"Error in get_case_filing_template: {e}")
        return None


def get_site_content(slug: str) -> dict | None:
    try:
        row = execute_one(
            "SELECT slug, value FROM public.site_content WHERE slug = %s",
            (slug,),
        )
        return row
    except Exception as e:
        print(f"Error in get_site_content: {e}")
        return None


# ── Moderator queue / SLA / revisions ──────────────────────────────────────


def assign_intervention_moderator(case_id: str, moderator_id: str) -> bool:
    """Exclusive assign + notify list of one."""
    try:
        execute_void(
            """
            UPDATE interventions
            SET assigned_moderator_id = %s,
                assigned_at = COALESCE(assigned_at, now()),
                notified_user_ids = ARRAY[%s]::text[],
                updated_at = now()
            WHERE id = %s
            """,
            (moderator_id, moderator_id, case_id),
        )
        return True
    except Exception as e:
        print(f"Error assigning intervention moderator: {e}")
        return False


def list_unassigned_pending_interventions(limit: int = 20) -> list[dict]:
    try:
        return (
            execute(
                """
                SELECT id, user_id, structured_report, session_id, user_statement, location, created_at
                FROM interventions
                WHERE collection_name = 'moderator'
                  AND status = 'pending'
                  AND (assigned_moderator_id IS NULL OR assigned_moderator_id = '')
                ORDER BY created_at ASC
                LIMIT %s
                """,
                (max(1, min(50, int(limit))),),
            )
            or []
        )
    except Exception as e:
        print(f"Error listing unassigned interventions: {e}")
        return []


def count_assigned_interventions_in_hour(uid: str) -> int:
    """Pending + recently assigned in rolling 60 minutes (capacity window)."""
    try:
        row = execute_one(
            """
            SELECT COUNT(*)::int AS n FROM interventions
            WHERE assigned_moderator_id = %s
              AND assigned_at >= now() - interval '60 minutes'
              AND status IN ('pending', 'reviewed')
            """,
            (uid,),
        )
        return int((row or {}).get("n") or 0)
    except Exception:
        return 0


def count_open_assigned_interventions(uid: str) -> int:
    try:
        row = execute_one(
            """
            SELECT COUNT(*)::int AS n FROM interventions
            WHERE assigned_moderator_id = %s AND status = 'pending'
            """,
            (uid,),
        )
        return int((row or {}).get("n") or 0)
    except Exception:
        return 0


def ensure_moderator_performance(moderator_id: str) -> dict:
    try:
        row = execute_one(
            "SELECT * FROM moderator_performance WHERE moderator_id = %s",
            (moderator_id,),
        )
        if row:
            return row
        rows = execute(
            """
            INSERT INTO moderator_performance (moderator_id)
            VALUES (%s)
            ON CONFLICT (moderator_id) DO UPDATE SET updated_at = now()
            RETURNING *
            """,
            (moderator_id,),
        )
        return rows[0] if rows else {"moderator_id": moderator_id, "respect_score": 100}
    except Exception as e:
        print(f"Error ensuring moderator performance: {e}")
        return {"moderator_id": moderator_id, "respect_score": 100, "delay_score_total": 0}


def get_moderator_performance(moderator_id: str) -> dict:
    return ensure_moderator_performance(moderator_id)


def get_moderator_respect_scores(uids: list[str]) -> dict[str, float]:
    if not uids:
        return {}
    try:
        rows = execute(
            """
            SELECT moderator_id, respect_score
            FROM moderator_performance
            WHERE moderator_id = ANY(%s)
            """,
            (list(uids),),
        ) or []
        return {str(r["moderator_id"]): float(r.get("respect_score") or 100) for r in rows}
    except Exception:
        return {}


def get_assigned_interventions_for_moderator(moderator_id: str, include_resolved: bool = False) -> list[dict]:
    try:
        if include_resolved:
            rows = execute(
                """
                SELECT * FROM interventions
                WHERE collection_name = 'moderator'
                  AND assigned_moderator_id = %s
                ORDER BY
                  CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
                  assigned_at DESC NULLS LAST,
                  created_at DESC
                LIMIT 100
                """,
                (moderator_id,),
            ) or []
        else:
            rows = execute(
                """
                SELECT * FROM interventions
                WHERE collection_name = 'moderator'
                  AND status = 'pending'
                  AND assigned_moderator_id = %s
                ORDER BY assigned_at ASC NULLS LAST, created_at ASC
                """,
                (moderator_id,),
            ) or []
        out = []
        for row in rows:
            report = row.get("structured_report") or {}
            out.append(
                {
                    "case_id": row.get("id"),
                    "user_id": row.get("user_id"),
                    "structured_report": report,
                    "status": row.get("status"),
                    "created_at": row.get("created_at"),
                    "assigned_at": row.get("assigned_at"),
                    "assigned_moderator_id": row.get("assigned_moderator_id"),
                    "delay_score": int(row.get("delay_score") or 0),
                    "sla_breached_at": row.get("sla_breached_at"),
                    "session_id": row.get("session_id"),
                    "pdf_url": _normalize_pdf_url(
                        (report or {}).get("pdf_url") if isinstance(report, dict) else None
                    ),
                    "user_statement": row.get("user_statement", ""),
                    "location": row.get("location") or {},
                    "notified_user_ids": row.get("notified_user_ids") or [],
                    "moderator_response": row.get("moderator_response"),
                    "moderator_options": row.get("moderator_options"),
                    "routing_recommendation": get_intervention_routing_recommendation(
                        report if isinstance(report, dict) else {},
                        row.get("user_statement", ""),
                        row.get("location") or {},
                    ),
                }
            )
            upd = get_latest_moderator_updatation(str(row.get("id") or ""))
            if upd:
                out[-1]["agent_summary"] = upd.get("agent_summary")
                out[-1]["agent_chat_response"] = upd.get("agent_chat_response")
                out[-1]["agent_suggested_actions"] = upd.get("agent_suggested_actions") or []
                out[-1]["agent_suggested_links"] = upd.get("agent_suggested_links") or []
                out[-1]["agent_flags"] = upd.get("agent_flags") or {}
                out[-1]["agent_report"] = upd.get("agent_report") or report
                if upd.get("agent_pdf_url"):
                    out[-1]["pdf_url"] = _normalize_pdf_url(upd.get("agent_pdf_url"))
        return out
    except Exception as e:
        print(f"Error fetching assigned interventions: {e}")
        return []


def _revision_search_text(
    structured_report: dict | None,
    user_statement: str = "",
    moderator_response: str = "",
    agent_payload: dict | None = None,
) -> str:
    report = structured_report if isinstance(structured_report, dict) else {}
    payload = agent_payload if isinstance(agent_payload, dict) else {}
    parts = [
        str(report.get("incident_type") or ""),
        str(report.get("summary") or ""),
        str(report.get("risk_level") or ""),
        user_statement or "",
        moderator_response or "",
        str(payload.get("user_statement") or ""),
        " ".join(str(x) for x in (report.get("statutory_sections") or [])[:12]),
    ]
    return " ".join(p.strip() for p in parts if p and str(p).strip())[:8000]


def create_moderator_case_revision(
    *,
    intervention_id: str,
    agent_payload: dict,
    agent_report: dict | None = None,
    case_id: str | None = None,
    user_statement: str = "",
) -> str | None:
    try:
        report = agent_report if isinstance(agent_report, dict) else {}
        search = _revision_search_text(report, user_statement, "", agent_payload)
        # Prefer linked cases.id when intervention id equals case id or session match
        linked_case = case_id or intervention_id
        exists = execute_one("SELECT id FROM cases WHERE id = %s LIMIT 1", (linked_case,))
        case_fk = exists["id"] if exists else None
        if not case_fk and agent_payload.get("session_id"):
            sess = execute_one(
                "SELECT id FROM cases WHERE session_id = %s ORDER BY created_at DESC LIMIT 1",
                (str(agent_payload.get("session_id")),),
            )
            case_fk = sess["id"] if sess else None

        rows = execute(
            """
            INSERT INTO moderator_case_revisions (
              intervention_id, case_id, agent_payload, agent_report, status, search_text
            )
            VALUES (%s, %s, %s::jsonb, %s::jsonb, 'agent_created', %s)
            RETURNING id
            """,
            (
                intervention_id,
                case_fk,
                _json(agent_payload or {}),
                _json(report or {}),
                search,
            ),
        )
        return str(rows[0]["id"]) if rows else None
    except Exception as e:
        print(f"Error creating moderator case revision: {e}")
        return None


def update_moderator_case_revision_on_resolve(
    *,
    intervention_id: str,
    moderator_id: str | None,
    moderator_payload: dict,
    moderator_response: str = "",
) -> bool:
    try:
        row = execute_one(
            """
            SELECT id, agent_report, agent_payload, search_text
            FROM moderator_case_revisions
            WHERE intervention_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (intervention_id,),
        )
        if not row:
            # Create a minimal revision if missing
            create_moderator_case_revision(
                intervention_id=intervention_id,
                agent_payload={"source": "resolve_fallback"},
                agent_report={},
            )
            row = execute_one(
                """
                SELECT id, agent_report, agent_payload, search_text
                FROM moderator_case_revisions
                WHERE intervention_id = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (intervention_id,),
            )
        if not row:
            return False
        report = row.get("agent_report") if isinstance(row.get("agent_report"), dict) else {}
        search = _revision_search_text(
            report,
            "",
            moderator_response,
            row.get("agent_payload") if isinstance(row.get("agent_payload"), dict) else {},
        )
        execute_void(
            """
            UPDATE moderator_case_revisions
            SET moderator_payload = %s::jsonb,
                moderator_id = %s,
                status = 'resolved',
                search_text = %s,
                updated_at = now()
            WHERE id = %s
            """,
            (_json(moderator_payload or {}), moderator_id, search, row["id"]),
        )
        if moderator_id:
            ensure_moderator_performance(moderator_id)
            execute_void(
                """
                UPDATE moderator_performance
                SET cases_resolved = cases_resolved + 1,
                    updated_at = now()
                WHERE moderator_id = %s
                """,
                (moderator_id,),
            )
        return True
    except Exception as e:
        print(f"Error updating moderator revision on resolve: {e}")
        return False


def list_sla_breach_candidates(sla_minutes: int) -> list[dict]:
    try:
        return (
            execute(
                """
                SELECT id, assigned_moderator_id, assigned_at, delay_score, sla_breached_at,
                       structured_report, user_statement
                FROM interventions
                WHERE status = 'pending'
                  AND assigned_moderator_id IS NOT NULL
                  AND assigned_at IS NOT NULL
                  AND assigned_at <= now() - (%s * interval '1 minute')
                ORDER BY assigned_at ASC
                LIMIT 200
                """,
                (max(1, int(sla_minutes)),),
            )
            or []
        )
    except Exception as e:
        print(f"Error listing SLA candidates: {e}")
        return []


def apply_intervention_delay_tick(
    intervention_id: str,
    moderator_id: str,
    respect_penalty: float,
) -> dict | None:
    """Increment delay_score; set sla_breached_at once; penalize respect."""
    try:
        rows = execute(
            """
            UPDATE interventions
            SET delay_score = COALESCE(delay_score, 0) + 1,
                sla_breached_at = COALESCE(sla_breached_at, now()),
                updated_at = now()
            WHERE id = %s AND status = 'pending'
            RETURNING id, delay_score, sla_breached_at, assigned_moderator_id, assigned_at
            """,
            (intervention_id,),
        )
        if not rows:
            return None
        updated = rows[0]
        ensure_moderator_performance(moderator_id)
        # First breach bump cases_breached when delay_score becomes 1
        if int(updated.get("delay_score") or 0) == 1:
            execute_void(
                """
                UPDATE moderator_performance
                SET cases_breached = cases_breached + 1,
                    delay_score_total = delay_score_total + 1,
                    respect_score = GREATEST(0, respect_score - %s),
                    updated_at = now()
                WHERE moderator_id = %s
                """,
                (float(respect_penalty), moderator_id),
            )
        else:
            execute_void(
                """
                UPDATE moderator_performance
                SET delay_score_total = delay_score_total + 1,
                    respect_score = GREATEST(0, respect_score - %s),
                    updated_at = now()
                WHERE moderator_id = %s
                """,
                (float(respect_penalty), moderator_id),
            )
        perf = get_moderator_performance(moderator_id)
        return {**updated, "respect_score": perf.get("respect_score")}
    except Exception as e:
        print(f"Error applying delay tick: {e}")
        return None


def list_moderator_case_revisions(
    *,
    q: str = "",
    offset: int = 0,
    limit: int = 25,
    query_embedding: list[float] | None = None,
) -> dict:
    try:
        limit = max(1, min(100, int(limit)))
        offset = max(0, int(offset))
        q = (q or "").strip()

        if query_embedding and len(query_embedding) > 0:
            vec = "[" + ",".join(str(float(x)) for x in query_embedding) + "]"
            rows = execute(
                """
                SELECT r.id, r.intervention_id, r.case_id, r.status, r.moderator_id,
                       r.created_at, r.updated_at, r.search_text,
                       r.agent_report, r.moderator_payload,
                       i.delay_score, i.assigned_at, i.sla_breached_at, i.status AS intervention_status,
                       (1 - (r.embedding <=> %s::vector)) AS similarity
                FROM moderator_case_revisions r
                LEFT JOIN interventions i ON i.id = r.intervention_id
                WHERE r.embedding IS NOT NULL
                ORDER BY r.embedding <=> %s::vector
                LIMIT %s OFFSET %s
                """,
                (vec, vec, limit, offset),
            ) or []
            total_row = execute_one(
                "SELECT COUNT(*)::int AS n FROM moderator_case_revisions WHERE embedding IS NOT NULL"
            )
            return {"total": int((total_row or {}).get("n") or 0), "items": rows}

        if q:
            like = f"%{q}%"
            rows = execute(
                """
                SELECT r.id, r.intervention_id, r.case_id, r.status, r.moderator_id,
                       r.created_at, r.updated_at, r.search_text,
                       r.agent_report, r.moderator_payload,
                       i.delay_score, i.assigned_at, i.sla_breached_at, i.status AS intervention_status
                FROM moderator_case_revisions r
                LEFT JOIN interventions i ON i.id = r.intervention_id
                WHERE r.search_text ILIKE %s
                   OR r.intervention_id ILIKE %s
                   OR COALESCE(r.case_id, '') ILIKE %s
                   OR COALESCE(r.moderator_id, '') ILIKE %s
                   OR r.agent_report::text ILIKE %s
                   OR COALESCE(r.moderator_payload::text, '') ILIKE %s
                ORDER BY r.updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (like, like, like, like, like, like, limit, offset),
            ) or []
            total_row = execute_one(
                """
                SELECT COUNT(*)::int AS n
                FROM moderator_case_revisions r
                WHERE r.search_text ILIKE %s
                   OR r.intervention_id ILIKE %s
                   OR COALESCE(r.case_id, '') ILIKE %s
                   OR COALESCE(r.moderator_id, '') ILIKE %s
                   OR r.agent_report::text ILIKE %s
                   OR COALESCE(r.moderator_payload::text, '') ILIKE %s
                """,
                (like, like, like, like, like, like),
            )
            return {"total": int((total_row or {}).get("n") or 0), "items": rows}

        rows = execute(
            """
            SELECT r.id, r.intervention_id, r.case_id, r.status, r.moderator_id,
                   r.created_at, r.updated_at, r.search_text,
                   r.agent_report, r.moderator_payload,
                   i.delay_score, i.assigned_at, i.sla_breached_at, i.status AS intervention_status
            FROM moderator_case_revisions r
            LEFT JOIN interventions i ON i.id = r.intervention_id
            ORDER BY r.updated_at DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        ) or []
        total_row = execute_one("SELECT COUNT(*)::int AS n FROM moderator_case_revisions")
        return {"total": int((total_row or {}).get("n") or 0), "items": rows}
    except Exception as e:
        print(f"Error listing moderator revisions: {e}")
        return {"total": 0, "items": []}


def get_moderator_case_revision(revision_id: str) -> dict | None:
    try:
        row = execute_one(
            """
            SELECT r.*,
                   i.delay_score, i.assigned_at, i.sla_breached_at,
                   i.status AS intervention_status, i.user_statement,
                   i.assigned_moderator_id, i.moderator_response, i.moderator_options
            FROM moderator_case_revisions r
            LEFT JOIN interventions i ON i.id = r.intervention_id
            WHERE r.id = %s
            LIMIT 1
            """,
            (revision_id,),
        )
        if not row:
            return None
        row.pop("embedding", None)
        return row
    except Exception as e:
        print(f"Error fetching moderator revision: {e}")
        return None


def set_moderator_revision_embedding(revision_id: str, embedding: list[float]) -> bool:
    try:
        vec = "[" + ",".join(str(float(x)) for x in embedding) + "]"
        execute_void(
            "UPDATE moderator_case_revisions SET embedding = %s::vector, updated_at = now() WHERE id = %s",
            (vec, revision_id),
        )
        return True
    except Exception as e:
        print(f"Error setting revision embedding: {e}")
        return False


def create_moderator_updatation(
    *,
    intervention_id: str,
    case_id: str | None = None,
    session_id: str | None = None,
    langgraph_run_id: str | None = None,
    agent_summary: str | None = None,
    agent_chat_response: str | None = None,
    agent_report: dict | None = None,
    agent_suggested_actions: list | None = None,
    agent_suggested_links: list | None = None,
    agent_flags: dict | None = None,
    agent_pdf_url: str | None = None,
) -> str | None:
    try:
        report = agent_report if isinstance(agent_report, dict) else {}
        flags = agent_flags if isinstance(agent_flags, dict) else {
            "cognizable": report.get("cognizable"),
            "is_complex_mlat": report.get("is_complex_mlat"),
            "fraud_under_10k": report.get("fraud_under_10k"),
        }
        rows = execute(
            """
            INSERT INTO public.moderator_updatation (
              intervention_id, case_id, session_id, langgraph_run_id,
              agent_summary, agent_chat_response, agent_report,
              agent_suggested_actions, agent_suggested_links, agent_flags, agent_pdf_url,
              status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s, 'in_progress')
            RETURNING id
            """,
            (
                intervention_id,
                case_id,
                session_id,
                langgraph_run_id,
                agent_summary or report.get("summary"),
                agent_chat_response,
                _json(report),
                _json(agent_suggested_actions or []),
                _json(agent_suggested_links or []),
                _json(flags),
                agent_pdf_url,
            ),
        )
        return str(rows[0]["id"]) if rows else None
    except Exception as e:
        print(f"Error creating moderator_updatation: {e}")
        return None


def complete_moderator_updatation(
    *,
    intervention_id: str,
    moderator_id: str | None,
    moderator_summary: str | None = None,
    moderator_chat_response: str | None = None,
    moderator_report: dict | None = None,
    moderator_suggested_actions: list | None = None,
    moderator_suggested_links: list | None = None,
    moderator_flags: dict | None = None,
    moderator_pdf_url: str | None = None,
    moderator_notes: str | None = None,
) -> bool:
    try:
        row = execute_one(
            """
            SELECT id FROM public.moderator_updatation
            WHERE intervention_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (intervention_id,),
        )
        if not row:
            create_moderator_updatation(intervention_id=intervention_id)
            row = execute_one(
                """
                SELECT id FROM public.moderator_updatation
                WHERE intervention_id = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (intervention_id,),
            )
        if not row:
            return False
        execute_void(
            """
            UPDATE public.moderator_updatation
            SET moderator_id = COALESCE(%s, moderator_id),
                moderator_summary = %s,
                moderator_chat_response = %s,
                moderator_report = %s::jsonb,
                moderator_suggested_actions = %s::jsonb,
                moderator_suggested_links = %s::jsonb,
                moderator_flags = %s::jsonb,
                moderator_pdf_url = %s,
                moderator_notes = %s,
                status = 'completed',
                review_completed_at = now(),
                updated_at = now()
            WHERE id = %s
            """,
            (
                moderator_id,
                moderator_summary,
                moderator_chat_response,
                _json(moderator_report or {}),
                _json(moderator_suggested_actions or []),
                _json(moderator_suggested_links or []),
                _json(moderator_flags or {}),
                moderator_pdf_url,
                moderator_notes,
                row["id"],
            ),
        )
        return True
    except Exception as e:
        print(f"Error completing moderator_updatation: {e}")
        return False


def get_latest_moderator_updatation(intervention_id: str) -> dict | None:
    if not intervention_id:
        return None
    try:
        return execute_one(
            """
            SELECT * FROM public.moderator_updatation
            WHERE intervention_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (intervention_id,),
        )
    except Exception as e:
        print(f"Error fetching moderator_updatation: {e}")
        return None


def _digits_phone(raw: Any) -> str:
    s = re.sub(r"[^0-9+]", "", str(raw or "").strip())
    if s.startswith("+91") and len(s) >= 13:
        return s
    digits = re.sub(r"\D", "", s)
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    return s


def get_user_contact_snapshot(uid: str) -> dict[str, str]:
    if not uid:
        return {"name": "", "phone": ""}
    try:
        row = execute_one(
            """
            SELECT display_name, mobile, email
            FROM public.users
            WHERE id::text = %s OR firebase_uid = %s
            LIMIT 1
            """,
            (str(uid), str(uid)),
        )
        if not row:
            return {"name": "", "phone": ""}
        return {
            "name": str(row.get("display_name") or "").strip(),
            "phone": _digits_phone(row.get("mobile") or ""),
        }
    except Exception as e:
        print(f"Error loading user contact: {e}")
        return {"name": "", "phone": ""}


def resolve_female_nyayguide_assignee(guide: dict | None) -> tuple[str, str]:
    """Map a female_nyayguides row to the login uid used on the sahayak canvas."""
    if not isinstance(guide, dict):
        return "", ""
    guide_id = str(guide.get("id") or guide.get("uid") or "").strip()
    name = str(guide.get("name") or "").strip()
    email = str(guide.get("email") or "").strip().lower()
    if email:
        try:
            user = execute_one(
                "SELECT id::text AS id FROM public.users WHERE lower(email) = %s LIMIT 1",
                (email,),
            )
            if user and user.get("id"):
                return str(user["id"]), name
        except Exception:
            pass
    return guide_id, name


def create_so_call_confirmation(
    *,
    case_id: str | None,
    session_id: str | None,
    user_id: str | None,
    victim_name: str,
    victim_phone: str,
    structured_report: dict | None = None,
    document_summary: str = "",
) -> dict | None:
    try:
        new_id = str(uuid.uuid4())
        rows = execute(
            """
            INSERT INTO public.sexual_offense_call_confirmations (
              id, case_id, session_id, user_id, victim_name, victim_phone,
              structured_report, document_summary, status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, 'pending_call')
            RETURNING *
            """,
            (
                new_id,
                case_id,
                session_id,
                user_id,
                victim_name or "Survivor",
                _digits_phone(victim_phone),
                _json(structured_report or {}),
                (document_summary or "")[:4000],
            ),
        )
        return rows[0] if rows else None
    except Exception as e:
        print(f"Error creating SO call confirmation: {e}")
        return None


def list_so_call_confirmations(status: str | None = "pending_call", limit: int = 80) -> list[dict]:
    try:
        if status:
            return execute(
                """
                SELECT * FROM public.sexual_offense_call_confirmations
                WHERE status = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (status, int(limit)),
            ) or []
        return execute(
            """
            SELECT * FROM public.sexual_offense_call_confirmations
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (int(limit),),
        ) or []
    except Exception as e:
        print(f"Error listing SO call confirmations: {e}")
        return []


def get_so_call_confirmation(confirmation_id: str) -> dict | None:
    try:
        return execute_one(
            "SELECT * FROM public.sexual_offense_call_confirmations WHERE id = %s LIMIT 1",
            (str(confirmation_id),),
        )
    except Exception as e:
        print(f"Error fetching SO call confirmation: {e}")
        return None


def mark_so_call_result(
    confirmation_id: str,
    *,
    call_done: bool,
    confirmed_by: str | None = None,
) -> dict | None:
    status = "call_done" if call_done else "call_not_done"
    try:
        rows = execute(
            """
            UPDATE public.sexual_offense_call_confirmations
            SET status = %s,
                confirmed_by = %s,
                call_confirmed_at = CASE WHEN %s THEN now() ELSE call_confirmed_at END,
                updated_at = now()
            WHERE id = %s AND status IN ('pending_call', 'call_not_done')
            RETURNING *
            """,
            (status, confirmed_by, call_done, str(confirmation_id)),
        )
        return rows[0] if rows else get_so_call_confirmation(confirmation_id)
    except Exception as e:
        print(f"Error updating SO call result: {e}")
        return None


def assign_so_confirmation_to_female_nyayguide(
    confirmation_id: str,
    *,
    nyayguide: dict,
    confirmed_by: str | None = None,
) -> dict | None:
    row = get_so_call_confirmation(confirmation_id)
    if not row:
        return None
    if str(row.get("status") or "") == "assigned" and row.get("sahayak_case_id"):
        return row
    assignee_id, assignee_name = resolve_female_nyayguide_assignee(nyayguide)
    if not assignee_id:
        return None
    report = row.get("structured_report") or {}
    if isinstance(report, str):
        try:
            report = json.loads(report)
        except Exception:
            report = {}
    if not isinstance(report, dict):
        report = {}
    report = {
        **report,
        "case_category": "sexual_offence",
        "high_sensitivity": True,
        "contact": row.get("victim_phone") or report.get("contact"),
        "female_nyayguide_support_enabled": True,
        "so_call_confirmed": True,
    }
    loc = report.get("location") if isinstance(report.get("location"), dict) else {}
    sahayak_id = str(uuid.uuid4())
    try:
        execute(
            """
            INSERT INTO public.sahayak_cases (
              id, user_id, user_name, structured_report, status, session_id,
              assigned_sahayak_id, assigned_sahayak_name, location, guide_kind
            )
            VALUES (%s, %s, %s, %s::jsonb, 'accepted', %s, %s, %s, %s::jsonb, 'female_nyayguide')
            RETURNING id
            """,
            (
                sahayak_id,
                row.get("user_id"),
                row.get("victim_name") or "Survivor",
                _json(report),
                row.get("session_id"),
                assignee_id,
                assignee_name or str(nyayguide.get("name") or "Female NyayGuide"),
                _json(loc or {}),
            ),
        )
        updated = execute(
            """
            UPDATE public.sexual_offense_call_confirmations
            SET status = 'assigned',
                assigned_nyayguide_id = %s,
                assigned_nyayguide_name = %s,
                sahayak_case_id = %s,
                confirmed_by = COALESCE(%s, confirmed_by),
                call_confirmed_at = COALESCE(call_confirmed_at, now()),
                updated_at = now()
            WHERE id = %s
            RETURNING *
            """,
            (
                assignee_id,
                assignee_name or str(nyayguide.get("name") or ""),
                sahayak_id,
                confirmed_by,
                str(confirmation_id),
            ),
        )
        out = updated[0] if updated else row
        out["sahayak_case_id"] = sahayak_id
        return out
    except Exception as e:
        print(f"Error assigning SO confirmation to female NyayGuide: {e}")
        return None


def get_female_nyayguide_by_id(guide_id: str) -> dict | None:
    if not guide_id:
        return None
    try:
        for table_name in ("female_nyayguides", "female_counsellors"):
            row = execute_one(
                f"SELECT * FROM {table_name} WHERE id::text = %s LIMIT 1",
                (str(guide_id),),
            )
            if row:
                return row
        user = execute_one(
            "SELECT id::text AS id, display_name AS name, email, mobile AS contact_number FROM public.users WHERE id::text = %s LIMIT 1",
            (str(guide_id),),
        )
        return user
    except Exception as e:
        print(f"Error fetching female NyayGuide: {e}")
        return None


def list_female_nyayguides(limit: int = 40) -> list[dict]:
    try:
        rows = execute(
            """
            SELECT * FROM public.female_nyayguides
            WHERE COALESCE(verified, true) = true
            ORDER BY name ASC
            LIMIT %s
            """,
            (int(limit),),
        )
        if rows:
            return rows
        return execute(
            """
            SELECT * FROM public.female_counsellors
            WHERE COALESCE(verified, true) = true
            ORDER BY name ASC
            LIMIT %s
            """,
            (int(limit),),
        ) or []
    except Exception as e:
        print(f"Error listing female NyayGuides: {e}")
        return []


def update_case_ai_verification_status(
    case_id: str,
    status: str,
    confidence_score: Optional[float] = None,
    source: Optional[str] = None,
    reason: Optional[str] = None,
) -> bool:
    """Updates case AI verification status via supabase_case_enhance."""
    from backend.database.supabase_case_enhance import update_case_ai_verification_status as _update
    return _update(
        case_id=case_id,
        status=status,
        confidence_score=confidence_score,
        source=source,
        reason=reason,
    )

