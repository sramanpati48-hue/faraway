"""Shared LLM helpers with per-task Groq/Gemini/OpenRouter resolution."""
from __future__ import annotations

import base64
import os
from typing import Any, Optional

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, BaseMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

from backend.paths import REPO_ROOT

load_dotenv()
load_dotenv(dotenv_path=REPO_ROOT / "backend" / "agents" / ".env")
load_dotenv(dotenv_path=REPO_ROOT / ".env")

DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
DEFAULT_SELFHOST_MODEL = "Qwen2.5-3B-Instruct"
DEFAULT_VERTEX_MODEL = "gemini-3.5-flash"
# Gemini Enterprise / Vertex Express: flash-lite is not published in every region
# (deploy 404 on asia-southeast1). Map to a model the API key's project actually serves.
VERTEX_MODEL_ALIASES = {
    "gemini-2.5-flash-lite": "gemini-2.5-flash",
    "gemini-2.0-flash-lite": "gemini-2.5-flash",
}

# When the primary OpenRouter model fails (rate limits, free-tier caps), try these next.
OPENROUTER_FALLBACK_MODELS = (
    "meta-llama/llama-3.3-70b-instruct",
    "google/gemini-2.5-flash",
    "tencent/hy3:free",
    "qwen/qwen3-32b",
)


def _openrouter_key() -> str:
    return (os.getenv("OPEN_ROUTER_API_KEY") or os.getenv("OPENROUTER_API_KEY") or "").strip()


