#!/usr/bin/env python3
"""Smoke verification for Postgres cutover: schema, auth, admin APIs shape, graph registry."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")


def main() -> None:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL required")

    from backend.database.postgres_pool import check_database_connection, close_pool, execute
    from backend.database.auth_service import login
    from backend.services import admin_db
    from backend.services.graph_registry import list_registered_graphs

    print("DB:", check_database_connection())
    tables = {r["name"] for r in admin_db.list_tables(include_counts=False)}
    for required in ("users", "cases", "langgraph_runs", "legal_documents"):
        assert required in tables, required
    print(f"Tables OK ({len(tables)})")

    email = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@nyaysahayak.local")
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "ChangeMeAdmin!")
    tokens = login(email, password)
    assert tokens.get("access_token")
    print("Admin login OK", tokens["user"]["role"])

    graphs = list_registered_graphs(refresh=True)
    for g in graphs:
        if g.get("error"):
            print("Graph warning:", g.get("graph_id"), g.get("error"))
        else:
            topo = g.get("topology") or {}
            print(
                "Graph OK:",
                g.get("graph_id"),
                "nodes=",
                topo.get("node_count"),
                "edges=",
                topo.get("edge_count"),
                "orphans=",
                topo.get("orphans"),
            )

    rows = execute("SELECT COUNT(*)::int AS c FROM langgraph_query_presets")
    print("Presets:", rows[0]["c"])
    close_pool()
    print("Cutover verification complete.")


if __name__ == "__main__":
    main()
