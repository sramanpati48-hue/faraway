#!/usr/bin/env python3
"""Entry point: python scripts/run_scam_classifier_worker.py"""
from backend.workers.scam_classifier_worker import main

if __name__ == "__main__":
    raise SystemExit(main())
