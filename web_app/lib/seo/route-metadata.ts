import type { Metadata } from "next";
import { buildArticleMetadata, buildRouteMetadata } from "@/lib/seo/build-metadata";
import { fetchArticleSeo, fetchSeoForRoute } from "@/lib/seo/api";
import type { RouteKey } from "@/lib/seo/types";

export async function generateRouteMetadata(routeKey: RouteKey): Promise<Metadata> {
  const { route, globals } = await fetchSeoForRoute(routeKey);
  return buildRouteMetadata(route, globals);
}

export async function getRouteStructuredData(routeKey: RouteKey) {
  const { route } = await fetchSeoForRoute(routeKey);
  return route.structured_data ?? null;
}

export async function generateArticleMetadata(articleId: string): Promise<Metadata> {
  const seo = await fetchArticleSeo(articleId);
  if (!seo) {
    return { title: "Article | Nyay Sahayak", robots: { index: false, follow: true } };
  }
  return buildArticleMetadata(seo);
}

export async function getArticleStructuredData(articleId: string) {
  const seo = await fetchArticleSeo(articleId);
  return seo?.structured_data ?? null;
}
