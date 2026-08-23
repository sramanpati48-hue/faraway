"""Deprecated: use the unified worker instead.

    python -m backend.workers.background_worker

Kept as a thin alias so existing commands / systemd units keep working. The
unified worker processes BOTH scam-trends and case-clustering jobs, so you only
ever need one worker process.
"""
from __future__ import annotations

from backend.workers.background_worker import main

if __name__ == "__main__":
    raise SystemExit(main())
