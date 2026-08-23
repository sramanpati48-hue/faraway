"""OpenAI-compatible Cloud Run service for Qwen2.5-3B-Instruct (llama.cpp / GGUF).

Loads the model once per instance. Designed for minScale=0 + concurrency=1.
"""
from __future__ import annotations

import os
import time
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MODEL_ID = os.getenv("MODEL_ID", "Qwen2.5-3B-Instruct")
MODEL_LOCAL_PATH = os.getenv("MODEL_LOCAL_PATH", "/models/qwen2.5-3b-instruct-q4.gguf")
MODEL_GCS_URI = (os.getenv("MODEL_GCS_URI") or "").strip()
API_KEY = (os.getenv("API_KEY") or os.getenv("SELFHOST_LLM_API_KEY") or "").strip()
N_CTX = int(os.getenv("N_CTX", "8192"))
N_THREADS = int(os.getenv("N_THREADS", "4"))
N_BATCH = int(os.getenv("N_BATCH", "256"))
CHAT_FORMAT = os.getenv("CHAT_FORMAT", "chatml")

app = FastAPI(title="NyaySahayak Qwen self-host", version="1.0.0")


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatCompletionRequest(BaseModel):
    model: Optional[str] = None
    messages: list[ChatMessage]
    temperature: float = 0.0
    max_tokens: Optional[int] = Field(default=2048, ge=1)
    stream: bool = False


def _require_auth(authorization: Optional[str] = Header(default=None)) -> None:
    if not API_KEY:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if token != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")


def _download_from_gcs(gcs_uri: str, dest: Path) -> None:
    if not gcs_uri.startswith("gs://"):
        raise RuntimeError(f"MODEL_GCS_URI must be gs://…, got {gcs_uri!r}")
    from google.cloud import storage

    _, _, rest = gcs_uri.partition("gs://")
    bucket_name, _, blob_name = rest.partition("/")
    if not bucket_name or not blob_name:
        raise RuntimeError(f"Invalid GCS URI: {gcs_uri}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {gcs_uri} → {dest} …", flush=True)
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    blob.download_to_filename(str(dest))
    print(f"Download complete ({dest.stat().st_size} bytes).", flush=True)


def _ensure_model_file() -> Path:
    path = Path(MODEL_LOCAL_PATH)
    if path.is_file() and path.stat().st_size > 0:
        return path
    if MODEL_GCS_URI:
        _download_from_gcs(MODEL_GCS_URI, path)
        return path
    raise RuntimeError(
        f"Model file missing at {path}. Set MODEL_GCS_URI=gs://bucket/path.gguf "
        "or bake the GGUF into the image at MODEL_LOCAL_PATH."
    )


@lru_cache(maxsize=1)
def get_llm():
    from llama_cpp import Llama

    model_path = _ensure_model_file()
    print(
        f"Loading llama.cpp model from {model_path} "
        f"(n_ctx={N_CTX}, n_threads={N_THREADS}) …",
        flush=True,
    )
    t0 = time.time()
    llm = Llama(
        model_path=str(model_path),
        n_ctx=N_CTX,
        n_threads=N_THREADS,
        n_batch=N_BATCH,
        chat_format=CHAT_FORMAT,
        verbose=False,
    )
    print(f"Model ready in {time.time() - t0:.1f}s.", flush=True)
    return llm


@app.on_event("startup")
def _warmup() -> None:
    # Fail fast on misconfig; cold start pays model load here (or on first request if this fails).
    preload = (os.getenv("PRELOAD_MODEL", "1") or "1").strip().lower()
    if preload in ("0", "false", "no"):
        return
    try:
        get_llm()
    except Exception as exc:  # noqa: BLE001
        print(f"WARNING: model preload failed: {exc}", flush=True)


@app.get("/health")
@app.get("/healthz")
def health() -> dict[str, Any]:
    # Prefer GET /health — some Cloud Run fronts intercept /healthz.
    return {
        "ok": True,
        "model": MODEL_ID,
        "model_path": MODEL_LOCAL_PATH,
        "file_present": Path(MODEL_LOCAL_PATH).is_file(),
        "loaded": get_llm.cache_info().currsize > 0,
    }


@app.get("/v1/models")
def list_models(_: None = Depends(_require_auth)) -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {
                "id": MODEL_ID,
                "object": "model",
                "owned_by": "nyaysahayak-selfhost",
            }
        ],
    }


@app.post("/v1/chat/completions")
def chat_completions(
    body: ChatCompletionRequest,
    _: None = Depends(_require_auth),
) -> dict[str, Any]:
    if body.stream:
        raise HTTPException(status_code=400, detail="stream=true is not supported")
    llm = get_llm()
    messages = [{"role": m.role, "content": m.content} for m in body.messages]
    max_tokens = int(body.max_tokens or 2048)
    t0 = time.time()
    try:
        result = llm.create_chat_completion(
            messages=messages,
            temperature=float(body.temperature or 0.0),
            max_tokens=max_tokens,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Generation failed: {exc}") from exc

    # Normalize to OpenAI shape (llama-cpp usually already matches).
    if isinstance(result, dict) and result.get("choices"):
        result.setdefault("id", f"chatcmpl-{uuid.uuid4().hex[:24]}")
        result.setdefault("object", "chat.completion")
        result.setdefault("model", body.model or MODEL_ID)
        result.setdefault("created", int(time.time()))
        print(f"chat.completions ok in {time.time() - t0:.1f}s", flush=True)
        return result

    raise HTTPException(status_code=500, detail="Unexpected llama.cpp response shape")
