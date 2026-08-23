"""Query/document embeddings: Nyaysahayak HTTP API or Google gemini-embedding-001."""
from __future__ import annotations

import json
import math
from typing import Literal

import requests

from backend.services.admin_models import GEMINI_EMBEDDING_MODEL, NYAYSAHAYAK_EMBEDDING_MODEL, get_embedding_config

EmbedTask = Literal["RETRIEVAL_QUERY", "RETRIEVAL_DOCUMENT"]

_GOOGLE_BATCH = 16


def _log_embedding_usage(
    *,
    task_type: EmbedTask,
    provider: str,
    model: str,
    texts: list[str],
    billed_tokens: int,
) -> None:
    """Feed embedding calls into ai_usage_logs so admin totals cover vectors, not just chat."""
    from backend.services.ai_usage import estimate_tokens, log_ai_usage

    tokens = billed_tokens or sum(estimate_tokens(t) for t in texts)
    suffix = "query" if task_type == "RETRIEVAL_QUERY" else "document"
    try:
        log_ai_usage(
            task=f"embedding.{suffix}",
            model=model,
            provider=provider,
            prompt_tokens=tokens,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] embedding usage log failed: {exc}")


def _l2_normalize(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in values))
    if norm <= 0:
        return values
    return [v / norm for v in values]


def _fit_dim(values: list[float], dim: int) -> list[float]:
    cleaned = [float(v) for v in values]
    if len(cleaned) >= dim:
        cleaned = cleaned[:dim]
    else:
        cleaned = cleaned + [0.0] * (dim - len(cleaned))
    return _l2_normalize(cleaned)


def _embed_nyaysahayak(texts: list[str], dim: int, cfg: dict) -> list[list[float]]:
    url = cfg.get("embed_texts_url") or ""
    if not url:
        raise RuntimeError("Nyaysahayak embed-texts URL is not configured")
    model = str(cfg.get("model") or NYAYSAHAYAK_EMBEDDING_MODEL)
    resp = requests.post(
        url,
        headers={"Content-Type": "application/json; charset=utf-8"},
        data=json.dumps(
            {"texts": texts, "normalize": True, "model": model},
            ensure_ascii=False,
        ).encode("utf-8"),
        timeout=60,
    )
    resp.raise_for_status()
    body = resp.json() or {}
    embeddings = body.get("embeddings") or []
    out: list[list[float]] = []
    for row in embeddings:
        if isinstance(row, list) and row:
            out.append(_fit_dim(row, dim))
    if len(out) != len(texts):
        raise RuntimeError(f"Nyaysahayak embed returned {len(out)} vectors for {len(texts)} texts")
    return out


def _extract_google_tokens(response: object) -> int:
    """Billed token count when the SDK reports it, else 0 so callers fall back to the estimate."""
    meta = getattr(response, "usage_metadata", None)
    if meta is None and isinstance(response, dict):
        meta = response.get("usage_metadata") or response.get("usageMetadata")
    if meta is None:
        return 0
    for attr in ("total_token_count", "totalTokenCount", "prompt_token_count", "promptTokenCount"):
        value = meta.get(attr) if isinstance(meta, dict) else getattr(meta, attr, None)
        if value:
            try:
                return int(value)
            except (TypeError, ValueError):
                continue
    return 0


def _extract_google_vectors(response: object) -> list[list[float]]:
    rows: list[list[float]] = []
    embeddings = getattr(response, "embeddings", None)
    if embeddings:
        for item in embeddings:
            values = getattr(item, "values", None)
            if values:
                rows.append([float(v) for v in values])
        return rows
    # dict-shaped SDK / REST fallback
    if isinstance(response, dict):
        for item in response.get("embeddings") or []:
            values = item.get("values") if isinstance(item, dict) else None
            if values:
                rows.append([float(v) for v in values])
    return rows


