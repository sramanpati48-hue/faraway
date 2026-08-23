"""Durable LangGraph checkpointer (Postgres pool) with MemorySaver fallback.

Uses a ConnectionPool instead of a single long-lived connection so idle
timeouts / Cloud SQL / PgBouncer closes do not break chat mid-turn with
"the connection is closed".

Sync PostgresSaver does not implement async APIs used by astream / astream_events.
We bind async wrappers onto the saver instance so isinstance(... BaseCheckpointSaver) still holds.
"""
from __future__ import annotations

import asyncio
import os
import types
from typing import Any, Optional

from dotenv import load_dotenv

load_dotenv()

_checkpointer: Any = None
_pool: Any = None


def _is_closed_connection_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "connection is closed" in msg
        or "server closed the connection" in msg
        or "connection not open" in msg
        or "ssl connection has been closed" in msg
    )


def _pool_check(conn: Any) -> None:
    """Evict dead connections before checkout."""
    conn.execute("SELECT 1")


def _attach_async_methods(saver: Any) -> Any:
    """Add async checkpoint APIs that LangGraph astream expects, with one retry on stale DB links."""

    def _call_with_retry(fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            if not _is_closed_connection_error(exc):
                raise
            # Pool should replace bad conns on next checkout; retry once.
            return fn(*args, **kwargs)

    async def aget_tuple(self, config):
        return await asyncio.to_thread(_call_with_retry, self.get_tuple, config)

    async def aget(self, config):
        tuple_ = await self.aget_tuple(config)
        return tuple_.checkpoint if tuple_ else None

    async def alist(self, config, *, filter=None, before=None, limit=None):
        items = await asyncio.to_thread(
            lambda: list(
                _call_with_retry(
                    self.list, config, filter=filter, before=before, limit=limit
                )
            )
        )
        for item in items:
            yield item

    async def aput(self, config, checkpoint, metadata, new_versions):
        return await asyncio.to_thread(
            _call_with_retry, self.put, config, checkpoint, metadata, new_versions
        )

    async def aput_writes(self, config, writes, task_id, task_path: str = ""):
        await asyncio.to_thread(
            _call_with_retry, self.put_writes, config, writes, task_id, task_path
        )

    async def adelete_thread(self, thread_id: str) -> None:
        delete = getattr(self, "delete_thread", None)
        if delete:
            await asyncio.to_thread(_call_with_retry, delete, thread_id)

    saver.aget_tuple = types.MethodType(aget_tuple, saver)
    saver.aget = types.MethodType(aget, saver)
    saver.alist = types.MethodType(alist, saver)
    saver.aput = types.MethodType(aput, saver)
    saver.aput_writes = types.MethodType(aput_writes, saver)
    saver.adelete_thread = types.MethodType(adelete_thread, saver)
    return saver


def build_checkpointer() -> Any:
    """Return a process-wide singleton checkpointer backed by a Postgres pool when possible."""
    global _checkpointer, _pool
    if _checkpointer is not None:
        return _checkpointer

    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if database_url:
        try:
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool
            from langgraph.checkpoint.postgres import PostgresSaver

            max_size = max(1, int(os.getenv("LG_CHECKPOINT_POOL_MAX", "5")))
            min_size = max(1, min(max_size, int(os.getenv("LG_CHECKPOINT_POOL_MIN", "1"))))
            timeout = float(os.getenv("LG_CHECKPOINT_POOL_TIMEOUT", "3.0"))
            _pool = ConnectionPool(
                conninfo=database_url,
                min_size=min_size,
                max_size=max_size,
                timeout=timeout,
                kwargs={
                    "autocommit": True,
                    # Required for PgBouncer / Cloud SQL poolers.
                    "prepare_threshold": None,
                    "row_factory": dict_row,
                    "connect_timeout": int(os.getenv("PG_CONNECT_TIMEOUT", "2")),
                },
                check=_pool_check,
                open=True,
            )
            saver = PostgresSaver(_pool)
            saver.setup()
            _checkpointer = _attach_async_methods(saver)
            print("[ok] Using Postgres LangGraph checkpointer (pooled, async-compatible)")
            return _checkpointer
        except Exception as e:
            print(f"[warn] Postgres checkpointer unavailable, falling back to MemorySaver: {e}")
            try:
                if _pool is not None:
                    _pool.close()
            except Exception:
                pass
            _pool = None

    from langgraph.checkpoint.memory import MemorySaver

    print("[info] Using in-memory LangGraph checkpointer")
    _checkpointer = MemorySaver()
    return _checkpointer


def thread_has_checkpoint(thread_id: str) -> bool:
    """True when this LangGraph thread already has persisted state."""
    tid = (thread_id or "").strip()
    if not tid:
        return False
    try:
        saver = build_checkpointer()
        get_tuple = getattr(saver, "get_tuple", None)
        if not callable(get_tuple):
            return False
        tup = get_tuple({"configurable": {"thread_id": tid}})
        return tup is not None
    except Exception:
        return False


def reset_checkpointer_for_tests() -> None:
    """Clear singleton (tests / reload helpers)."""
    global _checkpointer, _pool
    _checkpointer = None
    if _pool is not None:
        try:
            _pool.close()
        except Exception:
            pass
    _pool = None
