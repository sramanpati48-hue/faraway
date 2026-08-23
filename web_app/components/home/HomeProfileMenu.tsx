"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronUp,
  LogOut,
  Shield,
  FileText,
  HelpCircle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { dmSans } from "@/lib/fonts";
import { EASE_OUT, pressableSubtle, touchNavRow, focusRing } from "@/lib/motion";

export function HomeProfileMenu({
  collapsed = false,
  variant = "sidebar",
}: {
  collapsed?: boolean;
  /** Header avatar opens a dropdown; sidebar opens a drop-up. */
  variant?: "sidebar" | "header";
}) {
  const { user, logout, role } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const displayName =
    user?.display_name?.trim() ||
    user?.email?.split("@")[0] ||
    user?.mobile ||
    "Account";
  const initials = displayName.slice(0, 2).toUpperCase();

  const isHeader = variant === "header";
  const iconOnly = collapsed || isHeader;

  return (
    <div ref={rootRef} className={cn(dmSans.className, "relative", collapsed && "md:flex md:justify-center")}>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{
              opacity: 0,
              x: collapsed ? -6 : 0,
              y: isHeader ? -8 : collapsed ? 0 : 8,
              scale: 0.96,
            }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              x: collapsed ? -6 : 0,
              y: isHeader ? -8 : collapsed ? 0 : 8,
              scale: 0.96,
            }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className={cn(
              "absolute z-[60] overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-xl shadow-slate-900/10",
              isHeader
                ? "right-0 top-full mt-2 w-56 origin-top-right"
                : collapsed
                  ? "bottom-0 left-full ml-2 w-56 origin-bottom-left"
                  : "bottom-full left-0 right-0 mb-2 origin-bottom"
            )}
          >
            <div className="border-b border-slate-100 px-3 py-2.5">
              <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
              <p className="truncate text-xs text-slate-500">{user?.email || user?.mobile}</p>
              {role && (
                <span className="mt-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#00634B]">
                  {role}
                </span>
              )}
            </div>
            <div className="p-1">
              <MenuLink href="/documents" icon={FileText} label="My documents" onClick={() => setOpen(false)} />
              <MenuLink href="/help" icon={HelpCircle} label="Help & about" onClick={() => setOpen(false)} />
              <MenuLink href="/legal-rights" icon={Shield} label="Privacy & rights" onClick={() => setOpen(false)} />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void logout();
                }}
                className={cn(touchNavRow, focusRing, "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-red-600 transition hover:bg-red-50")}
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={iconOnly ? displayName : undefined}
        className={cn(
          pressableSubtle,
          focusRing,
          "flex items-center rounded-lg border text-left",
          isHeader &&
            cn(
              "h-10 w-10 justify-center rounded-full border-slate-200/80 bg-white p-0",
              open && "ring-2 ring-emerald-200"
            ),
          !isHeader &&
            collapsed &&
            cn(
              "md:h-10 md:w-10 md:justify-center md:border-transparent md:bg-transparent md:p-0 md:hover:bg-slate-50",
              open && "md:ring-2 md:ring-emerald-200"
            ),
          !isHeader && !collapsed && "w-full gap-3 px-3 py-2.5",
          !isHeader &&
            !collapsed &&
            (open
              ? "border-emerald-200 bg-emerald-50/80"
              : "border-slate-200/80 bg-slate-50/80 hover:border-emerald-200 hover:bg-emerald-50/50")
        )}
      >
        <div
          className={cn(
            "flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#00634B] to-emerald-600 text-xs font-bold text-white shadow-sm",
            "h-9 w-9"
          )}
        >
          {initials}
        </div>
        {!iconOnly && (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
              <p className="truncate text-xs text-slate-500">Account & settings</p>
            </div>
            <ChevronUp
              className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")}
            />
          </>
        )}
      </button>
    </div>
  );
}

function MenuLink({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(touchNavRow, focusRing, "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-slate-700 transition hover:bg-slate-50")}
    >
      <Icon className="h-4 w-4 text-slate-500" />
      {label}
    </Link>
  );
}
