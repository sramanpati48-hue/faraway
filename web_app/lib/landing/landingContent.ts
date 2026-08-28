const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export type LandingStat = {
  label: string;
  /** When set, the landing page may animate the number on scroll. */
  numeric?: number;
  suffix?: string;
  /** Static display when the value is not a simple number (e.g. "Growing network"). */
  display: string;
  /** Where this figure came from — shown to admins in dev only; omitted in UI for sourced CMS data. */
  source?: "cms" | "fallback";
};

export type LandingTestimonial = {
  quote: string;
  name: string;
  context: string;
  /** Composite / illustrative — not a verified review. */
  illustrative: boolean;
};

export type LandingMarketingContent = {
  stats: LandingStat[];
  testimonials: LandingTestimonial[];
  testimonialsDisclaimer: string;
};

const TESTIMONIALS_DISCLAIMER =
  "Composite examples inspired by common case types — anonymised, not verified user reviews.";

/** Parse CMS stat strings like "300+" or "24h" for optional animation. */
export function parseCmsStatValue(raw: string): Pick<LandingStat, "numeric" | "suffix" | "display"> {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d+)(.*)$/);
  if (match) {
    return {
      numeric: Number.parseInt(match[1], 10),
      suffix: match[2] ?? "",
      display: trimmed,
    };
  }
  return { display: trimmed };
}

function cmsStatsFromAbout(stats: { label: string; value: string }[] | undefined): LandingStat[] | null {
  if (!stats?.length) return null;
  return stats.map((s) => ({
    label: s.label,
    source: "cms" as const,
    ...parseCmsStatValue(s.value),
  }));
}

export const FALLBACK_LANDING_STATS: LandingStat[] = [
  { label: "Legal knowledge base", display: "Indexed", source: "fallback" },
  { label: "Human help ladder", display: "Built-in", source: "fallback" },
  { label: "Getting started", display: "Free", source: "fallback" },
  { label: "UI language today", display: "EN (+ expanding)", source: "fallback" },
];

export const FALLBACK_LANDING_TESTIMONIALS: LandingTestimonial[] = [
  {
    quote:
      "I lost money to a fake customer-care link. NyaySahayak helped me understand Zero FIR and what to tell the cyber cell — calmly, without making me feel foolish.",
    name: "Composite example",
    context: "Cyber fraud",
    illustrative: true,
  },
  {
    quote:
      "My landlord served a sudden eviction notice. The platform walked me through what was legally valid and helped me draft a reply before I spoke to a lawyer.",
    name: "Composite example",
    context: "Tenancy dispute",
    illustrative: true,
  },
  {
    quote:
      "After months of workplace harassment, I needed someone to help me organise evidence. Having my case history in one place made the lawyer consultation actually useful.",
    name: "Composite example",
    context: "Employment",
    illustrative: true,
  },
];

type AboutCmsPayload = {
  stats?: { label: string; value: string }[];
};

type LandingCmsPayload = {
  testimonials?: Array<{ quote: string; name: string; context: string; illustrative?: boolean }>;
  testimonials_disclaimer?: string;
};

async function fetchContent<T>(slug: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/api/content/${slug}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.content as T) ?? null;
  } catch {
    return null;
  }
}

export async function fetchLandingMarketingContent(): Promise<LandingMarketingContent> {
  const [about, landing] = await Promise.all([
    fetchContent<AboutCmsPayload>("about"),
    fetchContent<LandingCmsPayload>("landing"),
  ]);

  const cmsStats = cmsStatsFromAbout(about?.stats);
  const stats = cmsStats?.length ? cmsStats : FALLBACK_LANDING_STATS;

  const cmsTestimonials = landing?.testimonials
    ?.filter((t) => t.quote?.trim())
    .map((t) => ({
      quote: t.quote.trim(),
      name: t.name?.trim() || "Composite example",
      context: t.context?.trim() || "",
      illustrative: t.illustrative !== false,
    }));

  return {
    stats,
    testimonials: cmsTestimonials?.length ? cmsTestimonials : FALLBACK_LANDING_TESTIMONIALS,
    testimonialsDisclaimer: landing?.testimonials_disclaimer?.trim() || TESTIMONIALS_DISCLAIMER,
  };
}

export function getFallbackLandingMarketingContent(): LandingMarketingContent {
  return {
    stats: FALLBACK_LANDING_STATS,
    testimonials: FALLBACK_LANDING_TESTIMONIALS,
    testimonialsDisclaimer: TESTIMONIALS_DISCLAIMER,
  };
}

export type LandingArticle = {
  id: string;
  slug?: string;
  title: string;
  category: string;
  summary: string;
  read_minutes?: number;
};

function normalizeCategory(value: string | undefined): string {
  return (value || "Legal").trim() || "Legal";
}

/** Distinct categories first; fill remaining slots with other recents (same category OK). */
export async function fetchLandingArticles(limit = 3): Promise<LandingArticle[]> {
  try {
    const res = await fetch(`${API_URL}/api/articles?diverse=true&limit=${limit}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { articles?: LandingArticle[] };
    const seenIds = new Set<string>();
    const out: LandingArticle[] = [];
    for (const a of data.articles ?? []) {
      if (!a?.id || !a?.title || seenIds.has(a.id)) continue;
      seenIds.add(a.id);
      out.push({
        id: a.id,
        slug: a.slug,
        title: a.title,
        category: normalizeCategory(a.category),
        summary: a.summary || "",
        read_minutes: a.read_minutes,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}
