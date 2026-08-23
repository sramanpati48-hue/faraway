"""Admin routes for the Improvise Policies studio."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.database.auth_middleware import require_roles
from backend.services import policy_context, policy_impact, policy_studio

router = APIRouter(prefix="/api/admin/policies", tags=["admin-policies"])

AdminUser = Depends(require_roles("admin", "super_admin"))


class ContextSearchBody(BaseModel):
    query: str
    top_k: int = 8
    kind: Optional[str] = None


class ReindexBody(BaseModel):
    scope: str = "policy_context"


class DraftBody(BaseModel):
    description: str
    title: str = ""
    policy_id: Optional[str] = None
    context_refs: list[dict[str, Any]] = []
    answers: dict[str, Any] = {}
    genui_prompt: str = ""
    impact_prompt: str = ""
    period_days: int = 30


class ImplementBody(BaseModel):
    confirm: str = ""


@router.get("/catalog")
async def policy_catalog(user=AdminUser):
    del user
    return {
        "features": policy_context.feature_catalog(),
        "tables": [
            {"name": t.get("name"), "columns": [c.get("name") for c in (t.get("columns") or [])]}
            for t in policy_context.table_catalog()
        ],
        "index": policy_context.index_status(),
        "writable_config_keys": list(policy_studio.WRITABLE_CONFIG_KEYS),
        "agent_scopes": list(policy_studio.AGENT_SCOPES),
    }


@router.post("/context/search")
async def policy_context_search(body: ContextSearchBody, user=AdminUser):
    del user
    return {
        "results": policy_context.search_policy_context(
            body.query, top_k=body.top_k, kind=body.kind
        )
    }


@router.post("/context/reindex")
async def policy_context_reindex(body: ReindexBody, user=AdminUser):
    del user, body
    try:
        counts = policy_context.reindex_policy_context()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"success": True, "counts": counts, "index": policy_context.index_status()}


@router.get("/impact")
async def policy_impact_snapshot(days: int = 30, user=AdminUser):
    del user
    return {"snapshot": policy_impact.impact_snapshot(days)}


@router.post("/draft/stream")
async def policy_draft_stream(body: DraftBody, user=AdminUser):
    actor = str((user or {}).get("id") or "") or None
    stream = policy_studio.stream_policy_session(
        description=body.description,
        context_refs=body.context_refs,
        answers=body.answers,
        genui_prompt=body.genui_prompt,
        impact_prompt=body.impact_prompt,
        period_days=body.period_days,
        policy_id=body.policy_id,
        title=body.title,
        created_by=actor,
    )
    return StreamingResponse(stream, media_type="application/x-ndjson")


@router.get("")
async def policy_list(limit: int = 50, user=AdminUser):
    del user
    return {"policies": policy_studio.list_policies(limit)}


@router.get("/{policy_id}")
async def policy_detail(policy_id: str, user=AdminUser):
    del user
    policy = policy_studio.get_policy(policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"policy": policy}


@router.post("/{policy_id}/implement")
async def policy_implement(policy_id: str, body: ImplementBody, user=AdminUser):
    if (body.confirm or "").strip().upper() != "IMPLEMENT":
        raise HTTPException(status_code=400, detail="Type IMPLEMENT to confirm this change")
    actor = str((user or {}).get("id") or "") or None
    try:
        return policy_studio.implement_policy(policy_id, actor_id=actor)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{policy_id}/rollback")
async def policy_rollback(policy_id: str, user=AdminUser):
    actor = str((user or {}).get("id") or "") or None
    try:
        return policy_studio.rollback_policy(policy_id, actor_id=actor)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
