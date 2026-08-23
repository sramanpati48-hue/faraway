import os
import threading
import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Any
import json
from supabase import create_client, Client, ClientOptions
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")
MOCK_SCAM_EMBEDDING_DIM = 768

# Lock to serialize concurrent access — prevents WinError 10035 on Windows
# (shared httpx connection pool is not thread-safe under concurrent load)
_supabase_lock = threading.Lock()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Warning: SUPABASE_URL or SUPABASE_ANON_KEY not found in environment.")
    supabase: Any = None
else:
    try:
        options = ClientOptions(headers={"Accept-Charset": "utf-8", "Content-Type": "application/json; charset=utf-8"})
        supabase: Any = create_client(SUPABASE_URL, SUPABASE_KEY, options=options)
    except Exception as e:
        print(f"Error initializing Supabase client: {e}")
        supabase: Any = None


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
    a = v1[:n]
    b = v2[:n]
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
    embedding: list | None = None,
) -> Optional[str]:
    """Insert scam trend in mock_scams. Returns new id, or None on failure."""
    client = supabase
    if client is None:
        return None

    try:
        text_to_embed = (f"{title}. {description or ''}").strip()
        vec = embedding if embedding else _embed_text_for_mock_scam(text_to_embed)
        scam_id = str(uuid.uuid4())

        payload = {
            "id": scam_id,
            "title": title,
            "description": description,
            "scam_type": scam_type,
            "risk_level": risk_level,
            "city": city,
            "lat": float(lat) if lat is not None else None,
            "lon": float(lon) if lon is not None else None,
        }

        if vec:
            payload["embedding"] = _format_pgvector(vec)

        with _supabase_lock:
            response = client.table("mock_scams").insert(payload).execute()
        return scam_id if response.data else None
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
    """Find similar scams using embedding cosine similarity against mock_scams table."""
    client = supabase
    if client is None or not query_text:
        return []

    try:
        query_embedding = _embed_text_for_mock_scam(query_text)
        if not query_embedding:
            return []

        query = client.table("mock_scams").select(
            "id, title, description, scam_type, risk_level, city, lat, lon, timestamp, embedding"
        )
        if city and city not in ("Unknown", "India"):
            query = query.eq("city", city)

        response = query.order("timestamp", desc=True).limit(candidate_limit).execute()
        candidates = response.data or []

        if lookback_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
            filtered_candidates = []
            for row in candidates:
                ts = row.get("timestamp")
                try:
                    ts_dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00")) if ts else None
                except Exception:
                    ts_dt = None
                if ts_dt is None or ts_dt >= cutoff:
                    filtered_candidates.append(row)
            candidates = filtered_candidates

        matches = []
        for row in candidates:
            row_embedding = _parse_embedding(row.get("embedding"))
            if not row_embedding:
                continue

            score = _cosine_similarity(query_embedding, _to_fixed_embedding_dim(row_embedding))
            if score >= similarity_threshold:
                matches.append({
                    "id": row.get("id"),
                    "title": row.get("title"),
                    "description": row.get("description"),
                    "scam_type": row.get("scam_type"),
                    "risk_level": row.get("risk_level"),
                    "city": row.get("city"),
                    "lat": row.get("lat"),
                    "lon": row.get("lon"),
                    "timestamp": row.get("timestamp"),
                    "similarity": round(float(score), 4),
                })

        matches.sort(key=lambda m: m.get("similarity", 0.0), reverse=True)
        return matches[:max(1, int(limit))]
    except Exception as e:
        print(f"Error finding similar mock scams: {e}")
        return []

def create_or_update_user(uid: str, email: str, role: str):
    """Creates or updates a user record in Supabase to mirror Firebase Auth."""
    if not supabase:
        return False
    try:
        incoming_role = (role or "victim").strip().lower()
        role_priority = {
            "victim": 0,
            "sahayak": 1,
            "lawyer": 1,
            "moderator": 2,
            "admin": 3,
        }

        with _supabase_lock:
            response = supabase.table("users").select("firebase_uid, role").eq("firebase_uid", uid).execute()
            rows = response.data or []
            if rows:
                existing_roles = [
                    (row.get("role") or "victim").strip().lower()
                    for row in rows
                    if isinstance(row, dict)
                ]
                # Never downgrade an existing account role during generic login sync.
                highest_existing = max(existing_roles, key=lambda r: role_priority.get(r, 0)) if existing_roles else "victim"
                effective_role = highest_existing if role_priority.get(highest_existing, 0) > role_priority.get(incoming_role, 0) else incoming_role

                supabase.table("users").update({
                    "email": email,
                    "role": effective_role
                }).eq("firebase_uid", uid).execute()
            else:
                supabase.table("users").insert({
                    "firebase_uid": uid,
                    "email": email,
                    "role": incoming_role
                }).execute()
        return True
    except Exception as e:
        print(f"Error syncing user to Supabase: {e}")
        return False

def get_user_role(uid: str) -> Optional[str]:
    """Fetches the user's role from Supabase by firebase_uid. Used as fallback when Firebase Admin is unavailable."""
    if not supabase:
        return None
    try:
        role_priority = {
            "victim": 0,
            "sahayak": 1,
            "lawyer": 1,
            "moderator": 2,
            "admin": 3,
        }
        with _supabase_lock:
            response = supabase.table("users").select("role").eq("firebase_uid", uid).execute()

        rows = response.data or []
        if rows:
            normalized_roles = [
                (row.get("role") or "victim").strip().lower()
                for row in rows
                if isinstance(row, dict)
            ]
            if normalized_roles:
                return max(normalized_roles, key=lambda r: role_priority.get(r, 0))
        return None
    except Exception as e:
        print(f"Error fetching user role from Supabase: {e}")
        return None

def get_chat_history(uid: str, session_id: Optional[str] = None):
    """Fetches chat history for the user from Supabase, optionally filtered by session_id."""
    if not supabase:
        return []
    try:
        query = supabase.table("chat_history").select("session_data").eq("user_id", uid)
        
        if session_id:
            query = query.eq("id", session_id)
        
        # Fetch the latest session matching the criteria
        response = query.order("timestamp", desc=True).limit(1).execute()
        
        if response.data and len(response.data) > 0:
            return response.data[0].get("session_data", [])
        return []
    except Exception as e:
        print(f"Error fetching chat history from Supabase: {e}")
        return []

