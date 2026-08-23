"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Clock,
  MessageSquarePlus,
  Phone,
  Scale,
  Shield,
  Users,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useArticlesPanel } from "@/context/ArticlesPanelContext";
import { useGlobalChat } from "@/context/ChatContext";
import {
  LEGAL_LIBRARY_LINKS,
  MOCK_TRACKING_CASES,
  URGENT_HELPLINES,
  type TrackingCase,
} from "@/lib/home/mockData";
import { hasSidebarCaseContent, toSidebarSession } from "@/lib/home/sessionHelpers";
import { dmSans, instrumentSerif } from "@/lib/fonts";
import { DURATION, EASE_OUT, focusRing, pressable, pressableCard, pressableSubtle, touchIconButton } from "@/lib/motion";
import { cn } from "@/lib/utils";

const statusToneClass: Record<TrackingCase["statusTone"], string> = {
  amber: "bg-amber-100 text-amber-800 border-amber-200",
  emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
  blue: "bg-blue-100 text-blue-800 border-blue-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
};

function formatRelative(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return "Recently";
  }
}

const QUICK_ACTIONS = [
  {
    href: "/cases",
    label: "Start a new case",
    desc: "Describe your issue and get guided next steps",
    icon: MessageSquarePlus,
    accent: "text-[#00634B]",
  },
  {
    href: "/find-help",
    label: "Find legal help",
    desc: "Lawyers, NyayGuides, and Sahayaks near you",
    icon: Users,
    accent: "text-teal-700",
  },
  {
    href: "/my-cases",
    label: "Formalised cases",
    desc: "Track complaints filed through NyaySahayak",
    icon: Briefcase,
    accent: "text-slate-700",
  },
  {
    href: "/legal-rights",
    label: "Legal library",
    desc: "Know your rights, templates, and key Acts",
    icon: BookOpen,
    accent: "text-emerald-800",
  },
] as const;

