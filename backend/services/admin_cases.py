"""Admin user → cases browse APIs (paginated search/filter).

Role-aware listings:
  victim / default → public.cases owned by the user
  lawyer           → public.lawyer_cases assigned to the user
  sahayak          → public.sahayak_cases assigned to the user
  moderator        → public.interventions (moderator queue)
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from backend.database.postgres_pool import execute, execute_one, is_postgres_configured

ROLE_VICTIM = "victim"
ROLE_LAWYER = "lawyer"
ROLE_SAHAYAK = "sahayak"
ROLE_MODERATOR = "moderator"

SOURCE_VICTIM = "victim_case"
SOURCE_LAWYER = "lawyer_case"
SOURCE_SAHAYAK = "sahayak_case"
SOURCE_INTERVENTION = "intervention"


def _iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    return value


def _serialize(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {k: _iso(v) for k, v in row.items()}


def _user_ids(user: dict[str, Any]) -> list[str]:
    ids = [str(user["id"])]
    if user.get("firebase_uid"):
        ids.append(str(user["firebase_uid"]))
    return ids


def _case_scope(role: Optional[str]) -> str:
    r = (role or ROLE_VICTIM).lower()
    if r == ROLE_LAWYER:
        return SOURCE_LAWYER
    if r == ROLE_SAHAYAK:
        return SOURCE_SAHAYAK
    if r == ROLE_MODERATOR:
        return SOURCE_INTERVENTION
    return SOURCE_VICTIM


def _preview_sql(alias: str = "t") -> str:
    return f"""COALESCE(
      {alias}.structured_report->>'incident_type',
      ''
    ) AS incident_type,
    COALESCE(
      {alias}.structured_report->>'summary',
      {alias}.structured_report->>'incident_summary',
      LEFT(COALESCE({alias}.structured_report->>'raw_text', {alias}.structured_report->>'user_statement', ''), 160),
      ''
    ) AS summary_preview"""


def _victim_case_count_sql(alias_users: str = "u") -> str:
    return f"""(
      SELECT COUNT(*)::int FROM public.cases c
      WHERE c.user_id = {alias_users}.id::text
         OR ({alias_users}.firebase_uid IS NOT NULL AND c.user_id = {alias_users}.firebase_uid)
    )"""


def _lawyer_case_count_sql(alias_users: str = "u") -> str:
    return f"""(
      SELECT COUNT(*)::int FROM public.lawyer_cases lc
      WHERE lc.assigned_lawyer_id = {alias_users}.id::text
         OR ({alias_users}.firebase_uid IS NOT NULL AND lc.assigned_lawyer_id = {alias_users}.firebase_uid)
         OR lc.assigned_lawyer_id IN (
              SELECT l.id FROM public.lawyers l
              WHERE l.user_id = {alias_users}.id::text
                 OR ({alias_users}.firebase_uid IS NOT NULL AND l.user_id = {alias_users}.firebase_uid)
            )
    )"""


def _sahayak_case_count_sql(alias_users: str = "u") -> str:
    return f"""(
      SELECT COUNT(*)::int FROM public.sahayak_cases sc
      WHERE sc.assigned_sahayak_id = {alias_users}.id::text
         OR ({alias_users}.firebase_uid IS NOT NULL AND sc.assigned_sahayak_id = {alias_users}.firebase_uid)
    )"""


def _moderator_case_count_sql() -> str:
    # Shared moderator queue — count all moderator interventions for the badge.
    return """(
      SELECT COUNT(*)::int FROM public.interventions i
      WHERE COALESCE(i.collection_name, 'moderator') = 'moderator'
    )"""


def _role_case_count_expr(alias_users: str = "u") -> str:
    return f"""CASE LOWER(COALESCE({alias_users}.role, 'victim'))
      WHEN 'lawyer' THEN {_lawyer_case_count_sql(alias_users)}
      WHEN 'sahayak' THEN {_sahayak_case_count_sql(alias_users)}
      WHEN 'moderator' THEN {_moderator_case_count_sql()}
      ELSE {_victim_case_count_sql(alias_users)}
    END"""


def list_users(
    *,
    q: str = "",
    role: Optional[str] = None,
    status: Optional[str] = None,
    has_cases: Optional[bool] = None,
    offset: int = 0,
    limit: int = 25,
) -> dict[str, Any]:
    if not is_postgres_configured():
        return {"users": [], "total": 0, "offset": 0, "limit": limit}

    offset = max(0, offset)
    limit = max(1, min(100, limit))
    q = (q or "").strip()

    where = ["TRUE"]
    params: list[Any] = []

    if q:
        where.append(
            """(
              u.email ILIKE %s
              OR u.mobile ILIKE %s
              OR u.display_name ILIKE %s
              OR u.id::text ILIKE %s
              OR COALESCE(u.firebase_uid, '') ILIKE %s
            )"""
        )
        like = f"%{q}%"
        params.extend([like, like, like, like, like])

    if role:
        where.append("u.role = %s")
        params.append(role)

    if status:
        where.append("u.status = %s")
        params.append(status)

    case_count_expr = _role_case_count_expr("u")

    if has_cases is True:
        where.append(f"({case_count_expr}) > 0")
    elif has_cases is False:
        where.append(f"({case_count_expr}) = 0")

    where_sql = " AND ".join(where)

    total_row = execute_one(
        f"SELECT COUNT(*)::int AS total FROM public.users u WHERE {where_sql}",
        tuple(params),
    )
    total = int((total_row or {}).get("total") or 0)

    rows = execute(
        f"""
        SELECT
          u.id,
          u.email,
          u.mobile,
          u.display_name,
          u.role,
          u.status,
          u.firebase_uid,
          u.password_reset_required,
          u.failed_login_attempts,
          u.locked_until,
          u.created_at,
          u.updated_at,
          ({case_count_expr}) AS case_count
        FROM public.users u
        WHERE {where_sql}
        ORDER BY u.created_at DESC NULLS LAST, u.id
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )

    users = []
    for row in rows:
        item = _serialize(row) or {}
        item["case_count"] = int(item.get("case_count") or 0)
        item["case_scope"] = _case_scope(item.get("role"))
        users.append(item)

    return {"users": users, "total": total, "offset": offset, "limit": limit}


