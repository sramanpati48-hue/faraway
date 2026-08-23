"""Admin model catalog and per-node LLM / embedding config."""
from __future__ import annotations

import json
import os
import time
from copy import deepcopy
from typing import Any

from backend.database.postgres_pool import execute, execute_one, execute_void, is_postgres_configured

DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
DEFAULT_SELFHOST_MODEL = "Qwen2.5-3B-Instruct"
DEFAULT_VERTEX_MODEL = "gemini-3.5-flash"
NYAYSAHAYAK_EMBEDDING_MODEL = "krutrim-ai-labs/Vyakyarth"
NYAYSAHAYAK_EMBEDDING_URL_DEFAULT = "https://130-211-122-175.sslip.io"
GEMINI_EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 768
EMBEDDING_PROVIDERS = ("nyaysahayak", "vertex", "gemini")
EMBEDDING_MODELS = {
    "nyaysahayak": (NYAYSAHAYAK_EMBEDDING_MODEL,),
    "vertex": (GEMINI_EMBEDDING_MODEL,),
    "gemini": (GEMINI_EMBEDDING_MODEL,),
}

TEXT_MODEL_PROVIDERS = ("groq", "gemini", "openrouter", "selfhost", "vertex")
PROVIDER_API_KEY_HINTS = {
    "groq": "Set GROQ_API_KEY in the server .env for Groq models.",
    "gemini": "Set GEMINI_API_KEY (or GOOGLE_API_KEY) in the server .env for Gemini models.",
    "openrouter": "Set OPEN_ROUTER_API_KEY in the server .env for OpenRouter models.",
    "selfhost": (
        "Set SELFHOST_LLM_BASE_URL (Cloud Run …/v1) and SELFHOST_LLM_API_KEY. "
        "See docs/SELFHOST_LLM_CLOUD_RUN.md — cold starts can take several minutes."
    ),
    "vertex": (
        "Set VERTEX_API_KEY in the server .env for Gemini Enterprise Agent Platform "
        "(google.genai Client enterprise=True)."
    ),
}

GROQ_TEXT_MODELS = (
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama-3.1-70b-versatile",
    "mixtral-8x7b-32768",
)
GEMINI_TEXT_MODELS = (
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3.5-flash",
)
OPENROUTER_TEXT_MODELS = (
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "tencent/hy3:free",
    "qwen/qwen3-235b-a22b",
    "qwen/qwen3-32b",
    "google/gemini-2.5-flash",
    "meta-llama/llama-3.3-70b-instruct",
)
SELFHOST_TEXT_MODELS = (
    "Qwen2.5-3B-Instruct",
)
VERTEX_TEXT_MODELS = (
    "gemini-3.5-flash",
    "gemini-2.5-flash",
)

CHAT_NODES = (
    "supervisor",
    "cyber",
    "criminal",
    "civil",
    "domestic",
    "scam",
    "scam_match",
    "document",
    "sahayak",
    "legal_moderator",
    "lawyer_forwarder",
    "question_processor",
    "report_generator",
    "nodal_guide",
    "sexual_offense",
)
CLASH_NODES = (
    "preprocess",
    "prosecution",
    "defence",
    "cross_exam",
    "ai_cross_answer",
    "judge_round",
    "final_judge",
    "incorporate_answer",
)
SCAM_CLASSIFIER_NODES = (
    "classifier",
)
POLICY_NODES = (
    "planner",
    "question_gen",
    "impact",
    "implementer",
)

_DEFAULT_CHAT_NODE = {"provider": "groq", "model": DEFAULT_GROQ_MODEL}
_DEFAULT_CLASH_NODE = {"provider": "groq", "model": DEFAULT_GROQ_MODEL}
_DEFAULT_SCAM_CLASSIFIER_NODE = {"provider": "selfhost", "model": DEFAULT_SELFHOST_MODEL}
_DEFAULT_POLICY_NODE = {"provider": "groq", "model": DEFAULT_GROQ_MODEL}


