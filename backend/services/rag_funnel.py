"""RAG funnel: PDF -> LLM schema-aware chunking -> staging review -> promote.

Two ingest modes share the same staging/review/promote flow:

* ``pages`` — page batches are sent to an LLM that returns many structured
  chunks (used by admin PDF uploads).
* ``summary`` — the whole PDF is handed to the LLM in one call and condensed
  into a single information-rich chunk (used by SCR judgment ingestion).

Chunks are embedded (768-d) and stored in rag_ingest_chunks. Admins review/edit,
optionally run a quality assessment, rerun, then promote approved chunks into
public.legal_documents.

The pipeline runs as an in-memory async job (single-process), mirroring
embedding_admin.start_async_regenerate.
"""
from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
import uuid
from io import BytesIO
from typing import Any, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from backend.database.postgres_pool import execute, execute_one, execute_void, is_postgres_configured
from backend.services import admin_models
from backend.services import embedding_admin
from backend.utils import invoke_llm_with_selection

# Serialize RAG LLM calls across upload + SCR ingest threads so we don't stampede
# Vertex/Gemini RPM quotas (429 RESOURCE_EXHAUSTED).
_RAG_LLM_LOCK = threading.Semaphore(max(1, int(os.getenv("RAG_LLM_MAX_CONCURRENT", "1"))))
_RAG_LLM_MAX_RETRIES = max(1, int(os.getenv("RAG_LLM_MAX_RETRIES", "5")))
_RAG_LLM_RETRY_BASE_SECONDS = max(5.0, float(os.getenv("RAG_LLM_RETRY_BASE_SECONDS", "20")))
_RAG_LLM_BATCH_COOLDOWN_SECONDS = max(0.0, float(os.getenv("RAG_LLM_BATCH_COOLDOWN_SECONDS", "2")))

# Columns the LLM is asked to populate for each chunk (mirror of legal_documents).
CHUNK_TEXT_FIELDS = (
    "document_name",
    "act_name",
    "category",
    "section_number",
    "subsection_text",
    "title",
    "content",
    "summary",
    "authority",
    "jurisdiction",
    "legal_status",
    "severity_level",
    "punishments",
    "source_url",
    "source_type",
    "pdf_page_reference",
    "version",
    "language",
)
CHUNK_INT_FIELDS = ("year_introduced", "year_amendment")
CHUNK_ARRAY_FIELDS = ("related_acts", "keywords", "applicable_sections")
ALL_CHUNK_FIELDS = CHUNK_TEXT_FIELDS + CHUNK_INT_FIELDS + CHUNK_ARRAY_FIELDS

INGEST_MODES = ("pages", "summary")

DEFAULT_CONFIG = {
    "provider": "openrouter",
    "model": admin_models.DEFAULT_OPENROUTER_MODEL,
    "ingest_mode": "pages",
    "pages_per_batch": 5,
    "chunk_target_length": 3000,
    "summary_target_length": 15000,
    "quality_sample_count": 5,
}

# Providers whose APIs accept the raw PDF as an inline part. Everything else
# receives the extracted text of the whole document instead.
_PDF_NATIVE_PROVIDERS = frozenset(
    p.strip().lower()
    for p in (os.getenv("RAG_PDF_NATIVE_PROVIDERS", "gemini,vertex").split(","))
    if p.strip()
)
_SUMMARY_MAX_INPUT_CHARS = max(20000, int(os.getenv("RAG_SUMMARY_MAX_INPUT_CHARS", "1000000")))
_SUMMARY_MAX_PDF_BYTES = max(1_000_000, int(os.getenv("RAG_SUMMARY_MAX_PDF_BYTES", "100000000")))


class RagFunnelError(RuntimeError):
    pass


class RateLimitError(RagFunnelError):
    """LLM provider daily/minute quota exhausted (e.g. OpenRouter free-models-per-day)."""

    def __init__(self, message: str, *, session_id: Optional[str] = None):
        super().__init__(message)
        self.session_id = session_id


def _is_rate_limit_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return (
        "429" in text
        or "rate limit" in text
        or "free-models-per-day" in text
        or "resourceexhausted" in text
        or "resource exhausted" in text
    )


def _friendly_rate_limit_message(exc: BaseException) -> str:
    text = str(exc)
    lower = text.lower()
    if "free-models-per-day" in lower:
        return (
            "OpenRouter free-model daily limit reached (typically 50/day). "
            "Change provider/model in the RAG funnel header, then continue processing."
        )
    if "resource_exhausted" in lower or "resource exhausted" in lower or "429" in lower:
        return (
            "LLM provider quota/rate limit hit (HTTP 429). "
            "Wait a minute, or switch provider/model in the RAG funnel header, then continue. "
            f"Details: {text[:280]}"
        )
    return f"LLM rate limit hit: {text[:400]}"


def _invoke_rag_llm(
    provider: str,
    model: str,
    messages: list[Any],
    *,
    task_id: str,
    temperature: float = 0,
    max_tokens: Optional[int] = None,
):
    """Invoke LLM for RAG chunking with a global concurrency cap and 429 backoff."""
    last_exc: Optional[BaseException] = None
    with _RAG_LLM_LOCK:
        for attempt in range(_RAG_LLM_MAX_RETRIES):
            try:
                return invoke_llm_with_selection(
                    provider,
                    model,
                    messages,
                    task_id=task_id,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if not _is_rate_limit_error(exc):
                    raise
                if attempt >= _RAG_LLM_MAX_RETRIES - 1:
                    break
                # Exponential backoff: 20s, 40s, 80s… (capped) — Vertex capacity 429s often clear.
                delay = min(180.0, _RAG_LLM_RETRY_BASE_SECONDS * (2**attempt))
                print(
                    f"⚠️ rag_funnel LLM 429 ({task_id}) attempt {attempt + 1}/"
                    f"{_RAG_LLM_MAX_RETRIES}; backing off {delay:.0f}s"
                )
                time.sleep(delay)
    raise RateLimitError(_friendly_rate_limit_message(last_exc or RuntimeError("rate limited")))


# ---------------------------------------------------------------------------
# PDF extraction
# ---------------------------------------------------------------------------

def extract_pdf_pages(pdf_bytes: bytes) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(pdf_bytes))
    pages: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        text = re.sub(r"\s+", " ", text).strip()
        pages.append(text)
    return pages


# Raw PDFs kept in memory so summary-mode ingest can hand the file itself to the
# model. Reruns after a restart fall back to the source URL or extracted text.
_PDF_CACHE: dict[str, bytes] = {}
_PDF_CACHE_ORDER: list[str] = []
_PDF_CACHE_LOCK = threading.Lock()
_PDF_CACHE_MAX_ENTRIES = max(1, int(os.getenv("RAG_PDF_CACHE_ENTRIES", "20")))


def register_session_pdf(session_id: str, pdf_bytes: bytes) -> None:
    """Keep a PDF around so the ingest pipeline can send the file to the model."""
    if not session_id or not pdf_bytes or len(pdf_bytes) > _SUMMARY_MAX_PDF_BYTES:
        return
    with _PDF_CACHE_LOCK:
        if session_id in _PDF_CACHE:
            _PDF_CACHE_ORDER.remove(session_id)
        _PDF_CACHE[session_id] = pdf_bytes
        _PDF_CACHE_ORDER.append(session_id)
        while len(_PDF_CACHE_ORDER) > _PDF_CACHE_MAX_ENTRIES:
            _PDF_CACHE.pop(_PDF_CACHE_ORDER.pop(0), None)


