"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { AdminPageHeader, adminBtnSecondary, adminCard, adminInput } from "@/components/admin/admin-ui";
import { cn } from "@/lib/utils";

export const adminScroll = "admin-scrollbar overflow-x-hidden overflow-y-auto";
export const adminTableScroll = "admin-table-scroll min-h-0 overflow-auto";

type HeaderProps = {
  badge?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function AdminTabHeaderBar({ badge, title, description, actions }: HeaderProps) {
  return (
    <div className="shrink-0 border-b border-white/[0.07] bg-black/90 px-4 py-1.5 backdrop-blur-md md:px-5">
      <AdminPageHeader badge={badge} title={title} description={description} actions={actions} compact />
    </div>
  );
}

export function AdminTabPage({
  badge,
  title,
  description,
  actions,
  children,
  className,
}: HeaderProps & { children: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AdminTabHeaderBar badge={badge} title={title} description={description} actions={actions} />
      <div
        className={cn(
          adminScroll,
          "min-h-0 flex-1 bg-[radial-gradient(ellipse_at_top_left,rgba(30,30,40,0.35),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(20,20,30,0.2),transparent_45%)] px-5 py-5 md:px-6 md:py-6",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

type WorkspaceProps = HeaderProps & {
  sidebarWidth?: string;
  sidebarHeader?: ReactNode;
  sidebar: ReactNode;
  sidebarFooter?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  mainClassName?: string;
};

export function AdminWorkspace({
  badge,
  title,
  description,
  actions,
  sidebarWidth = "w-[260px]",
  sidebarHeader,
  sidebar,
  sidebarFooter,
  toolbar,
  children,
  mainClassName,
}: WorkspaceProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AdminTabHeaderBar badge={badge} title={title} description={description} actions={actions} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={cn(
            "flex h-full min-h-0 shrink-0 flex-col border-r border-white/[0.08] bg-[#050505]",
            sidebarWidth
          )}
        >
          {sidebarHeader ? <div className="shrink-0 border-b border-white/[0.08] px-4 py-4">{sidebarHeader}</div> : null}
          <div className={cn(adminScroll, "min-h-0 flex-1 p-2")}>{sidebar}</div>
          {sidebarFooter ? <div className="shrink-0 space-y-2 border-t border-white/[0.08] p-3">{sidebarFooter}</div> : null}
        </aside>
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 bg-[radial-gradient(ellipse_at_top_left,rgba(30,30,40,0.3),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(20,20,30,0.15),transparent_45%)]",
            toolbar ? "flex flex-col overflow-hidden" : cn(adminScroll, "overflow-auto"),
            mainClassName
          )}
        >
          {toolbar ? (
            <div className="shrink-0 border-b border-white/[0.07] bg-black/90 px-5 py-3 backdrop-blur-md md:px-6">
              {toolbar}
            </div>
          ) : null}
          <div className={cn(toolbar ? "flex min-h-0 flex-1 flex-col overflow-hidden" : undefined)}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminNavItem({
  active,
  onClick,
  title,
  subtitle,
  meta,
  dashed,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  dashed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mb-1 flex w-full flex-col rounded-xl px-3 py-2.5 text-left text-sm transition-all",
        dashed
          ? "border border-dashed border-emerald-500/35 text-emerald-200 hover:bg-emerald-600/10"
          : active
            ? "bg-emerald-600/15 text-white shadow-[inset_0_0_0_1px_rgba(16,185,129,0.3)]"
            : "text-white/70 hover:bg-white/[0.05] hover:text-white"
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{title}</span>
        {meta}
      </span>
      {subtitle && <span className="mt-0.5 truncate text-xs text-white/40">{subtitle}</span>}
    </button>
  );
}

export function AdminSidebarSearch({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(adminInput, "text-xs")}
    />
  );
}

export function AdminSidebarRefreshButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(adminBtnSecondary, "w-full gap-2 text-xs disabled:opacity-40")}
    >
      <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
      {label}
    </button>
  );
}

export function AdminMainPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-5 md:p-6", className)}>{children}</div>;
}

export function AdminToolbar({ children, className, sticky }: { children: ReactNode; className?: string; sticky?: boolean }) {
  return (
    <div
      className={cn(
        sticky
          ? "flex flex-wrap items-center gap-2"
          : "mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2",
        className
      )}
    >
      {children}
    </div>
  );
}

export function AdminFormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn(adminCard, "p-5 md:p-6")}>
      <h3 className="text-sm font-semibold text-white/90">{title}</h3>
      {description && <p className="mt-1 text-xs text-white/45">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}
