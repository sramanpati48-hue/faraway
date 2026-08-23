"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, PanelLeftOpen } from "lucide-react";
import { HomeSidebar } from "@/components/home/HomeSidebar";
import { HomeMobileTabBar } from "@/components/home/HomeMobileTabBar";
import { HomeProfileMenu } from "@/components/home/HomeProfileMenu";
import { NotificationsInbox } from "@/components/home/NotificationsInbox";
import { ArticlesSearchPanel } from "@/components/home/ArticlesSearchPanel";
import { HomeSplashIntro } from "@/components/dashboard/HomeSplashIntro";
import {
  PublicExploreShell,
  isPublicExplorePath,
} from "@/components/landing/PublicExploreShell";
import { instrumentSerif } from "@/lib/fonts";
import {
  DURATION,
  sidebarPadMotion,
} from "@/lib/motion";
import { ArticlesPanelProvider } from "@/context/ArticlesPanelContext";
import { ChatProvider } from "@/context/ChatContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { LawyerProvider } from "@/context/LawyerContext";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const LABEL_MS = Math.round(DURATION.sidebarLabel * 1000);

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  /** User intent + persistence */
  const [collapsed, setCollapsed] = useState(false);
  /** Actual rail width — lags labels on collapse, leads on expand */
  const [railNarrow, setRailNarrow] = useState(false);
  /** Nav/brand text + cases list visibility */
  const [showChrome, setShowChrome] = useState(true);
  /** Cases history drawer on small screens — always starts closed */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [articlesOpen, setArticlesOpen] = useState(true);
  const phaseTimerRef = useRef<number | null>(null);
  const isPublic = isPublicExplorePath(pathname);
  const isHomeRoute = pathname === "/home";
  const articlesPanelOpen = isHomeRoute && articlesOpen;

  const clearPhaseTimer = () => {
    if (phaseTimerRef.current != null) {
      window.clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
  };

  const setCollapsedState = useCallback((next: boolean, animate: boolean) => {
    clearPhaseTimer();
    setCollapsed(next);
    try {
      localStorage.setItem("nyaya_home_sidebar_collapsed", next ? "1" : "0");
    } catch {
      /* ignore */
    }

    if (!animate || prefersReducedMotion()) {
      setRailNarrow(next);
      setShowChrome(!next);
      return;
    }

    // Collapse: fade labels → then shrink width. Expand: grow width → then reveal labels.
    if (next) {
      setShowChrome(false);
      phaseTimerRef.current = window.setTimeout(() => {
        setRailNarrow(true);
        phaseTimerRef.current = null;
      }, LABEL_MS);
    } else {
      setRailNarrow(false);
      phaseTimerRef.current = window.setTimeout(() => {
        setShowChrome(true);
        phaseTimerRef.current = null;
      }, LABEL_MS + 40);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("nyaya_home_sidebar_collapsed") === "1";
      setCollapsed(stored);
      setRailNarrow(stored);
      setShowChrome(!stored);
    } catch {
      /* ignore */
    }
    return () => clearPhaseTimer();
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/cases")}`);
    }
  }, [user, loading, router, pathname, isPublic]);

  useEffect(() => {
    if (pathname === "/home") setArticlesOpen(true);
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileNavOpen]);

  const toggleSidebar = () => {
    setCollapsedState(!collapsed, true);
  };

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#F8F9FA] text-[#00634B]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Guests: public explore tools only
  if (!user) {
    if (!isPublic) {
      return (
        <div className="flex min-h-[100dvh] items-center justify-center bg-[#F8F9FA] text-[#00634B]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      );
    }
    return <PublicExploreShell>{children}</PublicExploreShell>;
  }

  const isCasesRoute = pathname.startsWith("/cases");
  const isClashRoute = pathname.startsWith("/clash");
  const isFullHeightRoute = isCasesRoute || isClashRoute;
  const mainPad = railNarrow ? "md:pl-[4.5rem]" : "md:pl-72";

  return (
    <ArticlesPanelProvider
      value={{
        isOpen: articlesPanelOpen,
        open: () => setArticlesOpen(true),
        close: () => setArticlesOpen(false),
      }}
    >
    <div className="flex min-h-[100dvh] bg-[#F8F9FA]">
      <HomeSplashIntro />
      <Suspense fallback={null}>
        <HomeSidebar
          collapsed={collapsed}
          railNarrow={railNarrow}
          showChrome={showChrome}
          onToggle={toggleSidebar}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
        />
      </Suspense>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          sidebarPadMotion,
          mainPad,
          articlesPanelOpen && "md:pr-80",
          isClashRoute && "h-[100dvh] max-h-[100dvh] overflow-hidden"
        )}
      >
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-2.5 backdrop-blur-md pt-[max(0.65rem,env(safe-area-inset-top))] md:hidden">
          {isCasesRoute && (
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open case history"
              className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50/40"
            >
              <Image
                src="/2.png"
                alt=""
                width={28}
                height={28}
                className="object-contain"
              />
              <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[#00634B] shadow-sm ring-1 ring-slate-100">
                <PanelLeftOpen className="h-2.5 w-2.5" />
              </span>
            </button>
          )}
          <span className={cn(instrumentSerif.className, "text-[17px] leading-none tracking-[0.06em] text-[#00634B]")}>
            Nyay<span className="text-slate-900">Sahayak</span>
          </span>
          <NotificationsInbox className="ml-auto" align="right" />
          <HomeProfileMenu variant="header" />
        </header>

        <main
          className={cn(
            isFullHeightRoute
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "min-h-0 flex-1 overflow-y-auto",
            "pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-0"
          )}
        >
          {children}
        </main>
      </div>
      <ArticlesSearchPanel open={articlesPanelOpen} onClose={() => setArticlesOpen(false)} />
      <HomeMobileTabBar />
    </div>
    </ArticlesPanelProvider>
  );
}

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      <LanguageProvider>
        <LawyerProvider>
          <AppShellInner>{children}</AppShellInner>
        </LawyerProvider>
      </LanguageProvider>
    </ChatProvider>
  );
}