def _cached_session_pdf(session_id: str) -> Optional[bytes]:
    with _PDF_CACHE_LOCK:
        return _PDF_CACHE.get(session_id)


def _load_session_pdf(session_id: str, source_pdf_url: Optional[str]) -> Optional[bytes]:
    cached = _cached_session_pdf(session_id)
    if cached:
        return cached
    url = (source_pdf_url or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return None
    try:
        import requests

        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        data = resp.content
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ rag_funnel could not re-download source PDF ({session_id}): {exc}")
        return None
    if not data or len(data) > _SUMMARY_MAX_PDF_BYTES:
        return None
    register_session_pdf(session_id, data)
    return data


# ---------------------------------------------------------------------------
# LLM response parsing
# ---------------------------------------------------------------------------

def _response_text(response: Any) -> str:
    content = getattr(response, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(block.get("text") or "") if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content or "")


def _strip_code_fence(text: str) -> str:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def _sanitize_json_text(text: str) -> str:
    """Best-effort cleanup of common LLM JSON mistakes."""
    cleaned = text or ""
    # Drop ASCII control chars except tab/newline/carriage-return.
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", cleaned)
    # Trailing commas before } or ].
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    return cleaned


def _loads_json(text: str) -> Any:
    return json.loads(_sanitize_json_text(text))


def _extract_balanced_objects(text: str) -> list[dict[str, Any]]:
    """Scan text for top-level {...} objects and parse each independently.

    Survives truncated arrays and broken later items by keeping earlier valid objects.
    """
    objects: list[dict[str, Any]] = []
    i = 0
    n = len(text)
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        depth = 0
        in_str = False
        escape = False
        start = i
        j = i
        while j < n:
            ch = text[j]
            if in_str:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_str = False
            else:
                if ch == '"':
                    in_str = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        snippet = text[start : j + 1]
                        try:
                            parsed = _loads_json(snippet)
                            if isinstance(parsed, dict):
                                objects.append(parsed)
                        except json.JSONDecodeError:
                            pass
                        i = j + 1
                        break
            j += 1
        else:
            # Unclosed object — stop scanning.
            break
        if j >= n and depth != 0:
            break
    return objects


def _coerce_chunk_list(parsed: Any) -> list[dict[str, Any]]:
    if isinstance(parsed, dict):
        for key in ("chunks", "items", "results", "data"):
            if isinstance(parsed.get(key), list):
                parsed = parsed[key]
                break
        else:
            parsed = [parsed]
    if not isinstance(parsed, list):
        raise RagFunnelError("The model response must be a JSON array of chunks")
    return [c for c in parsed if isinstance(c, dict)]


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = _strip_code_fence(text)
    try:
        parsed = _loads_json(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise RagFunnelError("The model did not return a JSON object")
        try:
            parsed = _loads_json(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise RagFunnelError(f"The model returned invalid JSON: {exc.msg}") from exc
    if not isinstance(parsed, dict):
        raise RagFunnelError("The model response must be a JSON object")
    return parsed


def _extract_json_array(text: str) -> list[dict[str, Any]]:
    cleaned = _strip_code_fence(text)
    last_error: Optional[Exception] = None

    # 1) Direct parse.
    try:
        return _coerce_chunk_list(_loads_json(cleaned))
    except (json.JSONDecodeError, RagFunnelError) as exc:
        last_error = exc

    # 2) Slice to outermost array brackets.
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start >= 0 and end > start:
        try:
            return _coerce_chunk_list(_loads_json(cleaned[start : end + 1]))
        except (json.JSONDecodeError, RagFunnelError) as exc:
            last_error = exc

    # 3) Recover any complete objects from a truncated / broken array.
    recovered = _extract_balanced_objects(cleaned)
    if recovered:
        return recovered

    msg = getattr(last_error, "msg", None) or str(last_error or "invalid JSON")
    raise RagFunnelError(f"The model did not return a JSON array of chunks ({msg})")


# ---------------------------------------------------------------------------
# Chunk normalization
# ---------------------------------------------------------------------------

def _as_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return None


def _as_str_array(value: Any) -> Optional[list[str]]:
    if value is None:
        return None
    if isinstance(value, str):
        parts = [p.strip() for p in re.split(r"[,;\n]", value)]
        cleaned = [p for p in parts if p]
        return cleaned or None
    if isinstance(value, (list, tuple)):
        cleaned = [str(v).strip() for v in value if str(v).strip()]
        return cleaned or None
    return None


def _normalize_chunk(raw: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for field in CHUNK_TEXT_FIELDS:
        val = raw.get(field)
        out[field] = str(val).strip() if val not in (None, "") else None
    for field in CHUNK_INT_FIELDS:
        out[field] = _as_int(raw.get(field))
    for field in CHUNK_ARRAY_FIELDS:
        out[field] = _as_str_array(raw.get(field))

    # Apply session-level defaults for provenance / naming fields.
    out["document_name"] = out.get("document_name") or defaults.get("document_name")
    out["act_name"] = out.get("act_name") or defaults.get("act_name") or out.get("document_name")
    out["authority"] = out.get("authority") or defaults.get("authority") or "Unknown"
    out["category"] = out.get("category") or defaults.get("category") or "General"
    out["jurisdiction"] = out.get("jurisdiction") or "India"
    out["version"] = out.get("version") or "1.0"
    out["language"] = out.get("language") or "en"
    if defaults.get("source_pdf_url") and not out.get("source_url"):
        out["source_url"] = defaults["source_pdf_url"]
    if defaults.get("source_type") and not out.get("source_type"):
        out["source_type"] = defaults["source_type"]
    return out


def _chunk_embed_text(chunk: dict[str, Any]) -> str:
    parts = [
        chunk.get("title") or "",
        chunk.get("summary") or "",
        chunk.get("content") or "",
    ]
    text = ". ".join(p.strip() for p in parts if p and p.strip())
    return text[:32000]


# ---------------------------------------------------------------------------
# Config resolution
# ---------------------------------------------------------------------------

def get_default_config() -> dict[str, Any]:
    cfg = admin_models.read_config_key("rag_funnel", dict(DEFAULT_CONFIG))
    merged = {**DEFAULT_CONFIG, **(cfg if isinstance(cfg, dict) else {})}
    return merged


def resolve_run_config(overrides: Optional[dict[str, Any]]) -> dict[str, Any]:
    cfg = get_default_config()
    if overrides:
        for key in (
            "provider",
            "model",
            "document_name",
            "act_name",
            "category",
            "authority",
            "ingest_mode",
            "source_type",
        ):
            if overrides.get(key):
                cfg[key] = overrides[key]
        for key in (
            "pages_per_batch",
            "chunk_target_length",
            "summary_target_length",
            "quality_sample_count",
        ):
            if overrides.get(key) is not None:
                val = _as_int(overrides.get(key))
                if val and val > 0:
                    cfg[key] = val
    mode = str(cfg.get("ingest_mode") or "pages").strip().lower()
    cfg["ingest_mode"] = mode if mode in INGEST_MODES else "pages"
    cfg["pages_per_batch"] = max(1, int(cfg.get("pages_per_batch") or 5))
    cfg["chunk_target_length"] = max(200, int(cfg.get("chunk_target_length") or 3000))
    cfg["summary_target_length"] = max(
        800, min(100000, int(cfg.get("summary_target_length") or 15000))
    )
    cfg["quality_sample_count"] = max(1, int(cfg.get("quality_sample_count") or 5))
    return cfg


# ---------------------------------------------------------------------------
# Session persistence
# ---------------------------------------------------------------------------

def serialize_session(row: dict[str, Any]) -> dict[str, Any]:
    if not row:
        return row
    out = dict(row)
    for key in ("created_at", "updated_at"):
        if out.get(key) is not None and hasattr(out[key], "isoformat"):
            out[key] = out[key].isoformat()
    if out.get("id") is not None:
        out["id"] = str(out["id"])
    if out.get("scr_fetch_session_id") is not None:
        out["scr_fetch_session_id"] = str(out["scr_fetch_session_id"])
    # Don't ship full page text in list/detail payloads; expose a count instead.
    pages = out.pop("source_pages", None)
    if isinstance(pages, list):
        out["source_page_count"] = len(pages)
    return out


# Backwards/internal alias.
_serialize_session = serialize_session


def _serialize_chunk(row: dict[str, Any]) -> dict[str, Any]:
    if not row:
        return row
    out = dict(row)
    for key in ("created_at", "updated_at"):
        if out.get(key) is not None and hasattr(out[key], "isoformat"):
            out[key] = out[key].isoformat()
    # embedding vector is large + not JSON-friendly; expose a boolean.
    emb = out.pop("embedding", None)
    out["has_embedding"] = emb is not None
    return out


def create_session(
    *,
    document_name: str,
    pages: list[str],
    config: dict[str, Any],
    source_filename: Optional[str] = None,
    source_pdf_url: Optional[str] = None,
    created_by: Optional[str] = None,
    source_kind: str = "upload",
    scr_fetch_session_id: Optional[str] = None,
) -> dict[str, Any]:
    if not is_postgres_configured():
        raise RagFunnelError("DATABASE_URL not configured")
    kind = (source_kind or "upload").strip().lower()
    if kind not in ("upload", "scr"):
        kind = "upload"
    row = execute_one(
        """
        INSERT INTO public.rag_ingest_sessions
          (created_by, document_name, act_name, source_filename, source_pdf_url,
           source_pages, config, status, total_pages, source_kind, scr_fetch_session_id)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, 'pending', %s, %s, %s)
        RETURNING *
        """,
        (
            created_by,
            document_name,
            config.get("act_name"),
            source_filename,
            source_pdf_url,
            json.dumps(pages, ensure_ascii=False),
            json.dumps(config, default=str),
            len(pages),
            kind,
            scr_fetch_session_id,
        ),
    )
    if not row:
        raise RagFunnelError("Failed to create ingest session")
    return row


def get_session_row(session_id: str) -> Optional[dict[str, Any]]:
    return execute_one(
        "SELECT * FROM public.rag_ingest_sessions WHERE id = %s",
        (session_id,),
    )


def get_session(session_id: str) -> dict[str, Any]:
    row = get_session_row(session_id)
    if not row:
        raise RagFunnelError("Session not found")
    return _serialize_session(row)


def list_sessions(
    limit: int = 50,
    source_kind: Optional[str] = None,
    *,
    offset: int = 0,
    q: Optional[str] = None,
    status: Optional[str] = None,
    as_page: bool = False,
) -> Any:
    if not is_postgres_configured():
        return {"sessions": [], "total": 0, "limit": limit, "offset": offset} if as_page else []
    limit = max(1, min(200, limit))
    offset = max(0, offset)
    kind = (source_kind or "").strip().lower() or None
    if kind and kind not in ("upload", "scr"):
        kind = None
    where: list[str] = []
    params: list[Any] = []
    if kind:
        where.append("source_kind = %s")
        params.append(kind)
    if q and q.strip():
        where.append(
            "(document_name ILIKE %s OR COALESCE(source_filename, '') ILIKE %s OR COALESCE(act_name, '') ILIKE %s)"
        )
        like = f"%{q.strip()}%"
        params.extend([like, like, like])
    if status and status.strip():
        where.append("status = %s")
        params.append(status.strip().lower())
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    total_row = execute_one(
        f"SELECT COUNT(*)::int AS total FROM public.rag_ingest_sessions {where_sql}",
        tuple(params),
    )
    rows = execute(
        f"""
        SELECT id, created_at, updated_at, created_by, document_name, act_name,
               source_filename, source_pdf_url, config, status, total_pages,
               processed_pages, chunk_count, promoted_count, quality, error,
               source_kind, scr_fetch_session_id
        FROM public.rag_ingest_sessions
        {where_sql}
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    out = []
    for r in rows:
        s = _serialize_session(r)
        if s.get("scr_fetch_session_id") is not None:
            s["scr_fetch_session_id"] = str(s["scr_fetch_session_id"])
        out.append(s)
    if as_page:
        return {
            "sessions": out,
            "total": int((total_row or {}).get("total") or 0),
            "limit": limit,
            "offset": offset,
        }
    return out


def list_chunks(session_id: str, offset: int = 0, limit: int = 100) -> dict[str, Any]:
    if not is_postgres_configured():
        return {"chunks": [], "total": 0}
    limit = max(1, min(500, limit))
    offset = max(0, offset)
    total_row = execute_one(
        "SELECT COUNT(*)::int AS total FROM public.rag_ingest_chunks WHERE session_id = %s",
        (session_id,),
    )
    rows = execute(
        """
        SELECT * FROM public.rag_ingest_chunks
        WHERE session_id = %s
        ORDER BY seq ASC, created_at ASC
        LIMIT %s OFFSET %s
        """,
        (session_id, limit, offset),
    )
    return {
        "chunks": [_serialize_chunk(r) for r in rows],
        "total": int((total_row or {}).get("total") or 0),
        "offset": offset,
        "limit": limit,
    }


def _update_session(session_id: str, fields: dict[str, Any]) -> None:
    if not fields:
        return
    sets = []
    params: list[Any] = []
    for key, value in fields.items():
        if key in ("quality", "config"):
            sets.append(f"{key} = %s::jsonb")
            params.append(json.dumps(value, default=str))
        else:
            sets.append(f"{key} = %s")
            params.append(value)
    sets.append("updated_at = now()")
    params.append(session_id)
    execute_void(
        f"UPDATE public.rag_ingest_sessions SET {', '.join(sets)} WHERE id = %s",
        tuple(params),
    )


def _insert_chunk(session_id: str, seq: int, page_start: int, page_end: int, chunk: dict[str, Any]) -> str:
    columns = ["session_id", "seq", "page_start", "page_end", "status"]
    values: list[Any] = [session_id, seq, page_start, page_end, "draft"]
    for field in ALL_CHUNK_FIELDS:
        columns.append(field)
        values.append(chunk.get(field))
    placeholders = ", ".join(["%s"] * len(values))
    col_sql = ", ".join(columns)
    row = execute_one(
        f"INSERT INTO public.rag_ingest_chunks ({col_sql}) VALUES ({placeholders}) RETURNING id",
        tuple(values),
    )
    return str(row["id"]) if row else ""


def _embed_chunk(chunk_id: str, chunk: dict[str, Any]) -> bool:
    text = _chunk_embed_text(chunk)
    if not text:
        return False
    try:
        vecs = embedding_admin._embed_texts([text])
        if not vecs:
            return False
        execute_void(
            "UPDATE public.rag_ingest_chunks SET embedding = %s::vector, status = 'embedded', updated_at = now() WHERE id = %s",
            (embedding_admin.format_pgvector(vecs[0]), chunk_id),
        )
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ rag_funnel embed failed ({chunk_id}): {exc}")
        return False


# ---------------------------------------------------------------------------
# LLM chunking
# ---------------------------------------------------------------------------

def _schema_hint() -> str:
    return (
        "Target schema fields for each chunk (JSON keys):\n"
        "- document_name (str), act_name (str), category (str), authority (str)\n"
        "- title (str, concise heading), content (str, one complete self-contained passage)\n"
        "- summary (str, 1-2 sentences), keywords (array of strings)\n"
        "- section_number (str or null), subsection_text (str or null)\n"
        "- year_introduced (int or null), year_amendment (int or null)\n"
        "- jurisdiction (str, default 'India'), legal_status (str or null)\n"
        "- related_acts (array or null), applicable_sections (array or null)\n"
        "- severity_level (str or null), punishments (str or null)\n"
        "- source_type (str or null), pdf_page_reference (str, e.g. 'p.3-4')\n"
        "- language (str, default 'en'), version (str, default '1.0')"
    )


def _chunk_pages_with_llm(
    *,
    provider: str,
    model: str,
    page_texts: list[str],
    page_start: int,
    target_length: int,
    previous_summary: str,
    defaults: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    joined = "\n\n".join(
        f"[PDF page {page_start + i}]\n{txt}" for i, txt in enumerate(page_texts) if txt.strip()
    )
    if not joined.strip():
        return [], previous_summary

    system = SystemMessage(
        content=(
            "You are a legal-document ingestion engine. You split raw legal PDF text into "
            "clean, retrieval-ready chunks. Each chunk must be one complete, self-contained "
            "passage (a full section/paragraph, not a fragment). Fill every relevant field of "
            "the target schema accurately from the text. Do NOT invent facts, citations, or "
            "years that are not supported by the text; use null when unknown. "
            f"Aim for roughly {target_length} characters of 'content' per chunk. "
            "Return ONLY a JSON array of chunk objects, no markdown or commentary.\n\n"
            + _schema_hint()
        )
    )
    context = (
        f"Context carried from the previous pages (for continuity, do not re-chunk it):\n{previous_summary}\n\n"
        if previous_summary
        else ""
    )
    defaults_hint = (
        f"Default document_name='{defaults.get('document_name')}', "
        f"act_name='{defaults.get('act_name') or ''}', "
        f"category='{defaults.get('category') or ''}', "
        f"authority='{defaults.get('authority') or ''}'. "
        "Use these unless the text clearly indicates otherwise."
    )
    request = HumanMessage(
        content=(
            f"{context}{defaults_hint}\n\nRaw text from PDF pages {page_start} onward:\n\n{joined}\n\n"
            "Return the JSON array of chunks now."
        )
    )
    try:
        response = _invoke_rag_llm(
            provider,
            model,
            [system, request],
            task_id="rag_funnel.chunk",
            temperature=0,
            max_tokens=16384,
        )
        raw_text = _response_text(response)
        try:
            chunks_raw = _extract_json_array(raw_text)
        except RagFunnelError:
            # One repair pass: models often emit truncated / unescaped JSON on long pages.
            repair = HumanMessage(
                content=(
                    "Your previous reply was invalid JSON. Return ONLY a valid JSON array of chunk "
                    "objects (no markdown, no commentary). Escape all quotes inside strings. "
                    "If the content is long, return fewer chunks rather than truncated JSON.\n\n"
                    "Broken reply to repair:\n"
                    + raw_text[:50000]
                )
            )
            response = _invoke_rag_llm(
                provider,
                model,
                [system, request, repair],
                task_id="rag_funnel.chunk.repair",
                temperature=0,
                max_tokens=16384,
            )
            chunks_raw = _extract_json_array(_response_text(response))
    except RateLimitError:
        raise
    except Exception as exc:  # noqa: BLE001
        if _is_rate_limit_error(exc):
            raise RateLimitError(_friendly_rate_limit_message(exc)) from exc
        raise

    chunks = [_normalize_chunk(c, defaults) for c in chunks_raw]

    # Build a short context summary to carry into the next batch.
    next_summary = _summarize_for_context(chunks)
    return chunks, next_summary


def _document_text(pages: list[str], max_chars: int = _SUMMARY_MAX_INPUT_CHARS) -> str:
    """Whole-document text with page markers, trimmed head+tail if oversized."""
    joined = "\n\n".join(
        f"[PDF page {i + 1}]\n{(txt or '').strip()}"
        for i, txt in enumerate(pages)
        if (txt or "").strip()
    )
    if len(joined) <= max_chars:
        return joined
    head = joined[: int(max_chars * 0.7)]
    tail = joined[-int(max_chars * 0.3) :]
    return f"{head}\n\n[… middle of the document omitted for length …]\n\n{tail}"


def _summary_schema_hint() -> str:
    return (
        "Return ONE JSON object with exactly these keys:\n"
        "- document_name (str): full case/document title as printed on the PDF\n"
        "- act_name (str): the principal statute the document turns on, else the case name\n"
        "- category (str), authority (str, the deciding court/ministry)\n"
        "- title (str): concise heading a lawyer would search for\n"
        "- content (str): the information-rich digest (see length rule below)\n"
        "- summary (str): 2-4 sentence abstract of the outcome\n"
        "- subsection_text (str or null): the key operative passage, quoted from the document\n"
        "- section_number (str or null): the central provision, e.g. '302' or 'II'\n"
        "- applicable_sections (array of str): every statutory provision applied\n"
        "- related_acts (array of str): other statutes relied on\n"
        "- keywords (array of 8-15 lowercase search terms)\n"
        "- year_introduced (int or null): year of the judgment/document\n"
        "- year_amendment (int or null)\n"
        "- jurisdiction (str, default 'India'), legal_status (str, e.g. 'active')\n"
        "- severity_level (str or null), punishments (str or null)\n"
        "- language (str, default 'en'), version (str, default '1.0')\n"
        "- pdf_page_reference (str, e.g. 'p.1-24')"
    )


def _summarize_document_with_llm(
    *,
    provider: str,
    model: str,
    pages: list[str],
    pdf_bytes: Optional[bytes],
    target_length: int,
    defaults: dict[str, Any],
) -> dict[str, Any]:
    """One LLM call over the entire PDF -> one schema-complete chunk."""
    use_native_pdf = bool(pdf_bytes) and provider.strip().lower() in _PDF_NATIVE_PROVIDERS
    doc_text = "" if use_native_pdf else _document_text(pages)
    if not use_native_pdf and not doc_text.strip():
        raise RagFunnelError("No extractable text and the selected provider cannot read PDFs")

    system = SystemMessage(
        content=(
            "You are a legal-document ingestion engine. You are given ONE complete legal "
            "document (usually a Supreme Court judgment). Condense it into a single "
            "retrieval-ready record for a legal RAG knowledge base. The 'content' field must "
            "be self-contained and information-dense: parties and citation, the facts, the "
            "questions of law, the statutory provisions applied, the reasoning, the holding "
            "and ratio decidendi, and any directions, sentence, or relief granted. Preserve "
            "section numbers, citations, dates, and figures exactly. Never invent facts, "
            "citations, or years — use null when the document does not say. "
            f"Aim for roughly {target_length} characters of 'content'. "
            "Return ONLY the JSON object, no markdown or commentary.\n\n"
            + _summary_schema_hint()
        )
    )

    total_pages = len(pages)
    defaults_hint = (
        f"Defaults if the document is silent: document_name='{defaults.get('document_name') or ''}', "
        f"act_name='{defaults.get('act_name') or ''}', category='{defaults.get('category') or ''}', "
        f"authority='{defaults.get('authority') or ''}'. "
        f"The PDF has {total_pages} page(s); set pdf_page_reference to 'p.1-{max(1, total_pages)}'."
    )

    if use_native_pdf:
        request = HumanMessage(
            content=[
                {
                    "type": "text",
                    "text": f"{defaults_hint}\n\nSummarize the attached PDF into the JSON object now.",
                },
                {
                    "type": "media",
                    "mime_type": "application/pdf",
                    "data": base64.b64encode(pdf_bytes or b"").decode("ascii"),
                },
            ]
        )
    else:
        request = HumanMessage(
            content=(
                f"{defaults_hint}\n\nFull text of the document:\n\n{doc_text}\n\n"
                "Return the JSON object now."
            )
        )

    try:
        response = _invoke_rag_llm(
            provider,
            model,
            [system, request],
            task_id="rag_funnel.summary",
            temperature=0,
            max_tokens=16384,
        )
        raw_text = _response_text(response)
        try:
            parsed = _extract_json_object(raw_text)
        except RagFunnelError:
            recovered = _extract_balanced_objects(_strip_code_fence(raw_text))
            if recovered:
                parsed = recovered[0]
            else:
                repair = HumanMessage(
                    content=(
                        "Your previous reply was invalid JSON. Return ONLY one valid JSON object "
                        "with the required keys (no markdown, no commentary). Escape all quotes "
                        "inside strings.\n\nBroken reply to repair:\n" + raw_text[:50000]
                    )
                )
                response = _invoke_rag_llm(
                    provider,
                    model,
                    [system, request, repair],
                    task_id="rag_funnel.summary.repair",
                    temperature=0,
                    max_tokens=16384,
                )
                parsed = _extract_json_object(_response_text(response))
    except RateLimitError:
        raise
    except Exception as exc:  # noqa: BLE001
        if _is_rate_limit_error(exc):
            raise RateLimitError(_friendly_rate_limit_message(exc)) from exc
        raise

    chunk = _normalize_chunk(parsed, defaults)
    if not chunk.get("content"):
        raise RagFunnelError("The model returned an empty 'content' field for the document")
    if not chunk.get("title"):
        chunk["title"] = chunk.get("document_name") or defaults.get("document_name") or "Judgment"
    if not chunk.get("summary"):
        chunk["summary"] = (chunk.get("content") or "")[:600]
    if not chunk.get("pdf_page_reference"):
        chunk["pdf_page_reference"] = f"p.1-{max(1, total_pages)}"
    return chunk


def _summarize_for_context(chunks: list[dict[str, Any]]) -> str:
    if not chunks:
        return ""
    tail = chunks[-2:]
    parts = []
    for c in tail:
        title = c.get("title") or c.get("section_number") or "section"
        summ = c.get("summary") or (c.get("content") or "")[:200]
        parts.append(f"- {title}: {summ}")
    return "Last covered:\n" + "\n".join(parts)


# ---------------------------------------------------------------------------
# Pipeline execution
# ---------------------------------------------------------------------------

def _run_summary_pipeline(
    session_id: str,
    *,
    session: dict[str, Any],
    config: dict[str, Any],
    pages: list[str],
    defaults: dict[str, Any],
) -> None:
    """Whole-PDF -> one summarized, schema-complete chunk (SCR judgments)."""
    provider = str(config.get("provider") or DEFAULT_CONFIG["provider"])
    model = str(config.get("model") or DEFAULT_CONFIG["model"])
    target_length = max(800, int(config.get("summary_target_length") or 6000))
    total_pages = len(pages)

    _update_session(session_id, {"status": "running", "processed_pages": 0, "error": None})
    # A session only ever holds one summary chunk — reruns replace it.
    execute_void("DELETE FROM public.rag_ingest_chunks WHERE session_id = %s", (session_id,))

    pdf_bytes = _load_session_pdf(session_id, session.get("source_pdf_url"))
    print(
        f"▶️ rag_funnel summary ({session_id}): {total_pages} page(s) via {provider}/{model}"
        f" ({'native PDF' if pdf_bytes and provider.lower() in _PDF_NATIVE_PROVIDERS else 'extracted text'})"
    )

    try:
        chunk = _summarize_document_with_llm(
            provider=provider,
            model=model,
            pages=[str(p or "") for p in pages],
            pdf_bytes=pdf_bytes,
            target_length=target_length,
            defaults=defaults,
        )
    except RateLimitError as rate_exc:
        msg = str(rate_exc)
        print(f"⚠️ rag_funnel rate-limited ({session_id}): {msg}")
        _update_session(
            session_id,
            {"status": "paused_quota", "processed_pages": 0, "chunk_count": 0, "error": msg[:2000]},
        )
        _job_set(session_id, {"status": "paused_quota", "error": msg[:500]})
        return
    except Exception as exc:  # noqa: BLE001
        if _is_rate_limit_error(exc):
            msg = _friendly_rate_limit_message(exc)
            _update_session(
                session_id,
                {"status": "paused_quota", "processed_pages": 0, "chunk_count": 0, "error": msg[:2000]},
            )
            _job_set(session_id, {"status": "paused_quota", "error": msg[:500]})
            return
        _update_session(session_id, {"status": "failed", "chunk_count": 0, "error": str(exc)[:2000]})
        _job_set(session_id, {"status": "failed", "error": str(exc)[:500]})
        return

    chunk_id = _insert_chunk(session_id, 0, 1, max(1, total_pages), chunk)
    if not chunk_id:
        _update_session(
            session_id,
            {"status": "failed", "chunk_count": 0, "error": "Failed to stage the summary chunk"},
        )
        _job_set(session_id, {"status": "failed", "error": "Failed to stage the summary chunk"})
        return
    _embed_chunk(chunk_id, chunk)
    _update_session(
        session_id,
        {
            "status": "completed",
            "processed_pages": total_pages,
            "chunk_count": 1,
            "error": None,
        },
    )
    _job_set(session_id, {"status": "completed"})


def _run_pipeline(session_id: str, *, resume: bool = False) -> None:
    session = get_session_row(session_id)
    if not session:
        return
    config = session.get("config") or {}
    if not isinstance(config, dict):
        config = {}
    pages = session.get("source_pages") or []
    if not isinstance(pages, list):
        pages = []

    provider = str(config.get("provider") or DEFAULT_CONFIG["provider"])
    model = str(config.get("model") or DEFAULT_CONFIG["model"])
    pages_per_batch = max(1, int(config.get("pages_per_batch") or 2))
    target_length = max(200, int(config.get("chunk_target_length") or 1200))
    defaults = {
        "document_name": session.get("document_name"),
        "act_name": session.get("act_name"),
        "category": config.get("category"),
        "authority": config.get("authority"),
        "source_pdf_url": session.get("source_pdf_url"),
        "source_type": config.get("source_type"),
    }

    if str(config.get("ingest_mode") or "pages").strip().lower() == "summary":
        _run_summary_pipeline(
            session_id,
            session=session,
            config=config,
            pages=pages,
            defaults=defaults,
        )
        return

    if resume:
        processed = max(0, min(int(session.get("processed_pages") or 0), len(pages)))
        chunk_count = int(session.get("chunk_count") or 0)
        seq_row = execute_one(
            "SELECT COALESCE(MAX(seq), -1) AS max_seq FROM public.rag_ingest_chunks WHERE session_id = %s",
            (session_id,),
        )
        seq = int((seq_row or {}).get("max_seq") or -1) + 1
        if chunk_count <= 0:
            chunk_count = int(
                (execute_one(
                    "SELECT COUNT(*)::int AS n FROM public.rag_ingest_chunks WHERE session_id = %s",
                    (session_id,),
                ) or {}).get("n")
                or 0
            )
        # Continuity hint from the last staged chunks.
        previous_summary = ""
        if processed > 0:
            tail = execute(
                """
                SELECT title, section_number, summary, content
                FROM public.rag_ingest_chunks
                WHERE session_id = %s
                ORDER BY seq DESC
                LIMIT 2
                """,
                (session_id,),
            )
            previous_summary = _summarize_for_context(
                [
                    {
                        "title": r.get("title"),
                        "section_number": r.get("section_number"),
                        "summary": r.get("summary"),
                        "content": r.get("content"),
                    }
                    for r in reversed(tail or [])
                ]
            )
        _update_session(session_id, {"status": "running", "error": None})
        print(
            f"▶️ rag_funnel resume ({session_id}): from page {processed + 1}/{len(pages)} "
            f"seq={seq} chunks={chunk_count} via {provider}/{model}"
        )
    else:
        processed = 0
        seq = 0
        chunk_count = 0
        previous_summary = ""
        _update_session(session_id, {"status": "running", "processed_pages": 0, "error": None})

    batch_errors: list[str] = []
    try:
        for start in range(processed, len(pages), pages_per_batch):
            batch = pages[start : start + pages_per_batch]
            page_start = start + 1
            page_end = start + len(batch)
            try:
                chunks, previous_summary = _chunk_pages_with_llm(
                    provider=provider,
                    model=model,
                    page_texts=[str(p or "") for p in batch],
                    page_start=page_start,
                    target_length=target_length,
                    previous_summary=previous_summary,
                    defaults=defaults,
                )
            except RateLimitError as rate_exc:
                # Pause after retries exhausted — continuing would spam the same 429.
                msg = str(rate_exc)
                print(f"⚠️ rag_funnel rate-limited ({session_id}): {msg}")
                _update_session(
                    session_id,
                    {
                        "status": "paused_quota",
                        "processed_pages": processed,
                        "chunk_count": chunk_count,
                        "error": msg[:2000],
                    },
                )
                _job_set(session_id, {"status": "paused_quota", "error": msg[:500]})
                return
            except Exception as batch_exc:  # noqa: BLE001
                if _is_rate_limit_error(batch_exc):
                    msg = _friendly_rate_limit_message(batch_exc)
                    print(f"⚠️ rag_funnel rate-limited ({session_id}): {msg}")
                    _update_session(
                        session_id,
                        {
                            "status": "paused_quota",
                            "processed_pages": processed,
                            "chunk_count": chunk_count,
                            "error": msg[:2000],
                        },
                    )
                    _job_set(session_id, {"status": "paused_quota", "error": msg[:500]})
                    return
                # Don't fail the whole PDF over one bad LLM JSON batch.
                msg = f"pages {page_start}-{page_end}: {batch_exc}"
                print(f"⚠️ rag_funnel batch skipped ({session_id}): {msg}")
                batch_errors.append(msg)
                processed = page_end
                _update_session(
                    session_id,
                    {
                        "processed_pages": processed,
                        "chunk_count": chunk_count,
                        "error": f"Skipped {len(batch_errors)} batch(es); last: {msg}"[:2000],
                    },
                )
                continue
            for chunk in chunks:
                if not chunk.get("pdf_page_reference"):
                    chunk["pdf_page_reference"] = (
                        f"p.{page_start}" if page_start == page_end else f"p.{page_start}-{page_end}"
                    )
                chunk_id = _insert_chunk(session_id, seq, page_start, page_end, chunk)
                if chunk_id:
                    _embed_chunk(chunk_id, chunk)
                    chunk_count += 1
                    seq += 1
            processed = page_end
            _update_session(session_id, {"processed_pages": processed, "chunk_count": chunk_count})
            if _RAG_LLM_BATCH_COOLDOWN_SECONDS > 0 and processed < len(pages):
                time.sleep(_RAG_LLM_BATCH_COOLDOWN_SECONDS)

        if chunk_count == 0 and batch_errors:
            err = "; ".join(batch_errors[:5])
            _update_session(
                session_id,
                {"status": "failed", "processed_pages": len(pages), "chunk_count": 0, "error": err[:2000]},
            )
            _job_set(session_id, {"status": "failed", "error": err[:500]})
            return

        final_error = None
        if batch_errors:
            final_error = f"Completed with {len(batch_errors)} skipped batch(es): " + "; ".join(
                batch_errors[:3]
            )
        _update_session(
            session_id,
            {
                "status": "completed",
                "processed_pages": len(pages),
                "chunk_count": chunk_count,
                "error": (final_error[:2000] if final_error else None),
            },
        )
    except Exception as exc:  # noqa: BLE001
        _update_session(session_id, {"status": "failed", "error": str(exc), "chunk_count": chunk_count})
        _job_set(session_id, {"status": "failed", "error": str(exc)})
        return
    _job_set(session_id, {"status": "completed"})


# ---------------------------------------------------------------------------
# Async job registry (in-memory; single-process)
# ---------------------------------------------------------------------------

_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()


def _job_set(session_id: str, fields: dict[str, Any]) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(session_id)
        if job:
            job.update(fields)
            job["updated_at"] = time.time()


def _run_job(session_id: str) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(session_id) or {}
        resume = bool(job.get("resume"))
    _job_set(session_id, {"status": "running", "started_at": time.time()})
    _run_pipeline(session_id, resume=resume)
    with _JOBS_LOCK:
        job = _JOBS.get(session_id)
        if job and job.get("status") not in ("failed", "paused_quota"):
            job["status"] = "completed"
        if job:
            job["finished_at"] = time.time()


def start_pipeline(session_id: str, *, resume: bool = False) -> dict[str, Any]:
    if not is_postgres_configured():
        raise RagFunnelError("DATABASE_URL not configured")
    with _JOBS_LOCK:
        _JOBS[session_id] = {
            "session_id": session_id,
            "status": "queued",
            "resume": resume,
            "created_at": time.time(),
        }
    thread = threading.Thread(target=_run_job, args=(session_id,), daemon=True)
    thread.start()
    return {"session_id": session_id, "status": "queued", "resume": resume}


_TERMINAL_SESSION_STATUSES = frozenset({"completed", "failed", "promoted", "paused_quota"})


def wait_for_pipeline(
    session_id: str,
    *,
    poll_interval: float = 2.0,
    timeout_seconds: float = 3600.0,
) -> dict[str, Any]:
    """Block until a session pipeline reaches a terminal status (or timeout)."""
    deadline = time.time() + max(30.0, timeout_seconds)
    interval = max(0.5, poll_interval)
    last: Optional[dict[str, Any]] = None
    while time.time() < deadline:
        row = get_session_row(session_id)
        if not row:
            raise RagFunnelError("Session not found while waiting for pipeline")
        last = row
        status = str(row.get("status") or "")
        if status in _TERMINAL_SESSION_STATUSES:
            return _serialize_session(row)
        time.sleep(interval)
    status = str((last or {}).get("status") or "unknown")
    raise RagFunnelError(
        f"Timed out waiting for pipeline {session_id} (last status={status})"
    )


def run_pipeline_blocking(session_id: str, *, resume: bool = False) -> dict[str, Any]:
    """Run the chunking pipeline on the current thread (no parallel job)."""
    if not is_postgres_configured():
        raise RagFunnelError("DATABASE_URL not configured")
    with _JOBS_LOCK:
        _JOBS[session_id] = {
            "session_id": session_id,
            "status": "running",
            "resume": resume,
            "created_at": time.time(),
            "started_at": time.time(),
        }
    _run_pipeline(session_id, resume=resume)
    with _JOBS_LOCK:
        job = _JOBS.get(session_id)
        if job:
            if job.get("status") not in ("failed", "paused_quota"):
                job["status"] = "completed"
            job["finished_at"] = time.time()
    row = get_session_row(session_id)
    if not row:
        raise RagFunnelError("Session not found after pipeline")
    return _serialize_session(row)


# ---------------------------------------------------------------------------
# Chunk edits
# ---------------------------------------------------------------------------

_EDITABLE_TEXT_FIELDS = set(CHUNK_TEXT_FIELDS)
_EDITABLE_INT_FIELDS = set(CHUNK_INT_FIELDS)
_EDITABLE_ARRAY_FIELDS = set(CHUNK_ARRAY_FIELDS)
_EDITABLE_STATUS = {"draft", "embedded", "approved", "rejected"}


def bulk_approve_session(session_id: str) -> dict[str, Any]:
    """Approve all non-rejected, non-promoted chunks in a session."""
    if not is_postgres_configured():
        raise RagFunnelError("DATABASE_URL not configured")
    session = get_session_row(session_id)
    if not session:
        raise RagFunnelError("Session not found")
    row = execute_one(
        """
        WITH updated AS (
          UPDATE public.rag_ingest_chunks
          SET status = 'approved', updated_at = now()
          WHERE session_id = %s
            AND status NOT IN ('approved', 'rejected', 'promoted')
          RETURNING id
        )
        SELECT COUNT(*)::int AS approved FROM updated
        """,
        (session_id,),
    )
    return {"success": True, "approved": int((row or {}).get("approved") or 0)}


def bulk_approve_scr_fetch(scr_fetch_session_id: str) -> dict[str, Any]:
    """Approve chunks across all RAG sessions linked to an SCR fetch."""
    if not is_postgres_configured():
        raise RagFunnelError("DATABASE_URL not configured")
    row = execute_one(
        """
        WITH updated AS (
          UPDATE public.rag_ingest_chunks c
          SET status = 'approved', updated_at = now()
          FROM public.rag_ingest_sessions s
          WHERE c.session_id = s.id
            AND s.scr_fetch_session_id = %s
            AND c.status NOT IN ('approved', 'rejected', 'promoted')
          RETURNING c.id
        )
        SELECT COUNT(*)::int AS approved FROM updated
        """,
        (scr_fetch_session_id,),
    )
    return {"success": True, "approved": int((row or {}).get("approved") or 0)}


def update_chunk(chunk_id: str, values: dict[str, Any]) -> dict[str, Any]:
    if not is_postgres_configured():
        raise RagFunnelError("DATABASE_URL not configured")
    existing = execute_one("SELECT * FROM public.rag_ingest_chunks WHERE id = %s", (chunk_id,))
    if not existing:
        raise RagFunnelError("Chunk not found")

    sets: list[str] = []
    params: list[Any] = []
    content_changed = False
    for key, value in (values or {}).items():
        if key in _EDITABLE_TEXT_FIELDS:
            sets.append(f"{key} = %s")
            params.append(str(value).strip() if value not in (None, "") else None)
            if key in ("title", "summary", "content"):
                content_changed = True
        elif key in _EDITABLE_INT_FIELDS:
            sets.append(f"{key} = %s")
            params.append(_as_int(value))
        elif key in _EDITABLE_ARRAY_FIELDS:
            sets.append(f"{key} = %s")
            params.append(_as_str_array(value))
        elif key == "status" and value in _EDITABLE_STATUS:
            sets.append("status = %s")
            params.append(value)
    if not sets:
        return _serialize_chunk(existing)
    sets.append("updated_at = now()")
    params.append(chunk_id)
    execute_void(
        f"UPDATE public.rag_ingest_chunks SET {', '.join(sets)} WHERE id = %s",
        tuple(params),
    )

    updated = execute_one("SELECT * FROM public.rag_ingest_chunks WHERE id = %s", (chunk_id,))
    # Re-embed when content-bearing fields changed.
    if content_changed and updated:
        _embed_chunk(chunk_id, updated)
        updated = execute_one("SELECT * FROM public.rag_ingest_chunks WHERE id = %s", (chunk_id,))
    return _serialize_chunk(updated)


# ---------------------------------------------------------------------------
# Rerun / delete / promote
# ---------------------------------------------------------------------------

def update_session_config(session_id: str, overrides: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    session = get_session_row(session_id)
    if not session:
        raise RagFunnelError("Session not found")
    current = session.get("config") if isinstance(session.get("config"), dict) else {}
    merged = resolve_run_config({**(current or {}), **(overrides or {})})
    # Keep document-level fields from the prior config when resolve resets them.
    for key in ("category", "authority", "act_name", "document_name"):
        if current.get(key) and not merged.get(key):
            merged[key] = current[key]
    _update_session(session_id, {"config": merged})
    return get_session(session_id)


def prepare_session_rerun(
    session_id: str,
    *,
    config_overrides: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Clear chunks and reset status so a blocking/async pipeline can run again."""
    session = get_session_row(session_id)
    if not session:
        raise RagFunnelError("Session not found")
    if config_overrides:
        update_session_config(session_id, config_overrides)
    execute_void("DELETE FROM public.rag_ingest_chunks WHERE session_id = %s", (session_id,))
    _update_session(
        session_id,
        {
            "status": "pending",
            "processed_pages": 0,
            "chunk_count": 0,
            "promoted_count": 0,
            "quality": None,
            "error": None,
        },
    )
    return get_session(session_id)


def rerun_session(
    session_id: str,
    *,
    config_overrides: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    prepare_session_rerun(session_id, config_overrides=config_overrides)
    return start_pipeline(session_id, resume=False)


def rerun_session_blocking(
    session_id: str,
    *,
    config_overrides: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    prepare_session_rerun(session_id, config_overrides=config_overrides)
    return run_pipeline_blocking(session_id, resume=False)


def continue_session(
    session_id: str,
    *,
    config_overrides: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Resume a paused_quota (or interrupted) session without wiping staged chunks."""
    session = get_session_row(session_id)
    if not session:
        raise RagFunnelError("Session not found")
    if config_overrides:
        update_session_config(session_id, config_overrides)
    _update_session(session_id, {"status": "pending", "error": None})
    return start_pipeline(session_id, resume=True)


def delete_session(session_id: str, *, delete_promoted: bool = False) -> dict[str, Any]:
    session = get_session_row(session_id)
    if not session:
        raise RagFunnelError("Session not found")
    deleted_docs = 0
    if delete_promoted:
        rows = execute(
            "SELECT promoted_document_id FROM public.rag_ingest_chunks WHERE session_id = %s AND promoted_document_id IS NOT NULL",
            (session_id,),
        )
        ids = [r["promoted_document_id"] for r in rows if r.get("promoted_document_id") is not None]
        if ids:
            execute_void(
                "DELETE FROM public.legal_documents WHERE id = ANY(%s)",
                (ids,),
            )
            deleted_docs = len(ids)
    execute_void("DELETE FROM public.rag_ingest_sessions WHERE id = %s", (session_id,))
    return {"success": True, "deleted_promoted_documents": deleted_docs}


_PROMOTE_FIELDS = (
    "document_name",
    "act_name",
    "category",
    "year_introduced",
    "year_amendment",
    "section_number",
    "subsection_text",
    "title",
    "content",
    "summary",
    "authority",
    "jurisdiction",
    "legal_status",
    "related_acts",
    "keywords",
    "severity_level",
    "applicable_sections",
    "punishments",
    "source_url",
    "source_type",
    "pdf_page_reference",
    "version",
    "language",
)
# legal_documents NOT NULL columns: document_name, act_name, category, title, content, authority.
_PROMOTE_REQUIRED = ("document_name", "act_name", "category", "title", "content", "authority")


def promote_session(session_id: str, *, only_approved: bool = True) -> dict[str, Any]:
    session = get_session_row(session_id)
    if not session:
        raise RagFunnelError("Session not found")

    status_filter = "AND status = 'approved'" if only_approved else "AND status != 'promoted' AND status != 'rejected'"
    chunks = execute(
        f"SELECT * FROM public.rag_ingest_chunks WHERE session_id = %s {status_filter} ORDER BY seq ASC",
        (session_id,),
    )
    if not chunks:
        raise RagFunnelError(
            "No approved chunks to promote" if only_approved else "No promotable chunks found"
        )

    promoted = 0
    skipped: list[str] = []
    insert_cols = list(_PROMOTE_FIELDS) + ["embedding", "created_by"]
    col_sql = ", ".join(insert_cols)
    placeholders = ", ".join(["%s"] * len(_PROMOTE_FIELDS)) + ", %s::vector, %s"

    for chunk in chunks:
        missing = [f for f in _PROMOTE_REQUIRED if not str(chunk.get(f) or "").strip()]
        if missing:
            skipped.append(str(chunk.get("id")))
            continue
        values = [chunk.get(f) for f in _PROMOTE_FIELDS]
        emb = chunk.get("embedding")
        emb_str = emb if isinstance(emb, str) else (embedding_admin.format_pgvector(emb) if emb else None)
        values.append(emb_str)
        values.append(session.get("created_by"))
        row = execute_one(
            f"INSERT INTO public.legal_documents ({col_sql}) VALUES ({placeholders}) RETURNING id",
            tuple(values),
        )
        if row:
            execute_void(
                "UPDATE public.rag_ingest_chunks SET status = 'promoted', promoted_document_id = %s, updated_at = now() WHERE id = %s",
                (row["id"], chunk["id"]),
            )
            promoted += 1

    total_promoted_row = execute_one(
        "SELECT COUNT(*)::int AS c FROM public.rag_ingest_chunks WHERE session_id = %s AND status = 'promoted'",
        (session_id,),
    )
    total_promoted = int((total_promoted_row or {}).get("c") or 0)
    _update_session(session_id, {"promoted_count": total_promoted, "status": "promoted"})
    return {"success": True, "promoted": promoted, "skipped": skipped, "total_promoted": total_promoted}


def promote_scr_fetch(scr_fetch_session_id: str, *, only_approved: bool = True) -> dict[str, Any]:
    """Promote approved chunks from every PDF ingested under one SCR fetch."""
    if not is_postgres_configured():
        raise RagFunnelError("DATABASE_URL not configured")
    rows = execute(
        """
        SELECT id FROM public.rag_ingest_sessions
        WHERE scr_fetch_session_id = %s
        ORDER BY created_at ASC
        """,
        (scr_fetch_session_id,),
    )
    if not rows:
        raise RagFunnelError("No ingested PDFs found for this SCR session")

    promoted = 0
    promoted_sessions = 0
    skipped: list[str] = []
    for row in rows:
        try:
            result = promote_session(str(row["id"]), only_approved=only_approved)
        except RagFunnelError:
            # PDF has nothing approved yet — leave it for the next pass.
            continue
        count = int(result.get("promoted") or 0)
        promoted += count
        promoted_sessions += 1 if count else 0
        skipped.extend(result.get("skipped") or [])
    if promoted == 0:
        raise RagFunnelError("No approved chunks to promote in this SCR session")
    return {
        "success": True,
        "promoted": promoted,
        "promoted_sessions": promoted_sessions,
        "skipped": skipped,
    }


# ---------------------------------------------------------------------------
# Quality assessment
# ---------------------------------------------------------------------------

def assess_quality(session_id: str, sample_count: Optional[int] = None) -> dict[str, Any]:
    session = get_session_row(session_id)
    if not session:
        raise RagFunnelError("Session not found")
    config = session.get("config") or {}
    if not isinstance(config, dict):
        config = {}
    n = sample_count or int(config.get("quality_sample_count") or DEFAULT_CONFIG["quality_sample_count"])
    n = max(1, min(50, n))
    provider = str(config.get("provider") or DEFAULT_CONFIG["provider"])
    model = str(config.get("model") or DEFAULT_CONFIG["model"])

    rows = execute(
        """
        SELECT id, seq, title, summary, content, keywords, section_number, category, authority
        FROM public.rag_ingest_chunks
        WHERE session_id = %s
        ORDER BY seq ASC
        LIMIT %s
        """,
        (session_id, n),
    )
    if not rows:
        raise RagFunnelError("No chunks available to assess")

    sample = [
        {
            "id": str(r.get("id")),
            "seq": r.get("seq"),
            "title": r.get("title"),
            "summary": r.get("summary"),
            "content": (r.get("content") or "")[:1500],
            "keywords": r.get("keywords"),
            "section_number": r.get("section_number"),
            "category": r.get("category"),
            "authority": r.get("authority"),
        }
        for r in rows
    ]

    system = SystemMessage(
        content=(
            "You are a QA reviewer for a legal RAG knowledge base. Assess the quality of the "
            "provided chunks for retrieval use. Consider: self-containedness, title accuracy, "
            "keyword relevance, factual grounding, and whether each chunk is one complete idea. "
            "Return ONLY a JSON object with keys: overall_score (0-100 int), verdict (str), "
            "issues (array of strings), per_chunk (array of {id, seq, score (0-100), notes}), "
            "recommendation (one of 'accept', 'review', 'rerun')."
        )
    )
    request = HumanMessage(
        content="Chunks to assess:\n" + json.dumps(sample, ensure_ascii=False, indent=2)
    )
    response = invoke_llm_with_selection(
        provider,
        model,
        [system, request],
        task_id="rag_funnel.quality",
        temperature=0,
        max_tokens=8192,
    )
    try:
        report = _extract_json_object(_response_text(response))
    except RagFunnelError:
        report = {"overall_score": None, "verdict": "unparseable", "raw": _response_text(response)[:4000]}
    report["sample_size"] = len(sample)
    report["assessed_at"] = time.time()
    _update_session(session_id, {"quality": report})
    return report
