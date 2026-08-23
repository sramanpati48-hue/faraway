"""SEO pages config stored in system_config (seo_pages / seo_pages_defaults)."""

from __future__ import annotations

import copy
import json
from typing import Any

from backend.database.postgres_pool import execute_one, execute_void, is_postgres_configured

SEO_PAGES_KEY = "seo_pages"
SEO_PAGES_DEFAULTS_KEY = "seo_pages_defaults"
RESTORE_DEFAULTS_CONFIRM = "restore-defaults"

ROUTE_KEY_TO_PATH: dict[str, str] = {
    "home": "/",
    "about": "/about",
    "legal-rights": "/legal-rights",
    "file-case": "/file-case",
    "documents": "/documents",
    "resources": "/resources",
    "scam-heatmap": "/scam-heatmap",
    "find-help": "/find-help",
    "lawyers": "/lawyers",
    "search": "/search",
    "blogs": "/blogs",
    "my-cases": "/my-cases",
    "clash": "/clash",
    "cases": "/cases",
    "login": "/login",
    "signup": "/signup",
    "lawyer": "/lawyer",
    "lawyer-cases": "/lawyer/cases",
    "lawyer-profile": "/lawyer/profile",
    "sahayak": "/sahayak",
    "sahayak-profile": "/sahayak/profile",
    "moderator": "/moderator",
}

PATH_TO_ROUTE_KEY = {v: k for k, v in ROUTE_KEY_TO_PATH.items()}

_ORG = {
    "@type": "Organization",
    "@id": "https://nyaysahayak.eu.cc/#organization",
    "name": "Nyay Sahayak",
    "url": "https://nyaysahayak.eu.cc",
    "logo": "https://nyaysahayak.eu.cc/1.png",
    "description": "AI-powered legal intelligence — from confusion to action.",
}


def _ld_website(title: str, description: str, path: str) -> dict[str, Any]:
    url = "https://nyaysahayak.eu.cc"
    return {
        "@context": "https://schema.org",
        "@graph": [
            copy.deepcopy(_ORG),
            {
                "@type": "WebSite",
                "name": "Nyay Sahayak",
                "url": url,
                "description": description,
                "publisher": {"@id": "https://nyaysahayak.eu.cc/#organization"},
                "potentialAction": {
                    "@type": "SearchAction",
                    "target": "https://nyaysahayak.eu.cc/search?q={search_term_string}",
                    "query-input": "required name=search_term_string",
                },
            },
            {
                "@type": "WebPage",
                "name": title,
                "description": description,
                "url": url,
                "isPartOf": {"@type": "WebSite", "url": url},
            },
        ],
    }


def _ld_webpage(title: str, description: str, path: str, page_type: str = "WebPage") -> dict[str, Any]:
    url = f"https://nyaysahayak.eu.cc{path}"
    return {
        "@context": "https://schema.org",
        "@type": page_type,
        "name": title,
        "description": description,
        "url": url,
        "isPartOf": {
            "@type": "WebSite",
            "name": "Nyay Sahayak",
            "url": "https://nyaysahayak.eu.cc",
        },
        "publisher": copy.deepcopy(_ORG),
    }


def _route(
    title: str,
    description: str,
    path: str,
    *,
    keywords: str = "",
    index: bool = True,
    follow: bool = True,
    page_type: str = "WebPage",
) -> dict[str, Any]:
    if path == "/":
        structured = _ld_website(title, description, path)
    else:
        structured = _ld_webpage(title, description, path, page_type=page_type)
    return {
        "title": title,
        "description": description,
        "keywords": keywords,
        "canonical_path": path,
        "index": index,
        "follow": follow,
        "og_image": None,
        "twitter_card": "summary_large_image",
        "structured_data": structured,
    }


