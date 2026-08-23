import { ROUTE_KEY_TO_PATH, type RouteKey } from "@/lib/seo/types";

const BASE = "https://nyaysahayak.eu.cc";
const ORG = {
  "@type": "Organization",
  "@id": `${BASE}/#organization`,
  name: "Nyay Sahayak",
  url: BASE,
  logo: `${BASE}/1.png`,
  description: "AI-powered legal intelligence — from confusion to action.",
};

type TemplateOpts = {
  title: string;
  description: string;
  path: string;
  pageType?: string;
};

function webpageTemplate({ title, description, path, pageType = "WebPage" }: TemplateOpts) {
  return {
    "@context": "https://schema.org",
    "@type": pageType,
    name: title,
    description,
    url: `${BASE}${path}`,
    isPartOf: { "@type": "WebSite", name: "Nyay Sahayak", url: BASE },
    publisher: { ...ORG },
  };
}

function homeTemplate(title: string, description: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { ...ORG },
      {
        "@type": "WebSite",
        name: "Nyay Sahayak",
        url: BASE,
        description,
        publisher: { "@id": `${BASE}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: `${BASE}/search?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "WebPage",
        name: title,
        description,
        url: BASE,
        isPartOf: { "@type": "WebSite", url: BASE },
      },
    ],
  };
}

const PAGE_TYPES: Partial<Record<RouteKey, string>> = {
  "legal-rights": "CollectionPage",
  "file-case": "CollectionPage",
  documents: "CollectionPage",
  resources: "CollectionPage",
  "find-help": "CollectionPage",
  lawyers: "CollectionPage",
  blogs: "CollectionPage",
  search: "SearchResultsPage",
};

/** Fallback templates when API returns empty structured_data. */
export function structuredDataTemplateForRoute(
  routeKey: RouteKey,
  title: string,
  description: string
): Record<string, unknown> {
  const path = ROUTE_KEY_TO_PATH[routeKey];
  if (routeKey === "home") return homeTemplate(title, description);
  return webpageTemplate({
    title,
    description,
    path,
    pageType: PAGE_TYPES[routeKey] || "WebPage",
  });
}

export function articleStructuredDataTemplate(opts: {
  title: string;
  description: string;
  slug: string;
  author?: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.title,
    description: opts.description,
    url: `${BASE}/blogs/${opts.slug}`,
    author: {
      "@type": "Organization",
      name: opts.author || "Nyay Sahayak",
    },
    publisher: { ...ORG },
  };
}
