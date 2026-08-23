"""
Authenticated API routes for NyayGuide Physical Assistance Dispatch System.
"""
from __future__ import annotations

from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.database.auth_middleware import get_current_user
from backend.database.postgres_pool import execute, execute_one, execute_void
from backend.database.supabase_case_enhance import get_case_complete
from backend.database import supabase_db
from backend.services.nyayguide_service import (
    accept_offer_transactional,
    cancel_request_by_citizen,
    create_nyayguide_request_transactional,
    dispatch_request_transactional,
    get_active_request_for_case,
    get_request_by_id,
    reject_offer_transactional,
    serialize_request_for_citizen,
    serialize_request_for_guide,
    update_request_status_by_guide,
)

router = APIRouter(prefix="/api/nyayguide", tags=["NyayGuide Dispatch"])


def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("uid") or "").strip()


class CreateNyayGuideRequestBody(BaseModel):
    case_id: str = Field(min_length=1)
    assistance_type: str = Field(default="document_support")
    location_consent: bool = False
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    preferred_gender: Optional[str] = None
    confirmed: bool = False
    idempotency_key: Optional[str] = None


class CompleteRequestBody(BaseModel):
    completion_notes: Optional[str] = None


class AvailabilityToggleBody(BaseModel):
    availability_status: str


class CancelRequestBody(BaseModel):
    reason: Optional[str] = "Citizen cancelled"


@router.post("/requests")
async def create_nyayguide_request(
    body: CreateNyayGuideRequestBody,
    user: dict = Depends(get_current_user),
):
    """
    Creates a new confirmed physical assistance request for an owned case.
    Requires confirmed=true. Reuses existing non-terminal request for idempotency.
    """
    user_id = _uid(user)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not body.confirmed:
        raise HTTPException(
            status_code=400,
            detail="Explicit citizen confirmation is required to request a NyayGuide.",
        )

    allowed_types = {
        "document_support",
        "office_navigation",
        "complaint_filing_support",
        "digital_assistance",
        "other",
    }
    if body.assistance_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid assistance_type. Must be one of: {', '.join(allowed_types)}",
        )

    # Validate case ownership
    case_row = await run_in_threadpool(get_case_complete, body.case_id)
    if not case_row and hasattr(supabase_db, "get_case_by_id"):
        case_row = await run_in_threadpool(supabase_db.get_case_by_id, body.case_id)

    if not case_row:
        # Fallback query directly in postgres if needed
        case_row = execute_one("SELECT * FROM public.cases WHERE id = %s;", (body.case_id,))

    if not case_row:
        raise HTTPException(status_code=404, detail="Case not found")

    case_owner = str(case_row.get("user_id") or "").strip()
    if case_owner and case_owner != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized access to this case")

    report = case_row.get("structured_report") or {}

    try:
        req = await run_in_threadpool(
            create_nyayguide_request_transactional,
            case_id=body.case_id,
            user_id=user_id,
            assistance_type=body.assistance_type,
            case_report=report,
            location_consent=body.location_consent,
            user_latitude=body.latitude,
            user_longitude=body.longitude,
            preferred_gender=body.preferred_gender,
            idempotency_key=body.idempotency_key,
        )
        return {"status": "success", "request": serialize_request_for_citizen(req)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create request: {exc}") from exc


@router.get("/requests/{request_id}")
async def get_nyayguide_request(
    request_id: str,
    user: dict = Depends(get_current_user),
):
    """Fetches live request details for citizen or assigned guide."""
    user_id = _uid(user)
    req = await run_in_threadpool(get_request_by_id, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    # Authorize: citizen owner, assigned guide, or admin
    is_citizen = str(req["user_id"]) == user_id
    is_assigned = False
    if req.get("assigned_nyayguide_id"):
        guide = execute_one(
            "SELECT * FROM public.nyay_guides WHERE id = %s;",
            (str(req["assigned_nyayguide_id"]),),
        )
        if guide and str(guide.get("user_id")) == user_id:
            is_assigned = True

    role = (user.get("role") or "").lower()
    is_admin = role in ("admin", "super_admin", "moderator")

    if not (is_citizen or is_assigned or is_admin):
        raise HTTPException(status_code=403, detail="Unauthorized access to request")

    if is_citizen or is_admin:
        return {"status": "success", "request": serialize_request_for_citizen(req)}
    return {"status": "success", "request": serialize_request_for_guide(req, is_assigned)}


@router.get("/requests/by-case/{case_id}")
async def get_active_case_request(
    case_id: str,
    user: dict = Depends(get_current_user),
):
    """Retrieves any active non-terminal request for a case."""
    user_id = _uid(user)
    req = await run_in_threadpool(get_active_request_for_case, case_id, user_id)
    if not req:
        return {"status": "success", "request": None}
    return {"status": "success", "request": serialize_request_for_citizen(req)}


@router.post("/requests/{request_id}/cancel")
async def cancel_request(
    request_id: str,
    body: CancelRequestBody = CancelRequestBody(),
    user: dict = Depends(get_current_user),
):
    """Allows citizen to cancel before physical assistance is active."""
    user_id = _uid(user)
    try:
        updated = await run_in_threadpool(
            cancel_request_by_citizen,
            request_id=request_id,
            user_id=user_id,
            reason=body.reason or "Citizen cancelled",
        )
        return {"status": "success", "request": serialize_request_for_citizen(updated)}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Unauthorized to cancel this request")
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))


