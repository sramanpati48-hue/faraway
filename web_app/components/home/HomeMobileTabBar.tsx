"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Briefcase,
  HelpCircle,
  Home,
  Map,
  MessageSquarePlus,
  MoreHorizontal,
  Search,
  Shield,
  SquarePen,
  Swords,
  Users,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useGlobalChat } from "@/context/ChatContext";
import { cn } from "@/lib/utils";
import { EASE_OUT, focusRing, pressableSubtle } from "@/lib/motion";
import { dmSans } from "@/lib/fonts";

const TABS = [
  { id: "home", href: "/home", label: "Home", icon: Home, match: (p: string) => p === "/home" },
  {
    id: "clash",
    href: "/clash",
    label: "Clash",
    icon: Swords,
    match: (p: string) => p.startsWith("/clash"),
  },
  {
    id: "cases",
    href: "/cases",
    label: "Cases",
    icon: MessageSquarePlus,
    match: (p: string) => p.startsWith("/cases"),
    fab: true,
  },
  {
    id: "search",
    href: "/search",
    label: "Search",
    icon: Search,
    match: (p: string) => p.startsWith("/search"),
  },
  {
    id: "find-help",
    href: "/find-help",
    label: "Help",
    icon: Users,
    match: (p: string) => p.startsWith("/find-help"),
  },
] as const;

const MORE_ITEMS = [
  { href: "/legal-rights", label: "Legal library", icon: BookOpen, match: (p: string) => p.startsWith("/legal-rights") || p.startsWith("/documents") },
  { href: "/scam-heatmap", label: "Scam heatmap", icon: Map, match: (p: string) => p.startsWith("/scam-heatmap") },
  { href: "/my-cases", label: "Formalised cases", icon: Briefcase, match: (p: string) => p.startsWith("/my-cases") },
  { href: "/help", label: "Help & about", icon: HelpCircle, match: (p: string) => p.startsWith("/help") },
];

export function HomeMobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { role } = useAuth();
  const { beginNewCase } = useGlobalChat();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const isAdmin =
    (role || "").trim().toLowerCase() === "admin" ||
    (role || "").trim().toLowerCase() === "super_admin";

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const moreActive = MORE_ITEMS.some((item) => item.match(pathname)) || pathname.startsWith("/admin");

  return (
    <nav
      className={cn(dmSans.className, "fixed inset-x-0 bottom-0 z-[55] md:hidden")}
      aria-label="Primary"
    >
      <div
        className="relative overflow-visible border-t border-slate-200/80 bg-white/92 px-1 pt-2 shadow-[0_-8px_32px_-12px_rgba(15,23,42,0.18)] backdrop-blur-xl"
        style={{ paddingBottom: "max(0.4rem, env(safe-area-inset-bottom))" }}
      >
        <div className="relative mx-auto grid h-14 max-w-lg grid-cols-5 items-end overflow-visible">
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            const Icon = tab.icon;
            if ("fab" in tab && tab.fab) {
              return (
                <div key={tab.id} className="relative flex h-14 items-end justify-center overflow-visible">
                  <Link
                    href={tab.href}
                    aria-label={tab.label}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      focusRing,
                      "flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-[#00A07A] to-[#00634B] text-white shadow-[0_10px_28px_-6px_rgba(0,99,75,0.55),0_0_0_4px_#fff] transition-transform duration-150 ease-out active:scale-[0.94]",
                      active && "shadow-[0_10px_28px_-6px_rgba(0,99,75,0.55),0_0_0_4px_#fff,0_0_0_7px_rgba(0,99,75,0.28)]"
                    )}
                  >
                    <Icon className="h-7 w-7" strokeWidth={2.1} />
                  </Link>
                </div>
              );
            }
            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-label={tab.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  pressableSubtle,
                  focusRing,
                  "flex h-12 flex-col items-center justify-center rounded-xl",
                  active ? "text-[#00634B]" : "text-slate-400"
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.85} />
              </Link>
            );
          })}

          <div ref={moreRef} className="absolute right-0.5 top-0.5">
            <button
              type="button"
              aria-label="More"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              className={cn(
                focusRing,
                "flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 active:scale-95",
                moreOpen || moreActive ? "bg-emerald-50 text-[#00634B]" : "hover:bg-slate-50 hover:text-slate-600"
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            <AnimatePresence>
              {moreOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                  className="absolute bottom-[calc(100%+0.4rem)] right-0 z-[60] w-52 origin-bottom-right overflow-hidden rounded-2xl border border-slate-200/80 bg-white py-1 shadow-xl shadow-slate-900/12"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      beginNewCase();
                      router.push("/cases");
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 active:bg-slate-50"
                  >
                    <SquarePen className="h-4 w-4 text-[#00634B]" />
                    New case
                  </button>
                  {MORE_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const active = item.match(pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMoreOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2.5 text-sm active:bg-slate-50",
                          active ? "bg-emerald-50/80 font-medium text-[#00634B]" : "text-slate-700"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    );
                  })}
                  {isAdmin && (
                    <Link
                      href="/admin"
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 border-t border-slate-100 px-3 py-2.5 text-sm active:bg-slate-50",
                        pathname.startsWith("/admin") ? "bg-emerald-50/80 font-medium text-[#00634B]" : "text-slate-700"
                      )}
                    >
                      <Shield className="h-4 w-4" />
                      Admin
                    </Link>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </nav>
  );
}
