"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { BookOpen, Map, Search, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { dmSans, instrumentSerif } from "@/lib/fonts";
import { focusRing, pressable } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const PUBLIC_EXPLORE_PATHS = [
  "/find-help",
  "/search",
  "/legal-rights",
  "/scam-heatmap",
] as const;

export function isPublicExplorePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return PUBLIC_EXPLORE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

const TOOLS = [
  { href: "/find-help", label: "Find a lawyer", icon: Users },
  { href: "/search", label: "Search articles", icon: Search },
  { href: "/legal-rights", label: "Legal library", icon: BookOpen },
  { href: "/scam-heatmap", label: "Scam heatmap", icon: Map },
] as const;

/** Lightweight chrome for explore tools — works without login. */
export function PublicExploreShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={cn(dmSans.className, "flex min-h-[100dvh] flex-col bg-[#F8F9FA]")}>
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className={cn("flex min-w-0 items-center gap-2.5 rounded-lg", focusRing)}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm">
              <Image src="/2.png" alt="" width={22} height={22} className="object-contain" />
            </div>
            <span className="truncate text-sm font-semibold text-slate-900">
              Nyay<span className="text-[#00634B]">Sahayak</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Explore tools">
            {TOOLS.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    focusRing,
                    active
                      ? "bg-emerald-50 text-[#00634B]"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), pressable)}
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className={cn(
                buttonVariants({ size: "sm" }),
                pressable,
                "bg-[#00634B] hover:bg-[#014D3C]"
              )}
            >
              Get started
            </Link>
          </div>
        </div>

        <nav
          className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 md:hidden"
          aria-label="Explore tools mobile"
        >
          {TOOLS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold",
                  focusRing,
                  active
                    ? "bg-emerald-50 text-[#00634B]"
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-slate-200/60 bg-white px-4 py-3 sm:px-6">
          <p className={cn(instrumentSerif.className, "text-xs tracking-[0.04em] text-[#00634B]")}>
            Explore without an account
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            Browse tools freely. Sign up when you want to start a case or save progress.
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}
