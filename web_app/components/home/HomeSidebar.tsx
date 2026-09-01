"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type Transition } from "framer-motion";
import {
  BookOpen,
  Briefcase,
  ChevronDown,
  Compass,
  GraduationCap,
  Home,
  Map,
  MessageSquarePlus,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Phone,
  Scale,
  Search,
  Share2,
  SquarePen,
  Swords,
  Trash2,
  Users,
  X,
  Pin,
  HelpCircle,
  Shield,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useGlobalChat } from "@/context/ChatContext";
import { HomeProfileMenu } from "@/components/home/HomeProfileMenu";
import { NotificationsInbox } from "@/components/home/NotificationsInbox";
import {
  MOCK_SIDEBAR_SESSIONS,
  type SidebarCaseSession,
} from "@/lib/home/mockData";
import { hasSidebarCaseContent, toSidebarSession, type CachedChatSession } from "@/lib/home/sessionHelpers";
import { cn } from "@/lib/utils";
import {
  pressableSubtle,
  touchIconButton,
  touchIconButtonCompact,
  touchNavRow,
  focusRing,
  sidebarRailMotion,
  sidebarLabelMotion,
  sidebarLayoutTransition,
  sidebarActionRowMotion,
  EASE_OUT,
  DURATION,
} from "@/lib/motion";
import { dmSans, instrumentSerif } from "@/lib/fonts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const CASE_TITLES_STORAGE_KEY = "nyaya_case_titles";

type NavItemDef = {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: (path: string) => boolean;
};

const PRIMARY_NAV: NavItemDef[] = [
  { id: "home", label: "Home", href: "/home", icon: Home, match: (p) => p === "/home" },
  { id: "find-help", label: "Find legal help", href: "/find-help", icon: Users, match: (p) => p.startsWith("/find-help") },
  {
    id: "library",
    label: "Legal library",
    href: "/legal-rights",
    icon: BookOpen,
    match: (p) => p.startsWith("/legal-rights") || p.startsWith("/documents"),
  },
  {
    id: "heatmap",
    label: "Scam heatmap",
    href: "/scam-heatmap",
    icon: Map,
    match: (p) => p.startsWith("/scam-heatmap"),
  },
  {
    id: "formal",
    label: "Formalised cases",
    href: "/my-cases",
    icon: Briefcase,
    match: (p) => p.startsWith("/my-cases"),
  },
  {
    id: "help",
    label: "Help",
    href: "/help",
    icon: HelpCircle,
    match: (p) => p.startsWith("/help"),
  },
];

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

function highlightText(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  let matchIdx = lower.indexOf(qLower);

  while (matchIdx !== -1) {
    if (matchIdx > start) parts.push(text.slice(start, matchIdx));
    parts.push(
      <span key={`${matchIdx}-${q.length}`} className="font-semibold text-slate-900">
        {text.slice(matchIdx, matchIdx + q.length)}
      </span>
    );
    start = matchIdx + q.length;
    matchIdx = lower.indexOf(qLower, start);
  }

  if (start < text.length) parts.push(text.slice(start));
  return parts.length === 1 ? parts[0] : parts;
}

function CaseSearchSkeleton() {
  return (
    <div className="space-y-1 py-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg px-4 py-3">
          <div className="h-3.5 animate-pulse rounded-sm bg-slate-200/80" style={{ width: `${68 - i * 8}%` }} />
          <div className="h-3 animate-pulse rounded-sm bg-slate-100" style={{ width: `${92 - i * 6}%` }} />
        </div>
      ))}
    </div>
  );
}

function SidebarCasesSkeleton() {
  return (
    <div className="space-y-0.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg px-3 py-2.5">
          <div
            className="mb-2 h-3.5 animate-pulse rounded-sm bg-slate-200/80"
            style={{ width: `${88 - i * 10}%` }}
          />
          <div
            className="mb-2 h-3 animate-pulse rounded-sm bg-slate-100"
            style={{ width: `${96 - i * 8}%` }}
          />
          <div className="h-2.5 w-10 animate-pulse rounded-sm bg-slate-100/90" />
        </div>
      ))}
    </div>
  );
}

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupSessionsByRecency(sessions: SidebarCaseSession[]) {
  const todayStart = startOfTodayMs();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const today: SidebarCaseSession[] = [];
  const last7Days: SidebarCaseSession[] = [];
  const older: SidebarCaseSession[] = [];

  for (const session of sessions) {
    const ts = new Date(session.updated_at).getTime();
    if (Number.isNaN(ts) || ts >= todayStart) today.push(session);
    else if (ts >= sevenDaysAgo) last7Days.push(session);
    else older.push(session);
  }

  return { today, last7Days, older };
}