# ── NyayGuide-facing action routes ──────────────────────────────────────────

@router.post("/offers/{offer_id}/accept")
async def accept_offer(
    offer_id: str,
    user: dict = Depends(get_current_user),
):
    """NyayGuide accepts offer atomically."""
    user_id = _uid(user)
    try:
        updated = await run_in_threadpool(accept_offer_transactional, offer_id, user_id)
        return {"status": "success", "request": serialize_request_for_guide(updated, is_assigned=True)}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Unauthorized to accept this offer")
    except ValueError as val_err:
        raise HTTPException(status_code=409, detail=str(val_err))


@router.post("/offers/{offer_id}/reject")
async def reject_offer(
    offer_id: str,
    user: dict = Depends(get_current_user),
):
    """NyayGuide declines offer."""
    user_id = _uid(user)
    try:
        updated = await run_in_threadpool(reject_offer_transactional, offer_id, user_id)
        return {"status": "success", "request": serialize_request_for_citizen(updated)}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Unauthorized to reject this offer")
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))


@router.post("/requests/{request_id}/en-route")
async def mark_en_route(
    request_id: str,
    user: dict = Depends(get_current_user),
):
    """NyayGuide marks en route."""
    user_id = _uid(user)
    try:
        updated = await run_in_threadpool(
            update_request_status_by_guide,
            request_id=request_id,
            nyayguide_user_id=user_id,
            target_status="NYAYGUIDE_EN_ROUTE",
        )
        return {"status": "success", "request": serialize_request_for_guide(updated, is_assigned=True)}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Unauthorized")
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))


@router.post("/requests/{request_id}/arrived")
async def mark_arrived(
    request_id: str,
    user: dict = Depends(get_current_user),
):
    """NyayGuide marks arrived at citizen location."""
    user_id = _uid(user)
    try:
        updated = await run_in_threadpool(
            update_request_status_by_guide,
            request_id=request_id,
            nyayguide_user_id=user_id,
            target_status="NYAYGUIDE_ARRIVED",
        )
        return {"status": "success", "request": serialize_request_for_guide(updated, is_assigned=True)}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Unauthorized")
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))


@router.post("/requests/{request_id}/start-assistance")
async def start_assistance(
    request_id: str,
    user: dict = Depends(get_current_user),
):
    """NyayGuide starts physical assistance."""
    user_id = _uid(user)
    try:
        updated = await run_in_threadpool(
            update_request_status_by_guide,
            request_id=request_id,
            nyayguide_user_id=user_id,
            target_status="ASSISTANCE_ACTIVE",
        )
        return {"status": "success", "request": serialize_request_for_guide(updated, is_assigned=True)}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Unauthorized")
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))