def _default_graph_node_models() -> dict[str, Any]:
    # policy_studio is deliberately absent: read_config_key() merges this fallback
    # over the stored config, so a hardcoded entry here would mask the inherited
    # supervisor selection computed by _policy_default().
    return {
        "chat_agent": {n: dict(_DEFAULT_CHAT_NODE) for n in CHAT_NODES},
        "clash_agent": {n: dict(_DEFAULT_CLASH_NODE) for n in CLASH_NODES},
        "scam_classifier": {n: dict(_DEFAULT_SCAM_CLASSIFIER_NODE) for n in SCAM_CLASSIFIER_NODES},
    }


def _policy_default(cfg: dict[str, Any]) -> dict[str, str]:
    """Policy studio inherits the chat supervisor's model until an admin overrides it.

    Without this the studio would fall back to a Groq model that many deployments
    have no key for, and every draft would 404 on the first LLM call.
    """
    supervisor = {}
    if isinstance(cfg, dict):
        supervisor = (cfg.get("chat_agent") or {}).get("supervisor") or {}
    provider = str(supervisor.get("provider") or _DEFAULT_POLICY_NODE["provider"])
    model = str(supervisor.get("model") or _DEFAULT_POLICY_NODE["model"])
    if provider not in TEXT_MODEL_PROVIDERS:
        return dict(_DEFAULT_POLICY_NODE)
    return {"provider": provider, "model": model}


def _default_embeddings() -> dict[str, Any]:
    return {
        "provider": "nyaysahayak",
        "model": NYAYSAHAYAK_EMBEDDING_MODEL,
        "output_dimensionality": EMBEDDING_DIM,
        "external_embedding_url": NYAYSAHAYAK_EMBEDDING_URL_DEFAULT,
    }


def default_model_for_provider(provider: str) -> str:
    if provider == "gemini":
        return DEFAULT_GEMINI_MODEL
    if provider == "openrouter":
        return DEFAULT_OPENROUTER_MODEL
    if provider == "selfhost":
        return DEFAULT_SELFHOST_MODEL
    if provider == "vertex":
        return DEFAULT_VERTEX_MODEL
    return DEFAULT_GROQ_MODEL


def models_for_provider(provider: str) -> tuple[str, ...]:
    """Catalog model IDs for a text provider (used by admin UI + payload generator)."""
    p = (provider or "").strip().lower()
    if p == "gemini":
        return GEMINI_TEXT_MODELS
    if p == "openrouter":
        return OPENROUTER_TEXT_MODELS
    if p == "groq":
        return GROQ_TEXT_MODELS
    if p == "selfhost":
        return SELFHOST_TEXT_MODELS
    if p == "vertex":
        return VERTEX_TEXT_MODELS
    return ()


def _selfhost_configured() -> bool:
    return bool(
        (os.getenv("SELFHOST_LLM_BASE_URL") or "").strip()
        and (os.getenv("SELFHOST_LLM_API_KEY") or "").strip()
    )


def _vertex_configured() -> bool:
    return bool((os.getenv("VERTEX_API_KEY") or os.getenv("vertex_api_key") or "").strip())


_cache: dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 10.0


def _cache_get(key: str) -> Any:
    hit = _cache.get(key)
    if not hit:
        return None
    ts, value = hit
    if time.time() - ts > _CACHE_TTL:
        _cache.pop(key, None)
        return None
    return deepcopy(value)


def _cache_set(key: str, value: Any) -> Any:
    _cache[key] = (time.time(), deepcopy(value))
    return value


def invalidate_config_cache() -> None:
    _cache.clear()


