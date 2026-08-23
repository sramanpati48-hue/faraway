"""Moderator ops APIs: mine queue, stats, history, sexual-offence confirmation calls."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

import backend.database.supabase_db as supabase_db
from backend.database.auth_middleware import require_roles
from backend.services import moderator_queue
from backend.websocket_manager import manager

router = APIRouter(prefix="/api", tags=["moderator"])


def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("uid") or user.get("firebase_uid") or "")


class SoCallResultBody(BaseModel):
    call_done: bool
    nyayguide_id: Optional[str] = None
    nyayguide_name: Optional[str] = None


@router.get("/moderator/stats")
async def moderator_stats(user=Depends(require_roles("moderator", "admin", "super_admin"))):
    uid = _uid(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Missing user id")
    stats = await run_in_threadpool(moderator_queue.moderator_stats_for, uid)
    return {"status": "success", **stats}


@router.get("/interventions/moderator/mine")
async def my_interventions(user=Depends(require_roles("moderator", "admin", "super_admin"))):
    uid = _uid(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Missing user id")
    await run_in_threadpool(moderator_queue.try_claim_unassigned_for, uid)
    cases = await run_in_threadpool(
        supabase_db.get_assigned_interventions_for_moderator, uid, False
    )
    stats = await run_in_threadpool(moderator_queue.moderator_stats_for, uid)
    return {"status": "success", "cases": cases, "stats": stats}


@router.get("/interventions/moderator/history")
async def my_intervention_history(
    limit: int = Query(50, ge=1, le=100),
    user=Depends(require_roles("moderator", "admin", "super_admin")),
):
    uid = _uid(user)
    cases = await run_in_threadpool(
        supabase_db.get_assigned_interventions_for_moderator, uid, True
    )
    return {"status": "success", "cases": (cases or [])[:limit]}


@router.get("/moderator/sexual-offense-confirmations")
async def list_so_confirmations(
    status: str = Query("pending_call"),
    user=Depends(require_roles("moderator", "admin", "super_admin")),
):
    rows = await run_in_threadpool(supabase_db.list_so_call_confirmations, status, 80)
    guides = await run_in_threadpool(supabase_db.list_female_nyayguides, 40)
    return {"status": "success", "cases": rows or [], "guides": guides or []}


@router.post("/moderator/sexual-offense-confirmations/{confirmation_id}/call")
async def mark_so_call(
    confirmation_id: str,
    body: SoCallResultBody,
    user=Depends(require_roles("moderator", "admin", "super_admin")),
):
    uid = _uid(user)
    row = await run_in_threadpool(
        lambda: supabase_db.mark_so_call_result(
            confirmation_id, call_done=body.call_done, confirmed_by=uid
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Confirmation not found")

    assigned = None
    if body.call_done:
        guide = None
        if body.nyayguide_id:
            guide = await run_in_threadpool(supabase_db.get_female_nyayguide_by_id, body.nyayguide_id)
            if guide and body.nyayguide_name:
                guide = {**guide, "name": body.nyayguide_name}
        if not guide:
            guides = await run_in_threadpool(supabase_db.list_female_nyayguides, 8)
            guide = (guides or [None])[0]
        if not guide:
            raise HTTPException(status_code=409, detail="No female Nyay Guide available to assign")
        assigned = await run_in_threadpool(
            lambda: supabase_db.assign_so_confirmation_to_female_nyayguide(
                confirmation_id, nyayguide=guide, confirmed_by=uid
            )
        )
        row = assigned or row

    try:
        manager.broadcast_sync({"type": "so_call_confirmation_updated", "confirmation": row}, channel="moderator")
        if assigned and assigned.get("assigned_nyayguide_id"):
            manager.send_to_uids_sync(
                [str(assigned["assigned_nyayguide_id"])],
                {"type": "sahayak_case_assigned", "case_id": assigned.get("sahayak_case_id")},
            )
    except Exception:
        pass

    return {"status": "success", "confirmation": row}
