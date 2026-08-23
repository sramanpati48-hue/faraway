"""Improvise Policies studio: plan, question, visualise impact, and implement.

The studio turns a natural-language policy description into a reviewed change
set. Only whitelisted ``system_config`` keys can be written; anything else is
surfaced as a manual follow-up so schema and code changes stay human-owned.
"""
from __future__ import annotations

import json
import re
import time
import uuid
from typing import Any, Iterator

from langchain_core.messages import HumanMessage, SystemMessage

from backend.database.postgres_pool import (
    execute,
    execute_one,
    execute_void,
    is_postgres_configured,
)
from backend.services import policy_context, policy_impact
from backend.services.admin_models import read_config_key, resolve_node_model, write_config_key
from backend.utils import invoke_llm_with_selection

# Keys the implementer may write. Everything else becomes a manual follow-up.
WRITABLE_CONFIG_KEYS = (
    "rag_retrieval",
    "rag_funnel",
    "graph_node_models",
    "moderator_queue",
    "scam_classifier",
    "ai_embeddings",
)

AGENT_SCOPES = (
    "chat_agent.supervisor",
    "chat_agent.suggested_actions",
    "chat_agent.report_generator",
    "chat_agent.legal_moderator",
    "chat_agent.nodal_guide",
    "chat_agent.lawyer_forwarder",
)

_POLICY_CACHE: dict[str, tuple[float, str]] = {}
_POLICY_CACHE_TTL = 30.0


# ---------------------------------------------------------------------------
# LLM helpers
# ---------------------------------------------------------------------------


def _llm(node: str, system: str, user: str, *, max_tokens: int = 2400) -> str:
    selection = resolve_node_model(f"policy_studio.{node}")
    response = invoke_llm_with_selection(
        selection["provider"],
        selection["model"],
        [SystemMessage(content=system), HumanMessage(content=user)],
        task_id=f"policy_studio.{node}",
        temperature=0.2,
        max_tokens=max_tokens,
    )
    content = getattr(response, "content", "")
    return content if isinstance(content, str) else str(content)


def _extract_json(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1).strip()
    start = raw.find("{")
    if start == -1:
        return {}
    body = raw[start:]

    end = body.rfind("}")
    if end > 0:
        try:
            parsed = json.loads(body[: end + 1])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    repaired = _repair_truncated_json(body)
    if repaired is not None:
        return repaired
    return {}


def _repair_truncated_json(body: str) -> dict[str, Any] | None:
    """Close an object the model got cut off mid-way through.

    Hitting the token ceiling on a long policy_text is common enough that losing
    the whole plan to it is worse than recovering the fields that did arrive.
    """
    stack, last_safe = _scan_json(body)
    if not stack:
        return None

    # Drop the partial trailing member, then close everything still open.
    truncated = body[:last_safe] if last_safe > 0 else body.rstrip().rstrip(",")
    remaining, _ = _scan_json(truncated)
    candidate = truncated + "".join(reversed(remaining))
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _scan_json(body: str) -> tuple[list[str], int]:
    """Return the still-open closers and the last top-level member boundary."""
    stack: list[str] = []
    in_string = False
    escaped = False
    last_safe = -1

    for i, ch in enumerate(body):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if stack:
                stack.pop()
        elif ch == "," and len(stack) == 1:
            last_safe = i

    return stack, last_safe


def _extract_openui(text: str) -> str:
    """OpenUI Lang comes back either bare or inside a fenced block.

    The language tag is whatever the model felt like writing, and a truncated
    response can lose its closing fence, so both are treated as optional.
    """
    raw = (text or "").strip()
    fence = re.match(r"^```[a-zA-Z0-9_-]*[ \t]*\r?\n", raw)
    if not fence:
        return raw
    body = raw[fence.end() :]
    closing = body.rfind("```")
    return (body[:closing] if closing != -1 else body).strip()


# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------


