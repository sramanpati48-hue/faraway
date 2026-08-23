"""Semantic context catalog for the Improvise Policies studio.

Indexes two kinds of context an admin can attach to a policy description:

* ``feature`` — product capabilities (chat agent nodes, moderator queue, nodal
  guide forwarding, lawyer browsing, NyaySahayak booking, scam heatmap, RAG
  funnel, billing) with the tables and ``system_config`` keys they depend on.
* ``table``   — live ``public`` schema tables with their columns.

Vectors always come from the admin-selected embedding model so the picker uses
the same retrieval quality as the rest of the product.
"""
from __future__ import annotations

import json
from typing import Any

from backend.database.postgres_pool import (
    execute,
    execute_void,
    is_postgres_configured,
)
from backend.services import admin_db
from backend.services.embedding_admin import format_pgvector
from backend.services.text_embeddings import embed_query, embed_texts

# (id, title, summary, tables, config_keys, code_paths)
FEATURE_REGISTRY: tuple[dict[str, Any], ...] = (
    {
        "id": "chat_intake",
        "title": "Case intake chat agent",
        "summary": (
            "LangGraph supervisor that classifies a user's problem, asks clarifying "
            "questions, routes to domain specialists (cyber, criminal, civil, domestic, "
            "finance) and produces a structured case report."
        ),
        "tables": ["cases", "chat_history", "langgraph_runs"],
        "config_keys": ["graph_node_models", "rag_retrieval"],
        "code_paths": ["backend/agent_graph.py", "backend/agents/report_agent.py"],
    },
    {
        "id": "suggested_actions",
        "title": "Suggested actions and next steps",
        "summary": (
            "Builds the suggestions rail after a case report: official links, helplines, "
            "lawyer browsing, local forum / nodal guide routing, NyaySahayak booking and "
            "the satisfied / wrap-up chips."
        ),
        "tables": ["cases", "case_followups"],
        "config_keys": ["graph_node_models"],
        "code_paths": ["backend/agents/suggested_actions_agent.py"],
    },
    {
        "id": "lawyer_matching",
        "title": "Lawyer browsing and forwarding",
        "summary": (
            "Category-aware advocate matching. Semantic lawyer search over lawyer "
            "embeddings, fee display, and forwarding a case report to a chosen lawyer."
        ),
        "tables": ["lawyers", "female_lawyers", "cases", "case_assignments"],
        "config_keys": ["graph_node_models", "ai_embeddings"],
        "code_paths": ["backend/agents/lawyer_forwarder_agent.py"],
    },
    {
        "id": "nodal_guide",
        "title": "Local justice forum and nodal guides",
        "summary": (
            "State-wise grassroots forum mapping (Gram Nyayalaya, Nyaya Panchayat, Lok "
            "Adalat, Nari Adalat) plus consent-gated forwarding of a case summary to a "
            "nodal guide in the user's area."
        ),
        "tables": ["nodal_guides", "cases", "case_followups"],
        "config_keys": [],
        "code_paths": [
            "backend/agents/local_justice.py",
            "backend/agents/nodal_guide_agent.py",
        ],
    },
    {
        "id": "moderator_queue",
        "title": "Legal moderator queue and audit",
        "summary": (
            "Human moderator review of escalated cases: throughput per hour, SLA minutes, "
            "delay ticks, respect penalties, and revision history of moderated reports."
        ),
        "tables": ["moderator_updatation", "moderator_case_revisions", "moderator_performance"],
        "config_keys": ["moderator_queue"],
        "code_paths": ["backend/services/moderator_queue.py"],
    },
    {
        "id": "sexual_offense",
        "title": "Sexual offence sensitive intake",
        "summary": (
            "High-sensitivity intake flow with restricted suggestions, female-lawyer "
            "preference, call confirmation and suppressed financial or cyber chips."
        ),
        "tables": ["cases", "sexual_offense_call_confirmations"],
        "config_keys": ["graph_node_models"],
        "code_paths": ["backend/agents/sexual_offense_agent.py"],
    },
    {
        "id": "nyaysahayak_booking",
        "title": "On-ground NyaySahayak booking",
        "summary": (
            "Paid on-ground assistance where a NyaySahayak visits the user. Booking is "
            "confirmed in chat after payment."
        ),
        "tables": ["nyaysahayak_bookings", "sahayak_cases", "sahayak_profiles", "cases"],
        "config_keys": [],
        "code_paths": ["backend/agents/sahayak_agent.py"],
    },
    {
        "id": "scam_intelligence",
        "title": "Scam trends, heatmap and classifier",
        "summary": (
            "Clusters reported scams by geography, matches a new case against known local "
            "patterns, and powers the scam heatmap plus the scam case classifier."
        ),
        "tables": ["mock_scams", "scam_reports", "scam_trend_drafts", "scam_classifier_runs"],
        "config_keys": ["scam_classifier", "scam_trends", "ai_embeddings"],
        "code_paths": [
            "backend/agents/scam_match.py",
            "backend/services/scam_case_classifier.py",
        ],
    },
    {
        "id": "rag_retrieval",
        "title": "Legal RAG retrieval",
        "summary": (
            "pgvector retrieval over Indian legal documents used by the chat agent and "
            "clash mode. Tunable top_k and minimum similarity per graph."
        ),
        "tables": ["legal_documents", "articles"],
        "config_keys": ["rag_retrieval", "ai_embeddings"],
        "code_paths": [
            "backend/database/vector_db.py",
            "backend/services/rag_retrieval_config.py",
        ],
    },
    {
        "id": "rag_funnel",
        "title": "RAG ingestion funnel",
        "summary": (
            "Admin pipeline that fetches, chunks, embeds and promotes legal source "
            "material into the legal_documents vector store."
        ),
        "tables": ["legal_documents", "rag_ingest_sessions", "rag_ingest_chunks", "scr_downloaded_cases"],
        "config_keys": ["rag_funnel", "ai_embeddings"],
        "code_paths": ["backend/services/rag_funnel.py"],
    },
    {
        "id": "clash_mode",
        "title": "Clash mode courtroom simulation",
        "summary": (
            "Prosecution / defence / cross-examination / judge agents that simulate a "
            "hearing for a filed case, with per-round billing."
        ),
        "tables": ["clash_session_runs", "clash_mock_cases", "clash_billing_events"],
        "config_keys": ["graph_node_models"],
        "code_paths": ["backend/agents/clash/"],
    },
    {
        "id": "billing",
        "title": "Payments and subscriptions",
        "summary": (
            "Subscription plans, one-off payments (NyaySahayak booking, clash rounds) and "
            "billing event history."
        ),
        "tables": ["clash_plans", "clash_subscriptions", "clash_billing_events", "nyaysahayak_bookings"],
        "config_keys": [],
        "code_paths": ["backend/routes/clash_billing_routes.py"],
    },
    {
        "id": "users_roles",
        "title": "Users, roles and access",
        "summary": (
            "Accounts across roles: citizen, lawyer, legal moderator, nodal guide, "
            "NyaySahayak, admin — including profile and availability data."
        ),
        "tables": ["users", "lawyers", "nodal_guides"],
        "config_keys": [],
        "code_paths": ["backend/services/admin_users.py"],
    },
    {
        "id": "ai_models",
        "title": "AI model and embedding configuration",
        "summary": (
            "Per-node LLM provider/model selection for every graph plus the embedding "
            "provider and model used for all vector search."
        ),
        "tables": ["system_config", "ai_usage_logs"],
        "config_keys": ["graph_node_models", "ai_embeddings", "sql_generation"],
        "code_paths": ["backend/services/admin_models.py"],
    },
)

