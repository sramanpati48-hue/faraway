#!/usr/bin/env python3
"""Export tables from Supabase and upsert into local Docker Postgres.

Idempotent: uses ON CONFLICT DO UPDATE / DO NOTHING per table primary key.
Users are imported without passwords and marked password_reset_required.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

PAGE_SIZE = 500

# (supabase_table, postgres_table, conflict_target, column allowlist or None=intersect)
TABLES: list[tuple[str, str, str, set[str] | None]] = [
    (
        "users",
        "users",
        "id",
        {
            "id",
            "firebase_uid",
            "email",
            "mobile",
            "role",
            "status",
            "password_reset_required",
            "display_name",
            "created_at",
            "updated_at",
        },
    ),
    ("chat_history", "chat_history", "id", {"id", "user_id", "session_data", "timestamp"}),
    (
        "cases",
        "cases",
        "id",
        {
            "id",
            "user_id",
            "session_id",
            "structured_report",
            "session_data",
            "pending",
            "situation_summary",
            "collected_answers",
            "user_language",
            "status",
            "has_answers",
            "pdf_url",
            "pdf_updated_at",
            "pdf_generated_at",
            "cloudinary_path",
            "timestamp",
            "updated_at",
        },
    ),
    (
        "interventions",
        "interventions",
        "id",
        {
            "id",
            "user_id",
            "collection_name",
            "structured_report",
            "status",
            "session_id",
            "user_statement",
            "location",
            "moderator_response",
            "moderator_options",
            "routing_recommendation",
            "resolved_at",
            "created_at",
            "updated_at",
        },
    ),
    (
        "sahayak_profiles",
        "sahayak_profiles",
        "uid",
        {
            "uid",
            "name",
            "email",
            "contact_number",
            "location",
            "occupation",
            "bio",
            "avatar",
            "languages",
            "availability",
            "rating",
            "cases_resolved",
            "created_at",
            "updated_at",
        },
    ),
    (
        "sahayak_cases",
        "sahayak_cases",
        "id",
        {
            "id",
            "user_id",
            "user_name",
            "structured_report",
            "status",
            "session_id",
            "assigned_sahayak_id",
            "assigned_sahayak_name",
            "created_at",
            "updated_at",
        },
    ),
    (
        "lawyers",
        "lawyers",
        "id",
        {
            "id",
            "user_id",
            "name",
            "email",
            "specialization",
            "lawyer_type",
            "experience",
            "hourly_rate",
            "bio",
            "location",
            "avatar",
            "contact_number",
            "bar_registration_number",
            "rating",
            "verified",
            "created_at",
            "updated_at",
        },
    ),
    (
        "lawyer_cases",
        "lawyer_cases",
        "id",
        {
            "id",
            "user_id",
            "assigned_lawyer_id",
            "structured_report",
            "status",
            "session_id",
            "created_at",
            "updated_at",
        },
    ),
    (
        "case_attachments",
        "case_attachments",
        "id",
        {
            "id",
            "case_id",
            "file_url",
            "file_type",
            "file_name",
            "file_size",
            "uploaded_by",
            "uploaded_at",
        },
    ),
    (
        "mock_scams",
        "mock_scams",
        "id",
        {
            "id",
            "title",
            "description",
            "scam_type",
            "risk_level",
            "city",
            "lat",
            "lon",
            "embedding",
            "timestamp",
        },
    ),
    (
        "legal_documents",
        "legal_documents",
        "id",
        {
            "id",
            "created_at",
            "updated_at",
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
            "embedding",
            "language",
            "created_by",
            "notes",
        },
    ),
    (
        "clash_mock_cases",
        "clash_mock_cases",
        "id",
        {"id", "title", "summary", "facts", "tags", "active", "created_at", "updated_at"},
    ),
    (
        "nodal_guides",
        "nodal_guides",
        "id",
        None,  # intersect with PG columns
    ),
    ("routing_rules", "routing_rules", "id", None),
    ("female_lawyers", "female_lawyers", "id", None),
    ("female_nyayguides", "female_nyayguides", "id", None),
]

VALID_ROLES = {"victim", "sahayak", "lawyer", "moderator", "admin", "super_admin"}


def _supabase():
    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
    return create_client(url, key)


def _pg_columns(cur, table: str) -> set[str]:
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table,),
    )
    return {r["column_name"] for r in cur.fetchall()}


def _fetch_all(client, table: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        end = start + PAGE_SIZE - 1
        res = client.table(table).select("*").range(start, end).execute()
        batch = res.data or []
        rows.extend(batch)
        print(f"  fetched {table}: {len(rows)}", end="\r", flush=True)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    print(f"  fetched {table}: {len(rows)}          ")
    return rows


def _normalize_embedding(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        return s if s.startswith("[") else None
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(str(float(x)) for x in value) + "]"
    return None


def _transform_user(row: dict[str, Any]) -> dict[str, Any]:
    role = (row.get("role") or "victim").strip().lower()
    if role not in VALID_ROLES:
        role = "victim"
    out = {
        "id": row.get("id"),
        "firebase_uid": row.get("firebase_uid") or row.get("uid"),
        "email": row.get("email"),
        "mobile": row.get("mobile") or row.get("phone"),
        "role": role,
        "status": "pending_reset",
        "password_reset_required": True,
        "display_name": row.get("display_name") or row.get("name"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at") or row.get("created_at"),
    }
    # Keep at least one identifier for CHECK constraint
    if not out["email"] and not out["mobile"] and not out["firebase_uid"]:
        out["firebase_uid"] = f"imported-{out['id']}"
    return out


def _prepare_row(
    table: str,
    row: dict[str, Any],
    cols: set[str],
) -> dict[str, Any] | None:
    if table == "users":
        row = _transform_user(row)
    out: dict[str, Any] = {}
    for k, v in row.items():
        if k not in cols:
            continue
        if k == "embedding":
            out[k] = _normalize_embedding(v)
            continue
        if isinstance(v, (dict, list)) and k not in (
            "languages",
            "tags",
            "related_acts",
            "keywords",
            "applicable_sections",
        ):
            # jsonb columns: leave as Python objects for psycopg
            out[k] = v
        else:
            out[k] = v
    if not out:
        return None
    return out


def _upsert_batch(cur, table: str, conflict: str, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    cols = list(rows[0].keys())
    col_sql = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != conflict)
    if updates:
        sql = (
            f"INSERT INTO public.{table} ({col_sql}) VALUES ({placeholders}) "
            f"ON CONFLICT ({conflict}) DO UPDATE SET {updates}"
        )
    else:
        sql = (
            f"INSERT INTO public.{table} ({col_sql}) VALUES ({placeholders}) "
            f"ON CONFLICT ({conflict}) DO NOTHING"
        )
    values = [[r.get(c) for c in cols] for r in rows]
    cur.executemany(sql, values)
    return len(values)


def import_table(
    client,
    conn,
    supabase_table: str,
    pg_table: str,
    conflict: str,
    allow: set[str] | None,
    dry_run: bool,
) -> int:
    import psycopg
    from psycopg.types.json import Jsonb

    raw = _fetch_all(client, supabase_table)
    with conn.cursor() as cur:
        pg_cols = _pg_columns(cur, pg_table)
        cols = (allow & pg_cols) if allow else pg_cols
        prepared: list[dict[str, Any]] = []
        for row in raw:
            p = _prepare_row(supabase_table, row, cols)
            if not p:
                continue
            # Wrap jsonb-like dicts for safety
            for k, v in list(p.items()):
                if isinstance(v, dict):
                    p[k] = Jsonb(v)
                elif isinstance(v, list) and k in (
                    "session_data",
                    "structured_report",
                    "situation_summary",
                    "collected_answers",
                    "location",
                    "moderator_options",
                    "routing_recommendation",
                    "action_links",
                ):
                    p[k] = Jsonb(v)
            prepared.append(p)

        if dry_run:
            print(f"  dry-run {pg_table}: would import {len(prepared)}")
            return len(prepared)

        # Align column order across batch (union of keys)
        all_cols = sorted({k for r in prepared for k in r.keys()})
        aligned = [{c: r.get(c) for c in all_cols} for r in prepared]

        # Insert in chunks
        total = 0
        chunk = 100
        for i in range(0, len(aligned), chunk):
            batch = aligned[i : i + chunk]
            total += _upsert_batch(cur, pg_table, conflict, batch)
            conn.commit()
            print(f"  upserted {pg_table}: {total}/{len(aligned)}", end="\r", flush=True)
        print(f"  upserted {pg_table}: {total}/{len(aligned)}          ")
        return total


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Supabase data into Docker Postgres")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--only",
        nargs="*",
        help="Optional supabase table names to import",
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")

    import psycopg
    from psycopg.rows import dict_row

    client = _supabase()
    only = set(args.only) if args.only else None

    print(f"Importing Supabase → Postgres ({'dry-run' if args.dry_run else 'live'})")
    print(f"DATABASE_URL host from env configured")

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        for supabase_table, pg_table, conflict, allow in TABLES:
            if only and supabase_table not in only:
                continue
            print(f"\n[{supabase_table}]")
            try:
                n = import_table(
                    client, conn, supabase_table, pg_table, conflict, allow, args.dry_run
                )
                print(f"  done: {n}")
            except Exception as e:
                conn.rollback()
                print(f"  ERROR: {e}")
                raise

    print("\nImport complete.")
    print("Next: python scripts/verify_cutover.py")


if __name__ == "__main__":
    main()
