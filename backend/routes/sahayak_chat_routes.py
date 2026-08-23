"""Victim ↔ sahayak (Nyay Guide) textual chat (REST + short polling)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.database import supabase_db
from backend.database.auth_middleware import get_current_user

router = APIRouter(prefix="/api/sahayak-chat", tags=["sahayak-chat"])


class ConnectThreadBody(BaseModel):
    sahayak_user_id: str
    sahayak_case_id: Optional[str] = None
    victim_user_id: Optional[str] = None
    initial_message: Optional[str] = None


class SendMessageBody(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("uid") or "")


def _is_sahayak_role(role: str) -> bool:
    return (role or "").lower() in {"sahayak", "guide", "nyay_guide"}


@router.post("/threads")
async def connect_sahayak_thread(body: ConnectThreadBody, user=Depends(get_current_user)):
    me = _uid(user)
    role = (user.get("role") or "").lower()
    sahayak_id = (body.sahayak_user_id or "").strip()
    if not sahayak_id:
        raise HTTPException(status_code=400, detail="sahayak_user_id required")

    if _is_sahayak_role(role):
        if sahayak_id != me:
            raise HTTPException(status_code=403, detail="Sahayaks can only open their own threads")
        victim_id = (body.victim_user_id or "").strip()
        if body.sahayak_case_id:
            case = await run_in_threadpool(supabase_db.get_sahayak_case_row, body.sahayak_case_id)
            if not case:
                raise HTTPException(status_code=404, detail="Case not found")
            victim_id = str(case.get("user_id") or victim_id)
        if not victim_id:
            raise HTTPException(status_code=400, detail="victim_user_id or sahayak_case_id required")
        thread = await run_in_threadpool(
            supabase_db.create_or_get_sahayak_thread,
            victim_id,
            me,
            body.sahayak_case_id,
        )
        profile_uid = me
    else:
        thread = await run_in_threadpool(
            supabase_db.create_or_get_sahayak_thread,
            me,
            sahayak_id,
            body.sahayak_case_id,
        )
        profile_uid = sahayak_id

    if not thread:
        raise HTTPException(status_code=500, detail="Failed to create thread")

    if body.initial_message and str(body.initial_message).strip():
        await run_in_threadpool(
            supabase_db.send_sahayak_message,
            str(thread["id"]),
            me,
            str(body.initial_message).strip(),
        )

    profile = await run_in_threadpool(supabase_db.get_sahayak_profile, profile_uid)
    return {"status": "success", "thread": thread, "sahayak": profile}


@router.get("/threads")
async def list_threads(
    perspective: Optional[str] = None,
    user=Depends(get_current_user),
):
    me = _uid(user)
    role = (user.get("role") or "victim").lower()
    view = (perspective or "").strip().lower()
    if view in {"victim", "sahayak", "guide", "nyay_guide"}:
        role = "sahayak" if view in {"sahayak", "guide", "nyay_guide"} else "victim"
    elif _is_sahayak_role(role):
        role = "sahayak"
    else:
        role = "victim"
    threads = await run_in_threadpool(supabase_db.list_sahayak_threads_for_user, me, role)
    return {"status": "success", "threads": threads}


@router.get("/threads/{thread_id}/messages")
async def get_messages(
    thread_id: str,
    after: Optional[str] = None,
    user=Depends(get_current_user),
):
    me = _uid(user)
    thread = await run_in_threadpool(supabase_db.get_sahayak_thread, thread_id, me)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    messages = await run_in_threadpool(supabase_db.list_sahayak_messages, thread_id, after)
    await run_in_threadpool(supabase_db.mark_chat_thread_read, "sahayak", thread_id, me)
    return {"status": "success", "thread": thread, "messages": messages}


@router.post("/threads/{thread_id}/messages")
async def post_message(thread_id: str, body: SendMessageBody, user=Depends(get_current_user)):
    me = _uid(user)
    thread = await run_in_threadpool(supabase_db.get_sahayak_thread, thread_id, me)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    msg = await run_in_threadpool(supabase_db.send_sahayak_message, thread_id, me, body.body)
    if not msg:
        raise HTTPException(status_code=400, detail="Failed to send message")
    await run_in_threadpool(supabase_db.mark_chat_thread_read, "sahayak", thread_id, me)
    return {"status": "success", "message": msg}