def _gemini_key() -> str:
    return (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()


def _groq_key() -> str:
    return (os.getenv("GROQ_API_KEY") or "").strip()


def _selfhost_base_url() -> str:
    return (os.getenv("SELFHOST_LLM_BASE_URL") or "").strip().rstrip("/")


def _selfhost_key() -> str:
    return (os.getenv("SELFHOST_LLM_API_KEY") or "").strip()


def _selfhost_configured() -> bool:
    return bool(_selfhost_base_url() and _selfhost_key())


def _vertex_key() -> str:
    return (os.getenv("VERTEX_API_KEY") or os.getenv("vertex_api_key") or "").strip()


def _vertex_configured() -> bool:
    return bool(_vertex_key())


def _vertex_location() -> str:
    """Region for Vertex/Enterprise. Default global — asia-southeast1 lacks several Gemini IDs."""
    return (
        os.getenv("VERTEX_LOCATION")
        or os.getenv("GOOGLE_CLOUD_LOCATION")
        or "global"
    ).strip() or "global"


def _resolve_vertex_model(model: str) -> str:
    name = (model or DEFAULT_VERTEX_MODEL).strip() or DEFAULT_VERTEX_MODEL
    aliased = VERTEX_MODEL_ALIASES.get(name, name)
    if aliased != name:
        print(f"ℹ️ Vertex model {name} remapped to {aliased} (not available in all regions)")
    return aliased


def _build_vertex_client(key: str):
    from google import genai

    loc = _vertex_location()
    attempts: list[dict[str, Any]] = [
        {"enterprise": True, "api_key": key},
        {"vertexai": True, "api_key": key},
        {"enterprise": True, "api_key": key, "location": loc},
        {"vertexai": True, "api_key": key, "location": loc},
    ]
    last_error: Exception | None = None
    for kwargs in attempts:
        try:
            return genai.Client(**kwargs)
        except (TypeError, ValueError) as exc:
            last_error = exc
            continue
    raise RuntimeError(f"Could not construct google.genai Client: {last_error}")


def _media_block(block: Any) -> Optional[tuple[str, str]]:
    """Return (mime_type, base64_data) for an inline-media content block."""
    if not isinstance(block, dict):
        return None
    if block.get("type") not in ("media", "file", "input_file"):
        return None
    data = block.get("data") or block.get("file_data")
    mime = block.get("mime_type") or block.get("mimeType") or "application/octet-stream"
    if not data:
        return None
    return str(mime), str(data)


def _messages_to_vertex_contents(messages: list[BaseMessage], types_mod: Any = None) -> list[Any]:
    """Flatten LangChain messages into a content list for google.genai.

    Inline media blocks (e.g. a whole PDF) become genai Parts when ``types_mod``
    is supplied; otherwise only text survives.
    """
    system_parts: list[str] = []
    user_parts: list[str] = []
    media_parts: list[Any] = []
    for m in messages:
        role = (getattr(m, "type", None) or getattr(m, "role", None) or "").lower()
        text = ""
        content = getattr(m, "content", "")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            chunks: list[str] = []
            for block in content:
                media = _media_block(block)
                if media and types_mod is not None:
                    mime, b64 = media
                    try:
                        media_parts.append(
                            types_mod.Part.from_bytes(data=base64.b64decode(b64), mime_type=mime)
                        )
                    except Exception:  # noqa: BLE001
                        pass
                    continue
                if media:
                    continue
                if isinstance(block, dict) and block.get("type") == "text":
                    chunks.append(str(block.get("text") or ""))
                elif isinstance(block, dict):
                    continue
                else:
                    chunks.append(str(block))
            text = "\n".join(chunks)
        else:
            text = str(content)
        text = (text or "").strip()
        if not text:
            continue
        if role in ("system", "developer"):
            system_parts.append(text)
        else:
            user_parts.append(text)
    contents: list[Any] = []
    if system_parts:
        contents.append("System instructions:\n" + "\n\n".join(system_parts))
    contents.extend(media_parts)
    if user_parts:
        contents.extend(user_parts)
    if not contents:
        contents = [_message_text(messages) or " "]
    return contents


def _invoke_vertex(
    model: str,
    messages: list[BaseMessage],
    *,
    temperature: float = 0,
    max_tokens: Optional[int] = None,
) -> AIMessage:
    from google import genai
    from google.genai import types

    key = _vertex_key()
    if not key:
        raise ValueError("VERTEX_API_KEY is not configured")
    model = _resolve_vertex_model(model)
    # Gemini Enterprise Agent Platform (express / API key). Location defaults to
    # global so we do not inherit GOOGLE_CLOUD_LOCATION=asia-southeast1 on deploy.
    client = _build_vertex_client(key)
    contents = _messages_to_vertex_contents(messages, types)
    config_kwargs: dict[str, Any] = {"temperature": temperature}
    if max_tokens is not None:
        config_kwargs["max_output_tokens"] = int(max_tokens)
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=types.GenerateContentConfig(**config_kwargs),
    )
    text = (getattr(response, "text", None) or "").strip()
    if not text:
        # Fallback: stitch candidate parts if .text is empty
        try:
            parts_out: list[str] = []
            for cand in getattr(response, "candidates", None) or []:
                content = getattr(cand, "content", None)
                for part in getattr(content, "parts", None) or []:
                    t = getattr(part, "text", None)
                    if t:
                        parts_out.append(str(t))
            text = "\n".join(parts_out).strip()
        except Exception:
            text = ""
    try:
        for cand in getattr(response, "candidates", None) or []:
            reason = str(getattr(cand, "finish_reason", "") or "")
            if "MAX_TOKENS" in reason.upper():
                # Thinking tokens share max_output_tokens, so answers get cut mid-sentence.
                print(f"⚠️ vertex {model} hit MAX_TOKENS ({max_tokens}) — response truncated")
                break
    except Exception:  # noqa: BLE001
        pass
    return AIMessage(content=text)


def _message_text(messages: list[BaseMessage]) -> str:
    parts: list[str] = []
    for m in messages:
        content = m.content
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(str(block.get("text") or ""))
                elif _media_block(block):
                    # Keep base64 payloads out of logs / token estimates.
                    parts.append("[inline media]")
                else:
                    parts.append(str(block))
        else:
            parts.append(str(content))
    return "\n".join(parts)


def _build_groq_llm(model: str, temperature: float = 0) -> ChatGroq:
    return ChatGroq(
        temperature=temperature,
        model_name=model,
        groq_api_key=_groq_key(),
        streaming=True,
    )