type CaseSearchGroups = ReturnType<typeof groupSessionsByRecency>;

function SidebarCaseItem({
  session,
  active,
  menuOpen,
  onOpen,
  onToggleMenu,
  onShare,
  onRename,
  onDelete,
}: {
  session: SidebarCaseSession;
  active: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onToggleMenu: () => void;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-start rounded-lg transition-colors",
        active
          ? "bg-emerald-50 shadow-[inset_0_0_0_1px_rgba(0,99,75,0.12)]"
          : "hover:bg-slate-50"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 px-3 py-3 pr-1 text-left md:py-2.5"
      >
        <div className="flex items-start gap-2">
          {session.pinned && <Pin className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />}
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-sm font-medium", active ? "text-[#00634B]" : "text-slate-800")}>
              {session.title}
            </p>
            <p className="truncate text-xs text-slate-500">{session.preview}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{formatRelative(session.updated_at)}</p>
          </div>
        </div>
      </button>

      <div className="relative shrink-0 py-2 pr-1.5">
        <button
          type="button"
          aria-label="Case options"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu();
          }}
          className={cn(
            touchIconButtonCompact,
            focusRing,
            "rounded-md text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-600",
            menuOpen || active
              ? "opacity-100 bg-slate-200/70 text-slate-600"
              : "opacity-0 group-hover:opacity-100"
          )}
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={onShare}
              className={cn(touchNavRow, "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50")}
            >
              <Share2 className="h-3.5 w-3.5 text-slate-400" />
              Share
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onRename}
              className={cn(touchNavRow, "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50")}
            >
              <Pencil className="h-3.5 w-3.5 text-slate-400" />
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onDelete}
              className={cn(touchNavRow, "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50")}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CaseSearchSection({
  label,
  sessions,
  query,
  browseMode,
  activeSessionId,
  pathname,
  onSelect,
}: {
  label: string;
  sessions: SidebarCaseSession[];
  query: string;
  browseMode: boolean;
  activeSessionId: string | null;
  pathname: string;
  onSelect: (id: string) => void;
}) {
  if (!sessions.length) return null;

  return (
    <div>
      <p className="px-4 pb-1 pt-3 text-[11px] font-semibold text-slate-400">{label}</p>
      {sessions.map((session) => {
        const active = pathname.startsWith("/cases") && activeSessionId === session.id;
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelect(session.id)}
            className={cn(
              "w-full px-4 py-2.5 text-left transition hover:bg-slate-50",
              active && "bg-emerald-50/80"
            )}
          >
            <p
              className={cn(
                "truncate text-sm leading-snug",
                active ? "font-medium text-[#00634B]" : "text-slate-700"
              )}
            >
              {highlightText(session.title, query)}
            </p>
            {!browseMode && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
                {highlightText(session.preview, query)}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Fixed-size layout slot — animates position only (no icon squash). */
function SidebarLayoutSlot({
  id,
  className,
  children,
  transition,
}: {
  id: string;
  className?: string;
  children: ReactNode;
  transition: Transition;
}) {
  return (
    <motion.div
      layout="position"
      layoutId={id}
      transition={transition}
      className={cn("shrink-0", className)}
    >
      {children}
    </motion.div>
  );
}

export function HomeSidebar({
  collapsed = false,
  railNarrow,
  showChrome,
  onToggle,
  mobileOpen = false,
  onMobileClose,
}: {
  collapsed?: boolean;
  /** Actual width state (phased). Defaults to `collapsed` when omitted. */
  railNarrow?: boolean;
  /** Label/cases visibility (phased). Defaults to `!collapsed` when omitted. */
  showChrome?: boolean;
  onToggle?: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, role } = useAuth();
  const { activeSessionId, setActiveSessionId, setActiveSession, sessionCache, setSessionCache, deleteSession, beginNewCase } =
    useGlobalChat();
  const isAdmin =
    (role || "").trim().toLowerCase() === "admin" ||
    (role || "").trim().toLowerCase() === "super_admin";
  const primaryNav = useMemo(() => {
    if (!isAdmin) return PRIMARY_NAV;
    return [
      ...PRIMARY_NAV,
      {
        id: "admin",
        label: "Admin console",
        href: "/admin",
        icon: Shield,
        match: (p: string) => p.startsWith("/admin"),
      },
      {
        id: "nyayguide",
        label: "Nyayguide console",
        href: "/nyayguide-console",
        icon: Map,
        match: (p: string) => p.startsWith("/nyayguide-console"),
      },
    ];
  }, [isAdmin]);
  const [caseSearch, setCaseSearch] = useState("");
  const [caseSearchOpen, setCaseSearchOpen] = useState(false);
  const [debouncedCaseSearch, setDebouncedCaseSearch] = useState("");
  const [caseSearchPending, setCaseSearchPending] = useState(false);
  const caseSearchInputRef = useRef<HTMLInputElement>(null);
  const [clashOpen, setClashOpen] = useState(pathname.startsWith("/clash"));
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [caseMenuId, setCaseMenuId] = useState<string | null>(null);
  const [customTitles, setCustomTitles] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<SidebarCaseSession | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const mobileCasesDrawer = Boolean(mobileOpen);
  const hideMobileChromeNav = mobileCasesDrawer;
  const narrow = (railNarrow ?? collapsed) && !mobileOpen;
  /** Soft label visibility — fades before width narrows */
  const labelsOpen = mobileOpen || (showChrome ?? !collapsed);
  const reduceMotion = useReducedMotion();
  const layoutTransition = reduceMotion
    ? { duration: 0.01 }
    : sidebarLayoutTransition;
  const collapsedNavIcon =
    "md:mx-auto md:flex md:h-10 md:w-10 md:items-center md:justify-center md:gap-0 md:px-0 md:py-0";
  const labelFade = {
    duration: reduceMotion ? 0.01 : DURATION.sidebarLabel,
    ease: EASE_OUT,
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CASE_TITLES_STORAGE_KEY);
      if (raw) setCustomTitles(JSON.parse(raw) as Record<string, string>);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!caseMenuId) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-case-menu-root]")) setCaseMenuId(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [caseMenuId]);

  useEffect(() => {
    // Drop empty shells already sitting in the in-memory cache
    setSessionCache((prev) => {
      const next = prev.filter(hasSidebarCaseContent);
      return next.length === prev.length ? prev : next;
    });
  }, [setSessionCache]);

  useEffect(() => {
    if (!user?.uid) {
      setSessionsLoaded(true);
      return;
    }
    if (sessionCache.length > 0) {
      setSessionsLoaded(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/chat/sessions?uid=${user.uid}`);
        if (res.ok) {
          const data = await res.json();
          const rows = (data.sessions || []) as CachedChatSession[];
          if (!cancelled && rows.length) {
            const meaningful = rows.filter(hasSidebarCaseContent);
            setSessionCache((prev) => (prev.length > 0 ? prev : meaningful));
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setSessionsLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, sessionCache.length, setSessionCache]);

  const sessions = useMemo(() => {
    const rows = user?.uid
      ? sessionCache.filter(hasSidebarCaseContent).map(toSidebarSession)
      : MOCK_SIDEBAR_SESSIONS;
    return rows.map((s) => ({
      ...s,
      title: customTitles[s.id]?.trim() || s.title,
    }));
  }, [user?.uid, sessionCache, customTitles]);

  const modalFilteredSessions = useMemo(() => {
    const q = debouncedCaseSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q)
    );
  }, [sessions, debouncedCaseSearch]);

  const modalBrowseGroups = useMemo(
    () => groupSessionsByRecency(sessions),
    [sessions]
  );

  const modalSearchGroups = useMemo(
    () => groupSessionsByRecency(modalFilteredSessions),
    [modalFilteredSessions]
  );

  const isCaseSearchBrowse = !debouncedCaseSearch.trim();

  useEffect(() => {
    if (!caseSearchOpen) {
      setDebouncedCaseSearch("");
      setCaseSearchPending(false);
      return;
    }
    setCaseSearchPending(true);
    const timer = window.setTimeout(() => {
      setDebouncedCaseSearch(caseSearch);
      setCaseSearchPending(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [caseSearch, caseSearchOpen]);

  const showCaseSearchSkeleton =
    caseSearchOpen && (caseSearchPending || (!sessionsLoaded && Boolean(user?.uid)));

  useEffect(() => {
    if (!caseSearchOpen) return;
    caseSearchInputRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCaseSearchOpen(false);
        setCaseSearch("");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [caseSearchOpen]);

  const handleNav = () => onMobileClose?.();

  const closeCaseSearch = () => {
    setCaseSearchOpen(false);
    setCaseSearch("");
  };

  const openCase = (sessionId: string) => {
    setActiveSessionId(sessionId);
    const cached = sessionCache?.find((s) => s.id === sessionId);
    setActiveSession(cached?.session_data ? cached.session_data : null);
    closeCaseSearch();
    handleNav();
    router.push(`/cases?session=${encodeURIComponent(sessionId)}`);
  };

  const handleNewCase = () => {
    beginNewCase();
    handleNav();
    router.push("/cases");
  };

  const openNewCaseFromSearch = () => {
    closeCaseSearch();
    handleNewCase();
  };

  const persistCustomTitles = (next: Record<string, string>) => {
    setCustomTitles(next);
    try {
      localStorage.setItem(CASE_TITLES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const shareCase = async (sessionId: string) => {
    const url = `${window.location.origin}/cases?session=${encodeURIComponent(sessionId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "NyaySahayak case", url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* user cancelled share or clipboard denied */
    }
    setCaseMenuId(null);
  };

  const renameCase = (session: SidebarCaseSession) => {
    const nextTitle = window.prompt("Rename case", session.title);
    if (!nextTitle?.trim()) return;
    const trimmed = nextTitle.trim();
    persistCustomTitles({ ...customTitles, [session.id]: trimmed });
    setCaseMenuId(null);
  };

  const deleteCase = async (session: SidebarCaseSession) => {
    setDeleteBusy(true);
    const sessionId = session.id;
    try {
      if (user?.uid) {
        await fetch(
          `${API_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}?uid=${encodeURIComponent(user.uid)}`,
          { method: "DELETE" }
        );
      }
      deleteSession(sessionId);
      const nextTitles = { ...customTitles };
      delete nextTitles[sessionId];
      persistCustomTitles(nextTitles);
      setCaseMenuId(null);
      router.replace("/cases");
    } finally {
      setDeleteBusy(false);
      setDeleteTarget(null);
    }
  };

  const renderGroupedCaseList = (groups: CaseSearchGroups, query: string, browseMode: boolean) => {
    const hasAny = groups.today.length + groups.last7Days.length + groups.older.length > 0;
    if (!hasAny) {
      return (
        <p className="px-4 py-8 text-center text-sm text-slate-400">
          {browseMode ? "No cases yet." : "No cases match your search."}
        </p>
      );
    }

    return (
      <>
        <CaseSearchSection
          label="Today"
          sessions={groups.today}
          query={query}
          browseMode={browseMode}
          activeSessionId={activeSessionId}
          pathname={pathname}
          onSelect={openCase}
        />
        <CaseSearchSection
          label="Previous 7 days"
          sessions={groups.last7Days}
          query={query}
          browseMode={browseMode}
          activeSessionId={activeSessionId}
          pathname={pathname}
          onSelect={openCase}
        />
        <CaseSearchSection
          label="Older"
          sessions={groups.older}
          query={query}
          browseMode={browseMode}
          activeSessionId={activeSessionId}
          pathname={pathname}
          onSelect={openCase}
        />
      </>
    );
  };

  return (
    <>
      {mobileCasesDrawer && (
        <button
          type="button"
          aria-label="Close case history"
          className="fixed inset-0 z-[58] bg-slate-900/40 backdrop-blur-[2px] md:hidden"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={cn(
          dmSans.className,
          "fixed left-0 top-0 flex h-[100dvh] flex-col overflow-x-hidden border-r border-slate-200/80 bg-white",
          sidebarRailMotion,
          narrow ? "md:w-[4.5rem] md:overflow-x-visible" : "w-[min(18rem,88vw)] md:w-72",
          "md:z-30 md:flex md:translate-x-0",
          mobileCasesDrawer
            ? "z-[60] translate-x-0 shadow-[8px_0_32px_-12px_rgba(15,23,42,0.28)]"
            : "z-50 hidden -translate-x-full"
        )}
      >
        {/* Logo + collapse — icons stay on a fixed left rail; labels clip/fade */}
        <div
          className={cn(
            "flex items-center gap-2 border-b border-slate-100 px-3 py-3.5",
            narrow && "md:px-2 md:py-3"
          )}
        >
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              aria-label="Expand sidebar"
              className={cn(
                "group relative mx-auto h-10 w-10 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50/40",
                narrow ? "hidden md:flex" : "hidden"
              )}
            >
              <Image
                src="/2.png"
                alt="NyaySahayak"
                width={28}
                height={28}
                className="object-contain transition-opacity duration-150 group-hover:opacity-0"
              />
              <PanelLeftOpen className="absolute h-5 w-5 text-[#00634B] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
            </button>
          )}
          <Link
            href="/home"
            onClick={handleNav}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3",
              narrow && "md:hidden"
            )}
          >
            <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm">
              <Image src="/2.png" alt="NyaySahayak" width={28} height={28} className="object-contain" />
            </div>
            <div
              className={cn(
                sidebarLabelMotion,
                "min-w-0",
                labelsOpen ? "max-w-[11rem] translate-x-0 opacity-100" : "max-w-0 -translate-x-1 opacity-0"
              )}
              aria-hidden={!labelsOpen}
            >
              <p
                className={cn(
                  instrumentSerif.className,
                  "truncate text-base font-normal tracking-normal text-[#00634B]"
                )}
              >
                Nyay<span className="text-slate-900">Sahayak</span>
              </p>
              <p
                className={cn(
                  dmSans.className,
                  "text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400"
                )}
              >
                Legal help for all
              </p>
            </div>
          </Link>
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "hidden shrink-0 rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-[#00634B] md:inline-flex",
                (!labelsOpen || narrow) && "md:hidden"
              )}
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          )}
          {onMobileClose && (
            <button type="button" onClick={onMobileClose} className={cn(touchIconButton, focusRing, "rounded-md text-slate-400 md:hidden")} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Primary nav */}
        <nav className={cn(dmSans.className, "space-y-0.5 px-2 py-2")}>
          <LayoutGroup id="sidebar-rail">
            {/* New case CTA + search + inbox */}
            <div
              className={cn(
                "mb-1 flex items-center gap-1.5",
                sidebarActionRowMotion,
                narrow && "md:flex-col md:gap-1"
              )}
            >
              <SidebarLayoutSlot
                id="sidebar-new-case"
                transition={layoutTransition}
                className={narrow ? "md:w-10" : "min-w-0 flex-1"}
              >
                <button
                  type="button"
                  onClick={handleNewCase}
                  title="New case"
                  className={cn(
                    touchNavRow,
                    focusRing,
                    pressableSubtle,
                    "flex h-10 w-full items-center rounded-md bg-gradient-to-b from-[#00A07A] to-[#00634B] text-sm font-semibold leading-5 text-[#EDEEF0] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0_rgba(0,0,0,0.04)] hover:brightness-[0.97]",
                    narrow ? "justify-center gap-0 px-0" : "justify-start gap-2 px-3"
                  )}
                >
                  <SquarePen className="h-[18px] w-[18px] shrink-0 text-[#EDEEF0]" />
                  <AnimatePresence initial={false}>
                    {labelsOpen && !narrow && (
                      <motion.span
                        key="new-case-label"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={labelFade}
                        className="truncate"
                      >
                        New case
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </SidebarLayoutSlot>

              <SidebarLayoutSlot id="sidebar-search" transition={layoutTransition} className="w-10">
                <button
                  type="button"
                  onClick={() => setCaseSearchOpen(true)}
                  title="Search cases"
                  aria-label="Search cases"
                  className={cn(
                    touchIconButton,
                    focusRing,
                    "h-10 w-10 rounded-lg border border-[#00634B]/20 bg-white text-[#00634B] hover:border-[#00634B]/40 hover:bg-[#E6F0ED]"
                  )}
                >
                  <Search className="h-[18px] w-[18px] text-[#00634B]" />
                </button>
              </SidebarLayoutSlot>

              <SidebarLayoutSlot id="sidebar-inbox" transition={layoutTransition} className={cn("w-10", mobileCasesDrawer && "max-md:hidden")}>
                <NotificationsInbox />
              </SidebarLayoutSlot>
            </div>

            {primaryNav.map((item) => {
              if (hideMobileChromeNav) return null;
              const active = item.match ? item.match(pathname) : pathname === item.href;
              const Icon = item.icon;
              const rowClass = cn(
                touchNavRow,
                "flex items-center rounded-lg text-sm font-medium transition-colors",
                pressableSubtle,
                narrow ? collapsedNavIcon : "gap-3 px-3 py-2 md:py-1.5",
                active
                  ? "bg-emerald-50 text-[#00634B] shadow-[inset_0_0_0_1px_rgba(0,99,75,0.15)]"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              );
              const inner = (
                <>
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                    <Icon className={cn("h-[18px] w-[18px]", active && "text-[#00634B]")} />
                  </span>
                  {!narrow && (
                    <motion.span
                      layout={false}
                      initial={false}
                      animate={{ opacity: labelsOpen ? 1 : 0 }}
                      transition={labelFade}
                      className={cn(
                        "min-w-0 truncate",
                        !labelsOpen && "pointer-events-none w-0 overflow-hidden"
                      )}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </>
              );
              return (
                <SidebarLayoutSlot
                  key={item.id}
                  id={`sidebar-nav-${item.id}`}
                  transition={layoutTransition}
                  className={narrow ? "md:w-full" : "w-full"}
                >
                  <Link
                    href={item.href}
                    title={item.label}
                    className={cn("block rounded-lg", focusRing, narrow && "md:flex md:justify-center")}
                    onClick={handleNav}
                  >
                    <span className={rowClass}>{inner}</span>
                  </Link>
                </SidebarLayoutSlot>
              );
            })}

            {/* Clash */}
            {!hideMobileChromeNav && (
            <SidebarLayoutSlot
              id="sidebar-nav-clash"
              transition={layoutTransition}
              className={narrow ? "md:w-full" : "w-full"}
            >
              {!narrow ? (
                <>
                  <button
                    type="button"
                    onClick={() => setClashOpen((o) => !o)}
                    className={cn(
                      touchNavRow,
                      focusRing,
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors md:py-1.5",
                      pathname.startsWith("/clash")
                        ? "bg-emerald-50 text-[#00634B]"
                        : "text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                        <Swords className="h-[18px] w-[18px]" />
                      </span>
                      <motion.span
                        layout={false}
                        animate={{ opacity: labelsOpen ? 1 : 0 }}
                        transition={labelFade}
                        className={cn("truncate", !labelsOpen && "w-0 overflow-hidden")}
                      >
                        Clash mode
                      </motion.span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 transition-[transform,opacity] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                        clashOpen && "rotate-180",
                        !labelsOpen && "opacity-0"
                      )}
                    />
                  </button>
                  {clashOpen && labelsOpen && (
                    <div className="ml-3 mt-1 space-y-0.5 pl-2">
                      <Link href="/clash?mode=practice" onClick={handleNav} className={cn(touchNavRow, focusRing, "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-[#00634B] md:py-1")}>
                        <GraduationCap className="h-3.5 w-3.5" /> Practice courtroom
                      </Link>
                      <Link href="/clash?mode=real_life" onClick={handleNav} className={cn(touchNavRow, focusRing, "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-[#00634B] md:py-1")}>
                        <Scale className="h-3.5 w-3.5" /> Real-life case
                      </Link>
                    </div>
                  )}
                </>
              ) : (
                <Link
                  href="/clash?mode=practice"
                  title="Clash mode"
                  onClick={handleNav}
                  className={cn("block rounded-lg", focusRing, "md:flex md:justify-center")}
                >
                  <span
                    className={cn(
                      collapsedNavIcon,
                      "rounded-lg text-slate-600 hover:bg-slate-50 md:py-1.5",
                      pathname.startsWith("/clash") && "bg-emerald-50 text-[#00634B]"
                    )}
                  >
                    <Swords className="h-[18px] w-[18px]" />
                  </span>
                </Link>
              )}
            </SidebarLayoutSlot>
            )}
          </LayoutGroup>
        </nav>

        {/* Case history — hidden in collapsed rail */}
        <div
          className={cn(
            dmSans.className,
            "flex min-h-0 flex-1 flex-col border-t border-slate-100 px-2 pt-3 transition-[opacity,flex-grow] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
            narrow && "md:hidden",
            !labelsOpen && !narrow && !mobileCasesDrawer &&
              "pointer-events-none max-md:hidden md:h-0 md:min-h-0 md:flex-grow-0 md:overflow-hidden md:border-0 md:p-0 md:opacity-0"
          )}
          aria-hidden={!labelsOpen || narrow}
        >
          <div className="mb-2 px-1">
            <p
              className={cn(
                instrumentSerif.className,
                "text-xs uppercase tracking-[0.12em] text-[#00634B]"
              )}
            >
              Your cases
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto custom-scrollbar pb-2">
            {!sessionsLoaded && user?.uid ? (
              <SidebarCasesSkeleton />
            ) : sessions.length === 0 ? (
              <p className="px-3 py-4 text-xs text-slate-400">No cases yet — start one above.</p>
            ) : (
            sessions.map((session) => {
              const active = pathname.startsWith("/cases") && activeSessionId === session.id;
              return (
                <div key={session.id} data-case-menu-root>
                  <SidebarCaseItem
                    session={session}
                    active={active}
                    menuOpen={caseMenuId === session.id}
                    onOpen={() => openCase(session.id)}
                    onToggleMenu={() =>
                      setCaseMenuId((prev) => (prev === session.id ? null : session.id))
                    }
                    onShare={() => void shareCase(session.id)}
                    onRename={() => renameCase(session)}
                    onDelete={() => {
                      setCaseMenuId(null);
                      setDeleteTarget(session);
                    }}
                  />
                </div>
              );
            })
            )}
          </div>
        </div>

        {/* Footer: helpline + profile */}
        <div
          className={cn(
            dmSans.className,
            "mt-auto space-y-2 border-t border-slate-100 p-3 transition-[padding] duration-[320ms] ease-[cubic-bezier(0.77,0,0.175,1)]",
            narrow && "md:flex md:flex-col md:items-center md:overflow-visible md:p-2",
            mobileCasesDrawer && "max-md:hidden"
          )}
        >
          <LayoutGroup id="sidebar-footer">
            {!narrow ? (
              <div
                className={cn(
                  "rounded-lg border border-amber-200/60 bg-amber-50/50 p-2.5 transition-opacity duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                  !labelsOpen && "pointer-events-none opacity-0"
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                    <Phone className="h-3.5 w-3.5" />
                    Urgent help
                  </span>
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                    Coming soon
                  </span>
                </div>
              </div>
            ) : (
              <SidebarLayoutSlot id="sidebar-urgent" transition={layoutTransition} className="w-10">
                <div
                  title="Urgent help · Coming soon"
                  aria-label="Urgent help, coming soon"
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-800 ring-1 ring-amber-200/70"
                >
                  <Phone className="h-4 w-4" />
                </div>
              </SidebarLayoutSlot>
            )}
            <SidebarLayoutSlot
              id="sidebar-profile"
              transition={layoutTransition}
              className={narrow ? "md:w-10" : "w-full"}
            >
              <HomeProfileMenu collapsed={narrow} />
            </SidebarLayoutSlot>
          </LayoutGroup>
        </div>
      </aside>

      {caseSearchOpen && (
        <div
          className={cn(
            dmSans.className,
            "fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/45 p-4 pt-[10vh] backdrop-blur-[3px]"
          )}
          onClick={closeCaseSearch}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search cases"
            className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
              <input
                ref={caseSearchInputRef}
                value={caseSearch}
                onChange={(e) => setCaseSearch(e.target.value)}
                placeholder="Search cases…"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={closeCaseSearch}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                aria-label="Close search"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[min(28rem,55vh)] overflow-y-auto custom-scrollbar">
              {showCaseSearchSkeleton ? (
                <CaseSearchSkeleton />
              ) : (
                <div className="pb-1">
                  {isCaseSearchBrowse && (
                    <button
                      type="button"
                      onClick={openNewCaseFromSearch}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                    >
                      <MessageSquarePlus className="h-4 w-4 shrink-0 text-slate-500" />
                      New case
                    </button>
                  )}
                  {renderGroupedCaseList(
                    isCaseSearchBrowse ? modalBrowseGroups : modalSearchGroups,
                    debouncedCaseSearch.trim(),
                    isCaseSearchBrowse
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className={cn(
            dmSans.className,
            "fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[3px]"
          )}
          onClick={() => !deleteBusy && setDeleteTarget(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-case-title"
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-case-title" className="text-base font-semibold text-slate-900">
              Delete case?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-medium text-slate-800">&ldquo;{deleteTarget.title}&rdquo;</span> will be
              permanently removed. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => void deleteCase(deleteTarget)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