def _planner_system() -> str:
    return (
        "You are the policy architect for NyaySahayak, an Indian legal-aid platform.\n"
        "An admin describes a policy change in plain language. You decide what the platform "
        "must actually change, and what still needs a human.\n\n"
        "Rules:\n"
        f"- Only these system_config keys can be changed automatically: {', '.join(WRITABLE_CONFIG_KEYS)}.\n"
        "- Any schema change, new table, new column, code change, or third-party integration "
        "MUST go into manual_followups instead of config_changes.\n"
        "- policy_text is markdown guidance injected into the live agent prompts. Write it as "
        "direct, enforceable rules addressed to the agent, not as a summary.\n"
        f"- agent_scope entries must come from: {', '.join(AGENT_SCOPES)}.\n"
        "- If critical details are missing, list them in open_questions instead of guessing.\n"
        "- risk is one of low, medium, high. Anything touching money, sensitive cases, or "
        "moderation throughput is at least medium.\n\n"
        "Reply with JSON only, no prose:\n"
        "{\n"
        '  "summary": "one paragraph of what changes and why",\n'
        '  "policy_text": "markdown rules for the agents",\n'
        '  "config_changes": [{"key": "rag_retrieval", "path": "chat_agent.top_k", '
        '"from": 10, "to": 6, "reason": "..."}],\n'
        '  "agent_scope": ["chat_agent.supervisor"],\n'
        '  "manual_followups": [{"title": "...", "detail": "...", "risk": "high"}],\n'
        '  "open_questions": ["..."],\n'
        '  "risk": "medium",\n'
        '  "ready": true\n'
        "}\n"
        "Set ready=false while open_questions is non-empty."
    )


def _planner_user(
    description: str,
    context_block: str,
    answers: dict[str, Any] | None,
    snapshot: dict[str, Any],
) -> str:
    answers_block = json.dumps(answers or {}, ensure_ascii=False, indent=2)
    config_block = json.dumps(snapshot.get("config") or {}, ensure_ascii=False, indent=2)[:6000]
    platform_block = json.dumps(
        {
            "cases": snapshot.get("cases"),
            "users": snapshot.get("users"),
            "routing": snapshot.get("routing"),
        },
        ensure_ascii=False,
        default=str,
    )[:6000]
    return (
        f"POLICY DESCRIPTION FROM ADMIN:\n{description}\n\n"
        f"ATTACHED CONTEXT (features and tables the admin selected):\n{context_block}\n\n"
        f"ADMIN ANSWERS TO EARLIER QUESTIONS:\n{answers_block}\n\n"
        f"CURRENT CONFIGURATION:\n{config_block}\n\n"
        f"CURRENT PLATFORM STATE:\n{platform_block}"
    )


def _question_system(genui_prompt: str) -> str:
    return (
        "You generate a short clarification form for an admin who is drafting a platform "
        "policy for NyaySahayak.\n\n"
        "Ask only case-specific questions that change the outcome of the policy — scope, "
        "thresholds, which user segments are affected, rollout, and exceptions. Never ask "
        "generic or restating questions. Three to six questions maximum.\n"
        "Build exactly one Form, give every field a stable snake_case name, and end with a "
        "single submit Button whose action label is 'Submit answers'.\n\n"
        f"{genui_prompt}"
    )


def _impact_system(genui_prompt: str) -> str:
    return (
        "You are a platform analyst for NyaySahayak. Visualise the impact of a proposed "
        "policy on the existing user base, live cases, and current configuration.\n\n"
        "Use the real numbers provided — never invent data. Lead with the headline metrics, "
        "then the affected segments, then a breakdown table, then the risks. Include charts "
        "only where the data supports them. Keep it scannable: this renders in a narrow side "
        "panel.\n\n"
        f"{genui_prompt}"
    )


# ---------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------