def _build_openrouter_llm(model: str, temperature: float = 0) -> ChatOpenAI:
    return ChatOpenAI(
        model=model,
        api_key=_openrouter_key(),
        base_url="https://openrouter.ai/api/v1",
        temperature=temperature,
        timeout=60,
        max_retries=1,
        streaming=True,
        default_headers={
            "HTTP-Referer": os.getenv("OPENROUTER_REFERER", "https://nyaysahayak.app"),
            "X-Title": "NyaySahayak",
        },
    )


def _build_selfhost_llm(model: str, temperature: float = 0) -> ChatOpenAI:
    """OpenAI-compatible Cloud Run / local llama.cpp service (long cold-start tolerant)."""
    base = _selfhost_base_url()
    if not base:
        raise ValueError("SELFHOST_LLM_BASE_URL is not configured")
    # ChatOpenAI expects …/v1; accept either bare service URL or …/v1.
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    timeout = float(os.getenv("SELFHOST_LLM_TIMEOUT", "600") or "600")
    return ChatOpenAI(
        model=model or DEFAULT_SELFHOST_MODEL,
        api_key=_selfhost_key() or "unused",
        base_url=base,
        temperature=temperature,
        timeout=timeout,
        max_retries=0,
        streaming=False,
    )


def _build_gemini_llm(model: str, temperature: float = 0) -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=_gemini_key(),
        temperature=temperature,
        streaming=True,
    )


def invoke_llm_with_selection(
    provider: str,
    model: str,
    messages: list[BaseMessage],
    *,
    task_id: str,
    temperature: float = 0,
    max_tokens: Optional[int] = None,
):
    """Invoke exactly the requested admin-selected provider/model and log usage."""
    from backend.services.ai_usage import estimate_tokens, log_ai_usage

    provider = (provider or "").strip().lower()
    model = (model or "").strip()
    if not model:
        raise ValueError("A model must be selected")
    if provider == "vertex":
        if not _vertex_configured():
            raise ValueError("VERTEX_API_KEY is not configured")
        response = _invoke_vertex(
            model, messages, temperature=temperature, max_tokens=max_tokens
        )
        completion = response.content if isinstance(response.content, str) else str(response.content)
        log_ai_usage(
            task=task_id,
            model=model,
            provider=provider,
            prompt_tokens=estimate_tokens(_message_text(messages)),
            completion_tokens=estimate_tokens(completion),
        )
        return response

    if provider == "groq":
        if not _groq_key():
            raise ValueError("GROQ_API_KEY is not configured")
        client = _build_groq_llm(model, temperature)
    elif provider == "gemini":
        if not _gemini_key():
            raise ValueError("GEMINI_API_KEY (or GOOGLE_API_KEY) is not configured")
        client = _build_gemini_llm(model, temperature)
    elif provider == "openrouter":
        if not _openrouter_key():
            raise ValueError("OPEN_ROUTER_API_KEY is not configured")
        client = _build_openrouter_llm(model, temperature)
    elif provider == "selfhost":
        if not _selfhost_configured():
            raise ValueError(
                "SELFHOST_LLM_BASE_URL and SELFHOST_LLM_API_KEY must be set "
                "(Cloud Run Qwen OpenAI-compatible endpoint)"
            )
        client = _build_selfhost_llm(model, temperature)
    else:
        raise ValueError(f"Unsupported provider '{provider}'")

    if max_tokens is not None:
        client = client.bind(max_tokens=max_tokens)
    response = client.invoke(messages)
    content = getattr(response, "content", "")
    completion = content if isinstance(content, str) else str(content)
    log_ai_usage(
        task=task_id,
        model=model,
        provider=provider,
        prompt_tokens=estimate_tokens(_message_text(messages)),
        completion_tokens=estimate_tokens(completion),
    )
    return response


