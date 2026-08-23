"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, Loader2 } from "lucide-react";
import { redirectToAdminLogin } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

const HINT_TOAST_WIDTH = 288;
const HINT_TOAST_GAP = 14;

function hintToastPosition(x: number, y: number) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const maxW = Math.min(HINT_TOAST_WIDTH, vw - 16);
  const flipLeft = x + HINT_TOAST_GAP + maxW > vw - 8;
  const flipUp = y > vh * 0.62;
  const shift = [
    flipLeft ? "translateX(-100%)" : "",
    flipUp ? "translateY(-100%)" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    left: flipLeft ? x - HINT_TOAST_GAP : x + HINT_TOAST_GAP,
    top: flipUp ? y - HINT_TOAST_GAP : y + HINT_TOAST_GAP,
    maxWidth: maxW,
    transform: shift || undefined,
  };
}

export const adminInput =
  "w-full rounded-xl border border-white/[0.1] bg-black/50 px-3 py-2 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition placeholder:text-white/30 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25";

export const adminSelect =
  "cursor-pointer rounded-xl border border-white/[0.1] bg-black/50 px-3 py-2 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none focus:border-emerald-500/50 disabled:cursor-not-allowed";

export const adminCard =
  "rounded-[20px] border border-white/[0.09] bg-[#0c0c0c] shadow-[0_8px_32px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-white/[0.04]";

export const adminBtnPrimary =
  "inline-flex cursor-pointer items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-[0_4px_16px_rgba(5,150,105,0.35)] transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50";

export const adminBtnSecondary =
  "inline-flex cursor-pointer items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.05] px-4 py-2 text-sm text-white/80 transition hover:border-white/[0.18] hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

export const adminBtnDanger =
  "inline-flex cursor-pointer items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50";

export function AdminHoverHint({
  hint,
  className,
  showToast = true,
}: {
  hint?: string;
  className?: string;
  /** When false, only the help icon is shown (parent owns the toast). */
  showToast?: boolean;
}) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  if (!hint) return null;

  const toast =
    showToast && cursor && typeof document !== "undefined"
      ? createPortal(
          <span
            role="tooltip"
            style={hintToastPosition(cursor.x, cursor.y)}
            className="pointer-events-none fixed z-[200] rounded-lg border border-white/15 bg-[#141414] px-2.5 py-2 text-left text-[11px] leading-snug font-normal whitespace-pre-wrap text-white/80 shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
          >
            {hint}
          </span>,
          document.body
        )
      : null;

  return (
    <span
      className={cn(
        "relative ml-1.5 inline-flex cursor-help align-middle text-white/35 hover:text-white/60",
        className
      )}
      aria-label={hint}
      role="img"
      onMouseEnter={(e) => showToast && setCursor({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => showToast && setCursor({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setCursor(null)}
    >
      <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
      {toast}
    </span>
  );
}

export function AdminFieldLabel({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="block text-xs text-white/50">
      {label && (
        <span className="mb-1 inline-flex items-center text-white/60">
          {label}
          {hint ? <AdminHoverHint hint={hint} /> : null}
        </span>
      )}
      {children}
      {!label && hint ? <AdminHoverHint hint={hint} className="ml-0" /> : null}
    </div>
  );
}

export function AdminPageHeader({
  title,
  description,
  badge,
  actions,
  compact,
}: {
  title: string;
  description?: string;
  badge?: string;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-3",
        compact ? "items-center gap-2" : "mb-6 flex-wrap items-start gap-4"
      )}
    >
      <div className="min-w-0 flex-1">
        {badge && (
          <p
            className={cn(
              "font-semibold uppercase tracking-wider text-white/35",
              compact ? "mb-0.5 text-[10px] leading-none" : "mb-1 text-[11px]"
            )}
          >
            {badge}
          </p>
        )}
        <h1
          className={cn(
            "font-semibold tracking-tight text-white",
            compact ? "truncate text-sm leading-tight md:text-base" : "text-xl md:text-2xl"
          )}
        >
          {title}
        </h1>
        {description && (
          <p
            className={cn(
              "max-w-2xl text-white/45",
              compact ? "mt-0.5 truncate text-[11px] leading-snug" : "mt-1.5 text-sm"
            )}
          >
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className={cn("flex items-center gap-2", compact ? "shrink-0" : "flex-wrap")}>
          {actions}
        </div>
      )}
    </div>
  );
}

function isSessionError(message: string): boolean {
  const m = (message || "").toLowerCase();
  return (
    m.includes("invalid or expired token") ||
    m.includes("session expired") ||
    m.includes("missing bearer") ||
    m.includes("sign in again") ||
    m.includes("insufficient role") ||
    m.includes("admin access")
  );
}

export function AdminErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  const needsRelogin = isSessionError(message);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200">
      <span className="flex-1">
        {needsRelogin
          ? "Your admin session expired or is no longer valid. Sign in again to continue."
          : message}
      </span>
      {needsRelogin ? (
        <button
          type="button"
          className="shrink-0 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-400"
          onClick={() => redirectToAdminLogin("session_expired")}
        >
          Log in again
        </button>
      ) : null}
      {onDismiss && !needsRelogin && (
        <button type="button" className="shrink-0 text-red-300/80 underline hover:text-red-200" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export function AdminLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-white/40">
      <Loader2 className="h-6 w-6 animate-spin text-emerald-500/80" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function AdminStatCard({
  label,
  value,
  sub,
  accent = "emerald",
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "blue" | "emerald" | "amber" | "red" | "violet";
  onClick?: () => void;
}) {
  const accents = {
    blue: "from-emerald-600/20 to-emerald-950/10 border-emerald-500/25",
    emerald: "from-emerald-600/20 to-emerald-950/10 border-emerald-500/25",
    amber: "from-amber-600/20 to-amber-950/10 border-amber-500/25",
    red: "from-red-600/20 to-red-950/10 border-red-500/25",
    violet: "from-emerald-600/15 to-teal-950/10 border-teal-500/25",
  };
  const className = cn("rounded-[20px] border bg-gradient-to-br p-5 text-left", accents[accent], onClick && "cursor-pointer transition hover:brightness-110");
  const inner = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/45">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-white">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-white/40">{sub}</p>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

export function AdminSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(adminCard, "p-5 md:p-6", className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            {title && <h2 className="text-sm font-semibold text-white/85">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-white/40">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function AdminTableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border border-white/[0.08]", className)}>
      <table className="admin-data-table w-full min-w-[480px] text-left text-sm">{children}</table>
    </div>
  );
}