def plan_change_set(
    *,
    description: str,
    context_refs: list[dict[str, Any]] | None,
    answers: dict[str, Any] | None,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    context_block = policy_context.expand_context_refs(context_refs)
    text = _llm(
        "planner",
        _planner_system(),
        _planner_user(description, context_block, answers, snapshot),
        max_tokens=4200,
    )
    plan = _extract_json(text)
    if not plan:
        plan = {
            "summary": text.strip()[:1200] or "The planner returned no structured output.",
            "policy_text": "",
            "config_changes": [],
            "agent_scope": [],
            "manual_followups": [],
            "open_questions": [],
            "risk": "medium",
            "ready": False,
        }
    return _normalise_plan(plan)


def _normalise_plan(plan: dict[str, Any]) -> dict[str, Any]:
    changes: list[dict[str, Any]] = []
    followups = [f for f in (plan.get("manual_followups") or []) if isinstance(f, dict)]
    for change in plan.get("config_changes") or []:
        if not isinstance(change, dict):
            continue
        key = str(change.get("key") or "").strip()
        if key not in WRITABLE_CONFIG_KEYS:
            followups.append(
                {
                    "title": f"Manual change required for '{key or 'unknown target'}'",
                    "detail": str(change.get("reason") or change.get("to") or ""),
                    "risk": "high",
                }
            )
            continue
        changes.append(
            {
                "key": key,
                "path": str(change.get("path") or "").strip(),
                "from": change.get("from"),
                "to": change.get("to"),
                "reason": str(change.get("reason") or ""),
            }
        )
    scope = [s for s in (plan.get("agent_scope") or []) if s in AGENT_SCOPES]
    risk = str(plan.get("risk") or "medium").lower()
    if risk not in ("low", "medium", "high"):
        risk = "medium"
    questions = [str(q) for q in (plan.get("open_questions") or []) if str(q).strip()]
    return {
        "summary": str(plan.get("summary") or ""),
        "policy_text": str(plan.get("policy_text") or ""),
        "config_changes": changes,
        "agent_scope": scope,
        "manual_followups": followups,
        "open_questions": questions,
        "risk": risk,
        "ready": bool(plan.get("ready")) and not questions,
    }


def generate_questions_ui(
    *,
    description: str,
    plan: dict[str, Any],
    context_refs: list[dict[str, Any]] | None,
    genui_prompt: str,
    answers: dict[str, Any] | None,
) -> str:
    if not genui_prompt.strip():
        return ""
    open_questions = plan.get("open_questions") or []
    if not open_questions:
        return ""
    payload = json.dumps(
        {
            "description": description,
            "open_questions": open_questions,
            "summary": plan.get("summary"),
            "already_answered": answers or {},
            "attached_context": [
                {"kind": r.get("kind"), "ref_id": r.get("ref_id")}
                for r in (context_refs or [])
                if isinstance(r, dict)
            ],
        },
        ensure_ascii=False,
        indent=2,
    )
    return _extract_openui(
        # Thinking tokens come out of the same budget, so a tight cap returns
        # an empty string rather than a short form.
        _llm("question_gen", _question_system(genui_prompt), payload, max_tokens=8000)
    )


def generate_impact_ui(
    *,
    description: str,
    plan: dict[str, Any],
    snapshot: dict[str, Any],
    genui_prompt: str,
) -> str:
    if not genui_prompt.strip():
        return ""
    payload = json.dumps(
        {
            "policy_description": description,
            "proposed_summary": plan.get("summary"),
            "config_changes": plan.get("config_changes"),
            "manual_followups": plan.get("manual_followups"),
            "risk": plan.get("risk"),
            "platform": snapshot,
        },
        ensure_ascii=False,
        default=str,
    )[:24000]
    return _extract_openui(
        # A full panel of metrics, charts and tables is long, and a truncated
        # program drops whole components since every ref must resolve.
        _llm("impact", _impact_system(genui_prompt), payload, max_tokens=8000)
    )


# ---------------------------------------------------------------------------
# Streaming session
# ---------------------------------------------------------------------------


def stream_policy_session(
    *,
    description: str,
    context_refs: list[dict[str, Any]] | None = None,
    answers: dict[str, Any] | None = None,
    genui_prompt: str = "",
    impact_prompt: str = "",
    period_days: int = 30,
    policy_id: str | None = None,
    title: str = "",
    created_by: str | None = None,
) -> Iterator[str]:
    """NDJSON stages: context, plan, questions_ui, impact_ui, saved, done."""

    def emit(payload: dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False, default=str) + "\n"

    description = (description or "").strip()
    if not description:
        yield emit({"type": "error", "message": "Describe the policy change first."})
        return

    try:
        yield emit({"type": "stage", "stage": "context", "label": "Reading platform context"})
        auto_context = policy_context.search_policy_context(description, top_k=6)
        merged = _merge_context(context_refs, auto_context)
        yield emit({"type": "context", "context": merged})

        snapshot = policy_impact.impact_snapshot(period_days)
        yield emit({"type": "stage", "stage": "plan", "label": "Drafting the change set"})
        plan = plan_change_set(
            description=description,
            context_refs=merged,
            answers=answers,
            snapshot=snapshot,
        )
        yield emit({"type": "plan", "plan": plan})

        if plan["open_questions"]:
            yield emit({"type": "stage", "stage": "questions", "label": "Preparing questions"})
            questions_ui = generate_questions_ui(
                description=description,
                plan=plan,
                context_refs=merged,
                genui_prompt=genui_prompt,
                answers=answers,
            )
            if questions_ui:
                yield emit({"type": "questions_ui", "content": questions_ui})

        yield emit({"type": "stage", "stage": "impact", "label": "Modelling impact"})
        impact_ui = generate_impact_ui(
            description=description,
            plan=plan,
            snapshot=snapshot,
            genui_prompt=impact_prompt or genui_prompt,
        )
        if impact_ui:
            yield emit({"type": "impact_ui", "content": impact_ui})
        yield emit({"type": "impact_data", "snapshot": snapshot})

        saved = save_draft(
            policy_id=policy_id,
            title=title or _derive_title(description),
            description=description,
            plan=plan,
            context_refs=merged,
            answers=answers,
            created_by=created_by,
        )
        yield emit({"type": "saved", "policy": saved})
        yield emit({"type": "done", "ready": plan["ready"]})
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] policy studio stream failed: {exc}")
        yield emit({"type": "error", "message": str(exc)})


