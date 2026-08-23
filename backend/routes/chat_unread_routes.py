"""Cross-channel unread chat notifications for the dashboard header."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from backend.database import supabase_db
from backend.database.auth_middleware import get_current_user

router = APIRouter(prefix="/api/chat", tags=["chat-unread"])


def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("uid") or "")


def _href_for_item(item: dict, role: str) -> str:
    channel = (item.get("channel") or "").lower()
    thread_id = item.get("thread_id") or ""
    case_id = item.get("case_id") or ""
    r = (role or "victim").lower()
    if channel == "lawyer":
        if r == "lawyer":
            q = f"thread={thread_id}"
            if case_id:
                q += f"&case={case_id}"
            return f"/lawyer/cases?{q}"
        return f"/find-help?tab=connected&thread={thread_id}&channel=lawyer"
    if channel == "sahayak":
        if r in {"sahayak", "guide", "nyay_guide"}:
            q = f"thread={thread_id}"
            if case_id:
                q += f"&case={case_id}"
            return f"/sahayak?{q}"
        return f"/find-help?tab=sahayak&thread={thread_id}&channel=sahayak"
    return "/find-help"


@router.get("/unread")
async def get_unread(user=Depends(get_current_user)):
    me = _uid(user)
    role = (user.get("role") or "victim").lower()
    rows = await run_in_threadpool(supabase_db.list_unread_chat_items, me, 20)
    items = []
    for row in rows or []:
        items.append(
            {
                "channel": row.get("channel"),
                "thread_id": str(row.get("thread_id") or ""),
                "case_id": row.get("case_id"),
                "peer_user_id": row.get("peer_user_id"),
                "peer_name": row.get("peer_name") or "Contact",
                "last_message": row.get("last_message"),
                "last_message_at": row.get("last_message_at"),
                "unread_count": int(row.get("unread_count") or 0),
                "href": _href_for_item(row, role),
            }
        )
    total = sum(i["unread_count"] for i in items)
    return {"status": "success", "total_unread": total, "items": items}


@router.post("/threads/{channel}/{thread_id}/read")
async def mark_read(channel: str, thread_id: str, user=Depends(get_current_user)):
    me = _uid(user)
    ch = (channel or "").strip().lower()
    if ch not in {"lawyer", "sahayak"}:
        raise HTTPException(status_code=400, detail="channel must be lawyer or sahayak")
    if ch == "lawyer":
        thread = await run_in_threadpool(supabase_db.get_lawyer_thread, thread_id, me)
    else:
        thread = await run_in_threadpool(supabase_db.get_sahayak_thread, thread_id, me)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    ok = await run_in_threadpool(supabase_db.mark_chat_thread_read, ch, thread_id, me)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to mark read")
    return {"status": "success"}
