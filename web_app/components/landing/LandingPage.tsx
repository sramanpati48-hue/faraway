"use client";

/**
 * THESIS: NyaySahayak is an India-specific legal companion — agentic routing,
 * grounded guidance, persistent cases, and a human ladder — not a generic chatbot.
 * OWN-WORLD: Emerald #00634B on white/#F8F9FA; Instrument Serif + DM Sans; hairline
 * borders; calm Persuade energy (DESIGN.md).
 * STORY: Dignity → clarity → proof of routing/handoff → trust → signup.
 * FIRST VIEWPORT: Brand + hero headline + one support line + Start free + live product preview.
 * FORM: Established landing world, content IA rebuilt from LANDING_PAGE_CONTENT_STRATEGY.md.
 */

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useInView, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { ArrowRight, Check, ChevronDown, Clock, Menu, Scale, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductPreview } from "@/components/landing/ProductPreview";
import { ExploreBentoGrid } from "@/components/landing/ExploreBentoGrid";
import { HumanHelpColumns } from "@/components/landing/HumanHelpColumns";
import { ScrollShowcase } from "@/components/landing/ScrollShowcase";
import {
  AI_SPECIALISTS,
  COMPARISON_ROWS,
  CONTINUITY_ITEMS,
  EXPLORE_TOOLS,
  FAQ_ITEMS,
  FOOTER_LINKS,
  HELPLINES,
  HELP_AREAS,
  HOW_IT_WORKS,
  HUMAN_LADDER,
  NAV_LINKS,
} from "@/components/landing/landing-data";
import {
  fetchLandingArticles,
  fetchLandingMarketingContent,
  getFallbackLandingMarketingContent,
  type LandingArticle,
  type LandingMarketingContent,
  type LandingStat,
} from "@/lib/landing/landingContent";
import { dmSans, instrumentSerif } from "@/lib/fonts";
import { focusRing, pressable, touchIconButton, touchNavRow } from "@/lib/motion";
import { cn } from "@/lib/utils";

function AnimatedStat({
  value,
  suffix,
  reduceMotion,
}: {
  value: number;
  suffix: string;
  reduceMotion: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const spring = useSpring(reduceMotion ? value : 0, { stiffness: 60, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v));

  useEffect(() => {
    if (reduceMotion || !inView) return;
    spring.set(value);
  }, [inView, reduceMotion, spring, value]);

  useEffect(() => {
    if (reduceMotion) return;
    return display.on("change", (v) => {
      if (ref.current) ref.current.textContent = `${v}${suffix}`;
    });
  }, [display, reduceMotion, suffix]);

  if (reduceMotion) {
    return (
      <span className="tabular-nums">
        {value}
        {suffix}
      </span>
    );
  }

  return (
    <span ref={ref} className="tabular-nums">
      0{suffix}
    </span>
  );
}

function StatValue({ stat, reduceMotion }: { stat: LandingStat; reduceMotion: boolean }) {
  if (stat.numeric != null) {
    return <AnimatedStat value={stat.numeric} suffix={stat.suffix ?? ""} reduceMotion={reduceMotion} />;
  }
  return <span>{stat.display}</span>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className={cn(instrumentSerif.className, "text-[2.25rem] leading-none tracking-[0.02em] text-[#00634B]")}>
      {children}
    </p>
  );
}

function HeroKenyaBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative w-full max-w-xl overflow-hidden rounded-2xl",
        "border border-white/35 ring-1 ring-slate-900/15",
        "shadow-[0_20px_48px_-22px_rgba(15,23,42,0.5),0_8px_20px_-10px_rgba(15,23,42,0.28)]",
        className
      )}
    >
      <div className="relative aspect-[16/5] w-full sm:aspect-[10/3] lg:aspect-[16/5]">
        <Image
          src="/landing/coming-soon-kenya.png"
          alt=""
          fill
          className="object-cover object-center"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 240px, 576px"
          priority
        />
        <div className="absolute inset-0 bg-slate-950/25" aria-hidden />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center text-white">
          <span
            className={cn(
              dmSans.className,
              "text-[10px] font-semibold uppercase tracking-[0.32em] text-white/90 sm:text-[11px]"
            )}
          >
            Expanding next
          </span>
          <p className={cn(instrumentSerif.className, "mt-1.5 text-2xl font-medium tracking-[0.02em] sm:text-3xl")}>
            Kenya is coming soon
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionIntro({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <SectionLabel>{label}</SectionLabel>
      <h2 className={cn(instrumentSerif.className, "mt-3 text-3xl text-slate-900 sm:text-4xl")}>{title}</h2>
      {body ? <p className="mt-4 text-base leading-relaxed text-slate-600">{body}</p> : null}
    </div>
  );
}

