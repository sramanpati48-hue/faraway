import type { Metadata } from "next";
import type { ArticleSeoResponse, RouteSeoResponse, SeoPagesConfig } from "@/lib/seo/types";

function keywordsArray(keywords?: string | null): string[] | undefined {
  if (!keywords?.trim()) return undefined;
  return keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function metadataShell(opts: {
  baseUrl: string;
  canonicalPath: string;
  title: string;
  description: string;
  keywords?: string | null;
  ogImage: string;
  index: boolean;
  follow: boolean;
  twitterCard?: string | null;
  ogType?: "website" | "article";
}): Metadata {
  const baseUrl = opts.baseUrl.replace(/\/$/, "") || "https://nyaysahayak.eu.cc";
  const canonicalPath = opts.canonicalPath.startsWith("/")
    ? opts.canonicalPath
    : `/${opts.canonicalPath}`;
  const canonical = `${baseUrl}${canonicalPath}`;
  return {
    metadataBase: new URL(baseUrl),
    title: opts.title,
    description: opts.description,
    keywords: keywordsArray(opts.keywords),
    alternates: { canonical },
    robots: {
      index: opts.index,
      follow: opts.follow,
      googleBot: {
        index: opts.index,
        follow: opts.follow,
        "max-snippet": -1,
        "max-image-preview": "large",
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type: opts.ogType || "website",
      url: canonical,
      title: opts.title,
      description: opts.description,
      images: [{ url: opts.ogImage, width: 1200, height: 630, alt: opts.title }],
    },
    twitter: {
      card: (opts.twitterCard as "summary_large_image") || "summary_large_image",
      title: opts.title,
      description: opts.description,
      images: [opts.ogImage],
    },
    icons: {
      icon: [{ url: "/2.png", type: "image/png" }],
      apple: [{ url: "/2.png", type: "image/png" }],
      shortcut: ["/2.png"],
    },
  };
}

export function buildRouteMetadata(route: RouteSeoResponse, globals: SeoPagesConfig): Metadata {
  return metadataShell({
    baseUrl: route.base_url ?? globals.base_url,
    canonicalPath: route.canonical_path || "/",
    title: route.title?.trim() || "Nyay Sahayak",
    description: route.description?.trim() || "Your AI legal companion",
    keywords: route.keywords,
    ogImage: route.og_image ?? globals.default_og_image,
    index: route.index !== false,
    follow: route.follow !== false,
    twitterCard: route.twitter_card,
  });
}

export function buildArticleMetadata(seo: ArticleSeoResponse): Metadata {
  return metadataShell({
    baseUrl: seo.base_url,
    canonicalPath: seo.canonical_path || `/blogs/${seo.slug}`,
    title: seo.meta_title?.trim() || seo.title || "Article | Nyay Sahayak",
    description: seo.meta_description?.trim() || "",
    keywords: seo.meta_keywords,
    ogImage: seo.og_image || seo.default_og_image,
    index: seo.index !== false,
    follow: seo.follow !== false,
    twitterCard: seo.twitter_card,
    ogType: "article",
  });
}
