#!/usr/bin/env python3
"""Apply SQL migrations from backend/database/migrations and bootstrap admin user."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

MIGRATIONS_DIR = ROOT / "backend" / "database" / "migrations"


def apply_migrations(database_url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("No migration files found.")
        return

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS public.schema_migrations (
                  filename text PRIMARY KEY,
                  applied_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            conn.commit()
            cur.execute("SELECT filename FROM public.schema_migrations")
            applied = {row["filename"] for row in cur.fetchall()}

            for path in files:
                name = path.name
                if name in applied:
                    print(f"skip  {name}")
                    continue
                sql = path.read_text(encoding="utf-8")
                print(f"apply {name}")
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO public.schema_migrations (filename) VALUES (%s) ON CONFLICT DO NOTHING",
                    (name,),
                )
                conn.commit()

    print("Migrations complete.")


def bootstrap_admin(database_url: str, email: str, password: str) -> None:
    from argon2 import PasswordHasher
    import psycopg
    from psycopg.rows import dict_row

    ph = PasswordHasher()
    password_hash = ph.hash(password)
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.users (email, password_hash, role, status, password_reset_required, display_name)
                VALUES (%s, %s, 'super_admin', 'active', false, 'Bootstrap Admin')
                ON CONFLICT DO NOTHING
                """,
                (email, password_hash),
            )
            # Partial unique index cannot be targeted easily; update-or-insert manually.
            cur.execute(
                "SELECT id FROM public.users WHERE lower(email) = lower(%s) LIMIT 1",
                (email,),
            )
            row = cur.fetchone()
            if row:
                cur.execute(
                    """
                    UPDATE public.users
                    SET password_hash = %s, role = 'super_admin', status = 'active',
                        password_reset_required = false, updated_at = now()
                    WHERE id = %s
                    """,
                    (password_hash, row["id"]),
                )
                print(f"Admin ready: {email} (id={row['id']})")
            else:
                cur.execute(
                    """
                    INSERT INTO public.users (email, password_hash, role, status, password_reset_required, display_name)
                    VALUES (%s, %s, 'super_admin', 'active', false, 'Bootstrap Admin')
                    RETURNING id
                    """,
                    (email, password_hash),
                )
                created = cur.fetchone()
                print(f"Admin created: {email} (id={created['id']})")
            conn.commit()


def verify_expected_tables(database_url: str) -> None:
    expected = {
        "users",
        "chat_history",
        "cases",
        "interventions",
        "sahayak_cases",
        "sahayak_profiles",
        "lawyers",
        "lawyer_cases",
        "case_attachments",
        "case_assignments",
        "mock_scams",
        "legal_documents",
        "clash_mock_cases",
        "nodal_guides",
        "routing_rules",
        "female_lawyers",
        "female_nyayguides",
        "langgraph_graph_versions",
        "langgraph_runs",
        "langgraph_node_events",
        "admin_audit_logs",
        "moderator_updatation",
        "case_followups",
        "nyaysahayak_bookings",
        "sexual_offense_call_confirmations",
    }
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                """
            )
            present = {row["table_name"] for row in cur.fetchall()}
    missing = sorted(expected - present)
    if missing:
        raise SystemExit(f"Missing tables: {', '.join(missing)}")
    print(f"Schema verification OK ({len(expected)} required tables present).")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--bootstrap-admin-email", default=os.getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@nyaysahayak.local"))
    parser.add_argument("--bootstrap-admin-password", default=os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "ChangeMeAdmin!"))
    parser.add_argument("--skip-bootstrap", action="store_true")
    args = parser.parse_args()
    if not args.database_url:
        raise SystemExit("DATABASE_URL is required")
    apply_migrations(args.database_url)
    verify_expected_tables(args.database_url)
    if not args.skip_bootstrap:
        bootstrap_admin(args.database_url, args.bootstrap_admin_email, args.bootstrap_admin_password)


if __name__ == "__main__":
    main()
