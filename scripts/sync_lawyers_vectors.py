"""Re-embed lawyer profiles into Postgres pgvector via Nyaysahayak embedding API."""
from __future__ import annotations

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

from backend.database.postgres_pool import execute, is_postgres_configured
from backend.database.vector_db import VectorDB


def sync_lawyers():
    if not is_postgres_configured():
        print("❌ DATABASE_URL not configured.")
        return

    vdb = VectorDB()
    rows = execute(
        """
        SELECT id, user_id, name, specialization, COALESCE(bio, '') AS bio
        FROM public.lawyers
        """
    )
    print(f"🔄 Embedding {len(rows)} lawyers into Postgres…")
    count = 0
    for row in rows:
        lawyer_id = row.get("user_id") or row.get("id")
        name = row.get("name") or "Unknown"
        specialization = row.get("specialization") or "General"
        bio = row.get("bio") or ""
        rich_text = f"Lawyer: {name}. Specialization: {specialization}. Bio: {bio}"
        print(f"Index -> [{lawyer_id}] {name}")
        vdb.add_lawyer(
            str(lawyer_id),
            rich_text,
            {
                "name": name,
                "specialization": specialization,
            },
        )
        count += 1
    print(f"✅ Successfully synced {count} lawyers to Postgres pgvector.")


if __name__ == "__main__":
    sync_lawyers()