def read_config_key(key: str, fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    cached = _cache_get(f"cfg:{key}")
    if cached is not None:
        return cached
    base = deepcopy(fallback or {})
    if not is_postgres_configured():
        return _cache_set(f"cfg:{key}", base)
    try:
        row = execute_one("SELECT value FROM public.system_config WHERE key = %s", (key,))
        if row and isinstance(row.get("value"), dict):
            base.update(row["value"])
    except Exception as exc:
        print(f"⚠️ system_config read failed ({key}): {exc}")
    return _cache_set(f"cfg:{key}", base)


def write_config_key(key: str, value: dict[str, Any]) -> dict[str, Any]:
    if not is_postgres_configured():
        raise RuntimeError("DATABASE_URL not configured")
    execute_void(
        """
        INSERT INTO public.system_config (key, value, updated_at)
        VALUES (%s, %s::jsonb, now())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = now()
        """,
        (key, json.dumps(value, default=str)),
    )
    invalidate_config_cache()
    return value


def list_system_config() -> list[dict[str, Any]]:
    if not is_postgres_configured():
        return []
    rows = execute("SELECT key, value, updated_at FROM public.system_config ORDER BY key")
    out = []
    for r in rows:
        out.append(
            {
                "key": r["key"],
                "value": r["value"],
                "updated_at": r["updated_at"].isoformat() if r.get("updated_at") else None,
            }
        )
    return out


def parse_task_id(task_id: str) -> tuple[str, str]:
    """Return (graph_id, node_id) for task ids like chat_agent.cyber or cyber."""
    task_id = (task_id or "").strip()
    if "." in task_id:
        graph_id, node_id = task_id.split(".", 1)
        return graph_id, node_id
    if task_id in CHAT_NODES:
        return "chat_agent", task_id
    if task_id in CLASH_NODES:
        return "clash_agent", task_id
    return "chat_agent", task_id or "supervisor"


def resolve_node_model(task_id: str) -> dict[str, str]:
    graph_id, node_id = parse_task_id(task_id)
    cfg = read_config_key("graph_node_models", _default_graph_node_models())
    node_cfg = ((cfg.get(graph_id) or {}).get(node_id) or {}) if isinstance(cfg, dict) else {}
    if graph_id == "clash_agent":
        default_provider, default_model = "groq", DEFAULT_GROQ_MODEL
    elif graph_id == "scam_classifier":
        default_provider, default_model = "selfhost", DEFAULT_SELFHOST_MODEL
    elif graph_id == "policy_studio":
        inherited = _policy_default(cfg)
        default_provider, default_model = inherited["provider"], inherited["model"]
    else:
        default_provider, default_model = "groq", DEFAULT_GROQ_MODEL
    provider = str(node_cfg.get("provider") or default_provider)
    model = str(node_cfg.get("model") or default_model)
    if provider not in TEXT_MODEL_PROVIDERS:
        provider = default_provider
        model = default_model
    return {"provider": provider, "model": model, "graph_id": graph_id, "node_id": node_id}


def get_embedding_config() -> dict[str, Any]:
    cfg = read_config_key("ai_embeddings", _default_embeddings())
    url = str(cfg.get("external_embedding_url") or NYAYSAHAYAK_EMBEDDING_URL_DEFAULT).rstrip("/")
    provider = str(cfg.get("provider") or "nyaysahayak").strip().lower()
    if provider not in EMBEDDING_PROVIDERS:
        provider = "nyaysahayak"
    allowed = EMBEDDING_MODELS.get(provider) or (NYAYSAHAYAK_EMBEDDING_MODEL,)
    model = str(cfg.get("model") or allowed[0]).strip()
    if model not in allowed:
        model = allowed[0]
    try:
        dim = int(cfg.get("output_dimensionality") or EMBEDDING_DIM)
    except (TypeError, ValueError):
        dim = EMBEDDING_DIM
    if dim not in (768, 1536, 3072):
        dim = EMBEDDING_DIM
    # Stored pgvector columns are vector(768); keep 768 unless a migration widens them.
    dim = EMBEDDING_DIM
    return {
        "provider": provider,
        "model": model,
        "output_dimensionality": dim,
        "external_embedding_url": url,
        "embed_texts_url": f"{url}/embed-texts",
        "embed_url": f"{url}/embed",
        "health_url": f"{url}/health",
    }


def get_admin_models_snapshot() -> dict[str, Any]:
    graph_models = read_config_key("graph_node_models", _default_graph_node_models())
    defaults = _default_graph_node_models()
    defaults["policy_studio"] = {n: dict(_policy_default(graph_models)) for n in POLICY_NODES}
    for graph_id, nodes in defaults.items():
        graph_models.setdefault(graph_id, {})
        for node_id, node_default in nodes.items():
            graph_models[graph_id].setdefault(node_id, dict(node_default))

    embeddings = get_embedding_config()
    sql_gen = read_config_key(
        "sql_generation",
        {
            "provider": "groq",
            "model": DEFAULT_GROQ_MODEL,
            "groq_model": DEFAULT_GROQ_MODEL,
            "openrouter_model": DEFAULT_OPENROUTER_MODEL,
            "gemini_model": DEFAULT_GEMINI_MODEL,
            "selfhost_model": DEFAULT_SELFHOST_MODEL,
            "vertex_model": DEFAULT_VERTEX_MODEL,
        },
    )

    resolved: dict[str, Any] = {}
    for graph_id, nodes in graph_models.items():
        if not isinstance(nodes, dict):
            continue
        for node_id in nodes:
            tid = f"{graph_id}.{node_id}"
            resolved[tid] = resolve_node_model(tid)

    return {
        "catalog": {
            "text_providers": list(TEXT_MODEL_PROVIDERS),
            "groq_text_models": list(GROQ_TEXT_MODELS),
            "gemini_text_models": list(GEMINI_TEXT_MODELS),
            "openrouter_text_models": list(OPENROUTER_TEXT_MODELS),
            "selfhost_text_models": list(SELFHOST_TEXT_MODELS),
            "vertex_text_models": list(VERTEX_TEXT_MODELS),
            "nyaysahayak_embedding_model": NYAYSAHAYAK_EMBEDDING_MODEL,
            "gemini_embedding_model": GEMINI_EMBEDDING_MODEL,
            "embedding_providers": list(EMBEDDING_PROVIDERS),
            "embedding_models": {k: list(v) for k, v in EMBEDDING_MODELS.items()},
            "embedding_dim": EMBEDDING_DIM,
            "chat_nodes": list(CHAT_NODES),
            "clash_nodes": list(CLASH_NODES),
            "scam_classifier_nodes": list(SCAM_CLASSIFIER_NODES),
            "policy_nodes": list(POLICY_NODES),
            "default_groq_model": DEFAULT_GROQ_MODEL,
            "default_gemini_model": DEFAULT_GEMINI_MODEL,
            "default_openrouter_model": DEFAULT_OPENROUTER_MODEL,
            "default_selfhost_model": DEFAULT_SELFHOST_MODEL,
            "default_vertex_model": DEFAULT_VERTEX_MODEL,
            "provider_api_key_hints": PROVIDER_API_KEY_HINTS,
        },
        "env": {
            "groq_configured": bool(os.getenv("GROQ_API_KEY")),
            "gemini_configured": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")),
            "openrouter_configured": bool(os.getenv("OPEN_ROUTER_API_KEY") or os.getenv("OPENROUTER_API_KEY")),
            "selfhost_configured": _selfhost_configured(),
            "vertex_configured": _vertex_configured(),
            "default_groq_model": DEFAULT_GROQ_MODEL,
            "default_gemini_model": DEFAULT_GEMINI_MODEL,
            "default_openrouter_model": DEFAULT_OPENROUTER_MODEL,
            "default_selfhost_model": DEFAULT_SELFHOST_MODEL,
            "default_vertex_model": DEFAULT_VERTEX_MODEL,
            "default_embedding_url": NYAYSAHAYAK_EMBEDDING_URL_DEFAULT,
            "provider_api_key_hints": PROVIDER_API_KEY_HINTS,
        },
        "config": {
            "graph_node_models": graph_models,
            "ai_embeddings": embeddings,
            "sql_generation": sql_gen,
        },
        "resolved": resolved,
    }


def patch_graph_node_model(graph_id: str, node_id: str, provider: str, model: str) -> dict[str, Any]:
    provider = (provider or "").strip().lower()
    model = (model or "").strip()
    if provider not in TEXT_MODEL_PROVIDERS:
        raise ValueError(f"Unsupported provider '{provider}'")
    allowed = models_for_provider(provider)
    if model not in allowed:
        raise ValueError(f"Model '{model}' is not available for {provider}")
    cfg = read_config_key("graph_node_models", _default_graph_node_models())
    cfg.setdefault(graph_id, {})
    cfg[graph_id][node_id] = {"provider": provider, "model": model}
    return write_config_key("graph_node_models", cfg)