def _default_routes() -> dict[str, Any]:
    return {
        "/": _route(
            "Nyay Sahayak — AI Legal Companion",
            "Get instant legal guidance, case analysis, and procedural support across India.",
            "/",
            keywords="legal aid, AI lawyer, FIR, Nyay Sahayak, India law",
        ),
        "/about": _route(
            "About Nyay Sahayak",
            "Learn about Nyay Sahayak — AI-powered legal intelligence from confusion to action.",
            "/about",
            keywords="about Nyay Sahayak, legal tech India",
        ),
        "/legal-rights": _route(
            "Know Your Legal Rights | Nyay Sahayak",
            "Explore key legal rights in India and start a guided chat for your situation.",
            "/legal-rights",
            keywords="legal rights India, FIR rights, consumer rights",
            page_type="CollectionPage",
        ),
        "/file-case": _route(
            "File a Case | Nyay Sahayak",
            "Step-by-step guides to file FIRs, consumer complaints, and other cases in India.",
            "/file-case",
            keywords="file FIR, file a case, legal filing India",
            page_type="CollectionPage",
        ),
        "/documents": _route(
            "Legal Document Templates | Nyay Sahayak",
            "Browse and generate common legal document templates.",
            "/documents",
            page_type="CollectionPage",
        ),
        "/resources": _route(
            "Legal Resources | Nyay Sahayak",
            "Helpful legal resources and guides.",
            "/resources",
            page_type="CollectionPage",
        ),
        "/scam-heatmap": _route(
            "Scam Heatmap | Nyay Sahayak",
            "See scam trends and alerts across India.",
            "/scam-heatmap",
            keywords="scam alerts, cyber fraud India, scam heatmap",
            page_type="WebPage",
        ),
        "/find-help": _route(
            "Find Legal Help | Nyay Sahayak",
            "Connect with local legal help and support.",
            "/find-help",
            page_type="CollectionPage",
        ),
        "/lawyers": _route(
            "Find Lawyers | Nyay Sahayak",
            "Browse lawyers and legal professionals.",
            "/lawyers",
            page_type="CollectionPage",
        ),
        "/search": _route(
            "Search | Nyay Sahayak",
            "Search legal guidance and services.",
            "/search",
            index=False,
            page_type="SearchResultsPage",
        ),
        "/blogs": _route(
            "Legal Articles | Nyay Sahayak",
            "Read articles on law, rights, and legal procedures in India.",
            "/blogs",
            page_type="CollectionPage",
        ),
        "/my-cases": _route(
            "My Cases | Nyay Sahayak",
            "Track your cases on Nyay Sahayak.",
            "/my-cases",
            index=False,
            follow=False,
        ),
        "/clash": _route(
            "Clash Courtroom | Nyay Sahayak",
            "Interactive courtroom practice with Nyay Sahayak.",
            "/clash",
            index=False,
        ),
        "/cases": _route(
            "Case Chat | Nyay Sahayak",
            "Guided case filing chat.",
            "/cases",
            index=False,
            follow=False,
        ),
        "/login": _route(
            "Log In | Nyay Sahayak",
            "Sign in to Nyay Sahayak.",
            "/login",
            index=False,
            follow=False,
        ),
        "/signup": _route(
            "Sign Up | Nyay Sahayak",
            "Create your Nyay Sahayak account.",
            "/signup",
            index=False,
            follow=False,
        ),
        "/lawyer": _route(
            "Lawyer Portal | Nyay Sahayak",
            "Lawyer dashboard on Nyay Sahayak.",
            "/lawyer",
            index=False,
            follow=False,
        ),
        "/lawyer/cases": _route(
            "Lawyer Cases | Nyay Sahayak",
            "Manage assigned cases.",
            "/lawyer/cases",
            index=False,
            follow=False,
        ),
        "/lawyer/profile": _route(
            "Lawyer Profile | Nyay Sahayak",
            "Edit your lawyer profile.",
            "/lawyer/profile",
            index=False,
            follow=False,
        ),
        "/sahayak": _route(
            "Sahayak Portal | Nyay Sahayak",
            "Sahayak case assignment portal.",
            "/sahayak",
            index=False,
            follow=False,
        ),
        "/sahayak/profile": _route(
            "Sahayak Profile | Nyay Sahayak",
            "Edit your sahayak profile.",
            "/sahayak/profile",
            index=False,
            follow=False,
        ),
        "/moderator": _route(
            "Moderator | Nyay Sahayak",
            "Legal moderator workspace.",
            "/moderator",
            index=False,
            follow=False,
        ),
    }


