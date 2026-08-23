import { DEFAULT_REVALIDATE, DEFAULT_SEO_PAGES } from "@/lib/seo/defaults";
import type {
  ArticleSeoResponse,
  RouteKey,
  RouteSeoResponse,
  SeoPagesConfig,
} from "@/lib/seo/types";
import { ROUTE_KEY_TO_PATH } from "@/lib/seo/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchJson<T>(path: string, revalidate = DEFAULT_REVALIDATE): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchSeoPagesConfig(): Promise<SeoPagesConfig> {
  const data = await fetchJson<SeoPagesConfig>("/api/seo/pages");
  return data ?? DEFAULT_SEO_PAGES;
}

export async function fetchSeoForRoute(routeKey: RouteKey): Promise<{
  route: RouteSeoResponse;
  globals: SeoPagesConfig;
}> {
  const globals = await fetchSeoPagesConfig();
  const fromApi = await fetchJson<RouteSeoResponse>(
    `/api/seo/pages/${routeKey}`,
    globals.revalidate_seconds ?? DEFAULT_REVALIDATE
  );
  const path = ROUTE_KEY_TO_PATH[routeKey];
  const fallback = globals.routes[path] ?? {};
  const route: RouteSeoResponse = {
    ...fallback,
    ...fromApi,
    base_url: fromApi?.base_url ?? globals.base_url,
    default_og_image: fromApi?.default_og_image ?? globals.default_og_image,
  };
  return { route, globals };
}

export async function fetchArticleSeo(articleId: string): Promise<ArticleSeoResponse | null> {
  const globals = await fetchSeoPagesConfig();
  return fetchJson<ArticleSeoResponse>(
    `/api/seo/articles/${encodeURIComponent(articleId)}`,
    globals.revalidate_seconds ?? DEFAULT_REVALIDATE
  );
}
