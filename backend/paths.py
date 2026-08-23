"""Canonical filesystem roots for the backend package."""
from __future__ import annotations

from pathlib import Path

# backend/paths.py → backend/ → repo root
BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
