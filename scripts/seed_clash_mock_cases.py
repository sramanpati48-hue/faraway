"""Seed Clash Mode practice cases into Supabase (idempotent)."""
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
MOCK_CASES_PATH = ROOT / "data" / "clash_mock_cases.json"


def seed_clash_mock_cases() -> int:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")

    if not MOCK_CASES_PATH.exists():
        raise FileNotFoundError(f"Missing mock cases file: {MOCK_CASES_PATH}")

    cases = json.loads(MOCK_CASES_PATH.read_text(encoding="utf-8"))
    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    rows = [
        {
            "id": case["id"],
            "title": case["title"],
            "summary": case["summary"],
            "facts": case["facts"],
            "tags": case.get("tags", []),
            "active": True,
        }
        for case in cases
    ]

    client.table("clash_mock_cases").upsert(rows, on_conflict="id").execute()
    return len(rows)


if __name__ == "__main__":
    count = seed_clash_mock_cases()
    print(f"Seeded {count} clash mock cases into Supabase.")
