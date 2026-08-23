"""
NyayGuide Physical Assistance Dispatch Service.
Implements:
- Transactional state machine validation and single-connection row locking (SELECT ... FOR UPDATE).
- Server-side UTC-only offer expiration.
- Staged radius matching (3 km -> 5 km -> 10 km -> NO_NYAYGUIDE_AVAILABLE).
- Terminal-state aware idempotency.
- Safe task summary generation (non-graphic, no raw transcript, no AI CoT).
- Two-tier location disclosure (coarse before acceptance, coordinates only post-acceptance with consent).
- Transactional guide status release and automatic re-dispatch.
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from backend.database.postgres_pool import connection, execute, execute_one, execute_void

# State machine constants
TERMINAL_STATUSES = {"COMPLETED", "CANCELLED", "EXPIRED", "NO_NYAYGUIDE_AVAILABLE", "FAILED"}
ACTIVE_STATUSES = {
    "REQUESTED",
    "SEARCHING",
    "OFFER_SENT",
    "MATCHED",
    "NYAYGUIDE_EN_ROUTE",
    "NYAYGUIDE_ARRIVED",
    "ASSISTANCE_ACTIVE",
}

VALID_TRANSITIONS: Dict[str, set[str]] = {
    "REQUESTED": {"SEARCHING", "CANCELLED", "FAILED"},
    "SEARCHING": {"OFFER_SENT", "NO_NYAYGUIDE_AVAILABLE", "CANCELLED", "FAILED"},
    "OFFER_SENT": {"MATCHED", "SEARCHING", "EXPIRED", "NO_NYAYGUIDE_AVAILABLE", "CANCELLED", "FAILED"},
    "MATCHED": {"NYAYGUIDE_EN_ROUTE", "CANCELLED", "FAILED"},
    "NYAYGUIDE_EN_ROUTE": {"NYAYGUIDE_ARRIVED", "CANCELLED", "FAILED"},
    "NYAYGUIDE_ARRIVED": {"ASSISTANCE_ACTIVE", "CANCELLED", "FAILED"},
    "ASSISTANCE_ACTIVE": {"COMPLETED", "FAILED"},
    "COMPLETED": set(),
    "CANCELLED": set(),
    "EXPIRED": set(),
    "NO_NYAYGUIDE_AVAILABLE": set(),
    "FAILED": set(),
}

DEFAULT_OFFER_TTL_SECONDS = 45
SEARCH_RADII_KM = [3.0, 5.0, 10.0]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two GPS coordinates in kilometers."""
    try:
        r = 6371.0
        d_lat = math.radians(lat2 - lat1)
        d_lon = math.radians(lon2 - lon1)
        a = (
            math.sin(d_lat / 2) ** 2
            + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return round(r * c, 2)
    except Exception:
        return 999.0


def generate_safe_task_summary(case_report: dict, assistance_type: str) -> str:
    """
    Generates a concise, non-graphic, NyayGuide-safe task summary.
    Never exposes full transcripts, internal AI reasoning, legal advice, or unnecessary PII.
    """
    report = case_report or {}
    incident = str(report.get("incident_type") or report.get("case_category") or "Legal/administrative matter").strip()
    summary = str(report.get("summary") or "").strip()

    # Strip any graphic or raw markers
    summary_clean = re.sub(r"\[.*?\]", "", summary).strip()
    if len(summary_clean) > 160:
        summary_clean = summary_clean[:157] + "..."

    type_labels = {
        "document_support": "Document organization and checklist preparation",
        "office_navigation": "In-person navigation and accompaniment at local administrative/police office",
        "complaint_filing_support": "Procedural hand-holding for complaint/form submission",
        "digital_assistance": "Digital portal and e-filing assistance",
        "other": "Practical on-ground procedural support",
    }
    action_label = type_labels.get(assistance_type, "Practical on-ground assistance")

    if summary_clean:
        return f"{action_label} for {incident}. Overview: {summary_clean}"
    return f"{action_label} for {incident}."


def log_request_event(
    cur: Any,
    request_id: str,
    previous_status: Optional[str],
    new_status: str,
    actor_type: str,
    actor_id: Optional[str] = None,
    reason: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    """Appends an immutable audit event into nyayguide_request_events within the active transaction."""
    sql = """
    INSERT INTO public.nyayguide_request_events (
        request_id, previous_status, new_status, actor_type, actor_id, reason, metadata
    ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb);
    """
    cur.execute(
        sql,
        (
            str(request_id),
            previous_status,
            new_status,
            actor_type,
            actor_id,
            reason,
            json.dumps(metadata or {}),
        ),
    )


def get_active_request_for_case(case_id: str, user_id: str) -> Optional[dict]:
    """Returns an active (non-terminal) request for a case and authenticated user."""
    sql = """
    SELECT * FROM public.nyayguide_requests
    WHERE case_id = %s AND user_id = %s AND status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_NYAYGUIDE_AVAILABLE', 'FAILED')
    ORDER BY created_at DESC
    LIMIT 1;
    """
    return execute_one(sql, (str(case_id), str(user_id)))


def get_request_by_id(request_id: str) -> Optional[dict]:
    """Retrieves a single request by ID."""
    sql = "SELECT * FROM public.nyayguide_requests WHERE id = %s;"
    return execute_one(sql, (str(request_id),))


def create_nyayguide_request_transactional(
    *,
    case_id: str,
    user_id: str,
    assistance_type: str,
    case_report: dict,
    location_consent: bool,
    user_latitude: Optional[float] = None,
    user_longitude: Optional[float] = None,
    preferred_gender: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Creates a new NyayGuide request in a single transaction with terminal-state aware idempotency.
    Immediately triggers matching dispatch.
    """
    with connection() as conn:
        with conn.cursor() as cur:
            # 1. Check idempotency: Return existing non-terminal request if one exists
            if idempotency_key:
                cur.execute(
                    """
                    SELECT * FROM public.nyayguide_requests
                    WHERE idempotency_key = %s AND status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_NYAYGUIDE_AVAILABLE', 'FAILED')
                    FOR UPDATE;
                    """,
                    (idempotency_key,),
                )
                existing = cur.fetchone()
                if existing:
                    conn.commit()
                    return dict(existing)

            # Check case-level non-terminal request
            cur.execute(
                """
                SELECT * FROM public.nyayguide_requests
                WHERE case_id = %s AND user_id = %s AND status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_NYAYGUIDE_AVAILABLE', 'FAILED')
                FOR UPDATE;
                """,
                (str(case_id), str(user_id)),
            )
            existing_case_req = cur.fetchone()
            if existing_case_req:
                conn.commit()
                return dict(existing_case_req)

            # 2. Prepare safe summary & fields
            safe_summary = generate_safe_task_summary(case_report, assistance_type)
            risk_flags = list((case_report or {}).get("risk_flags") or [])
            if "sensitive" in str(case_report).lower() and not preferred_gender:
                preferred_gender = "female"

            consent_at = datetime.now(timezone.utc) if location_consent else None
            lat = float(user_latitude) if (location_consent and user_latitude is not None) else None
            lon = float(user_longitude) if (location_consent and user_longitude is not None) else None

            # 3. Insert new request
            insert_sql = """
            INSERT INTO public.nyayguide_requests (
                case_id, user_id, assistance_type, safe_task_summary, risk_flags,
                preferred_gender, location_consent_at, user_latitude, user_longitude,
                idempotency_key, status, search_radius_km, requested_at
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, 'REQUESTED', 3.0, now()
            )
            RETURNING *;
            """
            cur.execute(
                insert_sql,
                (
                    str(case_id),
                    str(user_id),
                    assistance_type,
                    safe_summary,
                    risk_flags,
                    preferred_gender,
                    consent_at,
                    lat,
                    lon,
                    idempotency_key,
                ),
            )
            req_row = dict(cur.fetchone())

            # 4. Log initial event
            log_request_event(
                cur=cur,
                request_id=req_row["id"],
                previous_status=None,
                new_status="REQUESTED",
                actor_type="citizen",
                actor_id=str(user_id),
                reason="Citizen confirmed NyayGuide physical assistance request",
                metadata={
                    "assistance_type": assistance_type,
                    "location_consent": location_consent,
                    "preferred_gender": preferred_gender,
                },
            )
            conn.commit()

    # 5. Initiate dispatch in SEARCHING mode
    return dispatch_request_transactional(str(req_row["id"]))


def dispatch_request_transactional(request_id: str) -> dict:
    """
    Selects the best available NyayGuide inside a single locked database transaction.
    Applies staged search radii: 3 km -> 5 km -> 10 km.
    If a candidate is found, issues a time-limited offer and moves guide to OFFERED.
    If no candidates in 10 km, moves request to NO_NYAYGUIDE_AVAILABLE.
    """
    with connection() as conn:
        with conn.cursor() as cur:
            # 1. Lock the request
            cur.execute(
                "SELECT * FROM public.nyayguide_requests WHERE id = %s FOR UPDATE;",
                (str(request_id),),
            )
            req = cur.fetchone()
            if not req:
                conn.rollback()
                raise ValueError("Request not found")
            req = dict(req)

            if req["status"] in TERMINAL_STATUSES or req["status"] == "MATCHED":
                conn.commit()
                return req

            # Transition to SEARCHING if still REQUESTED
            if req["status"] == "REQUESTED":
                log_request_event(
                    cur,
                    request_id,
                    "REQUESTED",
                    "SEARCHING",
                    "system",
                    reason="Starting nearby NyayGuide search",
                )
                cur.execute(
                    "UPDATE public.nyayguide_requests SET status = 'SEARCHING', updated_at = now() WHERE id = %s RETURNING *;",
                    (str(request_id),),
                )
                req = dict(cur.fetchone())

            user_lat = req.get("user_latitude")
            user_lon = req.get("user_longitude")
            preferred_gender = req.get("preferred_gender")
            assistance_type = req.get("assistance_type")

            # 2. Staged search across radii: 3km -> 5km -> 10km
            chosen_candidate: Optional[dict] = None
            matched_radius = 3.0
            candidate_distance = 0.0

            for radius in SEARCH_RADII_KM:
                # Query verified available guides with row lock
                guide_query = """
                SELECT * FROM public.nyay_guides
                WHERE verification_status = 'VERIFIED'
                  AND availability_status = 'AVAILABLE'
                FOR UPDATE SKIP LOCKED;
                """
                cur.execute(guide_query)
                candidates = [dict(r) for r in cur.fetchall()]

                # Filter and rank candidates
                scored: List[Tuple[float, dict, float]] = []
                for g in candidates:
                    g_lat = g.get("latitude")
                    g_lon = g.get("longitude")
                    dist = 0.0
                    if user_lat is not None and user_lon is not None and g_lat is not None and g_lon is not None:
                        dist = haversine_km(user_lat, user_lon, g_lat, g_lon)
                        if dist > radius:
                            continue
                    else:
                        # Fallback for no GPS: treat as within radius if available
                        dist = 2.5

                    # Scoring heuristics
                    score = 100.0 - dist
                    if preferred_gender and g.get("gender") == preferred_gender:
                        score += 50.0
                    
                    specs = g.get("specializations") or []
                    if isinstance(specs, list) and assistance_type in specs:
                        score += 20.0

                    rating = float(g.get("rating") or 4.5)
                    score += rating * 2.0

                    scored.append((score, g, dist))

                if scored:
                    scored.sort(key=lambda x: x[0], reverse=True)
                    chosen_candidate = scored[0][1]
                    candidate_distance = scored[0][2]
                    matched_radius = radius
                    break

            # 3. If candidate found, create offer
            if chosen_candidate:
                guide_id = str(chosen_candidate["id"])
                # Mark guide OFFERED
                cur.execute(
                    "UPDATE public.nyay_guides SET availability_status = 'OFFERED', updated_at = now() WHERE id = %s;",
                    (guide_id,),
                )

                # Create offer with server-side UTC expiry
                offer_sql = """
                INSERT INTO public.nyayguide_offers (
                    request_id, nyayguide_id, status, distance_km, estimated_minutes,
                    offered_at, expires_at
                ) VALUES (
                    %s, %s, 'PENDING', %s, %s,
                    now(), now() + interval '%s seconds'
                )
                RETURNING *;
                """
                est_minutes = max(5, int(candidate_distance * 3.5)) if candidate_distance > 0 else 10
                cur.execute(
                    offer_sql,
                    (
                        str(request_id),
                        guide_id,
                        candidate_distance,
                        est_minutes,
                        DEFAULT_OFFER_TTL_SECONDS,
                    ),
                )
                offer_row = dict(cur.fetchone())

                # Update request status to OFFER_SENT
                prev_status = req["status"]
                cur.execute(
                    """
                    UPDATE public.nyayguide_requests
                    SET status = 'OFFER_SENT',
                        search_radius_km = %s,
                        expires_at = %s,
                        updated_at = now()
                    WHERE id = %s
                    RETURNING *;
                    """,
                    (matched_radius, offer_row["expires_at"], str(request_id)),
                )
                req = dict(cur.fetchone())

                log_request_event(
                    cur,
                    request_id,
                    prev_status,
                    "OFFER_SENT",
                    "system",
                    actor_id=guide_id,
                    reason=f"Offer sent to NyayGuide {chosen_candidate.get('display_name')} (distance ~{candidate_distance}km, radius {matched_radius}km)",
                    metadata={"offer_id": str(offer_row["id"]), "distance_km": candidate_distance},
                )
                conn.commit()
                req["current_offer"] = offer_row
                return req

            # 4. If no candidate found after 10 km
            prev_status = req["status"]
            cur.execute(
                """
                UPDATE public.nyayguide_requests
                SET status = 'NO_NYAYGUIDE_AVAILABLE',
                    search_radius_km = 10.0,
                    updated_at = now()
                WHERE id = %s
                RETURNING *;
                """,
                (str(request_id),),
            )
            req = dict(cur.fetchone())

            log_request_event(
                cur,
                request_id,
                prev_status,
                "NO_NYAYGUIDE_AVAILABLE",
                "system",
                reason="No eligible verified NyayGuide found within 10 km search radius",
            )
            conn.commit()
            return req


def accept_offer_transactional(offer_id: str, nyayguide_user_id: str) -> dict:
    """
    Atomically accepts an offer in a single locked database transaction.
    Enforces server-side UTC expiry check and strict pre-conditions.
    """
    with connection() as conn:
        with conn.cursor() as cur:
            # 1. Lock offer, request, and guide
            cur.execute(
                """
                SELECT o.*, g.user_id as guide_user_id, g.id as guide_id, g.availability_status as guide_status
                FROM public.nyayguide_offers o
                JOIN public.nyay_guides g ON g.id = o.nyayguide_id
                WHERE o.id = %s
                FOR UPDATE;
                """,
                (str(offer_id),),
            )
            offer = cur.fetchone()
            if not offer:
                conn.rollback()
                raise ValueError("Offer not found")
            offer = dict(offer)

            # Security: Ensure acting guide owns this offer
            if str(offer["guide_user_id"]) != str(nyayguide_user_id) and str(offer["guide_id"]) != str(nyayguide_user_id):
                conn.rollback()
                raise PermissionError("Unauthorized to accept this offer")

            request_id = str(offer["request_id"])
            guide_id = str(offer["guide_id"])

            cur.execute(
                "SELECT * FROM public.nyayguide_requests WHERE id = %s FOR UPDATE;",
                (request_id,),
            )
            req = cur.fetchone()
            if not req:
                conn.rollback()
                raise ValueError("Associated request not found")
            req = dict(req)

            # 2. Strict Pre-conditions & Server-Side UTC Expiry Validation
            now_utc = datetime.now(timezone.utc)
            expires_at = offer["expires_at"]
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)

            if offer["status"] != "PENDING":
                conn.rollback()
                raise ValueError(f"Offer is not pending (status: {offer['status']})")

            if now_utc > expires_at:
                # Mark offer EXPIRED inside transaction
                cur.execute(
                    "UPDATE public.nyayguide_offers SET status = 'EXPIRED', updated_at = now() WHERE id = %s;",
                    (str(offer_id),),
                )
                # Release guide if no other active assignment
                _release_guide_if_idle(cur, guide_id)
                conn.commit()
                # Trigger redispatch
                dispatch_request_transactional(request_id)
                raise ValueError("Offer has expired")

            if req["status"] != "OFFER_SENT":
                conn.rollback()
                raise ValueError(f"Request is not in OFFER_SENT state (status: {req['status']})")

            if req.get("assigned_nyayguide_id") is not None:
                conn.rollback()
                raise ValueError("Request already assigned to another NyayGuide")

            # 3. Lock assignment atomically
            cur.execute(
                "UPDATE public.nyayguide_offers SET status = 'ACCEPTED', responded_at = now(), updated_at = now() WHERE id = %s;",
                (str(offer_id),),
            )
            cur.execute(
                "UPDATE public.nyay_guides SET availability_status = 'BUSY', updated_at = now() WHERE id = %s;",
                (guide_id,),
            )
            cur.execute(
                """
                UPDATE public.nyayguide_requests
                SET status = 'MATCHED',
                    assigned_nyayguide_id = %s,
                    accepted_at = now(),
                    updated_at = now()
                WHERE id = %s
                RETURNING *;
                """,
                (guide_id, request_id),
            )
            updated_req = dict(cur.fetchone())

            # 4. Invalidate all other pending offers for this request
            cur.execute(
                """
                UPDATE public.nyayguide_offers
                SET status = 'CANCELLED', updated_at = now()
                WHERE request_id = %s AND id != %s AND status = 'PENDING';
                """,
                (request_id, str(offer_id)),
            )

            # 5. Log audit event
            log_request_event(
                cur=cur,
                request_id=request_id,
                previous_status="OFFER_SENT",
                new_status="MATCHED",
                actor_type="nyayguide",
                actor_id=guide_id,
                reason="NyayGuide accepted offer and locked assignment",
                metadata={"offer_id": str(offer_id), "accepted_at": now_utc.isoformat()},
            )

            conn.commit()
            return updated_req


def reject_offer_transactional(offer_id: str, nyayguide_user_id: str, reason: str = "NyayGuide declined") -> dict:
    """
    Atomically declines an offer, safely returns guide to AVAILABLE if idle, and triggers matching re-dispatch.
    """
    request_id = ""
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT o.*, g.user_id as guide_user_id, g.id as guide_id
                FROM public.nyayguide_offers o
                JOIN public.nyay_guides g ON g.id = o.nyayguide_id
                WHERE o.id = %s
                FOR UPDATE;
                """,
                (str(offer_id),),
            )
            offer = cur.fetchone()
            if not offer:
                conn.rollback()
                raise ValueError("Offer not found")
            offer = dict(offer)

            if str(offer["guide_user_id"]) != str(nyayguide_user_id) and str(offer["guide_id"]) != str(nyayguide_user_id):
                conn.rollback()
                raise PermissionError("Unauthorized to reject this offer")

            request_id = str(offer["request_id"])
            guide_id = str(offer["guide_id"])

            cur.execute(
                "UPDATE public.nyayguide_offers SET status = 'REJECTED', responded_at = now(), updated_at = now() WHERE id = %s;",
                (str(offer_id),),
            )
            _release_guide_if_idle(cur, guide_id)

            cur.execute(
                "UPDATE public.nyayguide_requests SET status = 'SEARCHING', updated_at = now() WHERE id = %s RETURNING *;",
                (request_id,),
            )
            req = dict(cur.fetchone())

            log_request_event(
                cur,
                request_id,
                "OFFER_SENT",
                "SEARCHING",
                "nyayguide",
                actor_id=guide_id,
                reason=reason,
                metadata={"offer_id": str(offer_id)},
            )
            conn.commit()

    # Trigger next candidate search
    return dispatch_request_transactional(request_id)


def update_request_status_by_guide(
    request_id: str,
    nyayguide_user_id: str,
    target_status: str,
    completion_notes: Optional[str] = None,
) -> dict:
    """
    Progresses assigned request through its active lifecycle:
    MATCHED -> NYAYGUIDE_EN_ROUTE -> NYAYGUIDE_ARRIVED -> ASSISTANCE_ACTIVE -> COMPLETED.
    """
    valid_targets = {"NYAYGUIDE_EN_ROUTE", "NYAYGUIDE_ARRIVED", "ASSISTANCE_ACTIVE", "COMPLETED"}
    if target_status not in valid_targets:
        raise ValueError(f"Invalid target status: {target_status}")

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.*, g.user_id as guide_user_id, g.id as guide_id
                FROM public.nyayguide_requests r
                JOIN public.nyay_guides g ON g.id = r.assigned_nyayguide_id
                WHERE r.id = %s
                FOR UPDATE;
                """,
                (str(request_id),),
            )
            req = cur.fetchone()
            if not req:
                conn.rollback()
                raise ValueError("Request not found or not assigned")
            req = dict(req)

            if str(req["guide_user_id"]) != str(nyayguide_user_id) and str(req["guide_id"]) != str(nyayguide_user_id):
                conn.rollback()
                raise PermissionError("Unauthorized to update this request")

            current_status = req["status"]
            allowed_next = VALID_TRANSITIONS.get(current_status, set())
            if target_status not in allowed_next:
                conn.rollback()
                raise ValueError(f"Cannot transition from {current_status} to {target_status}")

            guide_id = str(req["guide_id"])
            timestamp_col = {
                "NYAYGUIDE_EN_ROUTE": "nyayguide_en_route_at = now()",
                "NYAYGUIDE_ARRIVED": "nyayguide_arrived_at = now()",
                "ASSISTANCE_ACTIVE": "assistance_started_at = now()",
                "COMPLETED": "completed_at = now()",
            }[target_status]

            notes_sql = ", completion_notes = %s" if completion_notes else ""
            params = [completion_notes, str(request_id)] if completion_notes else [str(request_id)]

            update_sql = f"""
            UPDATE public.nyayguide_requests
            SET status = '{target_status}', {timestamp_col} {notes_sql}, updated_at = now()
            WHERE id = %s
            RETURNING *;
            """
            cur.execute(update_sql, tuple(params))
            updated_req = dict(cur.fetchone())

            # On completion, release guide to AVAILABLE if no other active requests
            if target_status == "COMPLETED":
                _release_guide_if_idle(cur, guide_id)

            log_request_event(
                cur,
                request_id,
                current_status,
                target_status,
                "nyayguide",
                actor_id=guide_id,
                reason=f"NyayGuide progressed state to {target_status}",
                metadata={"completion_notes": completion_notes} if completion_notes else {},
            )
            conn.commit()
            return updated_req


def cancel_request_by_citizen(request_id: str, user_id: str, reason: str = "Citizen cancelled") -> dict:
    """
    Cancels an active request before physical assistance begins.
    Releases any offered/assigned guide.
    """
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM public.nyayguide_requests WHERE id = %s FOR UPDATE;",
                (str(request_id),),
            )
            req = cur.fetchone()
            if not req:
                conn.rollback()
                raise ValueError("Request not found")
            req = dict(req)

            if str(req["user_id"]) != str(user_id):
                conn.rollback()
                raise PermissionError("Unauthorized to cancel this request")

            if req["status"] in {"ASSISTANCE_ACTIVE", "COMPLETED", "CANCELLED"}:
                conn.rollback()
                raise ValueError(f"Cannot cancel request in {req['status']} state")

            current_status = req["status"]
            guide_id = req.get("assigned_nyayguide_id")

            # Cancel all pending offers
            cur.execute(
                "UPDATE public.nyayguide_offers SET status = 'CANCELLED', updated_at = now() WHERE request_id = %s AND status = 'PENDING';",
                (str(request_id),),
            )

            # Update request
            cur.execute(
                """
                UPDATE public.nyayguide_requests
                SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
                WHERE id = %s
                RETURNING *;
                """,
                (str(request_id),),
            )
            updated_req = dict(cur.fetchone())

            # Release assigned guide if present
            if guide_id:
                _release_guide_if_idle(cur, str(guide_id))

            log_request_event(
                cur,
                request_id,
                current_status,
                "CANCELLED",
                "citizen",
                actor_id=str(user_id),
                reason=reason,
            )
            conn.commit()
            return updated_req


def _release_guide_if_idle(cur: Any, guide_id: str) -> None:
    """Sets a NyayGuide back to AVAILABLE only if they have no other active assignments or pending offers."""
    cur.execute(
        """
        SELECT count(*) as active_cnt
        FROM public.nyayguide_requests
        WHERE assigned_nyayguide_id = %s
          AND status IN ('MATCHED', 'NYAYGUIDE_EN_ROUTE', 'NYAYGUIDE_ARRIVED', 'ASSISTANCE_ACTIVE');
        """,
        (str(guide_id),),
    )
    active_cnt = cur.fetchone()["active_cnt"]

    cur.execute(
        """
        SELECT count(*) as offer_cnt
        FROM public.nyayguide_offers
        WHERE nyayguide_id = %s
          AND status = 'PENDING'
          AND expires_at > now();
        """,
        (str(guide_id),),
    )
    offer_cnt = cur.fetchone()["offer_cnt"]

    if active_cnt == 0 and offer_cnt == 0:
        cur.execute(
            "UPDATE public.nyay_guides SET availability_status = 'AVAILABLE', updated_at = now() WHERE id = %s;",
            (str(guide_id),),
        )


def serialize_request_for_citizen(req: dict) -> dict:
    """Formats request and attached assigned guide profile for citizen UI consumption."""
    out = dict(req)
    guide_id = req.get("assigned_nyayguide_id")
    if guide_id:
        guide = execute_one("SELECT * FROM public.nyay_guides WHERE id = %s;", (str(guide_id),))
        if guide:
            out["assigned_nyayguide"] = {
                "id": str(guide["id"]),
                "display_name": guide["display_name"],
                "profile_photo_url": guide.get("profile_photo_url"),
                "gender": guide.get("gender"),
                "languages": guide.get("languages") or [],
                "rating": float(guide.get("rating") or 4.8),
                "verification_status": guide.get("verification_status"),
            }
    return out


def serialize_request_for_guide(req: dict, is_assigned: bool) -> dict:
    """
    Two-tier privacy serializer for NyayGuide view:
    - Pre-acceptance: Shows only non-graphic task summary, assistance type, and approximate distance. Hides GPS coordinates.
    - Post-acceptance: Reveals user GPS coordinates only if location consent was granted.
    """
    out = {
        "id": str(req["id"]),
        "case_id": str(req["case_id"]),
        "assistance_type": req["assistance_type"],
        "safe_task_summary": req["safe_task_summary"],
        "preferred_gender": req.get("preferred_gender"),
        "status": req["status"],
        "search_radius_km": req.get("search_radius_km"),
        "requested_at": req.get("requested_at"),
    }
    if is_assigned and req.get("location_consent_at"):
        out["user_latitude"] = req.get("user_latitude")
        out["user_longitude"] = req.get("user_longitude")
        out["location_consented"] = True
    else:
        out["location_consented"] = False

    return out
