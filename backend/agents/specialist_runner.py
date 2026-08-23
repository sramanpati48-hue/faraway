"""Shared specialist runner: short intake replies vs full post-Q&A guidance."""
from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, SystemMessage

from backend.agents.common_utils import extract_search_query, retrieve_legal_context
from backend.agents.response_sanitize import format_retrieved_section_lines, strip_classification_block


def _query_text(state: dict) -> str:
    messages = state.get("messages") or []
    last = ""
    if messages:
        last = extract_search_query(getattr(messages[-1], "content", messages[-1]))
    return str(state.get("user_statement") or last or "").strip() or last


def more_specialists_remain(state: dict) -> bool:
    plan = list(state.get("agent_plan") or [])
    idx = int(state.get("plan_index") or 0)
    return idx < len(plan)


def run_specialist(
    state: dict,
    *,
    llm: Any,
    role_name: str,
    extra_context: str = "",
    full_instructions: str = "",
) -> dict:
    messages = state.get("messages") or []
    query = _query_text(state)
    context_text, context_rows = retrieve_legal_context(query, graph_id="chat_agent")
    intake = not bool(state.get("answers_collection_complete"))
    doc_note = str(state.get("document_analysis") or "").strip()
    extra_bits = "\n\n".join(p for p in [extra_context, f"DOCUMENT ANALYSIS:\n{doc_note}" if doc_note else ""] if p)

    lang_rules = """
- If the user's input is in English, respond ENTIRELY in English.
- Only use another language if the user wrote in that language's script.
- Ground legal citations in the retrieved context. Do not invent section numbers.
- Never include Classification Data, [Cognizable:], [Complex_MLAT:], or [Fraud_Under_10k:] in the user-facing reply.
"""

    if intake:
        section_lines = format_retrieved_section_lines(context_rows)
        system_prompt = f"""You are the {role_name} for NyaySahayak (India).

INTAKE MODE. The user-facing reply MUST be short (4–8 lines).
Summarize which retrieved provisions appear relevant, then say you need a little more clarification.
Do NOT write FIR/GD walkthroughs, long checklists, "What To Prepare", or satisfaction prompts.

RELEVANT LEGAL CONTEXT:
{context_text}

{extra_bits}

Retrieved section hints (prefer these if accurate):
{section_lines or "- (no close match; say so briefly)"}

{lang_rules}

STRUCTURE:
1. One sentence on what this situation appears to relate to.
2. Bullet the relevant act/section names from context (max 4).
3. End with: "I need a little more clarification before I give full next steps."
"""
    else:
        system_prompt = f"""You are the {role_name} for NyaySahayak (India).
Give complete, practical next steps now that follow-up answers are available.
Do NOT include internal classification tags.

RELEVANT LEGAL CONTEXT:
{context_text}

{extra_bits}

{lang_rules}

{full_instructions}
"""

    response = llm.invoke([SystemMessage(content=system_prompt)] + list(messages))
    raw = getattr(response, "content", response)
    if isinstance(raw, list):
        raw = "".join(
            (c.get("text") or "") if isinstance(c, dict) else str(c) for c in raw
        )
    user_text = strip_classification_block(raw)
    silent = intake and more_specialists_remain(state) and "document" in str(role_name).lower()
    if silent:
        user_text = ""
    return {
        "messages": [AIMessage(content=user_text)] if user_text else [],
        "final_response": user_text,
        "user_facing_delta": user_text,
        "legal_draft": strip_classification_block(raw) or context_text,
        "retrieved_legal_chunks": context_rows,
        "next_step": "plan_runner",
    }