def _embed_google(
    texts: list[str],
    dim: int,
    model: str,
    task_type: EmbedTask,
    reported_tokens: list[int] | None = None,
) -> list[list[float]]:
    from google import genai
    from google.genai import types

    from backend.utils import _build_vertex_client, _gemini_key, _vertex_key

    vertex_key = _vertex_key()
    gemini_key = _gemini_key()
    client = None
    errors: list[str] = []
    if vertex_key:
        try:
            client = _build_vertex_client(vertex_key)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"vertex: {exc}")
            client = None
    if client is None and gemini_key:
        try:
            client = genai.Client(api_key=gemini_key)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"gemini: {exc}")
            client = None
    if client is None:
        detail = ("; ".join(errors) or "no API key").strip()
        raise RuntimeError(
            "VERTEX_API_KEY or GEMINI_API_KEY is required for gemini-embedding-001 "
            f"({detail})"
        )

    out: list[list[float]] = []
    config = types.EmbedContentConfig(
        task_type=task_type,
        output_dimensionality=dim,
    )
    for start in range(0, len(texts), _GOOGLE_BATCH):
        chunk = texts[start : start + _GOOGLE_BATCH]
        response = client.models.embed_content(
            model=model or GEMINI_EMBEDDING_MODEL,
            contents=chunk,
            config=config,
        )
        if reported_tokens is not None:
            reported_tokens.append(_extract_google_tokens(response))
        vectors = _extract_google_vectors(response)
        if len(vectors) != len(chunk):
            raise RuntimeError(
                f"Google embed returned {len(vectors)} vectors for {len(chunk)} texts"
            )
        out.extend(_fit_dim(row, dim) for row in vectors)
    return out


_EMBED_CACHE: dict[tuple[str, str, int, str, str], list[float]] = {}
_MAX_EMBED_CACHE = 2048


def embed_texts(
    texts: list[str],
    *,
    task_type: EmbedTask = "RETRIEVAL_DOCUMENT",
) -> list[list[float]]:
    """Embed texts with the admin-selected provider. Always returns `output_dimensionality` floats."""
    cleaned = [(t or "").strip() or " " for t in texts]
    if not cleaned:
        return []
    cfg = get_embedding_config()
    dim = int(cfg.get("output_dimensionality") or 768)
    provider = (cfg.get("provider") or "nyaysahayak").strip().lower()
    model = (cfg.get("model") or "").strip()

    # Check cache for single text calls (common during turn flow)
    if len(cleaned) == 1:
        cache_key = (cleaned[0], task_type, dim, provider, model)
        if cache_key in _EMBED_CACHE:
            return [_EMBED_CACHE[cache_key]]

    if provider in ("vertex", "gemini", "google"):
        resolved_model = model or GEMINI_EMBEDDING_MODEL
        reported: list[int] = []
        vectors = _embed_google(cleaned, dim, resolved_model, task_type, reported)
        billed = sum(reported)
    else:
        resolved_model = model or NYAYSAHAYAK_EMBEDDING_MODEL
        vectors = _embed_nyaysahayak(cleaned, dim, cfg)
        billed = 0

    _log_embedding_usage(
        task_type=task_type,
        provider=provider,
        model=resolved_model,
        texts=cleaned,
        billed_tokens=billed,
    )

    # Populate cache
    if len(cleaned) == len(vectors):
        for t, v in zip(cleaned, vectors):
            if len(_EMBED_CACHE) >= _MAX_EMBED_CACHE:
                _EMBED_CACHE.clear()
            _EMBED_CACHE[(t, task_type, dim, provider, model)] = v

    return vectors


def embed_query(text: str) -> list[float]:
    vecs = embed_texts([text or ""], task_type="RETRIEVAL_QUERY")
    return vecs[0] if vecs else []


def embed_document(text: str) -> list[float]:
    vecs = embed_texts([text or ""], task_type="RETRIEVAL_DOCUMENT")
    return vecs[0] if vecs else []