def get_user(user_id: str) -> dict[str, Any] | None:
    if not is_postgres_configured() or not user_id:
        return None
    row = execute_one(
        """
        SELECT id, email, mobile, display_name, role, status, firebase_uid,
               password_reset_required, failed_login_attempts, locked_until,
               created_at, updated_at
        FROM public.users
        WHERE id::text = %s OR firebase_uid = %s
        LIMIT 1
        """,
        (user_id, user_id),
    )
    item = _serialize(row)
    if item:
        item["case_scope"] = _case_scope(item.get("role"))
    return item


def _lawyer_assignee_ids(user: dict[str, Any]) -> list[str]:
    ids = _user_ids(user)
    lawyer_rows = execute(
        """
        SELECT id FROM public.lawyers
        WHERE user_id = ANY(%s)
        """,
        (ids,),
    )
    for r in lawyer_rows:
        if r.get("id"):
            ids.append(str(r["id"]))
    # de-dupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def _list_victim_cases(
    user: dict[str, Any],
    *,
    q: str,
    status: Optional[str],
    pending: Optional[bool],
    offset: int,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    ids = _user_ids(user)
    where = ["c.user_id = ANY(%s)"]
    params: list[Any] = [ids]

    if q:
        where.append(
            """(
              c.id ILIKE %s
              OR COALESCE(c.session_id, '') ILIKE %s
              OR COALESCE(c.status, '') ILIKE %s
              OR COALESCE(c.structured_report->>'incident_type', '') ILIKE %s
              OR COALESCE(c.structured_report->>'summary', '') ILIKE %s
              OR COALESCE(c.structured_report::text, '') ILIKE %s
            )"""
        )
        like = f"%{q}%"
        params.extend([like, like, like, like, like, like])

    if status:
        where.append("COALESCE(c.status, '') = %s")
        params.append(status)

    if pending is True:
        where.append("c.pending = true")
    elif pending is False:
        where.append("c.pending = false")

    where_sql = " AND ".join(where)
    total = int(
        (execute_one(f"SELECT COUNT(*)::int AS total FROM public.cases c WHERE {where_sql}", tuple(params)) or {}).get(
            "total"
        )
        or 0
    )
    rows = execute(
        f"""
        SELECT
          c.id,
          c.user_id,
          c.session_id,
          c.status,
          c.pending,
          c.has_answers,
          c.user_language,
          c.pdf_url,
          c.timestamp,
          c.updated_at,
          {_preview_sql("c")},
          '{SOURCE_VICTIM}' AS source
        FROM public.cases c
        WHERE {where_sql}
        ORDER BY c.timestamp DESC NULLS LAST, c.id
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    return [_serialize(r) or {} for r in rows], total


def _list_lawyer_cases(
    user: dict[str, Any],
    *,
    q: str,
    status: Optional[str],
    pending: Optional[bool],
    offset: int,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    assignee_ids = _lawyer_assignee_ids(user)
    where = ["lc.assigned_lawyer_id = ANY(%s)"]
    params: list[Any] = [assignee_ids]

    if q:
        where.append(
            """(
              lc.id ILIKE %s
              OR COALESCE(lc.session_id, '') ILIKE %s
              OR COALESCE(lc.status, '') ILIKE %s
              OR COALESCE(lc.user_id, '') ILIKE %s
              OR COALESCE(lc.structured_report->>'incident_type', '') ILIKE %s
              OR COALESCE(lc.structured_report::text, '') ILIKE %s
            )"""
        )
        like = f"%{q}%"
        params.extend([like, like, like, like, like, like])

    if status:
        where.append("COALESCE(lc.status, '') = %s")
        params.append(status)
    elif pending is True:
        where.append("lc.status = 'pending'")
    elif pending is False:
        where.append("lc.status IS DISTINCT FROM 'pending'")

    where_sql = " AND ".join(where)
    total = int(
        (
            execute_one(
                f"SELECT COUNT(*)::int AS total FROM public.lawyer_cases lc WHERE {where_sql}",
                tuple(params),
            )
            or {}
        ).get("total")
        or 0
    )
    rows = execute(
        f"""
        SELECT
          lc.id,
          lc.user_id,
          lc.session_id,
          lc.status,
          (lc.status = 'pending') AS pending,
          lc.assigned_lawyer_id,
          NULL::text AS user_language,
          NULL::text AS pdf_url,
          lc.created_at AS timestamp,
          lc.updated_at,
          {_preview_sql("lc")},
          '{SOURCE_LAWYER}' AS source
        FROM public.lawyer_cases lc
        WHERE {where_sql}
        ORDER BY lc.created_at DESC NULLS LAST, lc.id
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    return [_serialize(r) or {} for r in rows], total


def _list_sahayak_cases(
    user: dict[str, Any],
    *,
    q: str,
    status: Optional[str],
    pending: Optional[bool],
    offset: int,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    ids = _user_ids(user)
    where = ["sc.assigned_sahayak_id = ANY(%s)"]
    params: list[Any] = [ids]

    if q:
        where.append(
            """(
              sc.id ILIKE %s
              OR COALESCE(sc.session_id, '') ILIKE %s
              OR COALESCE(sc.status, '') ILIKE %s
              OR COALESCE(sc.user_id, '') ILIKE %s
              OR COALESCE(sc.user_name, '') ILIKE %s
              OR COALESCE(sc.structured_report->>'incident_type', '') ILIKE %s
              OR COALESCE(sc.structured_report::text, '') ILIKE %s
            )"""
        )
        like = f"%{q}%"
        params.extend([like, like, like, like, like, like, like])

    if status:
        where.append("COALESCE(sc.status, '') = %s")
        params.append(status)
    elif pending is True:
        where.append("sc.status = 'pending'")
    elif pending is False:
        where.append("sc.status IS DISTINCT FROM 'pending'")

    where_sql = " AND ".join(where)
    total = int(
        (
            execute_one(
                f"SELECT COUNT(*)::int AS total FROM public.sahayak_cases sc WHERE {where_sql}",
                tuple(params),
            )
            or {}
        ).get("total")
        or 0
    )
    rows = execute(
        f"""
        SELECT
          sc.id,
          sc.user_id,
          sc.session_id,
          sc.status,
          (sc.status = 'pending') AS pending,
          sc.assigned_sahayak_id,
          sc.assigned_sahayak_name,
          sc.user_name,
          NULL::text AS user_language,
          NULL::text AS pdf_url,
          sc.created_at AS timestamp,
          sc.updated_at,
          {_preview_sql("sc")},
          '{SOURCE_SAHAYAK}' AS source
        FROM public.sahayak_cases sc
        WHERE {where_sql}
        ORDER BY sc.created_at DESC NULLS LAST, sc.id
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    return [_serialize(r) or {} for r in rows], total


def _list_moderator_cases(
    *,
    q: str,
    status: Optional[str],
    pending: Optional[bool],
    offset: int,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    where = ["COALESCE(i.collection_name, 'moderator') = 'moderator'"]
    params: list[Any] = []

    if q:
        where.append(
            """(
              i.id ILIKE %s
              OR COALESCE(i.session_id, '') ILIKE %s
              OR COALESCE(i.status, '') ILIKE %s
              OR COALESCE(i.user_id, '') ILIKE %s
              OR COALESCE(i.user_statement, '') ILIKE %s
              OR COALESCE(i.structured_report->>'incident_type', '') ILIKE %s
              OR COALESCE(i.structured_report::text, '') ILIKE %s
            )"""
        )
        like = f"%{q}%"
        params.extend([like, like, like, like, like, like, like])

    if status:
        where.append("COALESCE(i.status, '') = %s")
        params.append(status)
    elif pending is True:
        where.append("i.status = 'pending'")
    elif pending is False:
        where.append("i.status IS DISTINCT FROM 'pending'")

    where_sql = " AND ".join(where)
    total = int(
        (
            execute_one(
                f"SELECT COUNT(*)::int AS total FROM public.interventions i WHERE {where_sql}",
                tuple(params),
            )
            or {}
        ).get("total")
        or 0
    )
    rows = execute(
        f"""
        SELECT
          i.id,
          i.user_id,
          i.session_id,
          i.status,
          (i.status = 'pending') AS pending,
          i.collection_name,
          NULL::text AS user_language,
          NULL::text AS pdf_url,
          i.created_at AS timestamp,
          i.updated_at,
          {_preview_sql("i")},
          '{SOURCE_INTERVENTION}' AS source
        FROM public.interventions i
        WHERE {where_sql}
        ORDER BY i.created_at DESC NULLS LAST, i.id
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    return [_serialize(r) or {} for r in rows], total


def list_user_cases(
    user_id: str,
    *,
    q: str = "",
    status: Optional[str] = None,
    pending: Optional[bool] = None,
    offset: int = 0,
    limit: int = 25,
) -> dict[str, Any]:
    if not is_postgres_configured():
        return {
            "user": None,
            "cases": [],
            "total": 0,
            "offset": 0,
            "limit": limit,
            "case_scope": SOURCE_VICTIM,
        }

    user = get_user(user_id)
    if not user:
        raise ValueError("User not found")

    offset = max(0, offset)
    limit = max(1, min(100, limit))
    q = (q or "").strip()
    scope = _case_scope(user.get("role"))

    if scope == SOURCE_LAWYER:
        cases, total = _list_lawyer_cases(
            user, q=q, status=status, pending=pending, offset=offset, limit=limit
        )
    elif scope == SOURCE_SAHAYAK:
        cases, total = _list_sahayak_cases(
            user, q=q, status=status, pending=pending, offset=offset, limit=limit
        )
    elif scope == SOURCE_INTERVENTION:
        cases, total = _list_moderator_cases(
            q=q, status=status, pending=pending, offset=offset, limit=limit
        )
    else:
        cases, total = _list_victim_cases(
            user, q=q, status=status, pending=pending, offset=offset, limit=limit
        )

    return {
        "user": user,
        "cases": cases,
        "total": total,
        "offset": offset,
        "limit": limit,
        "case_scope": scope,
    }


def _detail_from_row(
    *,
    source: str,
    row: dict[str, Any],
    owner: dict[str, Any] | None = None,
) -> dict[str, Any]:
    case = _serialize(row) or {}
    report = case.get("structured_report") if isinstance(case.get("structured_report"), dict) else {}
    uid = str(case.get("user_id") or "")
    if owner is None and uid:
        owner = get_user(uid)

    related: dict[str, Any] = {
        "interventions": [],
        "sahayak_cases": [],
        "lawyer_cases": [],
    }

    session_id = case.get("session_id")
    case_id = case.get("id")

    if source != SOURCE_INTERVENTION:
        related["interventions"] = [
            _serialize(r)
            for r in execute(
                """
                SELECT id, status, collection_name, session_id, user_statement, location,
                       moderator_response, moderator_options, routing_recommendation,
                       resolved_at, created_at, updated_at, structured_report
                FROM public.interventions
                WHERE id = %s
                   OR (session_id IS NOT NULL AND session_id = %s)
                ORDER BY created_at DESC
                LIMIT 20
                """,
                (case_id, session_id),
            )
        ]
    if source != SOURCE_SAHAYAK:
        related["sahayak_cases"] = [
            _serialize(r)
            for r in execute(
                """
                SELECT id, status, user_name, assigned_sahayak_id, assigned_sahayak_name,
                       session_id, created_at, updated_at, structured_report, user_id, location,
                       notified_user_ids
                FROM public.sahayak_cases
                WHERE id = %s OR (session_id IS NOT NULL AND session_id = %s)
                ORDER BY created_at DESC
                LIMIT 10
                """,
                (case_id, session_id),
            )
        ]
    if source != SOURCE_LAWYER:
        related["lawyer_cases"] = [
            _serialize(r)
            for r in execute(
                """
                SELECT id, status, assigned_lawyer_id, session_id, created_at, updated_at,
                       structured_report, user_id
                FROM public.lawyer_cases
                WHERE id = %s OR (session_id IS NOT NULL AND session_id = %s)
                ORDER BY created_at DESC
                LIMIT 10
                """,
                (case_id, session_id),
            )
        ]

    return {
        "case": case,
        "user": owner,
        "source": source,
        "incident_type": report.get("incident_type") if isinstance(report, dict) else None,
        "interventions": related["interventions"],
        "sahayak_cases": related["sahayak_cases"],
        "lawyer_cases": related["lawyer_cases"],
    }


def get_case_detail(case_id: str, source: Optional[str] = None) -> dict[str, Any]:
    if not is_postgres_configured():
        raise ValueError("Database not configured")
    if not case_id:
        raise ValueError("Case id required")

    src = (source or "").strip() or None
    order = (
        [src]
        if src
        else [SOURCE_VICTIM, SOURCE_LAWYER, SOURCE_SAHAYAK, SOURCE_INTERVENTION]
    )

    for candidate in order:
        if candidate == SOURCE_VICTIM:
            row = execute_one("SELECT * FROM public.cases WHERE id = %s LIMIT 1", (case_id,))
            if row:
                return _detail_from_row(source=SOURCE_VICTIM, row=row)
        elif candidate == SOURCE_LAWYER:
            row = execute_one("SELECT * FROM public.lawyer_cases WHERE id = %s LIMIT 1", (case_id,))
            if row:
                return _detail_from_row(source=SOURCE_LAWYER, row=row)
        elif candidate == SOURCE_SAHAYAK:
            row = execute_one("SELECT * FROM public.sahayak_cases WHERE id = %s LIMIT 1", (case_id,))
            if row:
                return _detail_from_row(source=SOURCE_SAHAYAK, row=row)
        elif candidate == SOURCE_INTERVENTION:
            row = execute_one("SELECT * FROM public.interventions WHERE id = %s LIMIT 1", (case_id,))
            if row:
                return _detail_from_row(source=SOURCE_INTERVENTION, row=row)

    raise ValueError("Case not found")


def list_case_statuses(role: Optional[str] = None) -> list[str]:
    if not is_postgres_configured():
        return []

    scope = _case_scope(role) if role else None
    if scope == SOURCE_LAWYER:
        sql = "SELECT DISTINCT status FROM public.lawyer_cases WHERE status IS NOT NULL AND btrim(status) <> '' ORDER BY status LIMIT 50"
    elif scope == SOURCE_SAHAYAK:
        sql = "SELECT DISTINCT status FROM public.sahayak_cases WHERE status IS NOT NULL AND btrim(status) <> '' ORDER BY status LIMIT 50"
    elif scope == SOURCE_INTERVENTION:
        sql = """
            SELECT DISTINCT status FROM public.interventions
            WHERE status IS NOT NULL AND btrim(status) <> ''
              AND COALESCE(collection_name, 'moderator') = 'moderator'
            ORDER BY status LIMIT 50
        """
    else:
        sql = """
            SELECT DISTINCT status FROM public.cases
            WHERE status IS NOT NULL AND btrim(status) <> ''
            ORDER BY status LIMIT 50
        """
        if not role:
            # Union common statuses across queues when no role filter
            rows = execute(
                """
                SELECT DISTINCT status FROM (
                  SELECT status FROM public.cases WHERE status IS NOT NULL AND btrim(status) <> ''
                  UNION
                  SELECT status FROM public.lawyer_cases WHERE status IS NOT NULL AND btrim(status) <> ''
                  UNION
                  SELECT status FROM public.sahayak_cases WHERE status IS NOT NULL AND btrim(status) <> ''
                  UNION
                  SELECT status FROM public.interventions WHERE status IS NOT NULL AND btrim(status) <> ''
                ) s
                ORDER BY status
                LIMIT 50
                """
            )
            return [str(r["status"]) for r in rows if r.get("status")]

    rows = execute(sql)
    return [str(r["status"]) for r in rows if r.get("status")]
