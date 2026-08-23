"""Postgres pgvector + Nyaysahayak embedding API (no Pinecone)."""
from __future__ import annotations

import json
import math
import uuid
from typing import Any

from dotenv import load_dotenv

from backend.paths import REPO_ROOT

load_dotenv()
load_dotenv(dotenv_path=REPO_ROOT / "backend" / "agents" / ".env")
load_dotenv(dotenv_path=REPO_ROOT / ".env")


class VectorDB:
    """pgvector search. Query vectors always come from admin ``ai_embeddings``."""

    def _format_pgvector(self, values: list[float]) -> str:
        return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"

    def _parse_embedding(self, raw_embedding: Any) -> list[float]:
        if raw_embedding is None:
            return []
        if isinstance(raw_embedding, list):
            try:
                return [float(v) for v in raw_embedding]
            except Exception:
                return []
        if isinstance(raw_embedding, str):
            text = raw_embedding.strip()
            if text.startswith("[") and text.endswith("]"):
                text = text[1:-1]
            parts = [p.strip() for p in text.split(",") if p.strip()]
            try:
                return [float(v) for v in parts]
            except Exception:
                return []
        return []

    def _cosine_similarity(self, v1: list[float], v2: list[float]) -> float:
        if not v1 or not v2:
            return -1.0
        n = min(len(v1), len(v2))
        if n <= 0:
            return -1.0
        a = v1[:n]
        b = v2[:n]
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(y * y for y in b))
        if norm_a == 0 or norm_b == 0:
            return -1.0
        return dot / (norm_a * norm_b)

    def _embed_query_text(self, query: str) -> list[float]:
        try:
            from backend.services.text_embeddings import embed_query

            return embed_query(query)
        except Exception as e:
            print(f"❌ Error embedding query: {e}")
        return []

    def search_legal_documents(self, query: str, top_k: int = 10, filter_category: str | None = None):
        if not query:
            return []

        query_embedding = self._embed_query_text(query)
        if not query_embedding:
            return []

        try:
            from backend.database.postgres_pool import is_postgres_configured
            from backend.database.postgres_db import match_legal_documents

            if is_postgres_configured():
                rows = match_legal_documents(query_embedding, top_k, filter_category)
                output = []
                for row in rows:
                    if isinstance(row, dict) and "document_row" in row:
                        document_row = row.get("document_row") or {}
                        similarity = row.get("similarity")
                        if isinstance(document_row, dict):
                            output.append({"similarity": similarity, **document_row})
                    elif isinstance(row, dict):
                        output.append(row)
                if output:
                    return output
        except Exception as e:
            print(f"⚠️ Postgres match_legal_documents failed: {e}")

        return []

    def search_articles(
        self,
        query: str,
        top_k: int = 10,
        filter_category: str | None = None,
    ) -> list[dict]:
        if not query:
            return []
        query_embedding = self._embed_query_text(query)
        if not query_embedding:
            return []
        try:
            from backend.database.postgres_pool import is_postgres_configured
            from backend.database.postgres_db import match_articles

            if not is_postgres_configured():
                return []
            rows = match_articles(query_embedding, top_k, filter_category)
            output: list[dict] = []
            for row in rows:
                if isinstance(row, dict) and "article_row" in row:
                    article_row = row.get("article_row") or {}
                    if isinstance(article_row, str):
                        try:
                            article_row = json.loads(article_row)
                        except Exception:
                            article_row = {}
                    if isinstance(article_row, dict):
                        output.append({"similarity": row.get("similarity"), **article_row})
                elif isinstance(row, dict):
                    output.append(row)
            return output
        except Exception as e:
            print(f"⚠️ Postgres match_articles failed: {e}")
            return []

    def search_scam_reports(
        self,
        query: str,
        top_k: int = 5,
        filter_city: str | None = None,
    ) -> list[str]:
        query_embedding = self._embed_query_text(query or "recent scams")
        if not query_embedding:
            return []
        try:
            from backend.database.postgres_pool import execute, is_postgres_configured

            if not is_postgres_configured():
                return []
            rows = execute(
                """
                SELECT report_row, similarity
                FROM public.match_scam_reports(%s::vector, %s, %s)
                """,
                (self._format_pgvector(query_embedding), top_k, filter_city),
            )
            texts = []
            for row in rows:
                report = row.get("report_row") or {}
                if isinstance(report, str):
                    try:
                        report = json.loads(report)
                    except Exception:
                        report = {}
                desc = report.get("description") if isinstance(report, dict) else None
                if desc:
                    texts.append(str(desc))
            return texts
        except Exception as e:
            print(f"⚠️ match_scam_reports failed: {e}")
            return []

    def search(
        self,
        query: str,
        top_k: int = 3,
        namespaces: list | str | None = None,
        filter: dict | None = None,
    ):
        if namespaces is None:
            namespaces = ["laws"]
        elif isinstance(namespaces, str):
            namespaces = [namespaces]

        if any(ns in {"laws", "mlats", "legal_documents"} for ns in namespaces):
            legal_rows = self.search_legal_documents(query=query, top_k=top_k)
            return [
                str(row.get("content") or row.get("summary") or "")
                for row in legal_rows
                if isinstance(row, dict)
            ]

        if any(ns == "scams" for ns in namespaces):
            city = None
            if isinstance(filter, dict):
                city = filter.get("city")
            return self.search_scam_reports(query=query, top_k=top_k, filter_city=city)

        if any(ns == "lawyers" for ns in namespaces):
            return self.search_lawyers(query=query, top_k=top_k, filter=filter)

        return []

    def add_lawyer(self, lawyer_id: str, bio: str, metadata: dict | None = None):
        print(f"⚖️ Adding Lawyer Profile: {lawyer_id} | Metadata: {metadata}")
        try:
            from backend.services.text_embeddings import embed_document

            embedding = embed_document(bio or "")
        except Exception as e:
            print(f"⚠️ Lawyer embed failed — skipping vector upsert: {e}")
            return
        if not embedding:
            print("⚠️ Lawyer embed failed — skipping vector upsert")
            return
        try:
            from backend.database.postgres_pool import execute_void, is_postgres_configured

            if not is_postgres_configured():
                return
            execute_void(
                """
                UPDATE public.lawyers
                SET embedding = %s::vector,
                    bio = COALESCE(NULLIF(%s, ''), bio),
                    updated_at = now()
                WHERE id = %s OR user_id = %s
                """,
                (self._format_pgvector(embedding), bio or "", lawyer_id, lawyer_id),
            )
            print("✅ Lawyer profile embedding stored in Postgres.")
        except Exception as e:
            print(f"❌ Error adding lawyer embedding: {e}")

    def add_scam(self, description: str, metadata: dict | None = None):
        metadata = metadata or {}
        print(f"🚫 Adding Scam Report: {metadata.get('city', 'Unknown')}")
        try:
            from backend.services.text_embeddings import embed_document

            embedding = embed_document(description or "")
        except Exception as e:
            print(f"⚠️ Scam embed failed — skipping vector upsert: {e}")
            return
        if not embedding:
            print("⚠️ Scam embed failed — skipping vector upsert")
            return
        try:
            from backend.database.postgres_pool import execute_void, is_postgres_configured

            if not is_postgres_configured():
                return
            scam_id = f"scam_{uuid.uuid4().hex[:16]}"
            execute_void(
                """
                INSERT INTO public.scam_reports (id, description, city, metadata, embedding)
                VALUES (%s, %s, %s, %s::jsonb, %s::vector)
                """,
                (
                    scam_id,
                    description,
                    metadata.get("city"),
                    json.dumps(metadata, default=str),
                    self._format_pgvector(embedding),
                ),
            )
            print("✅ Scam report stored in Postgres.")
        except Exception as e:
            print(f"❌ Error adding scam report: {e}")

    def search_lawyers(
        self,
        query: str,
        top_k: int = 5,
        filter: dict | None = None,
        filters: dict | None = None,
    ):
        _ = filter or filters  # reserved for future metadata filters
        query_embedding = self._embed_query_text(query)
        if not query_embedding:
            return []
        try:
            from backend.database.postgres_pool import execute, is_postgres_configured

            if not is_postgres_configured():
                return []
            rows = execute(
                "SELECT lawyer_id, similarity FROM public.match_lawyers(%s::vector, %s)",
                (self._format_pgvector(query_embedding), top_k),
            )
            return [str(r["lawyer_id"]) for r in rows if r.get("lawyer_id")]
        except Exception as e:
            print(f"❌ Error searching lawyers: {e}")
            return []