def save_chat_history(uid: str, session_id: str, session_data: list):
    """Saves or syncs local chat history to a specific session in Supabase."""
    if not supabase:
        return False
    try:
        supabase.table("chat_history").upsert({
            "id": session_id,
            "user_id": uid,
            "session_data": session_data,
        }).execute()
        return True
    except Exception as e:
        print(f"Error saving chat history to Supabase: {e}")
        return False

def get_all_chat_sessions(uid: str):
    """Retrieves all chat sessions for a user, returning ID, timestamp, and summary/preview."""
    if not supabase:
        return []
    try:
        # Fetch all sessions, ordered by most recent
        response = supabase.table("chat_history").select("id, timestamp, session_data").eq("user_id", uid).order("timestamp", desc=True).execute()
        return response.data
    except Exception as e:
        print(f"Error fetching all chat sessions from Supabase: {e}")
        return []

def delete_chat_session(uid: str, session_id: str) -> bool:
    if not supabase:
        return False
    try:
        supabase.table("chat_history").delete().eq("id", session_id).eq("user_id", uid).execute()
        return True
    except Exception as e:
        print(f"Error deleting chat session from Supabase: {e}")
        return False

def save_user_case(uid: str, case_id: str, structured_report: dict, session_data: list):
    """Saves a completed case and its associated chat session into Supabase."""
    if not supabase:
        return False
    try:
        supabase.table("cases").upsert({
            "id": case_id,
            "user_id": uid,
            "structured_report": structured_report,
            "session_data": session_data,
            "pending": False
        }).execute()
        return True
    except Exception as e:
        print(f"Error saving user case to Supabase: {e}")
        return False


def get_pending_intervention_case_ids(user_id: str, collection_name: str = "moderator") -> set[str]:
    """Returns case IDs that currently have pending interventions."""
    if not supabase:
        return set()
    try:
        response = (
            supabase.table("interventions")
            .select("id")
            .eq("user_id", user_id)
            .eq("collection_name", collection_name)
            .eq("status", "pending")
            .execute()
        )
        return {
            str(row.get("id"))
            for row in (response.data or [])
            if row.get("id") is not None
        }
    except Exception as e:
        print(f"Error fetching pending intervention case IDs: {e}")
        return set()


def set_case_pending_status(case_id: str, is_pending: bool) -> bool:
    """Sets the pending moderator-review status on a case."""
    if not supabase or not case_id:
        return False
    try:
        response = (
            supabase.table("cases")
            .update({"pending": bool(is_pending)})
            .eq("id", case_id)
            .execute()
        )
        return bool(response.data)
    except Exception as e:
        print(f"Error updating case pending status: {e}")
        return False

def get_user_cases(uid: str):
    """Retrieves all structured cases for a given user from Supabase."""
    if not supabase:
        return []
    try:
        response = supabase.table("cases").select("*").eq("user_id", uid).order("timestamp", desc=True).execute()
        pending_case_ids = get_pending_intervention_case_ids(uid, "moderator")
        
        cases = []
        for row in response.data:
            case_id = row.get("id")
            computed_pending = str(case_id) in pending_case_ids if case_id else False
            case_data = {
                "case_id": case_id,
                "structured_report": row.get("structured_report"),
                "session": row.get("session_data"),
                "timestamp": row.get("timestamp"),
                "session_id": row.get("session_id"),
                "pdf_url": _normalize_pdf_url(row.get("pdf_url")),
                "pending": computed_pending
            }
            cases.append(case_data)
        return cases
    except Exception as e:
        print(f"Error fetching user cases from Supabase: {e}")
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
    """
    Creates a new intervention case in Supabase for moderators to review.
    Maps to `interventions` table with `collection_name` to differentiate types.
    Now also stores user_statement (exact user messages) and location for full moderator context.
    """
    if not supabase:
        return None
    try:
        enriched_report = dict(structured_report or {})
        if pdf_url:
            enriched_report["pdf_url"] = pdf_url

        payload = {
            "collection_name": collection_name,
            "structured_report": enriched_report,
            "status": "pending",
            "session_id": session_id,
            "user_statement": user_statement or "",
            "location": location or {}
        }
        
        if user_id and str(user_id).strip():
            payload["user_id"] = str(user_id).strip()
        else:
            payload["user_id"] = None

        if case_id:
            # Guard against accidentally downgrading an already reviewed/resolved
            # intervention back to pending when the same case is processed again.
            existing = (
                supabase.table("interventions")
                .select("id, status, moderator_response, resolved_at")
                .eq("id", case_id)
                .limit(1)
                .execute()
            )

            existing_row = existing.data[0] if existing.data else None
            existing_status = str((existing_row or {}).get("status") or "").strip().lower()

            if existing_row and existing_status in {"reviewed", "resolved"}:
                # Keep resolved interventions immutable by default.
                return existing_row.get("id")

            payload["id"] = case_id
            response = supabase.table("interventions").upsert(payload, on_conflict="id").execute()
            set_case_pending_status(case_id, True)
        else:
            response = supabase.table("interventions").insert(payload).execute()
        
        if response.data and len(response.data) > 0:
            return response.data[0].get("id")
        return None
    except Exception as e:
        print(f"Error creating intervention case in Supabase ({collection_name}): {e}")
        return None

