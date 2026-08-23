"""
Internal Webhook Poller for intervention / sahayak case tables.

Polls pending rows and broadcasts them to connected moderators and sahayaks via WebSocket.
Works with both Postgres and legacy Supabase through the supabase_db facade.
"""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from typing import Optional

from backend.database import supabase_db
from backend.websocket_manager import manager

logger = logging.getLogger(__name__)

# ── Cross-process lock ─────────────────────────────────────────────────────
_LOCK_FILE = "/tmp/nyaysahayak_poller.lock"
_lock_fd = None


def _acquire_poller_lock() -> bool:
    """Try to grab the exclusive poller lock. Returns True only in the winning process."""
    global _lock_fd
    if sys.platform == "win32":
        return True  # Windows dev — single worker, always run
    try:
        import fcntl

        _lock_fd = open(_LOCK_FILE, "w")
        fcntl.flock(_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _lock_fd.write(str(os.getpid()))
        _lock_fd.flush()
        return True
    except (IOError, OSError):
        return False


def _db_ready() -> bool:
    backend = getattr(supabase_db, "BACKEND", None)
    if backend == "postgres":
        return True
    client = getattr(supabase_db, "supabase", None)
    return bool(client) and client is not True


class WebhookPoller:
    def __init__(self):
        self.last_intervention_check: Optional[datetime] = None
        self.last_sahayak_check: Optional[datetime] = None
        self.processed_interventions: set = set()
        self.processed_sahayak_cases: set = set()
        self.poll_interval: int = 15
        self.running: bool = False

    async def start(self):
        """Start the polling loop — only runs in the process that wins the file lock."""
        if self.running:
            logger.warning("Webhook poller already running")
            return

        if not _acquire_poller_lock():
            logger.info(
                f"⏭️  Webhook poller skipped (another worker is already polling) PID={os.getpid()}"
            )
            return

        self.running = True
        logger.info(f"🔄 Starting Webhook Poller in PID={os.getpid()}...")

        try:
            await self._polling_loop()
        except Exception as e:
            logger.error(f"❌ Webhook poller error: {e}")
            self.running = False

    async def stop(self):
        """Stop the polling loop"""
        self.running = False
        logger.info("🛑 Stopping Webhook Poller...")

    async def _polling_loop(self):
        """Main polling loop - checks tables periodically"""
        while self.running:
            try:
                await asyncio.gather(
                    self._check_interventions(),
                    self._check_sahayak_cases(),
                    return_exceptions=True,
                )
                await asyncio.sleep(self.poll_interval)
            except Exception as e:
                logger.error(f"Error in polling loop: {e}")
                await asyncio.sleep(self.poll_interval)

    async def _check_interventions(self):
        """Check for new pending interventions"""
        if not _db_ready():
            logger.warning("Database not ready for intervention polling")
            return

        try:
            cases = await asyncio.to_thread(supabase_db.list_pending_intervention_rows, 50)

            for case in cases:
                case_id = case.get("id")
                if not case_id or case_id in self.processed_interventions:
                    continue

                self.processed_interventions.add(case_id)

                s_report = case.get("structured_report") or {}
                if isinstance(s_report, str):
                    try:
                        s_report = json.loads(s_report)
                    except Exception:
                        s_report = {}

                case_data = {
                    "type": "new_intervention",
                    "case_id": case_id,
                    "user_id": case.get("user_id"),
                    "incident_type": s_report.get("incident_type", "Unknown"),
                    "risk_level": s_report.get("risk_level", "High"),
                    "structured_report": s_report,
                    "collection": case.get("collection_name") or "moderator",
                    "created_at": str(case.get("created_at") or ""),
                    "session_id": case.get("session_id"),
                    "user_statement": case.get("user_statement", ""),
                    "location": case.get("location", {}) or {},
                    "routing_recommendation": supabase_db.get_intervention_routing_recommendation(
                        s_report,
                        case.get("user_statement", ""),
                        case.get("location", {}) or {},
                    ),
                }

                await manager.broadcast(json.dumps(case_data, default=str), channel="moderator")
                logger.info(f"📢 New intervention broadcast: {case_id}")

        except Exception as e:
            logger.error(f"Error checking interventions: {e}")

    async def _check_sahayak_cases(self):
        """Check for new pending sahayak cases"""
        if not _db_ready():
            logger.warning("Database not ready for sahayak polling")
            return

        try:
            cases = await asyncio.to_thread(supabase_db.list_pending_sahayak_case_rows, 50)

            for case in cases:
                case_id = case.get("id")
                if not case_id or case_id in self.processed_sahayak_cases:
                    continue

                self.processed_sahayak_cases.add(case_id)

                s_report = case.get("structured_report") or {}
                if isinstance(s_report, str):
                    try:
                        s_report = json.loads(s_report)
                    except Exception:
                        s_report = {}

                case_data = {
                    "type": "new_sahayak_case",
                    "case_id": case_id,
                    "user_id": case.get("user_id"),
                    "user_name": case.get("user_name", ""),
                    "incident_type": s_report.get("incident_type", "Unknown"),
                    "risk_level": s_report.get("risk_level", "High"),
                    "summary": s_report.get("summary", ""),
                    "structured_report": s_report,
                    "created_at": str(case.get("created_at") or ""),
                    "session_id": case.get("session_id"),
                }

                await manager.broadcast(json.dumps(case_data, default=str), channel="sahayak")
                logger.info(f"📢 New sahayak case broadcast: {case_id}")

        except Exception as e:
            logger.error(f"Error checking sahayak cases: {e}")

    async def reset_tracking(self):
        """Reset processed case tracking (useful for recovery)"""
        self.processed_interventions.clear()
        self.processed_sahayak_cases.clear()
        logger.info("🔄 Reset case tracking")


poller = WebhookPoller()