def _merge_context(
    selected: list[dict[str, Any]] | None,
    auto: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for ref in list(selected or []) + list(auto or []):
        if not isinstance(ref, dict):
            continue
        key = (str(ref.get("kind") or ""), str(ref.get("ref_id") or ""))
        if key in seen or not key[1]:
            continue
        seen.add(key)
        out.append(ref)
    return out[:16]


def _derive_title(description: str) -> str:
    first = (description or "").strip().split("\n")[0]
    return (first[:80] + "…") if len(first) > 80 else (first or "Untitled policy")


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _row_to_policy(row: dict[str, Any]) -> dict[str, Any]:
    def _json(value: Any, fallback: Any) -> Any:
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str) and value.strip():
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return fallback
        return fallback

    def _iso(value: Any) -> Any:
        return value.isoformat() if hasattr(value, "isoformat") else value

    return {
        "id": str(row.get("id")),
        "title": row.get("title") or "",
        "description": row.get("description") or "",
        "policy_text": row.get("policy_text") or "",
        "change_set": _json(row.get("change_set"), {}),
        "context_refs": _json(row.get("context_refs"), []),
        "answers": _json(row.get("answers"), {}),
        "agent_scope": _json(row.get("agent_scope"), []),
        "risk": row.get("risk") or "low",
        "status": row.get("status") or "draft",
        "version": int(row.get("version") or 1),
        "created_by": row.get("created_by"),
        "created_at": _iso(row.get("created_at")),
        "updated_at": _iso(row.get("updated_at")),
        "activated_at": _iso(row.get("activated_at")),
    }