def list_pending_intervention_rows(limit: int = 50) -> list[dict]:
    if not supabase:
        return []
    try:
        response = (
            supabase.table("interventions")
            .select("*")
            .eq("status", "pending")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return response.data or []
    except Exception as e:
        print(f"Error listing pending interventions from Supabase: {e}")
        return []


def list_pending_sahayak_case_rows(limit: int = 50) -> list[dict]:
    if not supabase:
        return []
    try:
        response = (
            supabase.table("sahayak_cases")
            .select("*")
            .eq("status", "pending")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return response.data or []
    except Exception as e:
        print(f"Error listing pending sahayak cases from Supabase: {e}")
        return []


def get_active_clash_mock_cases() -> list[dict]:
    if not supabase:
        return []
    try:
        response = (
            supabase.table("clash_mock_cases")
            .select("id, title, summary, facts, tags")
            .eq("active", True)
            .order("id")
            .execute()
        )
        return response.data or []
    except Exception as e:
        print(f"Error fetching clash mock cases from Supabase: {e}")
        return []


def get_pending_interventions(collection_name: str = "sahayak", notified_uid: str | None = None):
    """Fetches all pending intervention cases from the specified collection."""
    if not supabase:
        return []
    try:
        response = supabase.table("interventions").select("*").eq("collection_name", collection_name).eq("status", "pending").order("created_at", desc=True).execute()
        
        interventions = []
        for row in response.data:
            notified = row.get("notified_user_ids") or []
            if notified_uid and notified and notified_uid not in notified:
                continue
            report = row.get("structured_report") or {}
            routing_recommendation = get_intervention_routing_recommendation(
                report,
                row.get("user_statement", ""),
                row.get("location", {}),
            )
            interventions.append({
                "case_id": row.get("id"),
                "user_id": row.get("user_id"),
                "structured_report": report,
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "session_id": row.get("session_id"),
                "pdf_url": _normalize_pdf_url(report.get("pdf_url")),
                "user_statement": row.get("user_statement", ""),
                "location": row.get("location", {}),
                "notified_user_ids": notified,
                "routing_recommendation": routing_recommendation,
            })
        return interventions
    except Exception as e:
        print(f"Error fetching pending interventions from Supabase: {e}")
        return []

def forward_case_to_sahayak(user_id: str, user_name: str, structured_report: dict, session_id: str = "", location: dict = None) -> str | None:
    """Creates a pending sahayak case in Supabase and returns its UUID."""
    client = supabase
    if client is None:
        return None
    try:
        payload = {
            "user_id": user_id,
            "user_name": user_name,
            "structured_report": structured_report,
            "status": "pending",
            "session_id": session_id,
        }
        if location:
            payload["location"] = location
        response = client.table("sahayak_cases").insert(payload).execute()
        if response.data:
            return response.data[0].get("id")
        return None
    except Exception as e:
        print(f"Error forwarding case to sahayak: {e}")
        return None

def get_sahayak_case_by_session(session_id: str):
    """Returns the sahayak case (with assigned profile if any) for a given session_id."""
    client = supabase
    if client is None:
        return None
    try:
        response = (
            client.table("sahayak_cases")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if response.data:
            case = response.data[0]
            # If a sahayak is assigned, enrich with their profile
            assigned_id = case.get("assigned_sahayak_id")
            if assigned_id:
                try:
                    profile_res = client.table("sahayak_profiles").select("*").eq("uid", assigned_id).single().execute()
                    case["assigned_sahayak_profile"] = profile_res.data
                except Exception:
                    case["assigned_sahayak_profile"] = None
            return case
        return None
    except Exception as e:
        print(f"Error fetching sahayak case by session: {e}")
        return None


def get_all_sahayak_profiles(limit: int = 5) -> list:
    """Returns up to `limit` available sahayak/nodal-guide profiles from Supabase.
    Used by nodal_guide_agent to populate the Gram Nyayalaya panel."""
    client = supabase
    if client is None:
        return []
    try:
        response = (
            client.table("sahayak_profiles")
            .select(
                "uid, name, location, occupation, bio, avatar, "
                "contact_number, email, availability, rating, cases_resolved, languages"
            )
            .order("rating", desc=True)
            .limit(limit)
            .execute()
        )
        return response.data or []
    except Exception as e:
        print(f"Error fetching all sahayak profiles from Supabase: {e}")
        return []


def search_lawyers_by_specialization(incident_type: str, limit: int = 3):
    """Fetches recommended lawyers from Supabase based on specialization."""
    if not supabase:
        return []
    
    # Map incident types to broad legal specializations
    incident_lower = incident_type.lower()
    specialization_query = ""
    
    if "cyber" in incident_lower or "fraud" in incident_lower or "scam" in incident_lower:
        specialization_query = "Cyber"
    elif "property" in incident_lower or "civil" in incident_lower:
        specialization_query = "Civil"
    elif "domestic" in incident_lower or "divorce" in incident_lower or "family" in incident_lower:
        specialization_query = "Family"
    elif (
        "sexual" in incident_lower or "harassment" in incident_lower
        or "assault" in incident_lower or "criminal" in incident_lower
        or "posh" in incident_lower or "workplace" in incident_lower
    ):
        specialization_query = "Criminal"
        
    try:
        # If we have a mapped specialization, search for it using ilike
        if specialization_query:
            response = supabase.table("lawyers").select(
                "id, name, specialization, experience, hourly_rate, bio, location, rating, verified, contact_number, avatar"
            ).ilike("specialization", f"%{specialization_query}%").order("rating", desc=True).limit(limit).execute()
            
            if response.data and len(response.data) > 0:
                return response.data
                
        # Fallback: return highest-rated lawyers regardless of specialization
        fallback_res = supabase.table("lawyers").select(
            "id, name, specialization, experience, hourly_rate, bio, location, rating, verified, contact_number, avatar"
        ).order("rating", desc=True).limit(limit).execute()
        
        return fallback_res.data if fallback_res.data else []
        
    except Exception as e:
        print(f"Error searching for lawyers in Supabase: {e}")
        return []


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
):
    """Resolves a pending intervention case by adding the moderator's text and options, and updates the chat session."""
    if not supabase:
        return False
    try:
        from datetime import datetime
        normalized_options = list(options or [])
        if routing_recommendation and isinstance(routing_recommendation, dict):
            has_bundle = any(
                isinstance(o, dict) and o.get("type") == "routing_bundle"
                for o in normalized_options
            )
            if not has_bundle:
                normalized_options.append({
                    "label": "Open recommended official route",
                    "payload": "routing_bundle",
                    "type": "routing_bundle",
                    "routing_recommendation": routing_recommendation,
                })

        # 1. Update the intervention record only if it's currently pending.
        # This avoids stale clients mutating already-reviewed records.
        intervention_res = (
            supabase.table("interventions")
            .update({
                "status": "reviewed",
                "moderator_response": moderator_text,
                "moderator_options": normalized_options,
                "resolved_at": datetime.now().isoformat()
            })
            .eq("id", case_id)
            .eq("status", "pending")
            .execute()
        )

        if not intervention_res.data:
            # Fallback check: if already reviewed/resolved, treat idempotently as success.
            existing = (
                supabase.table("interventions")
                .select("id, user_id, session_id, status")
                .eq("id", case_id)
                .limit(1)
                .execute()
            )
            row = existing.data[0] if existing.data else None
            status = str((row or {}).get("status") or "").strip().lower()
            if row and status in {"reviewed", "resolved"}:
                return {
                    "success": True,
                    "user_id": row.get("user_id"),
                    "session_id": row.get("session_id"),
                    "case_id": case_id,
                    "moderator_response": moderator_text,
                    "moderator_options": normalized_options,
                    "routing_recommendation": routing_recommendation,
                }
            return False
        
        session_id = None
        user_id = None
        if intervention_res.data and len(intervention_res.data) > 0:
             session_id = intervention_res.data[0].get("session_id")
             user_id = intervention_res.data[0].get("user_id")
             
        new_msg = {
            "role": "assistant",
            "content": moderator_text,
            "agent": "legal_moderator"
        }
        
        if normalized_options and len(normalized_options) > 0:
            new_msg["options"] = normalized_options # Store options so frontend can re-render if it supports it in history
        if routing_recommendation and isinstance(routing_recommendation, dict):
            new_msg["routing_recommendation"] = routing_recommendation
            
        # 2. Mark source case as not pending
        set_case_pending_status(case_id, False)

        # 3. Append the moderator's response to the associated case's session_data
        case_response = supabase.table("cases").select("session_data").eq("id", case_id).execute()
        if case_response.data and len(case_response.data) > 0:
            session_data = case_response.data[0].get("session_data", [])
            session_data.append(new_msg)
            supabase.table("cases").update({
                "session_data": session_data
            }).eq("id", case_id).execute()
            
        # 4. Also update the live chat_history table so ChatInterface loads it immediately
        if session_id:
             chat_response = supabase.table("chat_history").select("session_data").eq("id", session_id).execute()
             if chat_response.data and len(chat_response.data) > 0:
                 chat_session_data = chat_response.data[0].get("session_data", [])
                 chat_session_data.append(new_msg)
                 supabase.table("chat_history").update({
                     "session_data": chat_session_data
                 }).eq("id", session_id).execute()
            
        return {
            "success": True,
            "user_id": user_id,
            "session_id": session_id,
            "case_id": case_id,
            "moderator_response": moderator_text,
            "moderator_options": normalized_options,
            "routing_recommendation": routing_recommendation,
        }
    except Exception as e:
        print(f"Error resolving intervention case in Supabase: {e}")
        return False


def update_pending_intervention_pdf(case_id: str, pdf_url: str, collection_name: str = "moderator") -> bool:
    """Attaches/updates PDF URL inside pending intervention's structured report."""
    if not supabase or not case_id or not pdf_url:
        return False
    try:
        response = (
            supabase.table("interventions")
            .select("structured_report")
            .eq("id", case_id)
            .eq("collection_name", collection_name)
            .eq("status", "pending")
            .limit(1)
            .execute()
        )
        if not response.data:
            return False

        current_report = response.data[0].get("structured_report") or {}
        current_report["pdf_url"] = pdf_url

        update_res = (
            supabase.table("interventions")
            .update({"structured_report": current_report})
            .eq("id", case_id)
            .eq("collection_name", collection_name)
            .eq("status", "pending")
            .execute()
        )
        return bool(update_res.data)
    except Exception as e:
        print(f"Error updating pending intervention PDF: {e}")
        return False

def search_lawyers():
    """Fetches lawyer directory rows from Supabase lawyers table."""
    client = supabase
    if client is None:
        return []
    try:
        response = (
            client.table("lawyers")
            .select("*")
            .order("rating", desc=True)
            .execute()
        )
        return response.data if response.data else []
    except Exception as e:
        print(f"Error searching lawyers from Supabase: {e}")
        return []

def register_lawyer_directory(uid: str, data: dict):
    """Upserts lawyer details into the public 'lawyers' directory table.
    
    Uses upsert so that subsequent profile saves update the existing row
    rather than failing silently with a duplicate user_id constraint error.
    """
    client = supabase
    if client is None:
        return False
    try:
        client.table("lawyers").upsert({
            "user_id": uid,
            "name": data.get("name"),
            "email": data.get("email"),
            "specialization": data.get("specialization"),
            "lawyer_type": data.get("lawyerType"),
            "experience": data.get("experience"),
            "hourly_rate": data.get("hourlyRate"),
            "bio": data.get("bio"),
            "location": data.get("location"),
            "avatar": data.get("avatar"),
            "contact_number": data.get("contactNumber", ""),
            "bar_registration_number": data.get("barRegistrationNumber", ""),
        }, on_conflict="user_id").execute()
        return True
    except Exception as e:
        print(f"Error upserting lawyer to directory in Supabase: {e}")
        return False

def get_lawyers_by_ids(lawyer_ids: list):
    """Fetches lawyer directory details by a list of user IDs."""
    client = supabase
    if client is None or not lawyer_ids:
        return []
    assert client is not None
    try:
        response = client.table("lawyers").select("*").in_("user_id", lawyer_ids).execute()
        return response.data
    except Exception as e:
        print(f"Error fetching lawyers by IDs from Supabase: {e}")
        return []

def get_lawyer_profile(uid: str) -> Optional[dict]:
    """Fetches a lawyer's profile by their user ID."""
    client = supabase
    if client is None:
         return None
    try:
         response = client.table("lawyers").select("*").eq("user_id", uid).execute()
         if response.data and len(response.data) > 0:
              return response.data[0]
         return None
    except Exception as e:
         print(f"Error fetching lawyer profile from Supabase: {e}")
         return None

def update_lawyer_profile(uid: str, data: dict):
    """Updates a lawyer's profile details."""
    client = supabase
    if client is None:
         return False
    try:
         # Build update payload
         update_payload = {}
         if "name" in data: update_payload["name"] = data["name"]
         if "email" in data: update_payload["email"] = data["email"]
         if "specialization" in data: update_payload["specialization"] = data["specialization"]
         if "lawyerType" in data: update_payload["lawyer_type"] = data["lawyerType"]
         if "experience" in data: update_payload["experience"] = data["experience"]
         if "hourlyRate" in data: update_payload["hourly_rate"] = data["hourlyRate"]
         if "bio" in data: update_payload["bio"] = data["bio"]
         if "location" in data: update_payload["location"] = data["location"]
         if "avatar" in data: update_payload["avatar"] = data["avatar"]
         if "barRegistrationNumber" in data: update_payload["bar_registration_number"] = data["barRegistrationNumber"]
         if "contactNumber" in data: update_payload["contact_number"] = data["contactNumber"]
         
         response = client.table("lawyers").update(update_payload).eq("user_id", uid).execute()
         return True if response.data else False
    except Exception as e:
         print(f"Error updating lawyer profile in Supabase: {e}")
         return False

def get_lawyer_cases(uid: str):
    """Fetches cases for a specific lawyer, including unassigned pending cases."""
    client = supabase
    if client is None:
         return []
    try:
         # To use .or_ we do: client.table("lawyer_cases").select("*").or_(f"assigned_lawyer_id.eq.{uid},status.eq.pending").execute()
         # Wait, if assigned_lawyer_id column might not exist, we should handle that gracefully.
         response = client.table("lawyer_cases").select("*").or_(f"assigned_lawyer_id.eq.{uid},status.eq.pending").order("created_at", desc=True).execute()
         return response.data if response.data else []
    except Exception as e:
         print(f"Error fetching lawyer cases from Supabase (attempting fallback): {e}")
         try:
              # Fallback if assigned_lawyer_id doesn't exist
              response = client.table("lawyer_cases").select("*").execute()
              return response.data if response.data else []
         except Exception as e2:
              print(f"Fallback error: {e2}")
              return []

def accept_lawyer_case(case_id: str, lawyer_id: str):
    """Assigns a pending case to a specific lawyer and changes its status."""
    client = supabase
    if client is None:
         return False
    try:
         response = client.table("lawyer_cases").update({
              "assigned_lawyer_id": lawyer_id,
              "status": "accepted"
         }).eq("id", case_id).execute()
         return True if response.data else False
    except Exception as e:
         print(f"Error accepting lawyer case: {e}")
         return False

# ─────────────────────────────────────────────
# SAHAYAK helpers
# ─────────────────────────────────────────────

def forward_case_to_sahayak(
    user_id: str,
    user_name: str,
    structured_report: dict,
    session_id: str = None,
    location: dict = None,
    pdf_url: str = None,
) -> str | None:
    """Creates a pending sahayak case in Supabase and returns its UUID."""
    client = supabase
    if client is None:
        return None
    try:
        payload: dict[str, Any] = {
            "user_name": user_name,
            "structured_report": structured_report,
            "status": "pending"
        }
        
        if user_id and str(user_id).strip():
            payload["user_id"] = str(user_id).strip()
        else:
            payload["user_id"] = None
            
        if session_id:
            payload["session_id"] = session_id
        if location:
            payload["location"] = location
        pdf = pdf_url or (structured_report.get("pdf_url") if isinstance(structured_report, dict) else None)
        if pdf:
            payload["pdf_url"] = pdf
        response = client.table("sahayak_cases").insert(payload).execute()
        if response.data:
            return response.data[0].get("id")
        return None
    except Exception as e:
        print(f"Error forwarding case to sahayak: {e}")
        return None


def forward_case_to_lawyer(
    user_id: str,
    structured_report: dict,
    session_id: str = None,
    user_name: str = None,
    pdf_url: str = None,
) -> str | None:
    """Create a pending lawyer case in Supabase."""
    client = supabase
    if client is None:
        return None
    try:
        payload: dict[str, Any] = {
            "user_id": user_id,
            "structured_report": structured_report,
            "status": "pending",
        }
        if user_name:
            payload["user_name"] = user_name
        if session_id:
            payload["session_id"] = session_id
        pdf = pdf_url or (structured_report.get("pdf_url") if isinstance(structured_report, dict) else None)
        if pdf:
            payload["pdf_url"] = pdf
        response = client.table("lawyer_cases").insert(payload).execute()
        if response.data:
            return response.data[0].get("id")
        return None
    except Exception as e:
        print(f"Error forwarding case to lawyer: {e}")
        return None


def set_intervention_notified_users(case_id: str, uids: list) -> bool:
    client = supabase
    if client is None:
        return False
    try:
        client.table("interventions").update({"notified_user_ids": list(uids or [])}).eq("id", case_id).execute()
        return True
    except Exception as e:
        print(f"Error setting intervention notified users: {e}")
        return False


def set_sahayak_case_notified_users(case_id: str, uids: list) -> bool:
    client = supabase
    if client is None:
        return False
    try:
        client.table("sahayak_cases").update({"notified_user_ids": list(uids or [])}).eq("id", case_id).execute()
        return True
    except Exception as e:
        print(f"Error setting sahayak notified users: {e}")
        return False


def count_notified_pending_interventions(uid: str) -> int:
    return 0


def count_notified_pending_sahayak_cases(uid: str) -> int:
    return 0


def get_intervention_row(case_id: str):
    client = supabase
    if client is None:
        return None
    try:
        res = client.table("interventions").select("*").eq("id", case_id).limit(1).execute()
        return res.data[0] if res.data else None
    except Exception:
        return None


def get_sahayak_case_row(case_id: str):
    client = supabase
    if client is None:
        return None
    try:
        res = client.table("sahayak_cases").select("*").eq("id", case_id).limit(1).execute()
        return res.data[0] if res.data else None
    except Exception:
        return None


def accept_sahayak_case_with_meta(case_id: str, sahayak_id: str, sahayak_name: str = ""):
    ok = accept_sahayak_case(case_id, sahayak_id, sahayak_name)
    if not ok:
        return None
    row = get_sahayak_case_row(case_id) or {}
    return {
        "id": case_id,
        "notified_user_ids": row.get("notified_user_ids") or [],
        "assigned_sahayak_id": sahayak_id,
    }

def get_sahayak_case_for_session(session_id: str):
    """Returns the sahayak case (with assigned profile) for a given chat session."""
    client = supabase
    if client is None:
        return None
    try:
        response = (
            client.table("sahayak_cases")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if response.data:
            case = response.data[0]
            if case.get("status") == "accepted" and case.get("assigned_sahayak_id"):
                try:
                    profile_resp = (
                        client.table("sahayak_profiles")
                        .select("*")
                        .eq("uid", case["assigned_sahayak_id"])
                        .single()
                        .execute()
                    )
                    case["assigned_sahayak_profile"] = profile_resp.data if profile_resp.data else None
                except Exception:
                    case["assigned_sahayak_profile"] = None
            return case
        return None
    except Exception as e:
        print(f"Error fetching sahayak case for session: {e}")
        return None

def get_sahayak_cases(uid: str):
    """Returns all pending cases plus cases assigned to this sahayak."""
    client = supabase
    if client is None:
        return []
    try:
        response = (
            client.table("sahayak_cases")
            .select("*")
            .or_(f"assigned_sahayak_id.eq.{uid},status.eq.pending")
            .order("created_at", desc=True)
            .execute()
        )
        return response.data if response.data else []
    except Exception as e:
        print(f"Error fetching sahayak cases: {e}")
        try:
            response = client.table("sahayak_cases").select("*").order("created_at", desc=True).execute()
            return response.data if response.data else []
        except Exception as e2:
            print(f"Fallback error: {e2}")
            return []

def accept_sahayak_case(case_id: str, sahayak_id: str, sahayak_name: str = ""):
    """Assigns a sahayak to a pending case."""
    client = supabase
    if client is None:
        return False
    try:
        response = client.table("sahayak_cases").update({
            "assigned_sahayak_id": sahayak_id,
            "assigned_sahayak_name": sahayak_name,
            "status": "accepted"
        }).eq("id", case_id).execute()
        return True if response.data else False
    except Exception as e:
        print(f"Error accepting sahayak case: {e}")
        return False

def assign_pending_nodal_guide(case_id: str, guide_id: str, guide_name: str = "") -> bool:
    return False

def get_sahayak_profile(uid: str):
    """Fetches a sahayak profile by uid."""
    client = supabase
    if client is None:
        return None
    try:
        response = client.table("sahayak_profiles").select("*").eq("uid", uid).single().execute()
        return response.data
    except Exception:
        return None

# ─────────────────────────────────────────────
# PDF and Case Attachment Management
# ─────────────────────────────────────────────

def update_case_pdf_url(case_id: str, pdf_url: str):
    """Updates the PDF URL for a case after generation and Cloudinary upload."""
    client = supabase
    if client is None:
        return False
    try:
        from datetime import datetime
        response = client.table("cases").update({
            "pdf_url": pdf_url,
            "pdf_updated_at": datetime.now().isoformat()
        }).eq("id", case_id).execute()
        return True if response.data else False
    except Exception as e:
        print(f"Error updating case PDF URL in Supabase: {e}")
        return False

def get_case_pdf_url(case_id: str):
    """Retrieves the PDF URL for a specific case (main cases or lawyer_cases)."""
    client = supabase
    if client is None:
        return None
    try:
        response = (
            client.table("cases")
            .select("pdf_url")
            .eq("id", case_id)
            .limit(1)
            .execute()
        )
        if response.data and len(response.data) > 0:
            url = _normalize_pdf_url(response.data[0].get("pdf_url"))
            if url:
                return url

        lawyer_resp = (
            client.table("lawyer_cases")
            .select("pdf_url, structured_report")
            .eq("id", case_id)
            .limit(1)
            .execute()
        )
        if lawyer_resp.data and len(lawyer_resp.data) > 0:
            row = lawyer_resp.data[0]
            url = _normalize_pdf_url(row.get("pdf_url"))
            if url:
                return url
            report = row.get("structured_report") or {}
            if isinstance(report, dict):
                return _normalize_pdf_url(report.get("pdf_url"))
        return None
    except Exception as e:
        print(f"Error fetching case PDF URL: {e}")
        return None

def add_case_attachment(case_id: str, file_url: str, file_type: str, file_name: str, file_size: int = None, uploaded_by: str = None):
    """Adds a file attachment to a case."""
    client = supabase
    if client is None:
        return False
    try:
        response = client.table("case_attachments").insert({
            "case_id": case_id,
            "file_url": file_url,
            "file_type": file_type,
            "file_name": file_name,
            "file_size": file_size,
            "uploaded_by": uploaded_by
        }).execute()
        return True if response.data else False
    except Exception as e:
        print(f"Error adding case attachment: {e}")
        return False

def get_case_attachments(case_id: str):
    """Retrieves all attachments for a specific case."""
    client = supabase
    if client is None:
        return []
    try:
        response = client.table("case_attachments").select("*").eq("case_id", case_id).order("uploaded_at", desc=True).execute()
        return response.data if response.data else []
    except Exception as e:
        print(f"Error retrieving case attachments: {e}")
        return []

def get_case_file_by_type(case_id: str, file_type: str):
    """Retrieves the latest file attachment of a specific type for a case (e.g., 'pdf')."""
    client = supabase
    if client is None:
        return None
    try:
        response = client.table("case_attachments").select("*").eq("case_id", case_id).eq("file_type", file_type).order("uploaded_at", desc=True).limit(1).execute()
        if response.data:
            return response.data[0]
        return None
    except Exception as e:
        print(f"Error retrieving case file by type: {e}")
        return None

def get_all_mock_scams(limit: int = 1000):
    """Fetches seeded mock scams for the heatmap."""
    client = supabase
    if client is None:
        return []
    try:
        response = client.table("mock_scams").select("*").order("timestamp", desc=True).limit(limit).execute()
        return response.data if response.data else []
    except Exception as e:
        print(f"Error fetching mock scams: {e}")
        return []

def upsert_sahayak_profile(uid: str, data: dict):
    """Creates or updates a sahayak profile."""
    client = supabase
    if client is None:
        return False
    try:
        payload = {"uid": uid}
        field_map = {
            "name": "name", "email": "email", "contactNumber": "contact_number",
            "location": "location", "occupation": "occupation", "bio": "bio",
            "avatar": "avatar", "languages": "languages", "availability": "availability"
        }
        for k, col in field_map.items():
            if k in data:
                payload[col] = data[k]
        client.table("sahayak_profiles").upsert(payload, on_conflict="uid").execute()
        return True
    except Exception as e:
        print(f"Error upserting sahayak profile: {e}")
        return False

def get_all_sahayak_profiles():
    """Returns all sahayak profiles (for victim-side browsing)."""
    client = supabase
    if client is None:
        return []
    try:
        response = client.table("sahayak_profiles").select("*").execute()
        return response.data if response.data else []
    except Exception as e:
        print(f"Error fetching sahayak profiles: {e}")
        return []


def get_nodal_guide_by_location(lat: float, lon: float) -> dict | None:
    """
    Returns the best-matching Nodal Guide for the given GPS coordinates
    by checking lat/lon bounding boxes in the nodal_guides table.
    Falls back to the first available guide if no bounding box matches.
    """
    client = supabase
    if client is None:
        return None
    try:
        response = client.table("nodal_guides").select("*").execute()
        guides = response.data if response.data else []
        if not guides:
            return None

        # Find guide whose bounding box contains the user's location
        for g in guides:
            try:
                if (float(g["lat_min"]) <= lat <= float(g["lat_max"]) and
                        float(g["lon_min"]) <= lon <= float(g["lon_max"])):
                    return g
            except (KeyError, TypeError, ValueError):
                continue

        # No exact match — return first available as a default
        print(f"  ⚠️  No nodal guide bounding box matched ({lat:.4f}, {lon:.4f}) — using default")
        return guides[0]
    except Exception as e:
        print(f"Error fetching nodal guide by location: {e}")
        return None


def get_nodal_guides_for_area(state_name: str | None = None, lat=None, lon=None, limit: int = 4) -> list[dict]:
    one = None
    if lat is not None and lon is not None:
        try:
            one = get_nodal_guide_by_location(float(lat), float(lon))
        except (TypeError, ValueError):
            one = None
    return [one] if one else []


def get_nodal_guide_by_id(guide_id: str) -> dict | None:
    return None


def get_sahayak_profiles_for_area(state_name: str | None = None, limit: int = 5) -> list[dict]:
    rows = get_all_sahayak_profiles() or []
    return rows[: max(1, int(limit))]


def pick_nyaysahayak_for_area(state_name: str | None = None) -> dict | None:
    rows = get_sahayak_profiles_for_area(state_name, limit=1)
    return rows[0] if rows else None


def create_nyaysahayak_booking(**kwargs):
    return None


def complete_nyaysahayak_booking(**kwargs):
    return None


def get_nyaysahayak_booking_by_order(razorpay_order_id: str):
    return None


def get_latest_case_for_session(session_id: str):
    return None


def get_case_by_id(case_id: str):
    return None


def persist_case_scam_matches(case_id: str | None, matches=None, note: str | None = None) -> bool:
    return False


def get_routing_rule(issue_type: str, state_name: Optional[str] = None) -> dict | None:
    """
    Resolve a routing rule for a case issue type, preferring exact state match
    and falling back to ALL.
    """
    client = supabase
    if client is None:
        return None

    issue = (issue_type or "").strip()
    state = (state_name or "ALL").strip() or "ALL"
    if not issue:
        return None

    try:
        response = (
            client.table("routing_rules")
            .select("*")
            .eq("active", True)
            .eq("issue_type", issue)
            .in_("state_name", [state, "ALL"])
            .execute()
        )
        rows = response.data if response.data else []
        if not rows:
            return None

        # Prefer exact-state rows first, then lower priority value.
        rows.sort(key=lambda r: (0 if r.get("state_name") == state else 1, int(r.get("priority") or 100)))
        return rows[0]
    except Exception as e:
        print(f"Error fetching routing rule for issue '{issue}' and state '{state}': {e}")
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

    phone_context = any(k in text for k in [
        "phone", "mobile", "handset", "smartphone", "sim", "imei", "मोबाइल", "फोन"
    ])
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
    """
    Build routing recommendation for moderator UI based on AI summary + user statement
    and state-aware routing_rules.
    """
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


def get_female_lawyers_by_location(lat: float, lon: float, state: str = "Delhi") -> list[dict]:
    """
    Returns female lawyers available in the user's area, specialized in sexual offences and assault.
    Priority given to verified lawyers.
    """
    client = supabase
    if client is None:
        return []
    
    try:
        normalized_state = (state or "").strip()
        if normalized_state in {"", "Unknown", "ALL"}:
            normalized_state = "Delhi"

        # First try to find lawyers within bounding box if lat/lon provided
        if lat is not None and lon is not None:
            response = client.table("female_lawyers").select("*").eq("state", normalized_state).eq("verified", True).execute()
            lawyers = response.data if response.data else []
            
            # Filter based on bounding box if available
            matched_lawyers = []
            for lawyer in lawyers:
                try:
                    if (lawyer.get("lat_min") and lawyer.get("lat_max") and 
                        lawyer.get("lon_min") and lawyer.get("lon_max")):
                        if (float(lawyer["lat_min"]) <= lat <= float(lawyer["lat_max"]) and
                            float(lawyer["lon_min"]) <= lon <= float(lawyer["lon_max"])):
                            matched_lawyers.append(lawyer)
                except (TypeError, ValueError):
                    continue
            
            # If we found matches, return them; otherwise return all verified lawyers for the state
            if matched_lawyers:
                return matched_lawyers[:4]  # Return top 4
            
            return lawyers[:4]  # Return up to 4 verified lawyers from state
        else:
            # No location provided, return verified lawyers from the state
            response = client.table("female_lawyers").select("*").eq("state", normalized_state).eq("verified", True).execute()
            return response.data[:4] if response.data else []
            
    except Exception as e:
        print(f"Error fetching female lawyers by location: {e}")
        return []


def get_female_nyayguides_by_location(lat: float, lon: float, state: str = "Delhi") -> list[dict]:
    """
    Returns female NyayGuides available in the user's area, specialized in trauma-aware support.
    Priority is given to verified profiles.
    """
    client = supabase
    if client is None:
        return []
    
    try:
        normalized_state = (state or "").strip()
        if normalized_state in {"", "Unknown", "ALL"}:
            normalized_state = "Delhi"

        def _fetch_rows_for_state() -> list[dict]:
            # Primary table uses NyayGuide terminology; fallback keeps backward compatibility.
            for table_name in ["female_nyayguides", "female_counsellors"]:
                try:
                    response = (
                        client.table(table_name)
                        .select("*")
                        .eq("state", normalized_state)
                        .eq("verified", True)
                        .execute()
                    )
                    if response.data:
                        return response.data
                except Exception:
                    continue
            return []

        # First try to find NyayGuides within bounding box if lat/lon provided
        if lat is not None and lon is not None:
            nyayguides = _fetch_rows_for_state()
            
            # Filter based on bounding box if available
            matched_nyayguides = []
            for nyayguide in nyayguides:
                try:
                    if (nyayguide.get("lat_min") and nyayguide.get("lat_max") and 
                        nyayguide.get("lon_min") and nyayguide.get("lon_max")):
                        if (float(nyayguide["lat_min"]) <= lat <= float(nyayguide["lat_max"]) and
                            float(nyayguide["lon_min"]) <= lon <= float(nyayguide["lon_max"])):
                            matched_nyayguides.append(nyayguide)
                except (TypeError, ValueError):
                    continue
            
            # If we found matches, return them; otherwise return all verified profiles for the state
            if matched_nyayguides:
                return matched_nyayguides[:4]  # Return top 4
            
            return nyayguides[:4]  # Return up to 4 verified profiles from state
        else:
            # No location provided, return verified profiles from the state
            return _fetch_rows_for_state()[:4]
            
    except Exception as e:
        print(f"Error fetching female NyayGuides by location: {e}")
        return []


def get_female_counsellors_by_location(lat: float, lon: float, state: str = "Delhi") -> list[dict]:
    """Backward-compatible alias for older call sites."""
    return get_female_nyayguides_by_location(lat, lon, state)


def get_lawyer_case(case_id: str):
    print("get_lawyer_case requires Postgres backend")
    return None


def create_or_get_lawyer_thread(victim_user_id: str, lawyer_user_id: str, lawyer_case_id=None):
    print("lawyer chat requires Postgres backend")
    return None


def list_lawyer_threads_for_user(user_id: str, role: str = "victim"):
    return []


def get_lawyer_thread(thread_id: str, user_id: str):
    return None


def list_lawyer_messages(thread_id: str, after=None, limit: int = 100):
    return []


def send_lawyer_message(thread_id: str, sender_user_id: str, body: str):
    return None


def create_or_get_sahayak_thread(victim_user_id: str, sahayak_user_id: str, sahayak_case_id=None):
    print("sahayak chat requires Postgres backend")
    return None


def list_sahayak_threads_for_user(user_id: str, role: str = "victim"):
    return []


def get_sahayak_thread(thread_id: str, user_id: str):
    return None


def list_sahayak_messages(thread_id: str, after=None, limit: int = 100):
    return []


def send_sahayak_message(thread_id: str, sender_user_id: str, body: str):
    return None


def mark_chat_thread_read(channel: str, thread_id: str, user_id: str):
    return False


def list_unread_chat_items(user_id: str, limit: int = 20):
    return []


def count_lawyer_cases_for_lawyer(uid: str):
    return {"pending": 0, "accepted": 0, "total": 0}


def assign_intervention_moderator(case_id: str, moderator_id: str) -> bool:
    return set_intervention_notified_users(case_id, [moderator_id] if moderator_id else [])


def list_unassigned_pending_interventions(limit: int = 20):
    return []


def count_assigned_interventions_in_hour(uid: str) -> int:
    return 0


def count_open_assigned_interventions(uid: str) -> int:
    return count_notified_pending_interventions(uid)


def ensure_moderator_performance(moderator_id: str) -> dict:
    return {"moderator_id": moderator_id, "respect_score": 100, "delay_score_total": 0}


def get_moderator_performance(moderator_id: str) -> dict:
    return ensure_moderator_performance(moderator_id)


def get_moderator_respect_scores(uids: list) -> dict:
    return {str(u): 100.0 for u in (uids or [])}


def get_assigned_interventions_for_moderator(moderator_id: str, include_resolved: bool = False):
    return get_pending_interventions("moderator", moderator_id)


def create_moderator_case_revision(**kwargs):
    return None


def update_moderator_case_revision_on_resolve(**kwargs):
    return False


def list_sla_breach_candidates(sla_minutes: int):
    return []


def apply_intervention_delay_tick(intervention_id: str, moderator_id: str, respect_penalty: float):
    return None


def list_moderator_case_revisions(**kwargs):
    return {"total": 0, "items": []}


def get_moderator_case_revision(revision_id: str):
    return None


def set_moderator_revision_embedding(revision_id: str, embedding: list) -> bool:
    return False


def create_moderator_updatation(**kwargs):
    return None


def complete_moderator_updatation(**kwargs):
    return False


def get_latest_moderator_updatation(intervention_id: str):
    return None


FORWARD_ROLE_LABELS = {
    "moderator": "Legal Moderator",
    "lawyer": "Lawyer",
    "sahayak": "Nyay Guide",
    "nodal_guide": "Nodal Guide",
}


def mark_case_forwarded(**kwargs):
    return None


def append_case_followup(**kwargs):
    return None


def get_session_forward_state(session_id: str):
    return None


def get_user_contact_snapshot(uid: str):
    return {"name": "", "phone": ""}


def create_so_call_confirmation(**kwargs):
    return None


def list_so_call_confirmations(status: str | None = "pending_call", limit: int = 80):
    return []


def get_so_call_confirmation(confirmation_id: str):
    return None


def mark_so_call_result(confirmation_id: str, *, call_done: bool, confirmed_by: str | None = None):
    return None


def assign_so_confirmation_to_female_nyayguide(confirmation_id: str, *, nyayguide: dict, confirmed_by: str | None = None):
    return None


def get_female_nyayguide_by_id(guide_id: str):
    return None


def list_female_nyayguides(limit: int = 40):
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

