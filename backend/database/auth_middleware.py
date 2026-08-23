"""FastAPI auth dependencies for JWT + role checks."""
from __future__ import annotations

from typing import Callable, Optional

from fastapi import Depends, Header, HTTPException, Request

from backend.database.auth_service import AuthError, decode_access_token, get_user_by_id


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        payload = decode_access_token(token)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    user = get_user_by_id(payload.get("sub") or "")
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="Account disabled")
    request.state.user = user
    return user


def require_roles(*roles: str) -> Callable:
    allowed = {r.lower() for r in roles}

    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        role = (user.get("role") or "").lower()
        if role == "super_admin":
            return user
        if role not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return user

    return _dep
