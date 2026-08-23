"""PostgreSQL connection pool for NyaySahayak."""
from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from typing import Any, Iterator, Optional

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
_pool = None
_pool_lock = threading.Lock()


class DbConnectionError(RuntimeError):
    pass


def is_postgres_configured() -> bool:
    return bool(DATABASE_URL)


def get_pool():
    global _pool
    if not DATABASE_URL:
        raise DbConnectionError("DATABASE_URL is not configured")
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is not None:
            return _pool
        try:
            from psycopg_pool import ConnectionPool
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise DbConnectionError(
                "psycopg and psycopg_pool are required. pip install 'psycopg[binary]' psycopg_pool"
            ) from exc

        timeout = float(os.getenv("PG_POOL_TIMEOUT", "15.0"))
        connect_timeout = int(os.getenv("PG_CONNECT_TIMEOUT", "10"))
        _pool = ConnectionPool(
            conninfo=DATABASE_URL,
            min_size=int(os.getenv("PG_POOL_MIN", "1")),
            max_size=int(os.getenv("PG_POOL_MAX", "10")),
            timeout=timeout,
            kwargs={
                "row_factory": dict_row,
                "autocommit": False,
                "connect_timeout": connect_timeout,
            },
            open=True,
        )
        return _pool


@contextmanager
def connection() -> Iterator[Any]:
    pool = get_pool()
    with pool.connection() as conn:
        yield conn


def execute(sql: str, params: Optional[tuple | list | dict] = None) -> list[dict[str, Any]]:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            if cur.description is None:
                conn.commit()
                return []
            rows = list(cur.fetchall())
            conn.commit()
            return rows


def execute_one(sql: str, params: Optional[tuple | list | dict] = None) -> Optional[dict[str, Any]]:
    rows = execute(sql, params)
    return rows[0] if rows else None


def execute_void(sql: str, params: Optional[tuple | list | dict] = None) -> None:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            conn.commit()


def check_database_connection() -> dict[str, Any]:
    row = execute_one("SELECT current_database() AS database, current_user AS user, now() AS now")
    return row or {}


def close_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.close()
            except Exception:
                pass
            _pool = None