def _default_sitemap() -> list[dict[str, Any]]:
    return [
        {"path": "/", "priority": 1.0, "changefreq": "weekly"},
        {"path": "/about", "priority": 0.7, "changefreq": "monthly"},
        {"path": "/legal-rights", "priority": 0.9, "changefreq": "weekly"},
        {"path": "/file-case", "priority": 0.9, "changefreq": "weekly"},
        {"path": "/documents", "priority": 0.7, "changefreq": "monthly"},
        {"path": "/resources", "priority": 0.6, "changefreq": "monthly"},
        {"path": "/scam-heatmap", "priority": 0.8, "changefreq": "daily"},
        {"path": "/find-help", "priority": 0.8, "changefreq": "weekly"},
        {"path": "/lawyers", "priority": 0.7, "changefreq": "weekly"},
        {"path": "/blogs", "priority": 0.7, "changefreq": "weekly"},
        {"path": "/blogs/{slug}", "priority": 0.65, "changefreq": "monthly", "dynamic": "article"},
    ]


def default_config() -> dict[str, Any]:
    return {
        "base_url": "https://nyaysahayak.eu.cc",
        "default_og_image": "https://nyaysahayak.eu.cc/1.png",
        "revalidate_seconds": 60,
        "routes": _default_routes(),
        "sitemap": _default_sitemap(),
        "previous_json": None,
    }


def _strip_previous(data: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in data.items() if k != "previous_json"}


def _read_raw(key: str) -> dict[str, Any] | None:
    if not is_postgres_configured():
        return None
    try:
        row = execute_one("SELECT value FROM public.system_config WHERE key = %s", (key,))
        if row and isinstance(row.get("value"), dict):
            return copy.deepcopy(row["value"])
    except Exception as exc:
        print(f"⚠️ seo_pages read failed ({key}): {exc}")
    return None


def _write_raw(key: str, value: dict[str, Any]) -> None:
    if not is_postgres_configured():
        raise RuntimeError("DATABASE_URL not configured")
    execute_void(
        """
        INSERT INTO public.system_config (key, value, updated_at)
        VALUES (%s, %s::jsonb, now())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = now()
        """,
        (key, json.dumps(value, default=str)),
    )
    try:
        from backend.services import admin_models

        admin_models.invalidate_config_cache()
    except Exception:
        pass


def ensure_permanent_defaults() -> dict[str, Any]:
    existing = _read_raw(SEO_PAGES_DEFAULTS_KEY)
    if existing and isinstance(existing.get("routes"), dict) and existing["routes"]:
        return _strip_previous(existing)
    live = _read_raw(SEO_PAGES_KEY)
    if live and isinstance(live.get("routes"), dict) and live["routes"]:
        payload = _strip_previous(live)
    else:
        payload = _strip_previous(default_config())
    if is_postgres_configured():
        _write_raw(SEO_PAGES_DEFAULTS_KEY, payload)
    return copy.deepcopy(payload)


def _merge_route_defaults(db_route: dict[str, Any], default_route: dict[str, Any]) -> dict[str, Any]:
    """Fill missing fields (especially structured_data) from code defaults."""
    merged = {**default_route, **(db_route or {})}
    if not merged.get("structured_data"):
        merged["structured_data"] = default_route.get("structured_data")
    return merged


