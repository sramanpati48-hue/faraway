"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock, Loader2, Search, X } from "lucide-react";
import { dmSans, instrumentSerif } from "@/lib/fonts";
import { focusRing, pressableSubtle, sidebarRailMotion, touchIconButton } from "@/lib/motion";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type ArticleCard = {
  id: string;
  title: string;
  category: string;
  summary: string;
  read_minutes?: number;
};

function mapArticles(raw: unknown): ArticleCard[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === "object" && (a as { id?: string }).id))
    .map((a) => ({
      id: String(a.id),
      title: String(a.title || "Untitled"),
      category: String(a.category || "Legal"),
      summary: String(a.summary || ""),
      read_minutes: typeof a.read_minutes === "number" ? a.read_minutes : undefined,
    }));
}

export function ArticlesSearchPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [latest, setLatest] = useState<ArticleCard[]>([]);
  const [loadingLatest, setLoadingLatest] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    let active = true;
    setLoadingLatest(true);
    fetch(`${API_URL}/api/articles?limit=12&offset=0`)
      .then((res) => (res.ok ? res.json() : { articles: [] }))
      .then((data) => {
        if (active) setLatest(mapArticles(data.articles));
      })
      .catch(() => {
        if (active) setLatest([]);
      })
      .finally(() => {
        if (active) setLoadingLatest(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const goToSearch = (q: string) => {
    const trimmed = q.trim();
    router.push(trimmed ? `/search?query=${encodeURIComponent(trimmed)}` : "/search");
  };

  return (
    <aside
      id="articles-search-panel"
      aria-label="Latest articles"
      className={cn(
        dmSans.className,
        "fixed right-0 top-0 z-30 hidden h-[100dvh] flex-col border-l border-slate-200/80 bg-white md:flex",
        sidebarRailMotion,
        open ? "w-80 translate-x-0" : "pointer-events-none w-80 translate-x-full"
      )}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-3">
        <p className={cn(instrumentSerif.className, "min-w-0 flex-1 text-lg text-slate-900")}>
          Search articles
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close article list"
          className={cn(
            touchIconButton,
            focusRing,
            "h-9 w-9 rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form
        className="border-b border-slate-100 p-3"
        action="/search"
        onSubmit={(e) => {
          e.preventDefault();
          goToSearch(query);
        }}
      >
        <label className="sr-only" htmlFor="articles-panel-query">
          Search articles
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            id="articles-panel-query"
            name="query"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe a legal issue…"
            className={cn(
              "w-full rounded-lg border border-slate-200/80 bg-[#F8F9FA] py-2 pl-8 pr-9 text-sm text-slate-900 outline-none placeholder:text-slate-400",
              "focus-visible:border-emerald-200 focus-visible:ring-2 focus-visible:ring-[#00634B]/25"
            )}
          />
          <button
            type="submit"
            aria-label="Search articles"
            className={cn(
              touchIconButton,
              focusRing,
              "absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-md text-slate-400 hover:text-[#00634B]"
            )}
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Latest articles</p>
        {loadingLatest ? (
          <div className="flex justify-center py-10 text-[#00634B]">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading articles" />
          </div>
        ) : latest.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-slate-500">No articles yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {latest.map((article) => (
              <li key={article.id}>
                <Link
                  href={`/blogs/${article.id}`}
                  className={cn(
                    pressableSubtle,
                    focusRing,
                    "block rounded-lg border border-transparent px-2.5 py-2 hover:border-slate-200/80 hover:bg-slate-50"
                  )}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#00634B]">
                    {article.category}
                  </span>
                  <span
                    className={cn(
                      instrumentSerif.className,
                      "mt-0.5 block line-clamp-2 text-[15px] leading-snug text-slate-900"
                    )}
                  >
                    {article.title}
                  </span>
                  {article.summary ? (
                    <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-slate-500">
                      {article.summary}
                    </span>
                  ) : null}
                  <span className="mt-1.5 inline-flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden />
                      {article.read_minutes || 5} min
                    </span>
                    <span className="inline-flex items-center gap-0.5 font-medium text-[#00634B]">
                      Read
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
