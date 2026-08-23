from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from backend.database.auth_middleware import get_current_user, require_roles
from backend.database.auth_service import (
    AuthError,
    admin_create_reset_code,
    import_firebase_user,
    login,
    logout,
    refresh,
    register_user,
    reset_password_with_code,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterBody(BaseModel):
    email: Optional[str] = None
    mobile: Optional[str] = None
    password: str = Field(min_length=8)
    role: str = "victim"
    display_name: Optional[str] = None


class LoginBody(BaseModel):
    identifier: str
    password: str


class RefreshBody(BaseModel):
    refresh_token: str


class ResetBody(BaseModel):
    identifier: str
    reset_code: str
    new_password: str = Field(min_length=8)


class AdminResetBody(BaseModel):
    identifier: str


class ImportFirebaseBody(BaseModel):
    firebase_uid: str
    email: Optional[str] = None
    role: str = "victim"


def _client_meta(request: Request):
    ua = request.headers.get("user-agent")
    ip = request.client.host if request.client else None
    return ua, ip


@router.post("/register")
async def auth_register(body: RegisterBody, request: Request):
    try:
        ua, ip = _client_meta(request)
        return register_user(
            email=body.email,
            mobile=body.mobile,
            password=body.password,
            role=body.role,
            display_name=body.display_name,
        )
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/jwt-login")
async def auth_jwt_login(body: LoginBody, request: Request):
    try:
        ua, ip = _client_meta(request)
        return login(body.identifier, body.password, user_agent=ua, ip=ip)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/refresh")
async def auth_refresh(body: RefreshBody, request: Request):
    try:
        ua, ip = _client_meta(request)
        return refresh(body.refresh_token, user_agent=ua, ip=ip)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/logout")
async def auth_logout(body: RefreshBody):
    logout(body.refresh_token)
    return {"status": "success"}


@router.post("/reset-password")
async def auth_reset_password(body: ResetBody):
    try:
        return reset_password_with_code(body.identifier, body.reset_code, body.new_password)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("/me")
async def auth_me(user=Depends(get_current_user)):
    return {
        "id": str(user["id"]),
        "uid": str(user.get("firebase_uid") or user["id"]),
        "email": user.get("email"),
        "mobile": user.get("mobile"),
        "role": user.get("role"),
        "display_name": user.get("display_name"),
        "password_reset_required": bool(user.get("password_reset_required")),
    }


@router.post("/admin/reset-code")
async def auth_admin_reset_code(
    body: AdminResetBody,
    user=Depends(require_roles("admin", "super_admin", "moderator")),
):
    try:
        return admin_create_reset_code(body.identifier, created_by=str(user["id"]))
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/import-firebase")
async def auth_import_firebase(
    body: ImportFirebaseBody,
    user=Depends(require_roles("admin", "super_admin")),
):
    try:
        return import_firebase_user(body.firebase_uid, body.email, body.role)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
