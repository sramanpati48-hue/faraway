import type { MetadataRoute } from "next";
import { fetchSeoPagesConfig } from "@/lib/seo/api";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const config = await fetchSeoPagesConfig();
  const base = (config.base_url || "https://nyaysahayak.eu.cc").replace(/\/$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin/", "/api/", "/moderator", "/moderator/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
