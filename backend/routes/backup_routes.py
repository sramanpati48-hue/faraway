import asyncio
import os
import time
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, status
from backend.services.db_backup_service import backup_database

router = APIRouter(tags=["Internal Backup"])

_backup_lock = asyncio.Lock()
_last_backup_start = 0.0
_last_backup_result = None

async def _run_backup_safely():
    global _last_backup_start, _last_backup_result
    async with _backup_lock:
        _last_backup_start = time.time()
        try:
            res = await backup_database()
            _last_backup_result = res
            return res
        except Exception as exc:
            _last_backup_result = {"success": False, "error": str(exc)}
            return _last_backup_result


def verify_cron_secret(
    x_cron_secret: Optional[str] = Header(None, alias="X-Cron-Secret"),
    secret_param: Optional[str] = Query(None, alias="secret"),
    key_param: Optional[str] = Query(None, alias="key"),
    token_param: Optional[str] = Query(None, alias="token"),
) -> None:
    try:
        from backend.services.admin_models import read_config_key
        db_cfg = read_config_key("backup_config", {})
    except Exception:
        db_cfg = {}

    expected_secret = (
        db_cfg.get("cron_secret")
        or db_cfg.get("CRON_SECRET")
        or os.getenv("CRON_SECRET", "super-secret")
    ).strip()

    provided_secret = x_cron_secret or secret_param or key_param or token_param

    if not provided_secret or provided_secret != expected_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Invalid or missing X-Cron-Secret header or secret query parameter",
        )


@router.post("/api/internal/backup")
@router.post("/internal/backup")
@router.post("/api/cron/backup")
@router.post("/cron/backup")
@router.post("/api/cron/db-backup")
@router.post("/cron/db-backup")
@router.post("/api/cron/db-dump")
@router.post("/cron/db-dump")
@router.post("/api/cron/nyay-sahyak-db-dump")
@router.post("/cron/nyay-sahyak-db-dump")
@router.post("/api/backup")
@router.post("/backup")
@router.get("/api/internal/backup")
@router.get("/internal/backup")
@router.get("/api/cron/backup")
@router.get("/cron/backup")
@router.get("/api/cron/db-backup")
@router.get("/cron/db-backup")
@router.get("/api/cron/db-dump")
@router.get("/cron/db-dump")
@router.get("/api/cron/nyay-sahyak-db-dump")
@router.get("/cron/nyay-sahyak-db-dump")
@router.get("/api/backup")
@router.get("/backup")
@router.head("/api/internal/backup")
@router.head("/internal/backup")
@router.head("/api/cron/backup")
@router.head("/cron/backup")
@router.head("/api/cron/db-backup")
@router.head("/cron/db-backup")
@router.head("/api/cron/db-dump")
@router.head("/cron/db-dump")
@router.head("/api/cron/nyay-sahyak-db-dump")
@router.head("/cron/nyay-sahyak-db-dump")
@router.head("/api/backup")
@router.head("/backup")
async def trigger_backup(
    background_tasks: BackgroundTasks,
    x_cron_secret: Optional[str] = Header(None, alias="X-Cron-Secret"),
    secret: Optional[str] = Query(None),
    key: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    sync: bool = Query(False),
):
    """Trigger an automated database backup, gzip compression, and multi-cloud delivery (Google Drive, GitHub, Discord)."""
    verify_cron_secret(x_cron_secret=x_cron_secret, secret_param=secret, key_param=key, token_param=token)

    now = time.time()

    # Deduplicate: if a backup is currently running or ran in the last 120 seconds, skip duplicate execution
    if _backup_lock.locked():
        return {
            "success": True,
            "message": "Backup is currently running in background",
            "status": "in_progress",
        }

    if (now - _last_backup_start) < 120:
        return {
            "success": True,
            "message": "Backup executed recently (cooldown active)",
            "status": "cached",
            "last_result": _last_backup_result,
        }

    if sync:
        try:
            result = await _run_backup_safely()
            return {
                "success": True,
                "result": result,
            }
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Backup process failed: {str(exc)}",
            ) from exc

    # Dispatch background execution for fast HTTP response (<50ms) to satisfy cron monitors
    background_tasks.add_task(_run_backup_safely)
    return {
        "success": True,
        "message": "Database backup initiated in background",
        "status": "processing",
    }


