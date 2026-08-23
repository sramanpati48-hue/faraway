"""Admin embedding regeneration via Nyaysahayak embed API + Postgres."""
from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Optional

import requests

from backend.database.postgres_pool import execute, execute_void, is_postgres_configured
from backend.services.admin_models import get_embedding_config
from backend.services.text_embeddings import embed_query, embed_texts as _embed_provider_texts


def _format_pgvector(values: list[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"


def embed_article_text(title: str, summary: str = "", content: str = "") -> Optional[list[float]]:
    """Return a 768-d embedding for an article using the configured provider.

    Mirrors the seed script: embeds "<title>. <summary>" for concise, retrieval-friendly vectors.
    """
    parts = [p for p in [(title or "").strip(), (summary or "").strip()] if p]
    text = ". ".join(parts) if parts else (content or "").strip()
    if not text:
        return None
    try:
        vecs = _embed_texts([text[:8000]])
        return vecs[0] if vecs else None
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ article embed failed: {exc}")
        return None


def format_pgvector(values: list[float]) -> str:
    return _format_pgvector(values)


def _embed_texts(texts: list[str]) -> list[list[float]]:
    return _embed_provider_texts(texts, task_type="RETRIEVAL_DOCUMENT")


def probe_ml_health() -> dict[str, Any]:
    cfg = get_embedding_config()
    result: dict[str, Any] = {
        "embedding_url": cfg["external_embedding_url"],
        "model": cfg["model"],
        "provider": cfg["provider"],
        "output_dimensionality": cfg.get("output_dimensionality"),
        "ok": False,
        "postgres": is_postgres_configured(),
    }
    provider = str(cfg.get("provider") or "").lower()
    if provider in ("vertex", "gemini", "google"):
        try:
            vec = embed_query("nyaysahayak embedding health")
            result["ok"] = bool(vec) and len(vec) == int(cfg.get("output_dimensionality") or 768)
            result["health"] = {"dim": len(vec) if vec else 0, "backend": "gemini-embedding-001"}
        except Exception as exc:
            result["error"] = str(exc)
        return result
    try:
        resp = requests.get(cfg["health_url"], timeout=8)
        resp.raise_for_status()
        result["health"] = resp.json()
        result["ok"] = True
    except Exception as exc:
        result["error"] = str(exc)
    return result


def regenerate_embeddings(scope: str = "all") -> dict[str, int]:
    if not is_postgres_configured():
        raise RuntimeError("DATABASE_URL not configured")

    counts = {
        "lawyers": 0,
        "mock_scams": 0,
        "legal_documents": 0,
        "scam_reports": 0,
        "articles": 0,
        "policy_context": 0,
    }
    scope = (scope or "all").lower()

    if scope in ("all", "policy_context"):
        # Lazy import: policy_context imports format_pgvector from this module.
        from backend.services.policy_context import reindex_policy_context

        try:
            result = reindex_policy_context()
            counts["policy_context"] = int(result.get("features", 0)) + int(result.get("tables", 0))
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] policy context reindex failed: {exc}")

    if scope in ("all", "lawyers"):
        rows = execute("SELECT id, COALESCE(bio, name, '') AS text FROM public.lawyers")
        for row in rows:
            text = (row.get("text") or "").strip()
            if not text:
                continue
            try:
                emb = _embed_texts([text])[0]
                execute_void(
                    "UPDATE public.lawyers SET embedding = %s::vector WHERE id = %s",
                    (_format_pgvector(emb), row["id"]),
                )
                counts["lawyers"] += 1
            except Exception as exc:
                print(f"⚠️ lawyer embed failed {row.get('id')}: {exc}")

    if scope in ("all", "mock_scams"):
        rows = execute(
            "SELECT id, COALESCE(description, title, '') AS text FROM public.mock_scams"
        )
        for row in rows:
            text = (row.get("text") or "").strip()
            if not text:
                continue
            try:
                emb = _embed_texts([text])[0]
                execute_void(
                    "UPDATE public.mock_scams SET embedding = %s::vector WHERE id = %s",
                    (_format_pgvector(emb), row["id"]),
                )
                counts["mock_scams"] += 1
            except Exception as exc:
                print(f"⚠️ mock_scam embed failed {row.get('id')}: {exc}")

    if scope in ("all", "legal_documents"):
        rows = execute(
            """
            SELECT id, COALESCE(content, summary, title, '') AS text
            FROM public.legal_documents
            ORDER BY id
            LIMIT 2000
            """
        )
        for row in rows:
            text = (row.get("text") or "").strip()
            if not text:
                continue
            try:
                emb = _embed_texts([text[:8000]])[0]
                execute_void(
                    "UPDATE public.legal_documents SET embedding = %s::vector WHERE id = %s",
                    (_format_pgvector(emb), row["id"]),
                )
                counts["legal_documents"] += 1
            except Exception as exc:
                print(f"⚠️ legal_document embed failed {row.get('id')}: {exc}")

    if scope in ("all", "scam_reports"):
        rows = execute("SELECT id, description FROM public.scam_reports")
        for row in rows:
            text = (row.get("description") or "").strip()
            if not text:
                continue
            try:
                emb = _embed_texts([text])[0]
                execute_void(
                    "UPDATE public.scam_reports SET embedding = %s::vector WHERE id = %s",
                    (_format_pgvector(emb), row["id"]),
                )
                counts["scam_reports"] += 1
            except Exception as exc:
                print(f"⚠️ scam_report embed failed {row.get('id')}: {exc}")

    if scope in ("all", "articles"):
        rows = execute(
            "SELECT id, title, summary, content FROM public.articles ORDER BY published_at DESC"
        )
        # Batch article embeds for efficiency.
        batch: list[tuple[str, str]] = []  # (id, text)
        for row in rows:
            parts = [p for p in [(row.get("title") or "").strip(), (row.get("summary") or "").strip()] if p]
            text = ". ".join(parts) if parts else (row.get("content") or "").strip()
            if text:
                batch.append((row["id"], text[:8000]))
        for start in range(0, len(batch), 25):
            chunk = batch[start : start + 25]
            try:
                vecs = _embed_texts([t for _, t in chunk])
                for (aid, _), emb in zip(chunk, vecs):
                    execute_void(
                        "UPDATE public.articles SET embedding = %s::vector WHERE id = %s",
                        (_format_pgvector(emb), aid),
                    )
                    counts["articles"] += 1
            except Exception as exc:
                print(f"⚠️ article embed batch failed at {start}: {exc}")

    return counts


# ---------------------------------------------------------------------------
# Async regeneration jobs (in-memory registry; single-process)
# ---------------------------------------------------------------------------

_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()


def _run_job(job_id: str, scope: str) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job:
            job["status"] = "running"
            job["started_at"] = time.time()
    try:
        counts = regenerate_embeddings(scope)
        with _JOBS_LOCK:
            job = _JOBS.get(job_id)
            if job:
                job["status"] = "completed"
                job["counts"] = counts
                job["finished_at"] = time.time()
    except Exception as exc:  # noqa: BLE001
        with _JOBS_LOCK:
            job = _JOBS.get(job_id)
            if job:
                job["status"] = "failed"
                job["error"] = str(exc)
                job["finished_at"] = time.time()


def start_async_regenerate(scope: str = "all") -> dict[str, Any]:
    if not is_postgres_configured():
        raise RuntimeError("DATABASE_URL not configured")
    job_id = uuid.uuid4().hex
    with _JOBS_LOCK:
        _JOBS[job_id] = {
            "job_id": job_id,
            "scope": (scope or "all").lower(),
            "status": "queued",
            "counts": None,
            "error": None,
            "created_at": time.time(),
        }
    thread = threading.Thread(target=_run_job, args=(job_id, (scope or "all").lower()), daemon=True)
    thread.start()
    with _JOBS_LOCK:
        return dict(_JOBS[job_id])


def get_job(job_id: str) -> Optional[dict[str, Any]]:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        return dict(job) if job else None
