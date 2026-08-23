"""Generic admin table browser / SQL console over Postgres."""
from __future__ import annotations

import re
import time
from typing import Any, Optional

from backend.database.postgres_pool import connection, execute, execute_one, execute_void

IDENT = re.compile(r"^[a-z_][a-z0-9_]*$", re.I)
DEFAULT_SCHEMA = "public"
EXCLUDED_ADMIN_TABLES = {
    "admin_audit_logs",
    "refresh_tokens",
    "password_reset_codes",
    "auth_audit_events",
}
SENSITIVE_COLUMNS = {
    "password_hash",
    "token_hash",
    "code_hash",
    "refresh_token",
    "access_token",
}


class AdminDbError(Exception):
    pass


def quote_ident(name: str) -> str:
    if not IDENT.match(name):
        raise AdminDbError(f"Invalid identifier: {name}")
    return f'"{name}"'


def assert_mutable_table(table: str) -> None:
    if table in EXCLUDED_ADMIN_TABLES:
        raise AdminDbError(f'Table "{table}" is read-only in the admin UI.')


def list_tables(include_counts: bool = True) -> list[dict[str, Any]]:
    rows = execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = %s AND table_type = 'BASE TABLE'
        ORDER BY table_name
        """,
        (DEFAULT_SCHEMA,),
    )
    result = []
    for row in rows:
        name = row["table_name"]
        if name in EXCLUDED_ADMIN_TABLES:
            continue
        entry: dict[str, Any] = {"name": name, "row_count": None}
        if include_counts:
            try:
                count = execute_one(f"SELECT COUNT(*)::int AS count FROM {quote_ident(name)}")
                entry["row_count"] = int((count or {}).get("count") or 0)
            except Exception:
                entry["row_count"] = None
        result.append(entry)
    return result


def get_table_schema(table: str) -> dict[str, Any]:
    if not IDENT.match(table):
        raise AdminDbError(f"Invalid table: {table}")
    exists = execute_one(
        """
        SELECT 1 AS ok FROM information_schema.tables
        WHERE table_schema = %s AND table_name = %s AND table_type = 'BASE TABLE'
        """,
        (DEFAULT_SCHEMA, table),
    )
    if not exists:
        raise AdminDbError(f"Table not found: {table}")

    cols = execute(
        """
        SELECT column_name, data_type, udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ordinal_position
        """,
        (DEFAULT_SCHEMA, table),
    )
    pks = execute(
        """
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_schema = kcu.constraint_schema
         AND tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = %s
          AND tc.table_name = %s
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
        """,
        (DEFAULT_SCHEMA, table),
    )
    pk_set = {r["column_name"] for r in pks}
    columns = []
    for c in cols:
        columns.append(
            {
                "name": c["column_name"],
                "data_type": c["data_type"],
                "udt_name": c["udt_name"],
                "is_nullable": c["is_nullable"] == "YES",
                "column_default": c["column_default"],
                "is_primary_key": c["column_name"] in pk_set,
                "sensitive": c["column_name"] in SENSITIVE_COLUMNS,
            }
        )
    return {"table": table, "columns": columns, "primary_key": [r["column_name"] for r in pks]}


def _redact_row(row: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in row.items():
        if k in SENSITIVE_COLUMNS:
            out[k] = "<redacted>" if v is not None else None
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def fetch_rows(
    table: str,
    offset: int = 0,
    limit: int = 50,
    order_by: Optional[str] = None,
    order_dir: str = "asc",
) -> dict[str, Any]:
    schema = get_table_schema(table)
    columns = [c["name"] for c in schema["columns"]]
    limit = max(1, min(int(limit), 200))
    offset = max(0, int(offset))
    order_dir = "DESC" if str(order_dir).lower() == "desc" else "ASC"
    order_sql = ""
    if order_by:
        if order_by not in columns:
            raise AdminDbError(f"Invalid orderBy column: {order_by}")
        order_sql = f" ORDER BY {quote_ident(order_by)} {order_dir}"
    elif schema["primary_key"]:
        order_sql = f" ORDER BY {quote_ident(schema['primary_key'][0])} {order_dir}"

    total_row = execute_one(f"SELECT COUNT(*)::int AS count FROM {quote_ident(table)}")
    rows = execute(
        f"SELECT * FROM {quote_ident(table)}{order_sql} LIMIT %s OFFSET %s",
        (limit, offset),
    )
    return {
        "table": table,
        "columns": columns,
        "rows": [_redact_row(r) for r in rows],
        "total": int((total_row or {}).get("count") or 0),
        "offset": offset,
        "limit": limit,
    }


def insert_row(table: str, values: dict[str, Any], actor_id: Optional[str] = None) -> dict[str, Any]:
    assert_mutable_table(table)
    schema = get_table_schema(table)
    allowed = {c["name"] for c in schema["columns"] if c["name"] not in SENSITIVE_COLUMNS or c["name"] in values}
    cols = []
    params = []
    for k, v in values.items():
        if k not in allowed:
            continue
        if k in SENSITIVE_COLUMNS:
            raise AdminDbError(f"Cannot write sensitive column {k} via admin tables API")
        cols.append(k)
        params.append(v)
    if not cols:
        raise AdminDbError("No valid columns provided")
    sql = (
        f"INSERT INTO {quote_ident(table)} ({', '.join(quote_ident(c) for c in cols)}) "
        f"VALUES ({', '.join(['%s'] * len(cols))}) RETURNING *"
    )
    rows = execute(sql, params)
    _audit(actor_id, "insert", table, {"columns": cols})
    return _redact_row(rows[0]) if rows else {}


def update_row(table: str, pk: dict[str, Any], values: dict[str, Any], actor_id: Optional[str] = None) -> dict[str, Any]:
    assert_mutable_table(table)
    schema = get_table_schema(table)
    pk_cols = schema["primary_key"]
    if not pk_cols:
        raise AdminDbError("Table has no primary key")
    set_cols = []
    params: list[Any] = []
    for k, v in values.items():
        if k in pk_cols:
            continue
        if k in SENSITIVE_COLUMNS:
            raise AdminDbError(f"Cannot write sensitive column {k} via admin tables API")
        if not any(c["name"] == k for c in schema["columns"]):
            continue
        set_cols.append(f"{quote_ident(k)} = %s")
        params.append(v)
    if not set_cols:
        raise AdminDbError("No updatable columns provided")
    where = []
    for col in pk_cols:
        if col not in pk:
            raise AdminDbError(f"Missing primary key field: {col}")
        where.append(f"{quote_ident(col)} = %s")
        params.append(pk[col])
    sql = (
        f"UPDATE {quote_ident(table)} SET {', '.join(set_cols)} "
        f"WHERE {' AND '.join(where)} RETURNING *"
    )
    rows = execute(sql, params)
    if not rows:
        raise AdminDbError("Row not found")
    _audit(actor_id, "update", table, {"pk": pk})
    return _redact_row(rows[0])


def delete_row(table: str, pk: dict[str, Any], actor_id: Optional[str] = None) -> bool:
    assert_mutable_table(table)
    schema = get_table_schema(table)
    pk_cols = schema["primary_key"]
    if not pk_cols:
        raise AdminDbError("Table has no primary key")
    where = []
    params = []
    for col in pk_cols:
        if col not in pk:
            raise AdminDbError(f"Missing primary key field: {col}")
        where.append(f"{quote_ident(col)} = %s")
        params.append(pk[col])
    rows = execute(
        f"DELETE FROM {quote_ident(table)} WHERE {' AND '.join(where)} RETURNING *",
        params,
    )
    _audit(actor_id, "delete", table, {"pk": pk})
    return bool(rows)


def sql_connection_info() -> dict[str, Any]:
    row = execute_one("SELECT current_database() AS database, current_user AS user")
    return {
        "database": (row or {}).get("database"),
        "user": (row or {}).get("user"),
        "schema": DEFAULT_SCHEMA,
    }


def schema_catalog(
    *,
    table_filter: Optional[list[str]] = None,
    include_counts: bool = False,
) -> list[dict[str, Any]]:
    """Compact public schema catalog for NL→SQL (and admin UI)."""
    allowed: Optional[set[str]] = None
    if table_filter:
        allowed = set()
        for name in table_filter:
            n = (name or "").strip()
            if not n or not IDENT.match(n):
                continue
            if n in EXCLUDED_ADMIN_TABLES:
                continue
            allowed.add(n)
        if not allowed:
            return []

    rows = execute(
        """
        SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema
         AND t.table_name = c.table_name
        WHERE c.table_schema = %s
          AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name, c.ordinal_position
        """,
        (DEFAULT_SCHEMA,),
    )
    by_table: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        name = str(row.get("table_name") or "")
        if name in EXCLUDED_ADMIN_TABLES:
            continue
        if allowed is not None and name not in allowed:
            continue
        by_table.setdefault(name, []).append(
            {
                "name": row.get("column_name"),
                "data_type": row.get("udt_name") or row.get("data_type"),
                "nullable": (row.get("is_nullable") or "").upper() == "YES",
            }
        )

    catalog: list[dict[str, Any]] = []
    for name in sorted(by_table.keys()):
        entry: dict[str, Any] = {
            "name": name,
            "columns": by_table[name],
            "row_count": None,
        }
        if include_counts:
            try:
                count = execute_one(f"SELECT COUNT(*)::int AS count FROM {quote_ident(name)}")
                entry["row_count"] = int((count or {}).get("count") or 0)
            except Exception:
                entry["row_count"] = None
        catalog.append(entry)
    return catalog


def schema_catalog_prompt_text(
    *,
    table_filter: Optional[list[str]] = None,
    max_tables: int = 80,
) -> str:
    tables = schema_catalog(table_filter=table_filter, include_counts=False)[:max_tables]
    if not tables:
        return "(no public tables available)"
    lines: list[str] = []
    for t in tables:
        cols = ", ".join(
            f"{c['name']}:{c['data_type']}{'?' if c.get('nullable') else ''}"
            for c in (t.get("columns") or [])
        )
        lines.append(f"- {t['name']}({cols})")
    return "\n".join(lines)


def extract_sql_from_llm(text: str) -> str:
    """Pull SQL out of model output (markdown fences or bare SQL)."""
    raw = (text or "").strip()
    if not raw:
        return ""
    fence = re.search(r"```(?:sql)?\s*([\s\S]*?)```", raw, flags=re.IGNORECASE)
    if fence:
        return fence.group(1).strip()
    # Drop leading commentary lines until a SQL keyword.
    lines = raw.splitlines()
    start = 0
    for i, line in enumerate(lines):
        low = line.strip().lower()
        if low.startswith(
            ("select", "with", "insert", "update", "delete", "create", "alter", "drop", "explain", "show")
        ):
            start = i
            break
    return "\n".join(lines[start:]).strip()


def generate_sql_from_prompt(
    *,
    prompt: str,
    provider: str,
    model: str,
    tables: Optional[list[str]] = None,
) -> dict[str, Any]:
    """NL → Postgres SQL using the live schema catalog + selected LLM."""
    from langchain_core.messages import HumanMessage, SystemMessage

    from backend.utils import invoke_llm_with_selection

    description = (prompt or "").strip()
    if not description:
        raise AdminDbError("Describe the query you want")
    if len(description) > 4000:
        raise AdminDbError("Prompt too long (max 4000 characters)")

    schema_text = schema_catalog_prompt_text(table_filter=tables)
    system = SystemMessage(
        content=(
            "You are a Postgres SQL expert for the NyaySahayak admin console. "
            "Write a single SQL statement for schema public using ONLY the tables/columns listed. "
            "Prefer SELECT / WITH for analytics. Use PostgreSQL syntax. "
            "Do not invent tables or columns. Avoid DROP DATABASE / DROP SCHEMA. "
            "Return ONLY the SQL — no markdown, no commentary."
        )
    )
    human = HumanMessage(
        content=(
            f"DATABASE SCHEMA (public):\n{schema_text}\n\n"
            f"USER REQUEST:\n{description}\n\n"
            "SQL:"
        )
    )
    try:
        response = invoke_llm_with_selection(
            provider,
            model,
            [system, human],
            task_id="admin.sql_generation",
            temperature=0.1,
            max_tokens=2000,
        )
    except Exception as exc:  # noqa: BLE001
        raise AdminDbError(f"LLM failed: {exc}") from exc

    content = getattr(response, "content", "") or ""
    if isinstance(content, list):
        content = " ".join(
            str(p.get("text") if isinstance(p, dict) else p) for p in content
        )
    sql = extract_sql_from_llm(str(content))
    if not sql:
        raise AdminDbError("Model returned no SQL — try a clearer description")
    return {
        "sql": sql,
        "provider": provider,
        "model": model,
        "tables_used": tables or [t["name"] for t in schema_catalog(include_counts=False)[:80]],
        "raw": str(content)[:2000],
    }


def run_sql(sql: str, allow_write: bool = False, actor_id: Optional[str] = None) -> dict[str, Any]:
    text = (sql or "").strip()
    if not text:
        raise AdminDbError("SQL is empty")
    lowered = text.lower().lstrip()
    is_select = (
        lowered.startswith("select")
        or lowered.startswith("with")
        or lowered.startswith("show")
        or lowered.startswith("explain")
    )
    if not is_select and not allow_write:
        raise AdminDbError("Write SQL disabled. Enable allow_write explicitly.")
    forbidden = ("drop database", "drop schema", "truncate schema")
    if any(f in lowered for f in forbidden):
        raise AdminDbError("Destructive statement blocked")

    started = time.perf_counter()
    if is_select:
        rows = execute(text)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        _audit(actor_id, "sql", None, {"write": False, "preview": text[:200]})
        if not rows:
            return {
                "kind": "rows",
                "columns": [],
                "rows": [],
                "row_count": 0,
                "truncated": False,
                "execution_ms": elapsed_ms,
                "message": "0 rows",
            }
        columns = list(rows[0].keys())
        truncated = len(rows) > 500
        return {
            "kind": "rows",
            "columns": columns,
            "rows": [_redact_row(r) for r in rows[:500]],
            "row_count": len(rows[:500]),
            "truncated": truncated,
            "execution_ms": elapsed_ms,
            "message": f"{min(len(rows), 500)} rows" + (" (truncated)" if truncated else ""),
        }

    # Write / DDL path
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(text)
            rowcount = int(cur.rowcount or 0)
            conn.commit()
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    _audit(actor_id, "sql", None, {"write": True, "preview": text[:200]})
    return {
        "kind": "command",
        "columns": [],
        "rows": [],
        "row_count": rowcount,
        "rowcount": rowcount,
        "truncated": False,
        "execution_ms": elapsed_ms,
        "message": f"Command completed ({rowcount} rows affected).",
    }


def _audit(actor_id: Optional[str], action: str, target_table: Optional[str], detail: dict) -> None:
    try:
        import json

        execute_void(
            """
            INSERT INTO admin_audit_logs (actor_user_id, action, target_table, detail)
            VALUES (%s, %s, %s, %s::jsonb)
            """,
            (actor_id, action, target_table, json.dumps(detail, default=str)),
        )
    except Exception:
        pass