def load_seo_pages_config() -> dict[str, Any]:
    defaults = default_config()
    data = _read_raw(SEO_PAGES_KEY)
    if not data:
        return defaults
    for k, v in defaults.items():
        if k not in data or data[k] in (None, "", {}, []):
            if k == "routes" and isinstance(data.get("routes"), dict) and data["routes"]:
                continue
            if k != "previous_json":
                data[k] = v
    db_routes = data.get("routes") if isinstance(data.get("routes"), dict) else {}
    default_routes = defaults["routes"]
    merged_routes: dict[str, Any] = {}
    for path, default_route in default_routes.items():
        merged_routes[path] = _merge_route_defaults(db_routes.get(path) or {}, default_route)
    for path, db_route in db_routes.items():
        if path not in merged_routes and isinstance(db_route, dict):
            merged_routes[path] = db_route
    data["routes"] = merged_routes
    if not data.get("sitemap"):
        data["sitemap"] = defaults["sitemap"]
    if not data.get("base_url"):
        data["base_url"] = defaults["base_url"]
    if not data.get("default_og_image"):
        data["default_og_image"] = defaults["default_og_image"]
    return data


def public_seo_pages_config() -> dict[str, Any]:
    return _strip_previous(load_seo_pages_config())


def get_route_config(route_key: str) -> dict[str, Any] | None:
    data = load_seo_pages_config()
    path = ROUTE_KEY_TO_PATH.get(route_key)
    if not path:
        return None
    routes = data.get("routes") or {}
    route = routes.get(path)
    if not route:
        return None
    return {
        **route,
        "base_url": data.get("base_url"),
        "default_og_image": data.get("default_og_image"),
        "revalidate_seconds": data.get("revalidate_seconds", 60),
    }


def save_seo_pages_config(new_config: dict[str, Any]) -> dict[str, Any]:
    current = _read_raw(SEO_PAGES_KEY)
    before = _strip_previous(current) if current else None
    payload = copy.deepcopy(new_config)
    payload["previous_json"] = before
    # Keep permanent defaults seeded once
    ensure_permanent_defaults()
    _write_raw(SEO_PAGES_KEY, payload)
    return payload


def restore_seo_pages_backup() -> dict[str, Any] | None:
    current = load_seo_pages_config()
    backup = current.get("previous_json")
    if not isinstance(backup, dict):
        return None
    restored = copy.deepcopy(backup)
    return save_seo_pages_config(restored)


def restore_to_factory_defaults() -> dict[str, Any]:
    factory = ensure_permanent_defaults()
    return save_seo_pages_config(copy.deepcopy(factory))


def get_article_seo(article_id: str) -> dict[str, Any] | None:
    """Public SEO payload for a single blog article (by id or slug)."""
    from backend.database import postgres_db as db

    article = db.get_article(article_id)
    if not article:
        return None
    pages = load_seo_pages_config()
    base_url = str(pages.get("base_url") or "https://nyaysahayak.eu.cc").rstrip("/")
    default_og = str(pages.get("default_og_image") or f"{base_url}/1.png")
    slug = article.get("slug") or article.get("id")
    canonical = (article.get("canonical_path") or f"/blogs/{slug}").strip() or f"/blogs/{slug}"
    title = (article.get("meta_title") or article.get("title") or "Article").strip()
    description = (
        article.get("meta_description") or article.get("summary") or ""
    ).strip()
    og = article.get("og_image") or article.get("hero_image") or default_og
    robots = (article.get("robots") or "index,follow").strip()
    lower = robots.lower()
    index = "noindex" not in lower
    follow = "nofollow" not in lower
    structured = article.get("structured_data")
    if not isinstance(structured, dict) or not structured:
        structured = {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": title,
            "description": description,
            "url": f"{base_url}{canonical if canonical.startswith('/') else '/' + canonical}",
            "author": {
                "@type": "Organization",
                "name": article.get("author") or "Nyay Sahayak",
            },
            "publisher": {
                "@type": "Organization",
                "name": "Nyay Sahayak",
                "url": base_url,
            },
        }
    return {
        "id": article.get("id"),
        "slug": slug,
        "title": article.get("title"),
        "meta_title": title,
        "meta_description": description,
        "meta_keywords": article.get("meta_keywords"),
        "og_image": og,
        "robots": robots,
        "index": index,
        "follow": follow,
        "canonical_path": canonical,
        "structured_data": structured,
        "twitter_card": "summary_large_image",
        "base_url": base_url,
        "default_og_image": default_og,
        "revalidate_seconds": pages.get("revalidate_seconds", 60),
    }
