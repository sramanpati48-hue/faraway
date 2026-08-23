#!/usr/bin/env python3
"""Re-embed lawyer rows that are missing a pgvector embedding.

Targets whichever database ``DATABASE_URL`` points to. Useful after a bulk
lawyer seed where embedding calls failed (e.g. console encoding errors).

Usage:
    python scripts/reembed_lawyers.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from backend.database.postgres_pool import execute, is_postgres_configured  # noqa: E402


def main() -> None:
    if not is_postgres_configured():
        print("ERROR: DATABASE_URL not configured.")
        sys.exit(1)

    from backend.database.vector_db import VectorDB

    rows = execute("SELECT user_id, id, bio FROM public.lawyers WHERE embedding IS NULL")
    print(f"Lawyers missing embedding: {len(rows)}")
    v = VectorDB()
    done = 0
    for r in rows:
        lid = r.get("user_id") or r.get("id")
        if not lid:
            continue
        try:
            v.add_lawyer(lawyer_id=lid, bio=(r.get("bio") or ""))
            done += 1
        except Exception as e:  # noqa: BLE001
            print(f"  ! failed for {lid}: {e}")
    print(f"Re-embedded {done} lawyers.")


if __name__ == "__main__":
    main()
