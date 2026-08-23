"""Victim ↔ lawyer textual chat (REST + short polling)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.database import supabase_db
from backend.database.auth_middleware import get_current_user

router = APIRouter(prefix="/api/lawyer-chat", tags=["lawyer-chat"])


class ConnectThreadBody(BaseModel):
    lawyer_user_id: str
    lawyer_case_id: Optional[str] = None
    victim_user_id: Optional[str] = None
    initial_message: Optional[str] = None


class SendMessageBody(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("uid") or "")


@router.post("/threads")
async def connect_lawyer_thread(body: ConnectThreadBody, user=Depends(get_current_user)):
    me = _uid(user)
    role = (user.get("role") or "").lower()
    lawyer_id = (body.lawyer_user_id or "").strip()
    if not lawyer_id:
        raise HTTPException(status_code=400, detail="lawyer_user_id required")

    if role == "lawyer":
        if lawyer_id != me:
            raise HTTPException(status_code=403, detail="Lawyers can only open their own threads")
        victim_id = (body.victim_user_id or "").strip()
        if body.lawyer_case_id:
            case = await run_in_threadpool(supabase_db.get_lawyer_case, body.lawyer_case_id)
            if not case:
                raise HTTPException(status_code=404, detail="Case not found")
            victim_id = str(case.get("user_id") or victim_id)
        if not victim_id:
            raise HTTPException(status_code=400, detail="victim_user_id or lawyer_case_id required")
        thread = await run_in_threadpool(
            supabase_db.create_or_get_lawyer_thread,
            victim_id,
            me,
            body.lawyer_case_id,
        )
        profile_uid = me
    else:
        thread = await run_in_threadpool(
            supabase_db.create_or_get_lawyer_thread,
            me,
            lawyer_id,
            body.lawyer_case_id,
        )
        profile_uid = lawyer_id

    if not thread:
        raise HTTPException(status_code=500, detail="Failed to create thread")

    if body.initial_message and str(body.initial_message).strip():
        await run_in_threadpool(
            supabase_db.send_lawyer_message,
            str(thread["id"]),
            me,
            str(body.initial_message).strip(),
        )

    profile = await run_in_threadpool(supabase_db.get_lawyer_profile, profile_uid)
    return {"status": "success", "thread": thread, "lawyer": profile}


@router.get("/threads")
async def list_threads(
    perspective: Optional[str] = None,
    user=Depends(get_current_user),
):
    """
    List chat threads for the authenticated user.
    - Default: use JWT role (lawyers see their client threads; victims see counsel).
    - perspective=victim: always filter by victim_user_id (Find Help "Connected").
    - perspective=lawyer: always filter by lawyer_user_id (lawyer portal).
    """
    me = _uid(user)
    role = (user.get("role") or "victim").lower()
    view = (perspective or "").strip().lower()
    if view in {"victim", "lawyer"}:
        role = view
    threads = await run_in_threadpool(supabase_db.list_lawyer_threads_for_user, me, role)
    return {"status": "success", "threads": threads}


@router.get("/threads/{thread_id}/messages")
async def get_messages(
    thread_id: str,
    after: Optional[str] = None,
    user=Depends(get_current_user),
):
    me = _uid(user)
    thread = await run_in_threadpool(supabase_db.get_lawyer_thread, thread_id, me)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    messages = await run_in_threadpool(supabase_db.list_lawyer_messages, thread_id, after)
    await run_in_threadpool(supabase_db.mark_chat_thread_read, "lawyer", thread_id, me)
    return {"status": "success", "thread": thread, "messages": messages}


@router.post("/threads/{thread_id}/messages")
async def post_message(thread_id: str, body: SendMessageBody, user=Depends(get_current_user)):
    me = _uid(user)
    thread = await run_in_threadpool(supabase_db.get_lawyer_thread, thread_id, me)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    msg = await run_in_threadpool(supabase_db.send_lawyer_message, thread_id, me, body.body)
    if not msg:
        raise HTTPException(status_code=400, detail="Failed to send message")
    await run_in_threadpool(supabase_db.mark_chat_thread_read, "lawyer", thread_id, me)
    return {"status": "success", "message": msg}
