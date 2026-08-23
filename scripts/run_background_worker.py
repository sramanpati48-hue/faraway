#!/usr/bin/env python3
"""Entry point: python scripts/run_background_worker.py

Unified worker for scam-trends scraping AND case clustering.
"""
from backend.workers.background_worker import main

if __name__ == "__main__":
    raise SystemExit(main())