_FEATURE_BY_ID = {f["id"]: f for f in FEATURE_REGISTRY}

# Tables that add no policy signal.
_SKIP_TABLES = {
    "langgraph_run_events",
    "langgraph_run_forks",
    "schema_migrations",
}

_EMBED_BATCH = 20


def _feature_document(feature: dict[str, Any]) -> str:
    tables = ", ".join(feature.get("tables") or []) or "none"
    keys = ", ".join(feature.get("config_keys") or []) or "none"
    return (
        f"Feature: {feature['title']}. {feature['summary']} "
        f"Backing tables: {tables}. Configuration keys: {keys}."
    )


def _table_document(table: dict[str, Any]) -> str:
    columns = ", ".join(
        f"{c.get('name')} {c.get('data_type')}" for c in (table.get("columns") or [])[:40]
    )
    return f"Database table: {table['name']}. Columns: {columns or 'unknown'}."


def feature_catalog() -> list[dict[str, Any]]:
    """Static product features enriched with whether their tables actually exist."""
    known: set[str] = set()
    try:
        known = {str(t.get("name")) for t in admin_db.schema_catalog(include_counts=False)}
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] policy feature catalog could not read schema: {exc}")
    out: list[dict[str, Any]] = []
    for feature in FEATURE_REGISTRY:
        entry = dict(feature)
        entry["tables_present"] = [t for t in feature.get("tables") or [] if t in known] if known else []
        out.append(entry)
    return out


def table_catalog() -> list[dict[str, Any]]:
    try:
        rows = admin_db.schema_catalog(include_counts=False)
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] policy table catalog failed: {exc}")
        return []
    return [t for t in rows if str(t.get("name")) not in _SKIP_TABLES]


def context_documents() -> list[dict[str, Any]]:
    """All indexable context rows (features first, then tables)."""
    docs: list[dict[str, Any]] = []
    for feature in FEATURE_REGISTRY:
        docs.append(
            {
                "kind": "feature",
                "ref_id": feature["id"],
                "title": feature["title"],
                "content": _feature_document(feature),
                "metadata": {
                    "tables": feature.get("tables") or [],
                    "config_keys": feature.get("config_keys") or [],
                    "code_paths": feature.get("code_paths") or [],
                },
            }
        )
    for table in table_catalog():
        docs.append(
            {
                "kind": "table",
                "ref_id": str(table.get("name")),
                "title": str(table.get("name")),
                "content": _table_document(table),
                "metadata": {
                    "columns": [c.get("name") for c in (table.get("columns") or [])][:60],
                },
            }
        )
    return docs


