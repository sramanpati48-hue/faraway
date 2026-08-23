"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Home, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADMIN_NAV, type AdminTabId } from "@/components/admin/admin-nav-config";

export type { AdminTabId };

const STORAGE_KEY = "nyaya-admin-sidebar-collapsed";

type Props = {
  tab: AdminTabId;
  onTabChange: (tab: AdminTabId) => void;
  userName?: string | null;
  role?: string | null;
  onSignOut?: () => void;
  children: ReactNode;
};

export function AdminShell({ tab, onTabChange, userName, role, onSignOut, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  let lastGroup = "";

  return (
    <div className="flex h-screen overflow-hidden bg-black">
      <aside
        className={cn(
          "relative flex shrink-0 flex-col border-r border-white/[0.08] bg-[#030303] transition-[width] duration-300",
          collapsed ? "w-[68px]" : "w-[248px]"
        )}
      >
        <div className={cn("shrink-0 border-b border-white/[0.07]", collapsed ? "px-2 py-4" : "px-4 py-4")}>
          <div className={cn("flex items-center", collapsed ? "flex-col gap-3" : "gap-3")}>
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white"
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            {!collapsed && (
              <Link href="/" className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.1] bg-emerald-600/20 text-sm font-bold text-emerald-300">
                  NS
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">Admin</p>
                  <p className="truncate text-[11px] text-white/40">NyaySahayak</p>
                </div>
              </Link>
            )}
          </div>
        </div>

        <nav className="admin-no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {ADMIN_NAV.map((item) => {
            const showGroup = !collapsed && item.group !== lastGroup;
            if (item.group) lastGroup = item.group;
            const active = tab === item.id;
            const Icon = item.icon;
            return (
              <div key={item.id}>
                {showGroup && (
                  <p className="mb-2 mt-4 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28 first:mt-0">
                    {item.group}
                  </p>
                )}
                <button
                  type="button"
                  title={item.label}
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    "group relative mb-1 flex w-full items-center rounded-xl transition-all",
                    collapsed ? "justify-center py-2.5" : "gap-3 px-3 py-2.5",
                    active
                      ? "bg-emerald-600/15 text-white shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35)]"
                      : "text-white/55 hover:bg-white/[0.05] hover:text-white/90"
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-emerald-500" />
                  )}
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      active
                        ? "bg-emerald-600/25 text-emerald-300"
                        : "bg-white/[0.04] text-white/50 group-hover:text-white/80"
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
                </button>
              </div>
            );
          })}
        </nav>

        <div className={cn("shrink-0 border-t border-white/[0.07]", collapsed ? "p-2" : "p-3")}>
          {!collapsed && (userName || role) && (
            <div className="mb-2 px-2">
              {userName && <p className="truncate text-[11px] text-white/35">{userName}</p>}
              {role && <p className="truncate text-[10px] uppercase tracking-wider text-white/25">{role}</p>}
            </div>
          )}
          <Link
            href="/"
            className={cn(
              "mb-1 flex w-full items-center rounded-xl text-white/50 hover:bg-white/[0.05] hover:text-white/80",
              collapsed ? "justify-center py-2" : "gap-3 px-3 py-2 text-sm"
            )}
          >
            <Home className="h-4 w-4 shrink-0" />
            {!collapsed && <span>View app</span>}
          </Link>
          <button
            type="button"
            onClick={() => onSignOut?.()}
            className={cn(
              "flex w-full items-center rounded-xl text-white/55 hover:bg-red-500/10 hover:text-red-300",
              collapsed ? "justify-center py-2.5" : "gap-3 px-3 py-2.5"
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="text-sm font-medium">Sign out</span>}
          </button>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
