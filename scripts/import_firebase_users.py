#!/usr/bin/env python3
"""Import Firebase/legacy user profiles into Postgres as password_reset_required accounts."""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from backend.database.auth_service import import_firebase_user


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", help="JSON array file with {firebase_uid|uid, email, role}")
    parser.add_argument("--csv", help="CSV with columns firebase_uid,email,role")
    args = parser.parse_args()
    if not os.getenv("DATABASE_URL"):
        raise SystemExit("DATABASE_URL required")

    rows = []
    if args.json:
        rows = json.loads(Path(args.json).read_text(encoding="utf-8"))
    elif args.csv:
        with open(args.csv, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
    else:
        raise SystemExit("Provide --json or --csv")

    imported = 0
    for row in rows:
        uid = row.get("firebase_uid") or row.get("uid")
        if not uid:
            continue
        user = import_firebase_user(str(uid), row.get("email"), row.get("role") or "victim")
        print(f"imported {user['id']} uid={uid} role={user['role']}")
        imported += 1
    print(f"Done. Imported/updated {imported} users (password_reset_required).")


if __name__ == "__main__":
    main()