def _format_llm_error(exc: Exception) -> str:
    """Surface OpenRouter / OpenAI client errors beyond the useless bare 'Error'."""
    msg = str(exc).strip()
    if msg and msg.lower() != "error":
        return msg
    for attr in ("message", "body", "response"):
        raw = getattr(exc, attr, None)
        if not raw:
            continue
        if isinstance(raw, dict):
            err = raw.get("error")
            if isinstance(err, dict) and err.get("message"):
                return str(err["message"])
            if raw.get("message"):
                return str(raw["message"])
        text = str(raw).strip()
        if text and text.lower() != "error":
            return text[:500]
    return msg or type(exc).__name__


class TaskBoundLLM:
    """Resolves provider/model from system_config for a graph node on each invoke."""

    def __init__(self, task_id: str):
        self.task_id = task_id

    def _resolve(self) -> dict[str, str]:
        from backend.services.admin_models import resolve_node_model

        return resolve_node_model(self.task_id)

    def _candidates(self, resolved: dict[str, str]) -> list[tuple[str, str]]:
        """Provider/model pairs to try when the admin-selected primary fails."""
        provider = (resolved.get("provider") or "groq").strip().lower()
        model = (resolved.get("model") or DEFAULT_GROQ_MODEL).strip()
        out: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()

        def add(provider_name: str, model_name: str) -> None:
            provider_name = provider_name.strip().lower()
            model_name = (model_name or "").strip()
            if not provider_name or not model_name:
                return
            key = (provider_name, model_name)
            if key in seen:
                return
            if provider_name == "groq" and not _groq_key():
                return
            if provider_name == "openrouter" and not _openrouter_key():
                return
            if provider_name == "gemini" and not _gemini_key():
                return
            if provider_name == "selfhost" and not _selfhost_configured():
                return
            if provider_name == "vertex" and not _vertex_configured():
                return
            if provider_name not in ("groq", "openrouter", "gemini", "selfhost", "vertex"):
                return
            seen.add(key)
            out.append((provider_name, model_name))

        add(provider, model)

        if _openrouter_key():
            for alt in OPENROUTER_FALLBACK_MODELS:
                add("openrouter", alt)
            if DEFAULT_OPENROUTER_MODEL not in OPENROUTER_FALLBACK_MODELS:
                add("openrouter", DEFAULT_OPENROUTER_MODEL)

        add("groq", DEFAULT_GROQ_MODEL)
        for gm in (DEFAULT_GEMINI_MODEL, "gemini-3-flash-preview", "gemini-2.5-flash-lite"):
            add("gemini", gm)
        add("vertex", DEFAULT_VERTEX_MODEL)
        if _selfhost_configured():
            add("selfhost", DEFAULT_SELFHOST_MODEL)

        return out

    def invoke(
        self,
        messages: list[BaseMessage],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ):
        resolved = self._resolve()
        errors: list[str] = []
        is_multimodal = any(isinstance(getattr(m, "content", None), list) for m in messages)
        temp = float(temperature) if temperature is not None else 0.0

        for provider, model in self._candidates(resolved):
            if is_multimodal and provider == "groq":
                continue
            try:
                return invoke_llm_with_selection(
                    provider,
                    model,
                    messages,
                    task_id=self.task_id,
                    temperature=temp,
                    max_tokens=max_tokens,
                )
            except Exception as exc:
                detail = _format_llm_error(exc)
                print(f"⚠️ LLM failed ({provider}/{model}) for {self.task_id}: {detail}")
                errors.append(f"{provider}/{model}: {detail}")

        raise Exception(f"All LLMs failed for {self.task_id}: {'; '.join(errors)}")


_task_llms: dict[str, TaskBoundLLM] = {}


def get_llm_for_task(task_id: str) -> TaskBoundLLM:
    if task_id not in _task_llms:
        _task_llms[task_id] = TaskBoundLLM(task_id)
    return _task_llms[task_id]


def get_llm() -> TaskBoundLLM:
    """Backward-compatible default (supervisor). Prefer get_llm_for_task."""
    return get_llm_for_task("chat_agent.supervisor")


llm = get_llm()
llm.groq_llm = get_llm_for_task("chat_agent.supervisor")  # type: ignore[attr-defined]
