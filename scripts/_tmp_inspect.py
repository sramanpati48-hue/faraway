import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from backend.database.postgres_pool import execute

for table in ("case_assignments", "case_followups", "moderator_updatation", "nyaysahayak_bookings"):
    rows = execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=%s ORDER BY ordinal_position",
        (table,),
    )
    print(table, "->", [r["column_name"] for r in rows])
