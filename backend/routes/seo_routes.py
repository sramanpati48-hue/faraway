"""Public + admin SEO pages API."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.database.auth_middleware import require_roles
from backend.services import seo_pages as seo_service

router = APIRouter(tags=["seo"])

AdminUser = Depends(require_roles("admin", "super_admin"))


class SeoRouteConfigBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    keywords: Optional[str] = None
    canonical_path: Optional[str] = None
    index: Optional[bool] = None
    follow: Optional[bool] = None
    og_image: Optional[str] = None
    twitter_card: Optional[str] = None
    structured_data: Optional[dict[str, Any]] = None


class SitemapEntryBody(BaseModel):
    path: str
    priority: Optional[float] = None
    changefreq: Optional[str] = None
    dynamic: Optional[str] = None


class SeoPagesUpdate(BaseModel):
    base_url: Optional[str] = None
    default_og_image: Optional[str] = None
    revalidate_seconds: Optional[int] = None
    routes: Optional[dict[str, SeoRouteConfigBody]] = None
    sitemap: Optional[list[SitemapEntryBody]] = None


class SeoRestoreDefaultsBody(BaseModel):
    confirm: str = Field(default="")


@router.get("/api/seo/pages")
async def public_seo_pages():
    return seo_service.public_seo_pages_config()


@router.get("/api/seo/pages/{route_key}")
async def public_seo_route(route_key: str):
    route = seo_service.get_route_config(route_key)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    return route


@router.get("/api/seo/articles/{article_id}")
async def public_article_seo(article_id: str):
    out = seo_service.get_article_seo(article_id)
    if not out:
        raise HTTPException(status_code=404, detail="Article not found")
    return out


@router.get("/api/admin/seo/pages")
async def admin_get_seo_pages(user=AdminUser):
    return seo_service.load_seo_pages_config()


@router.put("/api/admin/seo/pages")
async def admin_put_seo_pages(body: SeoPagesUpdate, user=AdminUser):
    current = seo_service.load_seo_pages_config()
    before_public = {k: v for k, v in current.items() if k != "previous_json"}
    update_dict = body.model_dump(exclude_unset=True)
    merged = {**before_public, **update_dict}
    if body.routes is not None:
        merged["routes"] = {
            path: cfg.model_dump(exclude_none=False) for path, cfg in body.routes.items()
        }
    if body.sitemap is not None:
        merged["sitemap"] = [e.model_dump() for e in body.sitemap]
    after = seo_service.save_seo_pages_config(merged)
    after_public = {k: v for k, v in after.items() if k != "previous_json"}
    return {
        "success": True,
        "config": after_public,
        "has_backup": after.get("previous_json") is not None,
    }


@router.get("/api/admin/seo/pages/defaults")
async def admin_get_seo_defaults(user=AdminUser):
    return seo_service.ensure_permanent_defaults()


@router.post("/api/admin/seo/pages/restore-defaults")
async def admin_restore_seo_defaults(body: SeoRestoreDefaultsBody, user=AdminUser):
    if body.confirm.strip() != seo_service.RESTORE_DEFAULTS_CONFIRM:
        raise HTTPException(
            status_code=400,
            detail=f'Type "{seo_service.RESTORE_DEFAULTS_CONFIRM}" to confirm',
        )
    after = seo_service.restore_to_factory_defaults()
    after_public = {k: v for k, v in after.items() if k != "previous_json"}
    return {
        "success": True,
        "config": after_public,
        "restored_from": seo_service.SEO_PAGES_DEFAULTS_KEY,
    }


@router.post("/api/admin/seo/pages/restore-backup")
async def admin_restore_seo_backup(user=AdminUser):
    restored = seo_service.restore_seo_pages_backup()
    if not restored:
        raise HTTPException(status_code=400, detail="No backup available")
    restored_public = {k: v for k, v in restored.items() if k != "previous_json"}
    return {"success": True, "config": restored_public}


class ArticleSeoUpdate(BaseModel):
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    meta_keywords: Optional[str] = None
    og_image: Optional[str] = None
    robots: Optional[str] = None
    canonical_path: Optional[str] = None
    structured_data: Optional[dict[str, Any]] = None


@router.patch("/api/admin/seo/articles/{article_id}")
async def admin_patch_article_seo(article_id: str, body: ArticleSeoUpdate, user=AdminUser):
    from backend.database import supabase_db

    existing = supabase_db.get_article(article_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Article not found")
    data = body.model_dump(exclude_unset=True)
    row = supabase_db.update_article(article_id, data)
    if row:
        for key in ("published_at", "updated_at", "created_at"):
            if row.get(key) is not None and hasattr(row[key], "isoformat"):
                row[key] = row[key].isoformat()
    seo = seo_service.get_article_seo(article_id)
    return {"success": True, "article": row, "seo": seo}
