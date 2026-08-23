"""Idempotent Supabase reference-data seeder for NyaySahayak.

Seeds Clash mock cases and core lookup tables when empty or stale.
Safe to re-run — uses upsert / skip-if-populated checks.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[1]
SEED_DIR = Path(__file__).resolve().parent / "seed_data"
sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")


def _client():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _count(client, table: str) -> int:
    res = client.table(table).select("*", count="exact", head=True).execute()
    return int(res.count or 0)


def _load_json(name: str):
    path = SEED_DIR / name
    if not path.exists():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"))


def seed_clash_mock_cases(client) -> int:
    cases = json.loads((ROOT / "data" / "clash_mock_cases.json").read_text(encoding="utf-8"))
    rows = [
        {
            "id": c["id"],
            "title": c["title"],
            "summary": c["summary"],
            "facts": c["facts"],
            "tags": c.get("tags", []),
            "active": True,
        }
        for c in cases
    ]
    client.table("clash_mock_cases").upsert(rows, on_conflict="id").execute()
    return len(rows)


def seed_if_empty(client, table: str, rows: list[dict], on_conflict: str | None = None) -> int:
    if _count(client, table) > 0:
        print(f"  skip {table}: already has data")
        return 0
    if on_conflict:
        client.table(table).upsert(rows, on_conflict=on_conflict).execute()
    else:
        client.table(table).insert(rows).execute()
    print(f"  seeded {table}: {len(rows)} rows")
    return len(rows)


def main() -> None:
    client = _client()
    print("Seeding Supabase reference data…")

    clash_count = seed_clash_mock_cases(client)
    print(f"  upsert clash_mock_cases: {clash_count} rows")

    seed_if_empty(client, "routing_rules", _load_json("routing_rules.json"))
    seed_if_empty(client, "nodal_guides", _load_json("nodal_guides.json"))
    seed_if_empty(
        client,
        "sahayak_profiles",
        _load_json("sahayak_profiles.json"),
        on_conflict="uid",
    )
    seed_if_empty(client, "female_nyayguides", _load_json("female_nyayguides.json"))
    seed_if_empty(client, "female_lawyers", _load_json("female_lawyers.json"))

    print("Done.")


if __name__ == "__main__":
    main()