def save_draft(
    *,
    policy_id: str | None,
    title: str,
    description: str,
    plan: dict[str, Any],
    context_refs: list[dict[str, Any]] | None,
    answers: dict[str, Any] | None,
    created_by: str | None,
) -> dict[str, Any]:
    if not is_postgres_configured():
        return {
            "id": policy_id or uuid.uuid4().hex,
            "title": title,
            "description": description,
            "policy_text": plan.get("policy_text") or "",
            "change_set": plan,
            "context_refs": context_refs or [],
            "answers": answers or {},
            "agent_scope": plan.get("agent_scope") or [],
            "risk": plan.get("risk") or "low",
            "status": "draft",
            "version": 1,
        }

    params = (
        title,
        description,
        plan.get("policy_text") or "",
        json.dumps(plan, ensure_ascii=False, default=str),
        json.dumps(context_refs or [], ensure_ascii=False, default=str),
        json.dumps(answers or {}, ensure_ascii=False, default=str),
        json.dumps(plan.get("agent_scope") or [], ensure_ascii=False),
        plan.get("risk") or "low",
        created_by,
    )
    if policy_id:
        row = execute_one(
            """
            UPDATE public.policy_documents
               SET title = %s,
                   description = %s,
                   policy_text = %s,
                   change_set = %s::jsonb,
                   context_refs = %s::jsonb,
                   answers = %s::jsonb,
                   agent_scope = %s::jsonb,
                   risk = %s,
                   updated_at = now()
             WHERE id = %s AND status = 'draft'
            RETURNING *
            """,
            params[:-1] + (policy_id,),
        )
        if row:
            return _row_to_policy(row)

    row = execute_one(
        """
        INSERT INTO public.policy_documents
          (title, description, policy_text, change_set, context_refs, answers, agent_scope, risk, created_by)
        VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s)
        RETURNING *
        """,
        params,
    )
    return _row_to_policy(row or {})


