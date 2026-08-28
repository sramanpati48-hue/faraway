import type { MetadataRoute } from "next";
import { fetchSeoPagesConfig } from "@/lib/seo/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type ArticleListItem = { id?: string; slug?: string };

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const config = await fetchSeoPagesConfig();
  const base = (config.base_url || "https://nyaysahayak.eu.cc").replace(/\/$/, "");

  const out: MetadataRoute.Sitemap = [];

  for (const entry of config.sitemap || []) {
    const p = entry.path || "";
    if (!p || p.startsWith("/admin")) continue;

    if (entry.dynamic === "article") {
      try {
        const res = await fetch(`${API_URL}/api/articles?limit=200&offset=0`, {
          next: { revalidate: config.revalidate_seconds || 60 },
        });
        if (res.ok) {
          const data = (await res.json()) as { articles?: ArticleListItem[] };
          for (const a of data.articles || []) {
            const slug = a.slug || a.id;
            if (!slug) continue;
            out.push({
              url: `${base}/blogs/${slug}`,
              changeFrequency: "monthly",
              priority: entry.priority ?? 0.65,
            });
          }
        }
      } catch {
        /* ignore article expansion failures */
      }
      continue;
    }

    if (entry.dynamic) continue;

    out.push({
      url: `${base}${p.startsWith("/") ? p : `/${p}`}`,
      changeFrequency:
        (entry.changefreq as MetadataRoute.Sitemap[0]["changeFrequency"]) || "monthly",
      priority: entry.priority ?? 0.5,
    });
  }

  return out;
}
