"""Nodal-guide forwarding and ₹49 NyaySahayak on-ground bookings."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.agents.local_justice import forum_for_state, profile_from_guide_row
from backend.database.auth_middleware import get_current_user
from backend.database import supabase_db
from backend.services import clash_billing

router = APIRouter(tags=["Local justice"])

NYAYSAHAYAK_AMOUNT_PAISE = 4900


class NodalForwardBody(BaseModel):
    guide_id: str
    session_id: str
    case_id: Optional[str] = None
    state: Optional[str] = None


class NyaySahayakBookBody(BaseModel):
    session_id: str
    case_id: Optional[str] = None
    state: Optional[str] = None
    area: Optional[str] = None


class NyaySahayakVerifyBody(BaseModel):
    razorpay_order_id: str = Field(min_length=1)
    razorpay_payment_id: str = Field(min_length=1)
    razorpay_signature: str = Field(min_length=1)
    session_id: Optional[str] = None
    case_id: Optional[str] = None
    state: Optional[str] = None


def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("uid") or "")


def _display_name(user: dict) -> str:
    return str(user.get("display_name") or user.get("name") or "User")


def _case_bundle(session_id: str, case_id: str | None) -> dict[str, Any]:
    row = None
    if case_id and hasattr(supabase_db, "get_case_by_id"):
        row = supabase_db.get_case_by_id(case_id)
    if not row and hasattr(supabase_db, "get_latest_case_for_session"):
        row = supabase_db.get_latest_case_for_session(session_id)
    report = (row or {}).get("structured_report") if isinstance(row, dict) else {}
    if not isinstance(report, dict):
        report = {}
    loc = report.get("location") if isinstance(report.get("location"), dict) else {}
    pdf_url = (row or {}).get("pdf_url") if isinstance(row, dict) else None
    return {
        "case_id": str((row or {}).get("id") or case_id or ""),
        "report": report,
        "location": loc,
        "pdf_url": pdf_url,
        "session_id": session_id,
    }


def _ensure_pdf(case_id: str | None, report: dict, user_id: str, session_id: str) -> str | None:
    pdf_url = report.get("pdf_url")
    if pdf_url:
        return str(pdf_url)
    if case_id and hasattr(supabase_db, "get_case_pdf_url"):
        try:
            pdf_url = supabase_db.get_case_pdf_url(case_id)
        except Exception:
            pdf_url = None
    if pdf_url:
        return str(pdf_url)
    try:
        from backend.database.pdf_service import ensure_report_pdf_url

        return ensure_report_pdf_url(
            case_data=report,
            case_id=case_id or session_id,
            user_id=user_id,
            existing_url=report.get("pdf_url"),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ PDF for local-justice forward skipped: {exc}")
        return None


@router.get("/api/nodal-guides")
async def list_nodal_guides(state: Optional[str] = None, lat: Optional[float] = None, lon: Optional[float] = None):
    forum = forum_for_state(state)
    rows = []
    if hasattr(supabase_db, "get_nodal_guides_for_area"):
        rows = await run_in_threadpool(supabase_db.get_nodal_guides_for_area, state, lat, lon, 6) or []
    profiles = [profile_from_guide_row(r, forum) for r in rows if r]
    return {"status": "success", "forum": forum, "guides": profiles}


@router.post("/api/nodal-guides/forward")
async def forward_to_nodal_guide(body: NodalForwardBody, user=Depends(get_current_user)):
    user_id = _uid(user)
    guide = None
    if hasattr(supabase_db, "get_nodal_guide_by_id"):
        guide = await run_in_threadpool(supabase_db.get_nodal_guide_by_id, body.guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="Nodal guide not found")
    forum = forum_for_state(body.state or guide.get("state"))
    bundle = await run_in_threadpool(_case_bundle, body.session_id, body.case_id)
    report = dict(bundle["report"] or {})
    pdf_url = await run_in_threadpool(
        _ensure_pdf,
        bundle["case_id"] or None,
        report,
        user_id,
        body.session_id,
    )
    if pdf_url:
        report["pdf_url"] = pdf_url

    sahayak_case_id = await run_in_threadpool(
        supabase_db.forward_case_to_sahayak,
        user_id,
        _display_name(user),
        report,
        body.session_id,
        bundle.get("location") or {},
        pdf_url,
    )
    if not sahayak_case_id:
        raise HTTPException(status_code=500, detail="Could not forward case to nodal guide")

    # Keep pending / queued — do not auto-accept. Notify the chosen guide for review.
    guide_id = str(guide.get("id") or body.guide_id)
    if hasattr(supabase_db, "set_sahayak_case_notified_users"):
        await run_in_threadpool(
            supabase_db.set_sahayak_case_notified_users,
            sahayak_case_id,
            [guide_id],
        )
    if hasattr(supabase_db, "assign_pending_nodal_guide"):
        await run_in_threadpool(
            supabase_db.assign_pending_nodal_guide,
            sahayak_case_id,
            guide_id,
            str(guide.get("name") or "Nodal Guide"),
        )

    case_id = bundle["case_id"] or str(sahayak_case_id)
    forward = await run_in_threadpool(
        lambda: supabase_db.mark_case_forwarded(
            role="nodal_guide",
            target_id=str(sahayak_case_id),
            case_id=case_id,
            session_id=body.session_id,
            user_id=user_id,
            structured_report=report,
            pdf_url=pdf_url,
            queue_status="queued",
        )
    )
    if not forward:
        forward = {
            "role": "nodal_guide",
            "role_label": "Nodal Guide",
            "target_id": str(sahayak_case_id),
            "case_id": case_id,
            "queue_status": "queued",
            "pdf_url": pdf_url,
            "follow_ups": [],
        }
    profile = profile_from_guide_row(guide, forum)
    return {
        "status": "success",
        "forward": forward,
        "sahayak_case_id": sahayak_case_id,
        "guide": profile,
        "forum": forum,
    }


def _get_verification_status_message(status: str) -> str:
    s = (status or "").lower()
    if s == "pending":
        return "Verifying your case with AI Moderator... Booking will unlock once verification is complete."
    if s == "flagged":
        return "Your case needs priority human review. We will guide you to the next safe step."
    if s == "rejected":
        return "Booking is unavailable because this case could not be verified."
    return "Case verification is required before booking on-ground NyaySahayak."


@router.post("/api/nyaysahayak/book")
async def book_nyaysahayak(body: NyaySahayakBookBody, user=Depends(get_current_user)):
    user_id = _uid(user)

    # 1. Require explicit case_id
    case_id = (body.case_id or "").strip()
    if not case_id:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "CASE_ID_REQUIRED",
                "message": "A valid case_id is required to book NyaySahayak.",
                "ai_verification_status": "pending",
            },
        )

    # 2. Strict case lookup and ownership check (no session-wide or user-wide fallback)
    from backend.database.supabase_case_enhance import get_case_complete

    case_row = await run_in_threadpool(get_case_complete, case_id)
    if not case_row and hasattr(supabase_db, "get_case_by_id"):
        case_row = await run_in_threadpool(supabase_db.get_case_by_id, case_id)

    if not case_row:
        raise HTTPException(status_code=404, detail="Case not found")

    case_owner = str(case_row.get("user_id") or "").strip()
    if case_owner != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized access to this case")

    # 3. AI Verification Gate: Only 'verified' cases can proceed to booking
    ai_status = str(case_row.get("ai_verification_status") or "pending").strip().lower()
    if ai_status != "verified":
        message = _get_verification_status_message(ai_status)
        reason = str(case_row.get("ai_verification_reason") or "")
        raise HTTPException(
            status_code=403,
            detail={
                "code": "AI_VERIFICATION_REQUIRED",
                "message": message,
                "ai_verification_status": ai_status,
                "reason": reason,
            },
        )

    area = (body.area or body.state or "").strip()
    profile = None
    if hasattr(supabase_db, "pick_nyaysahayak_for_area"):
        profile = await run_in_threadpool(supabase_db.pick_nyaysahayak_for_area, body.state or area)
    if not profile:
        raise HTTPException(status_code=404, detail="No NyaySahayak is available in this area yet")

    try:
        order = clash_billing.create_standard_order(
            amount=NYAYSAHAYAK_AMOUNT_PAISE,
            currency="INR",
            receipt=f"ns_{body.session_id[:12] if body.session_id else case_id[:12]}",
            user_id=user_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not create payment order: {exc}") from exc

    booking_id = None
    if hasattr(supabase_db, "create_nyaysahayak_booking"):
        booking_id = await run_in_threadpool(
            lambda: supabase_db.create_nyaysahayak_booking(
                user_id=user_id,
                session_id=body.session_id,
                case_id=case_id,
                sahayak_uid=str(profile.get("uid") or ""),
                sahayak_name=str(profile.get("name") or "NyaySahayak"),
                area=area or str(profile.get("state") or profile.get("location") or ""),
                razorpay_order_id=str(order["order_id"]),
                amount_paise=NYAYSAHAYAK_AMOUNT_PAISE,
            )
        )
    return {
        "status": "success",
        "booking_id": booking_id,
        "amount": order.get("amount") or NYAYSAHAYAK_AMOUNT_PAISE,
        "currency": order.get("currency") or "INR",
        "key_id": order.get("key_id"),
        "order_id": order.get("order_id"),
        "sahayak": profile,
        "area": area or str(profile.get("state") or profile.get("location") or ""),
    }



def _fulfill_paid_booking(
    *,
    user: dict,
    order_id: str,
    payment_id: str,
    session_id: str,
    case_id: str | None,
    state_name: str | None,
) -> dict[str, Any]:
    user_id = _uid(user)
    booking = None
    if hasattr(supabase_db, "get_nyaysahayak_booking_by_order"):
        booking = supabase_db.get_nyaysahayak_booking_by_order(order_id)
    if booking and str(booking.get("status") or "") == "paid":
        profile = None
        if booking.get("sahayak_uid") and hasattr(supabase_db, "get_sahayak_profile"):
            profile = supabase_db.get_sahayak_profile(str(booking["sahayak_uid"]))
        return {
            "already_paid": True,
            "booking": booking,
            "thread_id": booking.get("thread_id"),
            "sahayak_case_id": booking.get("sahayak_case_id"),
            "sahayak": profile,
            "area": booking.get("area"),
        }

    area = str((booking or {}).get("area") or state_name or "")
    profile = None
    if hasattr(supabase_db, "pick_nyaysahayak_for_area"):
        profile = supabase_db.pick_nyaysahayak_for_area(state_name or area)
    if not profile and booking and booking.get("sahayak_uid") and hasattr(supabase_db, "get_sahayak_profile"):
        profile = supabase_db.get_sahayak_profile(str(booking["sahayak_uid"]))
    if not profile:
        raise ValueError("No NyaySahayak is available in this area yet")

    sahayak_uid = str(profile.get("uid") or (booking or {}).get("sahayak_uid") or "")
    sahayak_name = str(profile.get("name") or (booking or {}).get("sahayak_name") or "NyaySahayak")
    area_label = area or str(profile.get("state") or profile.get("location") or "your area")

    bundle = _case_bundle(session_id, case_id or (booking or {}).get("case_id"))
    report = dict(bundle["report"] or {})
    pdf_url = _ensure_pdf(bundle["case_id"] or None, report, user_id, session_id)
    if pdf_url:
        report["pdf_url"] = pdf_url

    sahayak_case_id = supabase_db.forward_case_to_sahayak(
        user_id,
        _display_name(user),
        report,
        session_id,
        bundle.get("location") or {},
        pdf_url,
    )
    if sahayak_case_id and hasattr(supabase_db, "accept_sahayak_case"):
        supabase_db.accept_sahayak_case(sahayak_case_id, sahayak_uid, sahayak_name)

    thread = supabase_db.create_or_get_sahayak_thread(user_id, sahayak_uid, sahayak_case_id)
    thread_id = str((thread or {}).get("id") or "")
    summary = str(report.get("summary") or report.get("user_verbatim") or "").strip()
    intro = (
        f"Appointment booked with {sahayak_name} (NyaySahayak) for {area_label}. "
        "Please help me with on-ground next steps."
    )
    if summary:
        intro = f"{intro}\n\nCase summary:\n{summary[:1800]}"
    if thread_id:
        supabase_db.send_sahayak_message(thread_id, user_id, intro)

    existing = None
    if hasattr(supabase_db, "get_session_forward_state"):
        existing = supabase_db.get_session_forward_state(session_id)
    if not existing or not existing.get("role"):
        supabase_db.mark_case_forwarded(
            role="sahayak",
            target_id=str(sahayak_case_id or thread_id),
            case_id=bundle["case_id"] or str(sahayak_case_id or ""),
            session_id=session_id,
            user_id=user_id,
            structured_report=report,
            pdf_url=pdf_url,
        )

    updated = None
    if hasattr(supabase_db, "complete_nyaysahayak_booking"):
        updated = supabase_db.complete_nyaysahayak_booking(
            razorpay_order_id=order_id,
            razorpay_payment_id=payment_id,
            thread_id=thread_id or None,
            sahayak_case_id=str(sahayak_case_id) if sahayak_case_id else None,
            sahayak_uid=sahayak_uid,
            sahayak_name=sahayak_name,
        )
    return {
        "already_paid": False,
        "booking": updated or booking,
        "thread_id": thread_id,
        "thread": thread,
        "sahayak_case_id": sahayak_case_id,
        "sahayak": profile,
        "area": area_label,
        "forward": existing,
    }


@router.post("/api/nyaysahayak/verify")
async def verify_nyaysahayak(body: NyaySahayakVerifyBody, user=Depends(get_current_user)):
    if not clash_billing.verify_razorpay_signature(
        body.razorpay_order_id,
        body.razorpay_payment_id,
        body.razorpay_signature,
    ):
        raise HTTPException(status_code=400, detail="Invalid Razorpay payment signature")

    booking = None
    if hasattr(supabase_db, "get_nyaysahayak_booking_by_order"):
        booking = await run_in_threadpool(
            supabase_db.get_nyaysahayak_booking_by_order,
            body.razorpay_order_id,
        )
    if not booking:
        raise HTTPException(status_code=404, detail="Unknown NyaySahayak booking")

    session_id = body.session_id or str(booking.get("session_id") or "")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    try:
        result = await run_in_threadpool(
            lambda: _fulfill_paid_booking(
                user=user,
                order_id=body.razorpay_order_id,
                payment_id=body.razorpay_payment_id,
                session_id=session_id,
                case_id=body.case_id or booking.get("case_id"),
                state_name=body.state or booking.get("area"),
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not complete booking: {exc}") from exc

    return {"status": "success", "verified": True, **result}
