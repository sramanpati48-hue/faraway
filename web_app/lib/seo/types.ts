export type SeoRouteConfig = {
  title?: string;
  description?: string;
  keywords?: string;
  canonical_path?: string;
  index?: boolean;
  follow?: boolean;
  og_image?: string | null;
  twitter_card?: string | null;
  structured_data?: Record<string, unknown> | null;
};

export type SitemapEntry = {
  path: string;
  priority?: number;
  changefreq?: string;
  dynamic?: string | null;
};

export type SeoPagesConfig = {
  base_url: string;
  default_og_image: string;
  revalidate_seconds: number;
  routes: Record<string, SeoRouteConfig>;
  sitemap: SitemapEntry[];
  previous_json?: Record<string, unknown> | null;
};

export type RouteSeoResponse = SeoRouteConfig & {
  base_url?: string;
  default_og_image?: string;
  revalidate_seconds?: number;
};

export type ArticleSeoResponse = {
  id: string;
  slug: string;
  title?: string;
  meta_title: string;
  meta_description: string;
  meta_keywords?: string | null;
  og_image?: string | null;
  robots?: string | null;
  index?: boolean;
  follow?: boolean;
  canonical_path: string;
  structured_data?: Record<string, unknown> | null;
  twitter_card?: string | null;
  base_url: string;
  default_og_image: string;
  revalidate_seconds?: number;
};

export type RouteKey =
  | "home"
  | "about"
  | "legal-rights"
  | "file-case"
  | "documents"
  | "resources"
  | "scam-heatmap"
  | "find-help"
  | "lawyers"
  | "search"
  | "blogs"
  | "my-cases"
  | "clash"
  | "cases"
  | "login"
  | "signup"
  | "lawyer"
  | "lawyer-cases"
  | "lawyer-profile"
  | "sahayak"
  | "sahayak-profile"
  | "moderator";

export const ROUTE_KEY_TO_PATH: Record<RouteKey, string> = {
  home: "/",
  about: "/about",
  "legal-rights": "/legal-rights",
  "file-case": "/cases",
  documents: "/documents",
  resources: "/resources",
  "scam-heatmap": "/scam-heatmap",
  "find-help": "/find-help",
  lawyers: "/lawyers",
  search: "/search",
  blogs: "/blogs",
  "my-cases": "/my-cases",
  clash: "/clash",
  cases: "/cases",
  login: "/login",
  signup: "/signup",
  lawyer: "/lawyer",
  "lawyer-cases": "/lawyer/cases",
  "lawyer-profile": "/lawyer/profile",
  sahayak: "/sahayak",
  "sahayak-profile": "/sahayak/profile",
  moderator: "/moderator",
};

export const ROUTE_LABELS: Record<RouteKey, string> = {
  home: "Home",
  about: "About",
  "legal-rights": "Legal Rights",
  "file-case": "File a Case",
  documents: "Documents",
  resources: "Resources",
  "scam-heatmap": "Scam Heatmap",
  "find-help": "Find Help",
  lawyers: "Lawyers",
  search: "Search",
  blogs: "Blogs",
  "my-cases": "My Cases",
  clash: "Clash",
  cases: "Case Chat",
  login: "Log In",
  signup: "Sign Up",
  lawyer: "Lawyer Portal",
  "lawyer-cases": "Lawyer Cases",
  "lawyer-profile": "Lawyer Profile",
  sahayak: "Sahayak Portal",
  "sahayak-profile": "Sahayak Profile",
  moderator: "Moderator",
};