def list_policies(limit: int = 50) -> list[dict[str, Any]]:
    if not is_postgres_configured():
        return []
    rows = execute(
        """
        SELECT * FROM public.policy_documents
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (max(1, min(200, int(limit or 50))),),
    )
    return [_row_to_policy(r) for r in rows]


def get_policy(policy_id: str) -> dict[str, Any] | None:
    if not is_postgres_configured():
        return None
    row = execute_one("SELECT * FROM public.policy_documents WHERE id = %s", (policy_id,))
    return _row_to_policy(row) if row else None


# ---------------------------------------------------------------------------
# Implement / rollback
# ---------------------------------------------------------------------------


def _set_path(target: dict[str, Any], path: str, value: Any) -> None:
    parts = [p for p in (path or "").split(".") if p]
    if not parts:
        return
    node = target
    for part in parts[:-1]:
        nxt = node.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            node[part] = nxt
        node = nxt
    node[parts[-1]] = value


def _get_path(source: dict[str, Any], path: str) -> Any:
    node: Any = source
    for part in [p for p in (path or "").split(".") if p]:
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


def implement_policy(policy_id: str, *, actor_id: str | None = None) -> dict[str, Any]:
    """Apply whitelisted config changes and activate the policy text."""
    policy = get_policy(policy_id)
    if not policy:
        raise ValueError("Policy not found")
    if policy["status"] == "active":
        raise ValueError("Policy is already active")

    change_set = policy.get("change_set") or {}
    changes = [c for c in (change_set.get("config_changes") or []) if isinstance(c, dict)]

    previous: dict[str, Any] = {}
    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    grouped: dict[str, list[dict[str, Any]]] = {}
    for change in changes:
        key = str(change.get("key") or "")
        if key not in WRITABLE_CONFIG_KEYS:
            skipped.append({**change, "reason_skipped": "key is not writable"})
            continue
        grouped.setdefault(key, []).append(change)

    for key, key_changes in grouped.items():
        current = read_config_key(key, {}) or {}
        previous[key] = json.loads(json.dumps(current, default=str))
        updated = json.loads(json.dumps(current, default=str))
        for change in key_changes:
            path = str(change.get("path") or "").strip()
            if not path:
                skipped.append({**change, "reason_skipped": "missing path"})
                continue
            _set_path(updated, path, change.get("to"))
            applied.append(
                {
                    "key": key,
                    "path": path,
                    "from": _get_path(current, path),
                    "to": change.get("to"),
                }
            )
        write_config_key(key, updated)

    stored = dict(change_set)
    stored["previous"] = previous
    stored["applied"] = applied
    stored["skipped"] = skipped

    row = execute_one(
        """
        UPDATE public.policy_documents
           SET status = 'active',
               change_set = %s::jsonb,
               activated_at = now(),
               updated_at = now()
         WHERE id = %s
        RETURNING *
        """,
        (json.dumps(stored, ensure_ascii=False, default=str), policy_id),
    )

    # One active policy per agent scope, so the newest wins where they overlap.
    # Policies covering unrelated agents stay active.
    scopes = [s for s in (policy.get("agent_scope") or []) if isinstance(s, str)]
    if scopes:
        try:
            execute_void(
                """
                UPDATE public.policy_documents
                   SET status = 'archived', updated_at = now()
                 WHERE status = 'active'
                   AND id <> %s
                   AND EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements_text(agent_scope) AS existing(scope)
                     WHERE existing.scope = ANY(%s)
                   )
                """,
                (policy_id, scopes),
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] archiving previous policies failed: {exc}")

    _audit(actor_id, "policy_implement", policy_id, {"applied": applied, "skipped": skipped})
    _POLICY_CACHE.clear()
    return {
        "policy": _row_to_policy(row or {}),
        "applied": applied,
        "skipped": skipped,
    }


def rollback_policy(policy_id: str, *, actor_id: str | None = None) -> dict[str, Any]:
    policy = get_policy(policy_id)
    if not policy:
        raise ValueError("Policy not found")
    change_set = policy.get("change_set") or {}
    previous = change_set.get("previous") or {}
    restored: list[str] = []
    for key, value in previous.items():
        if key not in WRITABLE_CONFIG_KEYS or not isinstance(value, dict):
            continue
        write_config_key(key, value)
        restored.append(key)

    row = execute_one(
        """
        UPDATE public.policy_documents
           SET status = 'rolled_back', updated_at = now()
         WHERE id = %s
        RETURNING *
        """,
        (policy_id,),
    )
    _audit(actor_id, "policy_rollback", policy_id, {"restored": restored})
    _POLICY_CACHE.clear()
    return {"policy": _row_to_policy(row or {}), "restored": restored}


def _audit(actor_id: str | None, action: str, target: str, detail: dict[str, Any]) -> None:
    if not is_postgres_configured():
        return
    try:
        execute_void(
            """
            INSERT INTO public.admin_audit_logs (actor_user_id, action, target_table, detail)
            VALUES (%s, %s, %s, %s::jsonb)
            """,
            (
                actor_id,
                action,
                "policy_documents",
                json.dumps({"policy_id": target, **detail}, ensure_ascii=False, default=str),
            ),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] policy audit log failed: {exc}")


# ---------------------------------------------------------------------------
# Agent-facing policy text
# ---------------------------------------------------------------------------


def get_active_policy_text(scope: str) -> str:
    """Active policy guidance for an agent scope, cached briefly for hot paths."""
    cached = _POLICY_CACHE.get(scope)
    if cached and time.time() - cached[0] < _POLICY_CACHE_TTL:
        return cached[1]
    text = ""
    if is_postgres_configured():
        try:
            rows = execute(
                """
                SELECT policy_text, agent_scope
                FROM public.policy_documents
                WHERE status = 'active' AND policy_text <> ''
                ORDER BY activated_at DESC NULLS LAST
                LIMIT 5
                """
            )
            blocks: list[str] = []
            for row in rows:
                scopes = row.get("agent_scope")
                if isinstance(scopes, str):
                    try:
                        scopes = json.loads(scopes)
                    except json.JSONDecodeError:
                        scopes = []
                if scopes and scope not in scopes:
                    continue
                block = str(row.get("policy_text") or "").strip()
                if block:
                    blocks.append(block)
            text = "\n\n".join(blocks)
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] active policy lookup failed: {exc}")
            text = ""
    _POLICY_CACHE[scope] = (time.time(), text)
    return text
