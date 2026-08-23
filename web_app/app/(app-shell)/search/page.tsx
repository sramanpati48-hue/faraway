"use client";

import React, { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Search, Loader2, ArrowRight, Clock, Tag } from "lucide-react";
import {
  EASE_OUT,
  fadeUp,
  MotionListItem,
  OperateEmptyState,
  OperateHeader,
  OperateLayout,
  OperateSearchBar,
  OperateSkeletonGrid,
  staggerChildren,
} from "@/components/operate/OperatePrimitives";
import { instrumentSerif } from "@/lib/fonts";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ArticleResult {
  id: string;
  slug: string;
  title: string;
  category: string;
  summary: string;
  author?: string;
  tags?: string[];
  read_minutes?: number;
  similarity?: number;
  published_at?: string;
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const reduce = useReducedMotion();
  const initialQuery = searchParams.get("query") || "";

  const [inputValue, setInputValue] = useState(initialQuery);
  const [results, setResults] = useState<ArticleResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const res = await fetch(`${API_URL}/api/articles/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, top_k: 18 }),
      });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await res.json();
      setResults(Array.isArray(data.articles) ? data.articles : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setInputValue(initialQuery);
    runSearch(initialQuery);
  }, [initialQuery, runSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = inputValue.trim();
    if (!q) return;
    router.push(`/search?query=${encodeURIComponent(q)}`);
  };

  return (
    <OperateLayout wide>
      <OperateHeader
        kicker="Legal library"
        title="Search articles"
        description="AI-powered results from our knowledge base of Indian legal topics."
      />

      <OperateSearchBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        placeholder="Describe your legal issue, e.g. landlord not returning deposit"
      />

      {loading ? (
        <OperateSkeletonGrid count={6} />
      ) : error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-5 py-4 text-center text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : results.length > 0 ? (
        <>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
            {results.length} results for &ldquo;{initialQuery}&rdquo;
          </p>
          <motion.ul
            className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
            variants={staggerChildren}
            initial={reduce ? false : "hidden"}
            animate="visible"
          >
            {results.map((article, i) => (
              <MotionListItem key={article.id} index={i}>
                <Link
                  href={`/blogs/${article.id}`}
                  className="group flex h-full flex-col rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm transition-[transform,box-shadow,border-color] duration-200 ease-out hover:border-emerald-200 hover:shadow-md active:scale-[0.99]"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#00634B]">
                      <Tag className="h-3 w-3" aria-hidden />
                      {article.category}
                    </span>
                    {typeof article.similarity === "number" ? (
                      <span className="text-[10px] font-semibold text-slate-300">
                        {Math.round(article.similarity * 100)}% match
                      </span>
                    ) : null}
                  </div>
                  <h3
                    className={cn(
                      instrumentSerif.className,
                      "mb-2 line-clamp-2 text-lg leading-snug text-slate-900 transition-colors duration-200 group-hover:text-[#00634B]"
                    )}
                  >
                    {article.title}
                  </h3>
                  <p className="mb-4 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-500">
                    {article.summary}
                  </p>
                  <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                      <Clock className="h-3 w-3" aria-hidden />
                      {article.read_minutes || 5} min read
                    </span>
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#00634B]">
                      Read
                      <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              </MotionListItem>
            ))}
          </motion.ul>
        </>
      ) : hasSearched ? (
        <OperateEmptyState
          icon={Search}
          title="No articles found"
          description="Try rephrasing your query or using different keywords."
        />
      ) : (
        <motion.p
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, ease: EASE_OUT }}
          className="py-12 text-center text-sm text-slate-400"
        >
          Start typing to search our legal knowledge base.
        </motion.p>
      )}
    </OperateLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#00634B]" />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
