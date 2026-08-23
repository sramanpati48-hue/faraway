"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Heart, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { ABOUT_FALLBACK, fetchAboutContent, type AboutContent } from "@/lib/about/aboutContent";
import { buttonVariants } from "@/components/ui/button";
import { dmSans, instrumentSerif } from "@/lib/fonts";
import { cn } from "@/lib/utils";

const valueIcons = [Heart, ShieldCheck, Sparkles];

export function PublicAboutView() {
  const [content, setContent] = useState<AboutContent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchAboutContent().then((c) => {
      if (!cancelled) setContent(c);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const c = content || ABOUT_FALLBACK;

  return (
    <div className={cn(dmSans.className, "min-h-screen bg-white text-slate-900")}>
      <header className="sticky top-0 z-10 border-b border-slate-200/60 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-[#00634B]"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
          <Link href="/signup" className={cn(buttonVariants({ size: "sm" }), "bg-[#00634B] hover:bg-[#014D3C]")}>
            Get started
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-[#00634B]" aria-label="Loading" />
          </div>
        ) : (
          <article className="space-y-10">
            <header className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm">
                <Image src="/2.png" alt="NyaySahayak" width={28} height={28} className="object-contain" />
              </div>
              <h1 className={cn(instrumentSerif.className, "text-3xl text-slate-900 sm:text-4xl")}>{c.title}</h1>
              <p className="text-lg leading-relaxed text-slate-600">{c.tagline}</p>
            </header>

            <section className="rounded-xl border border-slate-200/80 bg-[#F8F9FA]/60 p-6 sm:p-8">
              <h2 className={cn(instrumentSerif.className, "text-xl text-slate-900")}>Our mission</h2>
              <p className="mt-3 text-base leading-relaxed text-slate-600">{c.mission}</p>
            </section>

            {c.values && c.values.length > 0 ? (
              <section>
                <h2 className={cn(instrumentSerif.className, "mb-5 text-xl text-slate-900")}>What we stand for</h2>
                <ul className="space-y-4">
                  {c.values.map((v, i) => {
                    const Icon = valueIcons[i % valueIcons.length];
                    return (
                      <li
                        key={v.title}
                        className="flex gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#00634B]">
                          <Icon className="h-5 w-5" aria-hidden />
                        </span>
                        <div>
                          <h3 className="font-semibold text-slate-900">{v.title}</h3>
                          <p className="mt-1 text-sm leading-relaxed text-slate-600">{v.description}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            <footer className="border-t border-slate-200/80 pt-8">
              <p className="text-sm text-slate-500">
                NyaySahayak provides guidance and navigation — not guaranteed legal outcomes. When you need
                representation, connect with a verified professional through the app.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/signup" className={cn(buttonVariants(), "bg-[#00634B] hover:bg-[#014D3C]")}>
                  Create free account
                </Link>
                <Link href="/login" className={cn(buttonVariants({ variant: "outline" }))}>
                  Log in
                </Link>
              </div>
            </footer>
          </article>
        )}
      </main>
    </div>
  );
}