def reindex_policy_context() -> dict[str, int]:
    """Re-embed the whole catalog with the admin-selected embedding model."""
    if not is_postgres_configured():
        raise RuntimeError("DATABASE_URL not configured")

    docs = context_documents()
    counts = {"features": 0, "tables": 0, "failed": 0}

    for start in range(0, len(docs), _EMBED_BATCH):
        chunk = docs[start : start + _EMBED_BATCH]
        try:
            vectors = embed_texts([d["content"][:8000] for d in chunk])
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] policy context embed batch failed at {start}: {exc}")
            counts["failed"] += len(chunk)
            continue
        for doc, vector in zip(chunk, vectors):
            try:
                execute_void(
                    """
                    INSERT INTO public.policy_context_embeddings
                      (kind, ref_id, title, content, metadata, embedding, updated_at)
                    VALUES (%s, %s, %s, %s, %s::jsonb, %s::vector, now())
                    ON CONFLICT (kind, ref_id) DO UPDATE SET
                      title = EXCLUDED.title,
                      content = EXCLUDED.content,
                      metadata = EXCLUDED.metadata,
                      embedding = EXCLUDED.embedding,
                      updated_at = now()
                    """,
                    (
                        doc["kind"],
                        doc["ref_id"],
                        doc["title"],
                        doc["content"],
                        json.dumps(doc["metadata"]),
                        format_pgvector(vector),
                    ),
                )
                counts["features" if doc["kind"] == "feature" else "tables"] += 1
            except Exception as exc:  # noqa: BLE001
                print(f"[warn] policy context upsert failed for {doc['ref_id']}: {exc}")
                counts["failed"] += 1

    # Drop rows whose feature or table no longer exists.
    live = {(d["kind"], d["ref_id"]) for d in docs}
    try:
        for row in execute("SELECT kind, ref_id FROM public.policy_context_embeddings"):
            key = (str(row.get("kind")), str(row.get("ref_id")))
            if key not in live:
                execute_void(
                    "DELETE FROM public.policy_context_embeddings WHERE kind = %s AND ref_id = %s",
                    key,
                )
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] policy context prune failed: {exc}")

    return counts


def index_status() -> dict[str, Any]:
    if not is_postgres_configured():
        return {"indexed": 0, "expected": len(context_documents()), "last_indexed_at": None}
    try:
        rows = execute(
            """
            SELECT COUNT(*)::int AS indexed, MAX(updated_at) AS last_indexed_at
            FROM public.policy_context_embeddings
            WHERE embedding IS NOT NULL
            """
        )
    except Exception:
        return {"indexed": 0, "expected": len(context_documents()), "last_indexed_at": None}
    row = rows[0] if rows else {}
    last = row.get("last_indexed_at")
    return {
        "indexed": int(row.get("indexed") or 0),
        "expected": len(context_documents()),
        "last_indexed_at": last.isoformat() if hasattr(last, "isoformat") else last,
    }


def search_policy_context(
    query: str,
    *,
    top_k: int = 8,
    kind: str | None = None,
) -> list[dict[str, Any]]:
    """Semantic search over features + tables using the admin embedding model."""
    text = (query or "").strip()
    if not text or not is_postgres_configured():
        return []
    try:
        vector = embed_query(text)
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] policy context query embed failed: {exc}")
        return []
    if not vector:
        return []
    try:
        rows = execute(
            "SELECT * FROM public.match_policy_context(%s::vector, %s, %s)",
            (format_pgvector(vector), max(1, min(int(top_k or 8), 40)), kind),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] policy context search failed: {exc}")
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "kind": row.get("kind"),
                "ref_id": row.get("ref_id"),
                "title": row.get("title"),
                "content": row.get("content"),
                "metadata": row.get("metadata") or {},
                "similarity": float(row.get("similarity") or 0.0),
            }
        )
    return out


def expand_context_refs(refs: list[dict[str, Any]] | None) -> str:
    """Render attached context into a prompt block the policy LLM can reason over."""
    if not refs:
        return "(no context attached)"
    lines: list[str] = []
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        kind = str(ref.get("kind") or "")
        ref_id = str(ref.get("ref_id") or "")
        if kind == "feature":
            feature = _FEATURE_BY_ID.get(ref_id)
            if feature:
                lines.append(f"- {_feature_document(feature)}")
                continue
        content = str(ref.get("content") or "").strip()
        if content:
            lines.append(f"- {content}")
        elif ref_id:
            lines.append(f"- {kind}: {ref_id}")
    return "\n".join(lines) or "(no context attached)"