function PrimaryCta({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        buttonVariants({ size: "lg" }),
        pressable,
        "h-11 inline-flex items-center gap-1 bg-[#00634B] px-6 hover:bg-[#014D3C]",
        className
      )}
    >
      {children}
    </Link>
  );
}

function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!toolsRef.current?.contains(e.target as Node)) setToolsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setToolsOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [toolsOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4 sm:pt-4">
      <div
        className={cn(
          dmSans.className,
          "pointer-events-auto relative mx-auto flex h-12 max-w-3xl items-center gap-2 rounded-full border border-white/15 bg-[#0B1F1A]/62 px-2 pl-3 shadow-[0_8px_32px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,99,75,0.12)] backdrop-blur-xl sm:h-14 sm:gap-3 sm:px-2.5 sm:pl-4"
        )}
      >
        <Link
          href="/"
          className={cn("flex min-w-0 shrink-0 items-center gap-2 rounded-full py-1 pr-1", focusRing)}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/95 shadow-sm">
            <Image src="/2.png" alt="NyaySahayak" width={20} height={20} className="object-contain" />
          </div>
          <span className="hidden truncate text-sm font-semibold text-white sm:inline">
            Nyay<span className="text-emerald-200">Sahayak</span>
          </span>
        </Link>

        <nav
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-0.5 lg:flex"
          aria-label="Primary"
        >
          {NAV_LINKS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white",
                focusRing
              )}
            >
              {item.label}
            </a>
          ))}

          <div className="relative" ref={toolsRef}>
            <button
              type="button"
              aria-expanded={toolsOpen}
              aria-haspopup="menu"
              onClick={() => setToolsOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white",
                focusRing,
                toolsOpen && "bg-white/10 text-white"
              )}
            >
              Tools
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-150 ease-out",
                  toolsOpen && "rotate-180"
                )}
                aria-hidden
              />
            </button>

            {toolsOpen ? (
              <div
                role="menu"
                aria-label="Public tools"
                className="absolute left-1/2 top-[calc(100%+1.25rem)] z-50 w-72 -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#0B1F1A]/95 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl"
              >
                {EXPLORE_TOOLS.map(({ title, desc, href, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    role="menuitem"
                    onClick={() => setToolsOpen(false)}
                    className={cn(
                      "flex gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/10",
                      focusRing
                    )}
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-200">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white">{title}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-emerald-100/65">{desc}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Link
            href="/login"
            className={cn(
              pressable,
              "hidden rounded-full px-3 py-1.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white sm:inline-flex",
              focusRing
            )}
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className={cn(
              "cursor-pointer inline-flex items-center rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold text-[#014D3C]",
              "transition-[transform,box-shadow,background-color] duration-150 ease-out hover:bg-emerald-50",
              "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_-2px_3px_rgba(0,99,75,0.12),0_1px_0_rgba(255,255,255,0.35),0_3px_0_0_rgba(0,77,60,0.35),0_4px_10px_rgba(0,0,0,0.28)]",
              "hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_-2px_3px_rgba(0,99,75,0.1),0_1px_0_rgba(255,255,255,0.35),0_4px_0_0_rgba(0,77,60,0.35),0_6px_14px_rgba(0,0,0,0.3)]",
              "active:translate-y-[2px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_2px_4px_rgba(0,99,75,0.16),0_1px_0_0_rgba(0,77,60,0.2)]",
              focusRing
            )}
          >
            Sign up
          </Link>
          <button
            type="button"
            className={cn(
              touchIconButton,
              focusRing,
              "rounded-full text-white/80 hover:bg-white/10 hover:text-white lg:hidden"
            )}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div
          className={cn(
            dmSans.className,
            "pointer-events-auto mx-auto mt-2 max-w-3xl overflow-hidden rounded-2xl border border-white/15 bg-[#0B1F1A]/92 p-3 shadow-xl backdrop-blur-xl lg:hidden"
          )}
        >
          <nav className="flex flex-col gap-0.5" aria-label="Mobile">
            {NAV_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={cn(
                  touchNavRow,
                  focusRing,
                  "flex rounded-xl px-3 py-2.5 text-sm font-medium text-white/85 hover:bg-white/10"
                )}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <p className="mt-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200/70">
              Tools
            </p>
            {EXPLORE_TOOLS.map(({ title, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  touchNavRow,
                  focusRing,
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-white/85 hover:bg-white/10"
                )}
                onClick={() => setMobileOpen(false)}
              >
                <Icon className="h-4 w-4 text-emerald-200" aria-hidden />
                {title}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3 sm:hidden">
              <Link
                href="/login"
                className={cn(
                  pressable,
                  "rounded-full border border-white/20 px-4 py-2.5 text-center text-sm font-semibold text-white",
                  focusRing
                )}
                onClick={() => setMobileOpen(false)}
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className={cn(
                  "cursor-pointer rounded-full bg-white px-4 py-2.5 text-center text-sm font-semibold text-[#014D3C]",
                  "transition-[transform,box-shadow,background-color] duration-150 ease-out",
                  "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_-2px_3px_rgba(0,99,75,0.12),0_1px_0_rgba(255,255,255,0.35),0_3px_0_0_rgba(0,77,60,0.35),0_4px_10px_rgba(0,0,0,0.28)]",
                  "active:translate-y-[2px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_2px_4px_rgba(0,99,75,0.16),0_1px_0_0_rgba(0,77,60,0.2)]",
                  focusRing
                )}
                onClick={() => setMobileOpen(false)}
              >
                Sign up
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="border-b border-slate-200/80 last:border-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          dmSans.className,
          pressable,
          "flex w-full items-start justify-between gap-4 rounded-lg py-5 text-left hover:text-[#00634B]",
          focusRing
        )}
      >
        <span className="text-sm font-semibold text-slate-900 sm:text-base">{q}</span>
        <ChevronDown
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ease-out motion-reduce:transition-none",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <p id={panelId} className={cn(dmSans.className, "pb-5 text-sm leading-relaxed text-slate-600")}>
          {a}
        </p>
      ) : null}
    </div>
  );
}

export function LandingPage() {
  const reduceMotion = useReducedMotion() ?? false;
  const [marketing, setMarketing] = useState<LandingMarketingContent | null>(null);
  const [articles, setArticles] = useState<LandingArticle[] | null>(null);

  useEffect(() => {
    let active = true;
    fetchLandingMarketingContent()
      .then((content) => {
        if (active) setMarketing(content);
      })
      .catch(() => {
        if (active) setMarketing(getFallbackLandingMarketingContent());
      });
    fetchLandingArticles(3)
      .then((items) => {
        if (active) setArticles(items);
      })
      .catch(() => {
        if (active) setArticles([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const resolvedMarketing = marketing ?? getFallbackLandingMarketingContent();

  return (
    <div className={cn(dmSans.className, "min-h-screen bg-white text-slate-900 antialiased")}>
      <LandingNav />

      <section className="relative pt-16 sm:pt-[4.5rem]">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(0,99,75,0.07),transparent)]"
          aria-hidden
        />
        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-8 sm:px-6 sm:pb-20 sm:pt-10 lg:grid-cols-2 lg:items-start lg:gap-16 lg:pb-24 lg:pt-12">
            <div className="motion-enter-fade">
              <Badge variant="outline" className="mb-6 border-emerald-200/80 bg-emerald-50/50 text-[#00634B]">
                Legal help for all
              </Badge>
              <div className="grid gap-6 max-lg:sm:grid-cols-[minmax(0,1fr)_minmax(0,13.5rem)] max-lg:sm:items-end lg:grid-cols-1 lg:items-stretch">
                <div className="min-w-0 max-w-xl">
                  <h1
                    className={cn(
                      instrumentSerif.className,
                      "text-4xl leading-[1.12] tracking-[-0.02em] text-slate-900 sm:text-5xl lg:text-[3.25rem]"
                    )}
                  >
                    You deserve to be heard — and understood.
                  </h1>
                  <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
                    Describe what happened in your own words. NyaySahayak helps you understand your rights under
                    Indian law, know what to do next, and connect with human help — without starting over.
                  </p>
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <PrimaryCta href="/signup">
                      Start free
                      <ArrowRight className="h-4 w-4" />
                    </PrimaryCta>
                    <Link
                      href="#how-it-works"
                      className={cn(buttonVariants({ variant: "outline", size: "lg" }), pressable, "h-11 px-6")}
                    >
                      See how it works
                    </Link>
                  </div>
                  <p className="mt-4 text-xs text-slate-500">
                    Free to start. Private by default. Human help when AI is not enough.
                  </p>
                </div>
                <HeroKenyaBanner className="max-lg:sm:max-w-none lg:mt-2" />
              </div>
            </div>

            <ProductPreview reduceMotion={reduceMotion} />
          </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-t border-slate-200/60 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            label="How it works"
            title="From confusion to a clear next step"
            body="Three steps you can see in the product — not a chatbot monologue that ends when you still need a human."
          />
          <ScrollShowcase
            items={HOW_IT_WORKS.map((item) => ({
              image: item.image,
              title: item.step,
              description: item.detail,
              imageAlt: item.imageAlt,
            }))}
          />
          <div className="mt-12 text-center">
            <PrimaryCta href="/signup">
              Start your first case
              <ArrowRight className="h-4 w-4" />
            </PrimaryCta>
          </div>
        </div>
      </section>

      <section id="explore" className="scroll-mt-20 border-t border-slate-200/60 bg-[#F8F9FA] py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            label="Explore without an account"
            title="Useful tools before you sign up"
            body="Browse the scam heatmap, find lawyers, search articles, and read the legal library — no login required. Create an account when you’re ready to start a case."
          />
          <ExploreBentoGrid items={EXPLORE_TOOLS} />
        </div>
      </section>

      <section id="human-help" className="scroll-mt-20 border-t border-slate-200/60 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            label="Human help"
            title="AI first. Humans when it matters."
            body="Trust isn’t only about clever answers — it’s knowing a person can take over without losing your story."
          />
          <HumanHelpColumns items={[...HUMAN_LADDER]} />
          <div className="mx-auto mt-12 max-w-3xl border-t border-slate-200/80 pt-8">
            <p className="text-sm font-semibold text-slate-900">Also: Gram Nyayalaya pathway</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
              For eligible local matters, NyaySahayak can offer a Nodal Guide handoff toward Gram Nyayalaya —
              a distinctive India justice path, not just another lawyer search.
            </p>
          </div>
          <div className="mt-10 text-center">
            <Link
              href="/signup"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), pressable, "h-11 px-6")}
            >
              Create account to find legal help
            </Link>
          </div>
        </div>
      </section>

      <section id="clash" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-center lg:gap-12">
          <div className="min-w-0 lg:max-w-[26rem]">
            <SectionLabel>Clash Mode</SectionLabel>
            <h2 className={cn(instrumentSerif.className, "mt-3 text-3xl text-slate-900 sm:text-4xl")}>
              Practice the argument. Understand both sides.
            </h2>
            <p className="mt-4 max-w-[36ch] text-base leading-snug text-slate-600">
              Prosecution and defence debate your scenario in a practice courtroom — or frame a real case from
              both sides. Educational only; not a court ruling or substitute for counsel.
            </p>
            <p className="mt-3 text-sm leading-snug text-slate-500">
              Explore when you want preparedness — not when you need emergency support.
            </p>
            <Link
              href="/signup"
              className={cn(
                "mt-6 inline-flex items-center gap-1 rounded-md text-sm font-semibold text-[#00634B] hover:text-[#014D3C]",
                focusRing
              )}
            >
              Explore after signup
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.16),0_8px_24px_-12px_rgba(15,23,42,0.08)] sm:p-4">
            <div className="overflow-hidden rounded-xl border border-slate-200/70 bg-[#F8F9FA]">
              <div className="relative aspect-[4/3] w-full sm:aspect-[16/10] lg:aspect-[16/11]">
                <Image
                  src="/landing/clash-mode/courtroom-preview.png"
                  alt="Clash Mode courtroom with prosecutor and defender argument cards"
                  fill
                  className="object-cover object-top"
                  sizes="(max-width: 1024px) 100vw, 720px"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <SectionLabel>The problem</SectionLabel>
            <h2 className={cn(instrumentSerif.className, "mt-3 text-3xl text-slate-900 sm:text-4xl")}>
              Legal trouble rarely arrives with clear instructions.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Police or cyber cell? Consumer forum or lawyer? A blog that doesn’t fit India? Fear of saying
              the wrong thing freezes people — and generic AI often makes it worse.
            </p>
            <Link
              href="#how-it-works"
              className={cn(
                "mt-6 inline-flex items-center gap-1 rounded-md text-sm font-semibold text-[#00634B] transition-colors hover:text-[#014D3C]",
                focusRing
              )}
            >
              See the calmer path
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-3">
            <div className="rounded-xl border border-slate-200/80 bg-[#F8F9FA] p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Scattered options</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">
                WhatsApp advice · random blogs · generic chatbots · unread helpline posters · starting over
                with every new person
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#00634B]">One calm workspace</p>
              <p className="mt-2 text-sm leading-relaxed text-emerald-950">
                Start a case → guided chat &amp; drafts → human help &amp; tracked status
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="situations" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionIntro
          label="Situations"
          title="Start wherever you are"
          body="Everyday citizen issues — from cyber fraud to FIR guidance. Pick a familiar situation; the product routes from there."
        />
        <ul className="mt-12 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {HELP_AREAS.map(({ title, desc, icon: Icon }) => (
            <li key={title} className="flex gap-3 border-t border-slate-200/80 pt-5">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#00634B]" aria-hidden />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section id="ai" className="scroll-mt-20 border-t border-slate-200/60 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            label="Specialist AI"
            title="Not one generic chatbot — paths for real Indian situations"
            body="A supervisor routes your case to specialist flows grounded in Indian Acts and procedures. Coverage grows with our legal corpus — we won’t pretend every question is equally covered."
          />
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AI_SPECIALISTS.map((s) => (
              <div key={s.name} className="rounded-xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
                <p className="text-sm font-semibold text-slate-900">{s.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-col items-center gap-3">
            <PrimaryCta href="/signup">Ask your first question free</PrimaryCta>
            <p className="text-center text-xs text-slate-500">
              Plus voice input, evidence upload, and case history that stays with you.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200/60 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            label="Continuity"
            title="Drafts, evidence, and a case that doesn’t forget you"
            body="Functional value after the emotional promise — so the next human you talk to isn’t starting cold."
          />
          <div className="mt-12 grid gap-8 sm:grid-cols-2">
            {CONTINUITY_ITEMS.map((item) => (
              <div key={item.title} className="flex gap-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#00634B]" aria-hidden />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="scroll-mt-20 border-t border-slate-200/60 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <SectionLabel>Safety &amp; privacy</SectionLabel>
          <h2 className={cn(instrumentSerif.className, "mt-3 text-3xl text-slate-900 sm:text-4xl")}>
            Private by default. Extra care for sensitive cases.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Conversations stay with your account so your case can continue. Escalations go to trained humans
            only when needed. Sensitive matters get screening and calmer pathways — never sensational
            treatment. We are not a substitute for emergency services.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/privacy"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), pressable, "h-11 px-6")}
            >
              Read Privacy Policy
            </Link>
            <Link
              href="/terms"
              className={cn("rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:text-[#00634B]", focusRing)}
            >
              Terms of Use
            </Link>
          </div>
        </div>
      </section>

      <section id="helplines" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionIntro
          label="When you need institutions"
          title="We guide you toward help — we don’t replace it"
          body="NyaySahayak can point you to emergency and legal-aid channels used across India. No fake partnership seals — just honest routing."
        />
        <ul className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
          {HELPLINES.map((h) => (
            <li
              key={h.number}
              className="flex items-start gap-4 rounded-xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm"
            >
              <span className="text-lg font-semibold tabular-nums text-[#00634B]">{h.number}</span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{h.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{h.note}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-slate-500">
          In immediate danger, dial <span className="font-semibold text-slate-700">112</span> first. Cyber
          reports also via cybercrime.gov.in.
        </p>
      </section>

      <section className="border-y border-slate-200/60 bg-white py-16 sm:py-20" aria-busy={!marketing}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-center text-xs font-medium text-slate-400">
            Process honesty — not vanity metrics we can’t defend
          </p>
          <div className="mt-8 grid grid-cols-2 gap-8 lg:grid-cols-4">
            {resolvedMarketing.stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-2xl font-semibold text-[#00634B] sm:text-3xl">
                  <StatValue stat={stat} reduceMotion={reduceMotion} />
                </p>
                <p className="mt-2 text-xs font-medium text-slate-500 sm:text-sm">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="articles" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionIntro
          label="Legal library"
          title="Search articles"
          body="Learn about real-life issues across India — rights, procedures, and what to do next, in plain language."
        />
        {articles === null ? (
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-200/80 bg-slate-50" />
            ))}
          </div>
        ) : articles.length > 0 ? (
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <li key={article.id}>
                <Link
                  href={`/blogs/${article.id}`}
                  className={cn(
                    "group flex h-full flex-col rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm transition-[border-color,box-shadow] duration-150 ease-out hover:border-emerald-200 hover:shadow-md",
                    focusRing
                  )}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#00634B]">
                    {article.category}
                  </span>
                  <h3
                    className={cn(
                      instrumentSerif.className,
                      "mt-2 line-clamp-2 text-lg leading-snug text-slate-900 group-hover:text-[#00634B]"
                    )}
                  >
                    {article.title}
                  </h3>
                  {article.summary ? (
                    <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-500">
                      {article.summary}
                    </p>
                  ) : null}
                  <span className="mt-4 inline-flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden />
                      {article.read_minutes || 5} min read
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-[#00634B]">
                      Read
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-10 text-center">
          <Link
            href="/search"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), pressable, "h-11 px-6")}
          >
            Search articles
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="border-t border-slate-200/60 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            label="Why NyaySahayak"
            title="Different from blogs, generic AI, and directories"
            body="A compact view of what actually changes the first mile of justice access."
          />
          <div className="mt-12 overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 bg-[#F8F9FA]">
                  <th className="px-4 py-3 font-semibold text-slate-700">Capability</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Blogs</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Generic AI</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Directory</th>
                  <th className="px-4 py-3 font-semibold text-[#00634B]">NyaySahayak</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.capability} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{row.capability}</td>
                    <td className="px-4 py-3 text-slate-500">{row.blogs}</td>
                    <td className="px-4 py-3 text-slate-500">{row.genericAi}</td>
                    <td className="px-4 py-3 text-slate-500">{row.directory}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{row.nyaysahayak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-20 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <SectionIntro label="FAQ" title="Questions you might have" />
          <div className="mt-10 rounded-xl border border-slate-200/80 bg-white px-5 sm:px-8">
            {FAQ_ITEMS.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
        <div className="rounded-xl border border-slate-200/80 bg-[#F8F9FA] px-6 py-14 text-center sm:px-12">
          <Scale className="mx-auto h-8 w-8 text-[#00634B]" aria-hidden />
          <h2 className={cn(instrumentSerif.className, "mt-4 text-3xl text-slate-900 sm:text-4xl lg:text-5xl")}>
            A place you can trust with what matters
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-slate-600">
            Start with a conversation. No pressure, no jargon — clear guidance, and human help when you need
            it.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <PrimaryCta href="/signup">Create free account</PrimaryCta>
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), pressable, "h-11 px-6")}
            >
              Log in
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200/80 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div>
            <Link href="/" className={cn("flex items-center gap-2 rounded-lg", focusRing)}>
              <Image src="/2.png" alt="" width={28} height={28} className="object-contain" />
              <span className="text-sm font-semibold">NyaySahayak</span>
            </Link>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              AI-powered legal guidance for Indian citizens. Not a law firm — a companion on your path to
              justice.
            </p>
          </div>
          {(
            [
              ["Product", FOOTER_LINKS.product],
              ["Resources", FOOTER_LINKS.resources],
              ["Legal", FOOTER_LINKS.legal],
            ] as const
          ).map(([title, links]) => (
            <div key={title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
              <ul className="mt-3 space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className={cn("rounded-sm text-sm text-slate-600 transition hover:text-[#00634B]", focusRing)}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 py-6 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} NyaySahayak. Guidance and navigation — not guaranteed legal outcomes.
        </div>
      </footer>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 p-3 backdrop-blur-md md:hidden">
        <PrimaryCta href="/signup" className="w-full justify-center">
          Start free
          <ArrowRight className="h-4 w-4" />
        </PrimaryCta>
      </div>
      <div className="h-16 md:hidden" aria-hidden />
    </div>
  );
}
