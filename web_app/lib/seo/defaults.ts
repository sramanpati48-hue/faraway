import type { SeoPagesConfig } from "@/lib/seo/types";
import { DEFAULT_OG_IMAGE_ABSOLUTE } from "@/lib/seo/og-image-defaults";

export const DEFAULT_SEO_PAGES: SeoPagesConfig = {
  base_url: "https://nyaysahayak.eu.cc",
  default_og_image: DEFAULT_OG_IMAGE_ABSOLUTE,
  revalidate_seconds: 60,
  routes: {
    "/": {
      title: "Nyay Sahayak — AI Legal Companion",
      description:
        "Get instant legal guidance, case analysis, and procedural support across India.",
      keywords: "legal aid, AI lawyer, FIR, Nyay Sahayak, India law",
      canonical_path: "/",
      index: true,
      follow: true,
    },
  },
  sitemap: [{ path: "/", priority: 1.0, changefreq: "weekly" }],
  previous_json: null,
};

export const DEFAULT_REVALIDATE = DEFAULT_SEO_PAGES.revalidate_seconds;
