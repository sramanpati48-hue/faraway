from __future__ import annotations

import json
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from backend.database.auth_middleware import require_roles
from backend.database.pdf_service import CloudinaryService
from backend.database.postgres_pool import check_database_connection, execute, execute_one, is_postgres_configured
from backend.database import supabase_db
from backend.services import admin_cases
from backend.services import admin_db
from backend.services import admin_models
from backend.services import admin_billing
from backend.services import admin_users
from backend.services.admin_users import AdminUserError
from backend.services import ai_usage
from backend.services import embedding_admin
from backend.services import graph_registry
from backend.services import graph_payload_generator
from backend.services import rag_funnel
from backend.services import scr_scraper
from backend.services import scam_trends_scraper
from backend.services import scam_case_classifier

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}
MAX_IMAGE_BYTES = 8 * 1024 * 1024
ALLOWED_UPLOAD_FOLDERS = {"articles", "site", "general", "heroes"}

router = APIRouter(prefix="/api/admin", tags=["admin"])

AdminUser = Depends(require_roles("admin", "super_admin"))


class SqlBody(BaseModel):
    sql: str
    allow_write: bool = False


class SqlGenerateBody(BaseModel):
    prompt: str
    provider: str = "groq"
    model: str = ""
    tables: Optional[list[str]] = None


class RowInsertBody(BaseModel):
    values: dict[str, Any]


class RowUpdateBody(BaseModel):
    pk: dict[str, Any]
    values: dict[str, Any]


class RowDeleteBody(BaseModel):
    pk: dict[str, Any]


class GraphRunBody(BaseModel):
    graph_id: str = "chat_agent"
    query: str
    initial_state: Optional[dict[str, Any]] = None


class GraphResumeBody(BaseModel):
    message: Optional[str] = None
    answers: Optional[dict[str, str]] = None


class GraphForkBody(BaseModel):
    node_id: str
    payload: dict[str, Any]


class GraphPayloadGenerateBody(BaseModel):
    graph_id: str
    node_id: str
    prompt: str
    base_payload: dict[str, Any]
    provider: str
    model: str


class EmbeddingsRegenerateBody(BaseModel):
    scope: str = "all"


class RagChunkUpdateBody(BaseModel):
    values: dict[str, Any]


class RagQualityBody(BaseModel):
    sample_count: Optional[int] = None


class RagPromoteBody(BaseModel):
    only_approved: bool = True


