"""
Data access facade.

When DATABASE_URL is set (and DB_BACKEND is not forced to supabase), all public
APIs are served from Postgres. Otherwise the legacy Supabase client is used.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

from backend.database.postgres_pool import is_postgres_configured

_backend = (os.getenv("DB_BACKEND") or "").strip().lower()
if not _backend:
    _backend = "postgres" if is_postgres_configured() else "supabase"

if _backend == "postgres" and is_postgres_configured():
    from backend.database.postgres_db import *  # noqa: F401,F403
    BACKEND = "postgres"
else:
    from backend.database.supabase_legacy import *  # noqa: F401,F403
    BACKEND = "supabase"