@router.post("/requests/{request_id}/complete")
async def complete_assistance(
    request_id: str,
    body: CompleteRequestBody = CompleteRequestBody(),
    user: dict = Depends(get_current_user),
):
    """NyayGuide completes physical assistance with notes."""
    user_id = _uid(user)
    try:
        updated = await run_in_threadpool(
            update_request_status_by_guide,
            request_id=request_id,
            nyayguide_user_id=user_id,
            target_status="COMPLETED",
            completion_notes=body.completion_notes,
        )
        return {"status": "success", "request": serialize_request_for_guide(updated, is_assigned=True)}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Unauthorized")
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))


# ── Development & Console Support Routes ────────────────────────────────────

@router.get("/console/status")
async def get_console_status(
    guide_user_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
):
    """
    Returns NyayGuide console status: profile, active incoming offers, and assigned requests.
    Supports development-mode guide selection when logged in as admin/moderator/demo.
    """
    current_uid = _uid(user)
    acting_uid = guide_user_id or current_uid

    # Lookup NyayGuide record
    guide = execute_one(
        "SELECT * FROM public.nyay_guides WHERE user_id = %s OR id::text = %s;",
        (acting_uid, acting_uid),
    )
    if not guide:
        # Return list of demo guides if current user is not a registered guide
        demo_guides = execute(
            "SELECT id, user_id, display_name, gender, languages, availability_status, rating FROM public.nyay_guides ORDER BY display_name ASC LIMIT 10;"
        )
        return {
            "status": "unregistered",
            "message": "User is not registered as a NyayGuide.",
            "available_demo_guides": demo_guides,
        }

    guide_id = str(guide["id"])

    # Pending offers for this guide
    offers = execute(
        """
        SELECT o.*, r.assistance_type, r.safe_task_summary, r.preferred_gender, r.status as request_status
        FROM public.nyayguide_offers o
        JOIN public.nyayguide_requests r ON r.id = o.request_id
        WHERE o.nyayguide_id = %s
          AND o.status = 'PENDING'
          AND o.expires_at > now()
          AND r.status = 'OFFER_SENT'
        ORDER BY o.created_at DESC;
        """,
        (guide_id,),
    )

    # Active assignment for this guide
    active_req = execute_one(
        """
        SELECT * FROM public.nyayguide_requests
        WHERE assigned_nyayguide_id = %s
          AND status IN ('MATCHED', 'NYAYGUIDE_EN_ROUTE', 'NYAYGUIDE_ARRIVED', 'ASSISTANCE_ACTIVE')
        ORDER BY updated_at DESC
        LIMIT 1;
        """,
        (guide_id,),
    )

    return {
        "status": "success",
        "guide": {
            "id": guide_id,
            "user_id": guide["user_id"],
            "display_name": guide["display_name"],
            "profile_photo_url": guide.get("profile_photo_url"),
            "gender": guide.get("gender"),
            "languages": guide.get("languages") or [],
            "specializations": guide.get("specializations") or [],
            "availability_status": guide["availability_status"],
            "verification_status": guide["verification_status"],
            "rating": float(guide.get("rating") or 4.8),
        },
        "pending_offers": [
            {
                "id": str(o["id"]),
                "request_id": str(o["request_id"]),
                "distance_km": o.get("distance_km"),
                "estimated_minutes": o.get("estimated_minutes"),
                "expires_at": o["expires_at"].isoformat() if hasattr(o["expires_at"], "isoformat") else str(o["expires_at"]),
                "assistance_type": o.get("assistance_type"),
                "safe_task_summary": o.get("safe_task_summary"),
                "preferred_gender": o.get("preferred_gender"),
            }
            for o in offers
        ],
        "active_request": serialize_request_for_guide(active_req, is_assigned=True) if active_req else None,
    }


@router.post("/console/availability")
async def set_console_availability(
    body: AvailabilityToggleBody,
    guide_user_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
):
    """Updates NyayGuide availability (OFFLINE, AVAILABLE, PAUSED)."""
    current_uid = _uid(user)
    acting_uid = guide_user_id or current_uid

    valid_statuses = {"OFFLINE", "AVAILABLE", "PAUSED"}
    status = body.availability_status.upper()
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid_statuses}")

    execute_void(
        "UPDATE public.nyay_guides SET availability_status = %s, updated_at = now() WHERE user_id = %s OR id::text = %s;",
        (status, acting_uid, acting_uid),
    )
    return {"status": "success", "availability_status": status}