class RagRerunBody(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None


class ScrSearchCreateBody(BaseModel):
    keyword: str
    search_opt: str = "PHRASE"
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    max_results: int = 100
    language: Optional[str] = None
    upload_to_cloudinary: bool = False
    provider: Optional[str] = None
    model: Optional[str] = None
    pages_per_batch: Optional[int] = None
    chunk_target_length: Optional[int] = None
    summary_target_length: Optional[int] = None
    quality_sample_count: Optional[int] = None
    category: Optional[str] = None
    authority: Optional[str] = None
    act_name: Optional[str] = None


class ScrCaptchaBody(BaseModel):
    captcha: str


class ScrResumeModelBody(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None


class ScrDuplicateDecisionBody(BaseModel):
    action: str  # skip | reingest


MAX_PDF_BYTES = 40 * 1024 * 1024


@router.get("/health")
async def admin_health(user=AdminUser):
    if not is_postgres_configured():
        return {"ok": False, "error": "DATABASE_URL not configured"}
    try:
        info = check_database_connection()
        return {"ok": True, "database": info}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/tables")
async def admin_list_tables(user=AdminUser):
    try:
        return {"tables": admin_db.list_tables()}
    except admin_db.AdminDbError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tables/{table}")
async def admin_table_schema(table: str, user=AdminUser):
    try:
        return admin_db.get_table_schema(table)
    except admin_db.AdminDbError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tables/{table}/rows")
async def admin_table_rows(
    table: str,
    offset: int = 0,
    limit: int = 50,
    orderBy: Optional[str] = None,
    orderDir: Optional[str] = None,
    order_by: Optional[str] = None,
    order_dir: Optional[str] = None,
    user=AdminUser,
):
    try:
        return admin_db.fetch_rows(
            table,
            offset=offset,
            limit=limit,
            order_by=order_by or orderBy,
            order_dir=order_dir or orderDir or "asc",
        )
    except admin_db.AdminDbError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/tables/{table}/rows")
async def admin_insert_row(table: str, body: RowInsertBody, user=AdminUser):
    try:
        return admin_db.insert_row(table, body.values, actor_id=str(user["id"]))
    except admin_db.AdminDbError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/tables/{table}/rows")
async def admin_update_row(table: str, body: RowUpdateBody, user=AdminUser):
    try:
        return admin_db.update_row(table, body.pk, body.values, actor_id=str(user["id"]))
    except admin_db.AdminDbError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/tables/{table}/rows")
async def admin_delete_row(table: str, body: RowDeleteBody, user=AdminUser):
    try:
        ok = admin_db.delete_row(table, body.pk, actor_id=str(user["id"]))
        return {"success": ok}
    except admin_db.AdminDbError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sql/info")
async def admin_sql_info(user=AdminUser):
    try:
        return admin_db.sql_connection_info()
    except admin_db.AdminDbError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sql/query")
async def admin_sql_query(body: SqlBody, user=AdminUser):
    try:
        return admin_db.run_sql(body.sql, allow_write=body.allow_write, actor_id=str(user["id"]))
    except admin_db.AdminDbError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sql/schema")
async def admin_sql_schema(user=AdminUser):
    """Compact public schema for the SQL generator UI."""
    try:
        return {"tables": admin_db.schema_catalog(include_counts=False)}
    except admin_db.AdminDbError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sql/generate")
async def admin_sql_generate(body: SqlGenerateBody, user=AdminUser):
    """Natural-language → SQL using live table schemas + selected model."""
    try:
        from backend.services.admin_models import default_model_for_provider

        provider = (body.provider or "groq").strip().lower()
        model = (body.model or "").strip() or default_model_for_provider(provider)
        result = admin_db.generate_sql_from_prompt(
            prompt=body.prompt,
            provider=provider,
            model=model,
            tables=body.tables,
        )
        return {"success": True, **result}
    except admin_db.AdminDbError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/langgraph/graphs")
async def admin_list_graphs(user=AdminUser):
    return {"graphs": graph_registry.list_registered_graphs(refresh=True)}


@router.get("/langgraph/graphs/{graph_id}")
async def admin_get_graph(graph_id: str, user=AdminUser):
    try:
        return graph_registry.get_graph_metadata(graph_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/langgraph/presets")
async def admin_list_presets(graph_id: Optional[str] = None, user=AdminUser):
    return {"presets": graph_registry.list_presets(graph_id)}


@router.get("/langgraph/runs")
async def admin_list_runs(graph_id: Optional[str] = None, limit: int = 50, user=AdminUser):
    return {"runs": graph_registry.list_runs(graph_id=graph_id, limit=limit)}


@router.get("/langgraph/runs/{run_id}")
async def admin_get_run(run_id: str, user=AdminUser):
    try:
        return graph_registry.get_run(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/langgraph/runs/{run_id}/nodes/{node_id}/input")
async def admin_get_node_input(run_id: str, node_id: str, user=AdminUser):
    try:
        return graph_registry.get_node_input_payload(run_id, node_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/langgraph/runs")
async def admin_create_run(body: GraphRunBody, user=AdminUser):
    try:
        return await graph_registry.create_and_run_test(
            body.graph_id,
            body.query,
            initial_state=body.initial_state,
            created_by=str(user["id"]),
        )
    except Exception as exc:
        detail = str(exc).strip() or repr(exc) or type(exc).__name__
        raise HTTPException(status_code=500, detail=detail) from exc


@router.post("/langgraph/runs/{run_id}/resume")
async def admin_resume_run(run_id: str, body: GraphResumeBody, user=AdminUser):
    try:
        return await graph_registry.resume_and_run_test(
            run_id,
            message=body.message or "",
            answers=body.answers,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        detail = str(exc).strip() or repr(exc) or type(exc).__name__
        raise HTTPException(status_code=500, detail=detail) from exc


@router.post("/langgraph/runs/{run_id}/fork")
async def admin_fork_run(run_id: str, body: GraphForkBody, user=AdminUser):
    try:
        return await graph_registry.fork_run_from_node(
            run_id,
            node_id=body.node_id,
            payload=body.payload,
            created_by=str(user["id"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        detail = str(exc).strip() or repr(exc) or type(exc).__name__
        raise HTTPException(status_code=500, detail=detail) from exc


@router.post("/langgraph/payload/generate")
async def admin_generate_graph_payload(body: GraphPayloadGenerateBody, user=AdminUser):
    try:
        return graph_payload_generator.generate_node_payload(
            graph_id=body.graph_id,
            node_id=body.node_id,
            prompt=body.prompt,
            base_payload=body.base_payload,
            provider=body.provider,
            model=body.model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        detail = str(exc).strip() or repr(exc) or type(exc).__name__
        raise HTTPException(status_code=500, detail=detail) from exc


@router.get("/ai-models")
async def admin_ai_models(user=AdminUser):
    return admin_models.get_admin_models_snapshot()


@router.get("/ai-usage")
async def admin_ai_usage(days: int = 7, user=AdminUser):
    return ai_usage.get_ai_usage_analytics(days)


@router.get("/ml-health")
async def admin_ml_health(user=AdminUser):
    return embedding_admin.probe_ml_health()


@router.get("/system-config")
async def admin_system_config(user=AdminUser):
    return {"config": admin_models.list_system_config()}


@router.patch("/system-config/{key}")
async def admin_patch_system_config(key: str, body: dict[str, Any], user=AdminUser):
    try:
        current = admin_models.read_config_key(key, {})
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Body must be a JSON object")
        # Full replacement for graph_node_models / nested configs when client sends complete value
        if key in ("graph_node_models",) and "chat_agent" in body:
            admin_models.write_config_key(key, body)
            return {"success": True, "key": key, "value": body}
        patch = (
            body.get("value")
            if isinstance(body.get("value"), dict) and set(body.keys()) <= {"value"}
            else body
        )
        merged = {**current, **patch} if isinstance(current, dict) else patch
        admin_models.write_config_key(key, merged)
        return {"success": True, "key": key, "value": merged}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class UserCreateBody(BaseModel):
    email: Optional[str] = None
    mobile: Optional[str] = None
    password: str
    role: str = "victim"
    display_name: Optional[str] = None


class UserPatchBody(BaseModel):
    status: Optional[str] = None
    role: Optional[str] = None
    display_name: Optional[str] = None


class UserResetPasswordBody(BaseModel):
    new_password: str


@router.post("/users")
async def admin_create_user(body: UserCreateBody, user=AdminUser):
    try:
        return admin_users.create_user(
            user,
            email=body.email,
            mobile=body.mobile,
            password=body.password,
            role=body.role,
            display_name=body.display_name,
        )
    except AdminUserError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("/users")
async def admin_list_users(
    q: str = "",
    role: Optional[str] = None,
    status: Optional[str] = None,
    has_cases: Optional[bool] = None,
    offset: int = 0,
    limit: int = 25,
    user=AdminUser,
):
    return admin_cases.list_users(
        q=q,
        role=role,
        status=status,
        has_cases=has_cases,
        offset=offset,
        limit=limit,
    )


@router.get("/users/{user_id}")
async def admin_get_user(user_id: str, user=AdminUser):
    row = admin_cases.get_user(user_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"user": row}


@router.patch("/users/{user_id}")
async def admin_patch_user(user_id: str, body: UserPatchBody, user=AdminUser):
    try:
        return admin_users.patch_user(
            user_id,
            user,
            status=body.status,
            role=body.role,
            display_name=body.display_name,
        )
    except AdminUserError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/users/{user_id}/reset-password")
async def admin_reset_user_password(user_id: str, body: UserResetPasswordBody, user=AdminUser):
    try:
        return admin_users.reset_password(user_id, user, body.new_password)
    except AdminUserError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.delete("/users/{user_id}")
async def admin_delete_user(user_id: str, user=AdminUser):
    try:
        return admin_users.delete_user(user_id, user)
    except AdminUserError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("/users/{user_id}/cases")
async def admin_list_user_cases(
    user_id: str,
    q: str = "",
    status: Optional[str] = None,
    pending: Optional[bool] = None,
    offset: int = 0,
    limit: int = 25,
    user=AdminUser,
):
    try:
        return admin_cases.list_user_cases(
            user_id,
            q=q,
            status=status,
            pending=pending,
            offset=offset,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/cases/{case_id}")
async def admin_get_case(case_id: str, source: Optional[str] = None, user=AdminUser):
    try:
        return admin_cases.get_case_detail(case_id, source=source)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/case-statuses")
async def admin_case_statuses(role: Optional[str] = None, user=AdminUser):
    return {"statuses": admin_cases.list_case_statuses(role=role)}


@router.get("/audit-logs")
async def admin_audit_logs(limit: int = 50, offset: int = 0, user=AdminUser):
    if not is_postgres_configured():
        return {"logs": [], "total": 0}
    limit = max(1, min(200, limit))
    offset = max(0, offset)
    total_row = execute_one("SELECT COUNT(*)::int AS total FROM public.admin_audit_logs")
    rows = execute(
        """
        SELECT id, actor_user_id, action, target_table, detail, created_at
        FROM public.admin_audit_logs
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
        """,
        (limit, offset),
    )
    logs = []
    for r in rows:
        logs.append(
            {
                **r,
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
            }
        )
    return {"logs": logs, "total": int((total_row or {}).get("total") or 0)}


@router.get("/billing/summary")
async def admin_billing_summary(user=AdminUser):
    del user
    return admin_billing.summary()


@router.get("/billing/subscriptions")
async def admin_billing_subscriptions(
    q: str = "",
    status: Optional[str] = None,
    plan_id: Optional[str] = None,
    offset: int = 0,
    limit: int = 25,
    user=AdminUser,
):
    del user
    return admin_billing.list_subscriptions(
        q=q, status=status, plan_id=plan_id, offset=offset, limit=limit
    )


@router.get("/billing/events")
async def admin_billing_events(
    q: str = "",
    event_type: Optional[str] = None,
    offset: int = 0,
    limit: int = 25,
    user=AdminUser,
):
    del user
    return admin_billing.list_events(q=q, event_type=event_type, offset=offset, limit=limit)


@router.post("/embeddings/regenerate")
async def admin_regenerate_embeddings(body: EmbeddingsRegenerateBody, user=AdminUser):
    try:
        counts = embedding_admin.regenerate_embeddings(body.scope)
        return {"success": True, "counts": counts}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/embeddings/regenerate-async")
async def admin_regenerate_embeddings_async(body: EmbeddingsRegenerateBody, user=AdminUser):
    try:
        job = embedding_admin.start_async_regenerate(body.scope)
        return {"success": True, "job": job}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/embeddings/regenerate-status/{job_id}")
async def admin_regenerate_status(job_id: str, user=AdminUser):
    job = embedding_admin.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job": job}


# ---------------------------------------------------------------------------
# RAG funnel (PDF -> LLM chunking -> staging -> promote into legal_documents)
# ---------------------------------------------------------------------------

@router.get("/rag/config")
async def admin_rag_config(user=AdminUser):
    try:
        return {"config": rag_funnel.get_default_config()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/rag-retrieval")
async def admin_rag_retrieval_config(user=AdminUser):
    """Per-graph legal RAG retrieval + live mock_scams match thresholds."""
    try:
        from backend.services import rag_retrieval_config as rag_ret

        return rag_ret.rag_retrieval_admin_snapshot()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/rag-retrieval")
async def admin_patch_rag_retrieval_config(body: dict[str, Any], user=AdminUser):
    try:
        from backend.services import rag_retrieval_config as rag_ret

        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Body must be a JSON object")
        config = rag_ret.save_rag_retrieval_config(body)
        return {
            "success": True,
            "config": config,
            "scam_match": rag_ret.get_scam_match_config(),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/rag/config")
async def admin_patch_rag_config(body: dict[str, Any], user=AdminUser):
    """Persist default RAG funnel LLM + chunk settings (provider/model survive reloads)."""
    try:
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Body must be a JSON object")
        current = rag_funnel.get_default_config()
        allowed = (
            "provider",
            "model",
            "ingest_mode",
            "pages_per_batch",
            "chunk_target_length",
            "summary_target_length",
            "quality_sample_count",
            "document_name",
            "act_name",
            "category",
            "authority",
        )
        patch = {k: body[k] for k in allowed if k in body and body[k] is not None}
        merged = {**current, **patch}
        admin_models.write_config_key("rag_funnel", merged)
        return {"success": True, "config": rag_funnel.get_default_config()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/rag/sessions")
async def admin_rag_list_sessions(
    limit: int = 50,
    offset: int = 0,
    source_kind: Optional[str] = None,
    q: Optional[str] = None,
    status: Optional[str] = None,
    user=AdminUser,
):
    try:
        return rag_funnel.list_sessions(
            limit,
            source_kind=source_kind,
            offset=offset,
            q=q,
            status=status,
            as_page=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/rag/sessions/{session_id}")
async def admin_rag_get_session(session_id: str, user=AdminUser):
    try:
        return {"session": rag_funnel.get_session(session_id)}
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/rag/sessions/{session_id}/chunks")
async def admin_rag_list_chunks(session_id: str, offset: int = 0, limit: int = 100, user=AdminUser):
    try:
        return rag_funnel.list_chunks(session_id, offset=offset, limit=limit)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/sessions")
async def admin_rag_create_session(
    file: UploadFile = File(...),
    document_name: str = Form(...),
    config: str = Form("{}"),
    upload_to_cloudinary: bool = Form(False),
    user=AdminUser,
):
    content_type = (file.content_type or "").lower().strip()
    if content_type and "pdf" not in content_type:
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail="PDF too large (max 40 MB)")

    try:
        overrides = json.loads(config or "{}")
        if not isinstance(overrides, dict):
            overrides = {}
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="config must be a JSON object")

    doc_name = (document_name or "").strip() or (file.filename or "Untitled document")

    try:
        pages = rag_funnel.extract_pdf_pages(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read PDF: {exc}") from exc
    if not any((p or "").strip() for p in pages):
        raise HTTPException(status_code=400, detail="No extractable text found in the PDF")

    run_config = rag_funnel.resolve_run_config(overrides)

    source_pdf_url = None
    if upload_to_cloudinary:
        result = CloudinaryService.upload_pdf(data, f"rag_{uuid4().hex}", str(user["id"]))
        if result.get("success"):
            source_pdf_url = result.get("url")
    run_config["source_pdf_url"] = source_pdf_url

    try:
        session = rag_funnel.create_session(
            document_name=doc_name,
            pages=pages,
            config=run_config,
            source_filename=file.filename,
            source_pdf_url=source_pdf_url,
            created_by=str(user["id"]),
        )
        job = rag_funnel.start_pipeline(str(session["id"]))
        return {
            "success": True,
            "session": rag_funnel.serialize_session(session),
            "job": job,
        }
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/rag/chunks/{chunk_id}")
async def admin_rag_update_chunk(chunk_id: str, body: RagChunkUpdateBody, user=AdminUser):
    try:
        return {"success": True, "chunk": rag_funnel.update_chunk(chunk_id, body.values)}
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/sessions/{session_id}/bulk-approve")
async def admin_rag_bulk_approve(session_id: str, user=AdminUser):
    try:
        return rag_funnel.bulk_approve_session(session_id)
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/sessions/{session_id}/rerun")
async def admin_rag_rerun(session_id: str, body: RagRerunBody | None = None, user=AdminUser):
    try:
        overrides: dict[str, Any] = {}
        if body:
            if body.provider:
                overrides["provider"] = body.provider
            if body.model:
                overrides["model"] = body.model
        return {
            "success": True,
            "job": rag_funnel.rerun_session(
                session_id,
                config_overrides=overrides or None,
            ),
        }
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/sessions/{session_id}/continue")
async def admin_rag_continue(session_id: str, body: RagRerunBody | None = None, user=AdminUser):
    """Resume paused_quota ingest from processed_pages without deleting chunks."""
    try:
        overrides: dict[str, Any] = {}
        if body:
            if body.provider:
                overrides["provider"] = body.provider
            if body.model:
                overrides["model"] = body.model
        return {
            "success": True,
            "job": rag_funnel.continue_session(
                session_id,
                config_overrides=overrides or None,
            ),
        }
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/sessions/{session_id}/quality")
async def admin_rag_quality(session_id: str, body: RagQualityBody, user=AdminUser):
    try:
        return {"success": True, "quality": rag_funnel.assess_quality(session_id, body.sample_count)}
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/sessions/{session_id}/promote")
async def admin_rag_promote(session_id: str, body: RagPromoteBody, user=AdminUser):
    try:
        return rag_funnel.promote_session(session_id, only_approved=body.only_approved)
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/rag/sessions/{session_id}")
async def admin_rag_delete(session_id: str, delete_promoted: bool = False, user=AdminUser):
    try:
        return rag_funnel.delete_session(session_id, delete_promoted=delete_promoted)
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# SCR Supreme Court judgment fetcher (keyword search -> PDF -> RAG funnel)
# ---------------------------------------------------------------------------


# List uses a dedicated path so GET never shares /rag/scr/searches with POST create
# (avoids 405 Method Not Allowed from stale proxies / partial reloads).
@router.get("/rag/scr/fetch-sessions")
async def admin_scr_list_searches(
    limit: int = 25,
    offset: int = 0,
    q: Optional[str] = None,
    status: Optional[str] = None,
    user=AdminUser,
):
    try:
        return scr_scraper.list_fetch_sessions(limit=limit, offset=offset, q=q, status=status)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# Back-compat alias for older clients (same handler body as fetch-sessions).
@router.get("/rag/scr/searches")
async def admin_scr_list_searches_alias(
    limit: int = 25,
    offset: int = 0,
    q: Optional[str] = None,
    status: Optional[str] = None,
    user=AdminUser,
):
    try:
        return scr_scraper.list_fetch_sessions(limit=limit, offset=offset, q=q, status=status)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/scr/searches")
async def admin_scr_create_search(body: ScrSearchCreateBody, user=AdminUser):
    try:
        config = {
            "search_opt": body.search_opt,
            "from_date": body.from_date or "",
            "to_date": body.to_date or "",
            "max_results": body.max_results,
            "language": body.language or "",
            "upload_to_cloudinary": body.upload_to_cloudinary,
            "provider": body.provider,
            "model": body.model,
            "summary_target_length": body.summary_target_length,
            "quality_sample_count": body.quality_sample_count,
            "category": body.category,
            "authority": body.authority,
            "act_name": body.act_name,
        }
        run = scr_scraper.create_run(
            keyword=body.keyword,
            config=config,
            created_by=str(user["id"]),
        )
        return {"success": True, "run": run}
    except scr_scraper.ScrScraperError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/rag/scr/searches/{run_id}/detail")
async def admin_scr_search_detail(run_id: str, user=AdminUser):
    try:
        return {"session": scr_scraper.get_fetch_session(run_id, include_pdfs=True)}
    except scr_scraper.ScrScraperError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/scr/searches/{run_id}/bulk-approve")
async def admin_scr_bulk_approve(run_id: str, user=AdminUser):
    try:
        # Ensure fetch exists.
        scr_scraper.get_fetch_session(run_id, include_pdfs=False)
        return rag_funnel.bulk_approve_scr_fetch(run_id)
    except scr_scraper.ScrScraperError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/scr/searches/{run_id}/promote")
async def admin_scr_promote(run_id: str, body: RagPromoteBody | None = None, user=AdminUser):
    """Promote approved judgment chunks from every PDF in one SCR fetch."""
    try:
        scr_scraper.get_fetch_session(run_id, include_pdfs=False)
        return rag_funnel.promote_scr_fetch(
            run_id,
            only_approved=(body.only_approved if body else True),
        )
    except scr_scraper.ScrScraperError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except rag_funnel.RagFunnelError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/scr/searches/{run_id}/captcha")
async def admin_scr_submit_captcha(run_id: str, body: ScrCaptchaBody, user=AdminUser):
    try:
        run = scr_scraper.submit_captcha(run_id, body.captcha)
        return {"success": True, "run": run}
    except scr_scraper.ScrScraperError as exc:
        detail = str(exc)
        # Invalid captcha / not found -> 400; keep UI retryable.
        status = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status, detail=detail) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/scr/searches/{run_id}/refresh-captcha")
async def admin_scr_refresh_captcha(run_id: str, user=AdminUser):
    try:
        return {"success": True, "run": scr_scraper.refresh_captcha(run_id)}
    except scr_scraper.ScrScraperError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/scr/searches/{run_id}/resume-model")
async def admin_scr_resume_model(run_id: str, body: ScrResumeModelBody, user=AdminUser):
    try:
        run = scr_scraper.resume_with_model(run_id, provider=body.provider, model=body.model)
        return {"success": True, "run": run}
    except scr_scraper.ScrScraperError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/rag/scr/searches/{run_id}/resolve-duplicate")
async def admin_scr_resolve_duplicate(run_id: str, body: ScrDuplicateDecisionBody, user=AdminUser):
    try:
        run = scr_scraper.resolve_duplicate(run_id, action=body.action)
        return {"success": True, "run": run}
    except scr_scraper.ScrScraperError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/rag/scr/searches/{run_id}")
async def admin_scr_get_search(run_id: str, user=AdminUser):
    try:
        return {"run": scr_scraper.get_run(run_id)}
    except scr_scraper.ScrScraperError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/rag/scr/searches/{run_id}")
async def admin_scr_delete_search(
    run_id: str,
    delete_pdfs: bool = True,
    user=AdminUser,
):
    try:
        return scr_scraper.delete_run(run_id, delete_pdfs=delete_pdfs)
    except scr_scraper.ScrScraperError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/rag/scr/cases")
async def admin_scr_list_cases(keyword: Optional[str] = None, limit: int = 100, user=AdminUser):
    try:
        return {"cases": scr_scraper.list_cases(keyword=keyword, limit=limit)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Articles CMS (rich content + semantic search + embeddings)
# ---------------------------------------------------------------------------

class ArticleBody(BaseModel):
    title: str
    category: str = "General"
    summary: str = ""
    content: str = ""
    author: Optional[str] = None
    tags: Optional[list[str]] = None
    read_minutes: Optional[int] = None
    hero_image: Optional[str] = None
    slug: Optional[str] = None
    published_at: Optional[str] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    meta_keywords: Optional[str] = None
    og_image: Optional[str] = None
    robots: Optional[str] = None
    canonical_path: Optional[str] = None
    structured_data: Optional[dict[str, Any]] = None


class ArticleUpdateBody(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    summary: Optional[str] = None
    content: Optional[str] = None
    author: Optional[str] = None
    tags: Optional[list[str]] = None
    read_minutes: Optional[int] = None
    hero_image: Optional[str] = None
    slug: Optional[str] = None
    published_at: Optional[str] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    meta_keywords: Optional[str] = None
    og_image: Optional[str] = None
    robots: Optional[str] = None
    canonical_path: Optional[str] = None
    structured_data: Optional[dict[str, Any]] = None


class ArticleSearchBody(BaseModel):
    query: str
    top_k: int = 12
    category: Optional[str] = None


def _serialize_article(row: dict | None) -> dict | None:
    if not row:
        return row
    out = dict(row)
    for key in ("published_at", "updated_at", "created_at"):
        if out.get(key) is not None and hasattr(out[key], "isoformat"):
            out[key] = out[key].isoformat()
    return out


@router.post("/upload/image")
async def admin_upload_image(
    file: UploadFile = File(...),
    folder: str = Form("articles"),
    user=AdminUser,
):
    """Upload an image to Cloudinary (admin article hero / site assets)."""
    content_type = (file.content_type or "").lower().strip()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type '{content_type or 'unknown'}'. Use JPEG, PNG, WebP, or GIF.",
        )

    safe_folder = (folder or "articles").strip().lower()
    if safe_folder not in ALLOWED_UPLOAD_FOLDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid folder. Allowed: {', '.join(sorted(ALLOWED_UPLOAD_FOLDERS))}",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 8 MB)")

    result = CloudinaryService.upload_image(
        data,
        folder=safe_folder,
        filename=file.filename or "image",
    )
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error") or "Cloudinary upload failed")

    return {
        "success": True,
        "url": result.get("url"),
        "public_id": result.get("public_id"),
        "width": result.get("width"),
        "height": result.get("height"),
        "format": result.get("format"),
        "bytes": result.get("bytes"),
        "folder": safe_folder,
    }


@router.get("/articles")
async def admin_articles_list(
    limit: int = 25,
    offset: int = 0,
    category: Optional[str] = None,
    q: Optional[str] = None,
    user=AdminUser,
):
    if not is_postgres_configured():
        return {"articles": [], "total": 0, "categories": []}
    limit = max(1, min(100, limit))
    offset = max(0, offset)
    rows = supabase_db.admin_list_articles(limit, offset, category, q)
    total = supabase_db.admin_count_articles(category, q)
    categories = supabase_db.list_article_categories()
    return {
        "articles": [_serialize_article(r) for r in rows],
        "total": total,
        "categories": categories,
        "limit": limit,
        "offset": offset,
    }


@router.get("/articles/{article_id}")
async def admin_article_get(article_id: str, user=AdminUser):
    article = supabase_db.get_article(article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"article": _serialize_article(article)}


@router.post("/articles")
async def admin_article_create(body: ArticleBody, user=AdminUser):
    if not (body.title or "").strip():
        raise HTTPException(status_code=400, detail="Title is required")
    try:
        embedding = embedding_admin.embed_article_text(body.title, body.summary or "", body.content or "")
        row = supabase_db.create_article(body.model_dump(exclude_none=False), embedding=embedding)
        return {"success": True, "article": _serialize_article(row), "embedded": embedding is not None}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/articles/{article_id}")
async def admin_article_update(article_id: str, body: ArticleUpdateBody, user=AdminUser):
    existing = supabase_db.get_article(article_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Article not found")
    try:
        data = body.model_dump(exclude_unset=True)
        # Re-embed when any content-bearing field changes.
        embedding = None
        if any(k in data for k in ("title", "summary", "content")):
            title = data.get("title", existing.get("title"))
            summary = data.get("summary", existing.get("summary"))
            content = data.get("content", existing.get("content"))
            embedding = embedding_admin.embed_article_text(title or "", summary or "", content or "")
        row = supabase_db.update_article(article_id, data, embedding=embedding)
        return {"success": True, "article": _serialize_article(row), "embedded": embedding is not None}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/articles/{article_id}")
async def admin_article_delete(article_id: str, user=AdminUser):
    try:
        ok = supabase_db.delete_article(article_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Article not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/articles/{article_id}/regenerate-embedding")
async def admin_article_regenerate_embedding(article_id: str, user=AdminUser):
    article = supabase_db.get_article(article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    try:
        embedding = embedding_admin.embed_article_text(
            article.get("title") or "", article.get("summary") or "", article.get("content") or ""
        )
        if not embedding:
            raise HTTPException(status_code=502, detail="Embedding service returned no vector")
        supabase_db.update_article(article_id, {}, embedding=embedding)
        return {"success": True, "has_embedding": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/articles/search")
async def admin_article_search(body: ArticleSearchBody, user=AdminUser):
    query = (body.query or "").strip()
    if not query:
        return {"articles": [], "query": query}
    try:
        from backend.database.vector_db import VectorDB

        results = VectorDB().search_articles(query, body.top_k, body.category)
        return {"articles": results, "query": query}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Scam Trends scraper ─────────────────────────────────────────────────────


class ScamTrendsCreateBody(BaseModel):
    target_date: Optional[str] = None
    areas: Optional[list[str]] = None
    count: int = 10
    provider: str = "groq"
    model: str = ""
    custom_query: Optional[str] = None


@router.get("/scam-trends/config")
async def admin_scam_trends_config(user=AdminUser):
    """Editable extraction prompt + filters, plus the fixed output schema."""
    return {
        "config": scam_trends_scraper.get_trends_config(),
        "defaults": scam_trends_scraper.DEFAULT_TRENDS_CONFIG,
        "schema": scam_trends_scraper.EXTRACTION_SCHEMA,
    }


@router.patch("/scam-trends/config")
async def admin_patch_scam_trends_config(body: dict[str, Any], user=AdminUser):
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    patch = body.get("value") if isinstance(body.get("value"), dict) else body
    allowed = (
        "system_prompt",
        "recency_days",
        "search_timelimit",
        "prefer_news",
        "strict_filters",
        "blocked_domains",
    )
    merged = {**scam_trends_scraper.get_trends_config()}
    for key in allowed:
        if key not in patch:
            continue
        value = patch[key]
        if key == "system_prompt":
            text = str(value or "").strip()
            if not text:
                raise HTTPException(status_code=400, detail="System prompt cannot be empty")
            merged[key] = text[:20000]
        elif key == "recency_days":
            try:
                merged[key] = max(0, min(3650, int(value)))
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail="recency_days must be a number") from exc
        elif key == "search_timelimit":
            window = str(value or "")
            if window not in ("d", "w", "m", "y", ""):
                raise HTTPException(status_code=400, detail="search_timelimit must be d, w, m, y or empty")
            merged[key] = window
        elif key == "blocked_domains":
            if not isinstance(value, list):
                raise HTTPException(status_code=400, detail="blocked_domains must be a list")
            merged[key] = [str(v).strip().lower() for v in value if str(v).strip()][:200]
        else:
            merged[key] = bool(value)
    try:
        admin_models.write_config_key("scam_trends", merged)
        admin_models.invalidate_config_cache()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"success": True, "config": scam_trends_scraper.get_trends_config()}


@router.get("/scam-trends/runs")
async def admin_scam_trends_list(limit: int = 50, user=AdminUser):
    try:
        return {"runs": scam_trends_scraper.list_runs(limit=limit)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/scam-trends/runs")
async def admin_scam_trends_create(body: ScamTrendsCreateBody, user=AdminUser):
    try:
        run = scam_trends_scraper.create_run(
            target_date=body.target_date,
            areas=body.areas,
            count=body.count,
            provider=body.provider,
            model=body.model,
            custom_query=body.custom_query,
            created_by=str(user["id"]),
        )
        return {"success": True, "run": run}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/scam-trends/runs/{run_id}")
async def admin_scam_trends_status(run_id: str, user=AdminUser):
    run = scam_trends_scraper.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"run": run}


@router.post("/scam-trends/runs/{run_id}/process")
async def admin_scam_trends_process(run_id: str, user=AdminUser):
    """Run the job inside this HTTP request (Cloud Run CPU stays allocated; no min-instances)."""
    try:
        run = scam_trends_scraper.ensure_processing(run_id, sync=True)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        return {"success": True, "run": run}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class ScamTrendDraftStatusBody(BaseModel):
    status: str


@router.get("/scam-trends/runs/{run_id}/drafts")
async def admin_scam_trends_list_drafts(run_id: str, user=AdminUser):
    run = scam_trends_scraper.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    try:
        return {"drafts": scam_trends_scraper.list_drafts(run_id), "run": run}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/scam-trends/drafts/{draft_id}/status")
async def admin_scam_trends_draft_status(draft_id: str, body: ScamTrendDraftStatusBody, user=AdminUser):
    try:
        draft = scam_trends_scraper.set_draft_status(draft_id, body.status)
        run_id = str(draft.get("run_id") or "")
        run = scam_trends_scraper.get_run(run_id) if run_id else None
        return {"success": True, "draft": draft, "run": run}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/scam-trends/runs/{run_id}/approve-all")
async def admin_scam_trends_approve_all(run_id: str, user=AdminUser):
    try:
        result = scam_trends_scraper.approve_all_drafts(run_id)
        result["run"] = scam_trends_scraper.get_run(run_id)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/scam-trends/runs/{run_id}/promote")
async def admin_scam_trends_promote(run_id: str, user=AdminUser):
    try:
        return scam_trends_scraper.promote_approved_drafts(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Scam case classifier (cluster similar cases → mock_scams) ───────────────


@router.post("/scam-classifier/run-now")
async def admin_scam_classifier_run_now(user=AdminUser):
    try:
        run = scam_case_classifier.start_run(
            trigger_source="manual",
            created_by=str(user["id"]),
        )
        return {"success": True, "run": run}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/scam-classifier/runs")
async def admin_scam_classifier_list(limit: int = 30, user=AdminUser):
    try:
        # Opportunistic schedule tick when admin opens the list (no always-on worker).
        try:
            scam_case_classifier.tick_schedule_and_process(sync=False)
        except Exception:
            pass
        return {"runs": scam_case_classifier.list_runs(limit=limit)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/scam-classifier/runs/{run_id}")
async def admin_scam_classifier_status(run_id: str, user=AdminUser):
    run = scam_case_classifier.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"run": run}


@router.post("/scam-classifier/runs/{run_id}/process")
async def admin_scam_classifier_process(run_id: str, user=AdminUser):
    """Run the job inside this HTTP request (Cloud Run CPU stays allocated; no min-instances)."""
    try:
        run = scam_case_classifier.ensure_processing(run_id, sync=True)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        return {"success": True, "run": run}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/scam-classifier/tick")
async def admin_scam_classifier_tick(user=AdminUser):
    """Enqueue schedule if due and process (admin or Cloud Scheduler with admin token)."""
    try:
        run = scam_case_classifier.tick_schedule_and_process(sync=True)
        return {"success": True, "run": run, "config": scam_case_classifier.get_config()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/scam-classifier/config")
async def admin_scam_classifier_config(user=AdminUser):
    try:
        scam_case_classifier.tick_schedule_and_process(sync=False)
    except Exception:
        pass
    return {"config": scam_case_classifier.get_config()}


@router.get("/moderator-queue/config")
async def admin_moderator_queue_config(user=AdminUser):
    from backend.services import moderator_queue

    return {"config": moderator_queue.get_queue_config()}


@router.patch("/moderator-queue/config")
async def admin_patch_moderator_queue_config(body: dict[str, Any], user=AdminUser):
    from backend.services import moderator_queue

    current = moderator_queue.get_queue_config()
    patch = body.get("value") if isinstance(body.get("value"), dict) else body
    if not isinstance(patch, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    merged = {**current, **patch}
    for key in ("cases_per_hour", "sla_minutes", "delay_tick_minutes"):
        if key in merged:
            merged[key] = max(1, int(merged[key]))
    if "respect_penalty_per_tick" in merged:
        merged["respect_penalty_per_tick"] = max(0.0, float(merged["respect_penalty_per_tick"]))
    admin_models.write_config_key("moderator_queue", merged)
    admin_models.invalidate_config_cache()
    return {"success": True, "config": moderator_queue.get_queue_config()}


@router.get("/moderator-revisions")
async def admin_list_moderator_revisions(
    q: str = "",
    page: int = 1,
    limit: int = 25,
    semantic: bool = True,
    user=AdminUser,
):
    from backend.services import moderator_queue

    page = max(1, int(page or 1))
    limit = max(1, min(100, int(limit or 25)))
    offset = (page - 1) * limit
    query_embedding = None
    q = (q or "").strip()
    if q and semantic:
        try:
            from backend.database.vector_db import VectorDB

            query_embedding = VectorDB()._embed_query_text(q[:2000])
        except Exception:
            query_embedding = None
    result = supabase_db.list_moderator_case_revisions(
        q=q if not query_embedding else "",
        offset=offset,
        limit=limit,
        query_embedding=query_embedding,
    )
    # If semantic returned empty but q present, fall back to ILIKE
    if q and query_embedding and not (result.get("items") or []):
        result = supabase_db.list_moderator_case_revisions(q=q, offset=offset, limit=limit)
    items = result.get("items") or []
    for item in items:
        item.pop("embedding", None)
        # Trim heavy JSON in list view
        for key in ("agent_report", "moderator_payload", "agent_payload"):
            if isinstance(item.get(key), dict):
                item[key] = {
                    k: item[key].get(k)
                    for k in list(item[key].keys())[:8]
                }
    return {
        "total": result.get("total") or 0,
        "page": page,
        "limit": limit,
        "items": items,
        "config": moderator_queue.get_queue_config(),
    }


@router.get("/moderator-revisions/{revision_id}")
async def admin_get_moderator_revision(revision_id: str, user=AdminUser):
    row = supabase_db.get_moderator_case_revision(revision_id)
    if not row:
        raise HTTPException(status_code=404, detail="Revision not found")
    row.pop("embedding", None)
    return {"revision": row}