export function HomeDashboard() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const articlesPanel = useArticlesPanel();
  const { sessionCache, setActiveSessionId, setActiveSession, beginNewCase } = useGlobalChat();

  const displayName =
    user?.display_name?.trim() ||
    user?.email?.split("@")[0] ||
    user?.mobile ||
    "there";

  const recentSessions = useMemo(() => {
    return sessionCache.filter(hasSidebarCaseContent).map(toSidebarSession).slice(0, 4);
  }, [sessionCache]);

  const latestFormal = MOCK_TRACKING_CASES[0];

  const openCase = (sessionId: string) => {
    setActiveSessionId(sessionId);
    const cached = sessionCache.find((s) => s.id === sessionId);
    setActiveSession(cached?.session_data ? cached.session_data : null);
    router.push(`/cases?session=${encodeURIComponent(sessionId)}`);
  };

  const startNewCase = () => {
    beginNewCase();
    router.push("/cases");
  };

  return (
    <div className={cn(dmSans.className, "mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10")}>
      <motion.header
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.enter, ease: EASE_OUT }}
        className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className={cn(instrumentSerif.className, "text-2xl text-slate-900 sm:text-3xl")}>
            Welcome back, {displayName}
          </p>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-500">
            Your legal workspace — pick up a case, find help, or explore your rights.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {articlesPanel && !articlesPanel.isOpen && (
            <button
              type="button"
              onClick={articlesPanel.open}
              aria-label="Open article search"
              title="Search articles"
              className={cn(
                touchIconButton,
                focusRing,
                pressableSubtle,
                "hidden h-10 w-10 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-[#00634B] shadow-sm hover:border-emerald-200 hover:bg-emerald-50/40 md:inline-flex"
              )}
            >
              <BookOpen className="h-4 w-4" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push("/search")}
            aria-label="Search articles"
            title="Search articles"
            className={cn(
              touchIconButton,
              focusRing,
              pressableSubtle,
              "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-[#00634B] shadow-sm hover:border-emerald-200 hover:bg-emerald-50/40 md:hidden"
            )}
          >
            <BookOpen className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={startNewCase}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#00634B] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/15 hover:bg-[#014D3C]",
              pressable
            )}
          >
            <MessageSquarePlus className="h-4 w-4" />
            New case
          </button>
        </div>
      </motion.header>

      <section className="mb-8">
        <h2 className={cn(instrumentSerif.className, "mb-3 text-xs uppercase tracking-[0.12em] text-[#00634B]")}>
          Quick actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {QUICK_ACTIONS.map((action, i) => {
            const Icon = action.icon;
            const inner = (
              <>
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-md bg-slate-50", action.accent)}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{action.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{action.desc}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
              </>
            );

            return (
              <motion.div
                key={action.href}
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduceMotion ? 0 : 0.05 * i, duration: DURATION.enter, ease: EASE_OUT }}
              >
                {action.href === "/cases" ? (
                  <button
                    type="button"
                    onClick={startNewCase}
                    className={cn(
                      "motion-hover-card flex w-full items-center gap-3 rounded-lg border border-slate-200/80 bg-white p-4 text-left shadow-sm",
                      pressableCard
                    )}
                  >
                    {inner}
                  </button>
                ) : (
                  <Link
                    href={action.href}
                    className={cn(
                      "motion-hover-card flex items-center gap-3 rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm",
                      pressableCard
                    )}
                  >
                    {inner}
                  </Link>
                )}
              </motion.div>
            );
          })}
        </div>
      </section>

      <div className="mb-8 grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className={cn(instrumentSerif.className, "text-xs uppercase tracking-[0.12em] text-[#00634B]")}>
              Continue your cases
            </h2>
            <Link href="/cases" className="text-xs font-semibold text-[#00634B] hover:underline">
              Open workspace
            </Link>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
            {recentSessions.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-slate-500">No cases yet.</p>
                <button
                  type="button"
                  onClick={startNewCase}
                  className="mt-3 text-sm font-semibold text-[#00634B] hover:underline"
                >
                  Start your first case
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentSessions.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => openCase(session.id)}
                      className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{session.title}</p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{session.preview}</p>
                      </div>
                      <span className="shrink-0 text-[10px] text-slate-400">
                        {formatRelative(session.updated_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className={cn(instrumentSerif.className, "text-xs uppercase tracking-[0.12em] text-[#00634B]")}>
              Formalised case
            </h2>
            <Link href="/my-cases" className="text-xs font-semibold text-[#00634B] hover:underline">
              View all
            </Link>
          </div>
          <div className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold text-slate-900">{latestFormal.title}</p>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  statusToneClass[latestFormal.statusTone]
                )}
              >
                {latestFormal.status}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{latestFormal.nextStep}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Shield className="h-3 w-3" />
                {latestFormal.involved}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {latestFormal.updated}
              </span>
            </div>
          </div>
        </section>
      </div>

      <section className="mb-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 p-4">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-900">
            <Phone className="h-3.5 w-3.5" />
            Urgent helplines
          </p>
          <ul className="space-y-2">
            {URGENT_HELPLINES.slice(0, 3).map((h) => (
              <li key={h.number}>
                <a href={`tel:${h.number.replace(/\D/g, "")}`} className="block text-sm">
                  <span className="font-semibold text-slate-800">{h.label}</span>
                  <span className="ml-1 font-bold text-[#00634B]">{h.number}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Scale className="h-3.5 w-3.5 text-[#00634B]" />
            Legal library
          </p>
          <ul className="space-y-2">
            {LEGAL_LIBRARY_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="group block rounded-md px-1 py-1 transition hover:bg-slate-50"
                >
                  <span className="text-sm font-medium text-slate-900 group-hover:text-[#00634B]">
                    {link.title}
                  </span>
                  <span className="block text-xs text-slate-500">{link.desc}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
