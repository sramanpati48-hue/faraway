#!/usr/bin/env python3
import os
import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row
from supabase import create_client

load_dotenv()

TABLES = [
    "users",
    "chat_history",
    "cases",
    "interventions",
    "sahayak_cases",
    "sahayak_profiles",
    "lawyers",
    "mock_scams",
    "legal_documents",
    "clash_mock_cases",
    "nodal_guides",
    "routing_rules",
    "female_lawyers",
    "female_nyayguides",
]


def main() -> None:
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_KEY"],
    )
    with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
        cur = conn.cursor()
        print(f"{'table':22} {'supabase':>10} {'postgres':>10}")
        for t in TABLES:
            sc = sb.table(t).select("*", count="exact", head=True).execute().count or 0
            cur.execute(f"SELECT COUNT(*) AS c FROM {t}")
            pc = cur.fetchone()["c"]
            flag = "OK" if pc == sc or (t == "users" and pc >= sc) else "DIFF"
            print(f"{t:22} {sc:10} {pc:10} {flag}")


if __name__ == "__main__":
    main()
