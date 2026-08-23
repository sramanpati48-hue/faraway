"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AdminTabPage } from "@/components/admin/AdminPageLayout";
import {
  AdminErrorBanner,
  AdminLoading,
  adminBtnSecondary,
} from "@/components/admin/admin-ui";
import { adminApi, type AuditLogRow } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

export function AdminAuditTab() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pageIndex: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.auditLogs(PAGE_SIZE, pageIndex * PAGE_SIZE);
      setLogs(res.logs || []);
      setTotal(res.total || 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <AdminTabPage
      badge="System"
      title="Audit log"
      description="Admin table and SQL actions recorded in admin_audit_logs."
      actions={
        <button type="button" className={adminBtnSecondary} onClick={() => void load(page)}>
          Refresh
        </button>
      }
    >
      {error && <AdminErrorBanner message={error} onDismiss={() => setError(null)} />}
      {loading && logs.length === 0 ? (
        <AdminLoading label="Loading audit logs…" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/40">
            <p>
              {total === 0
                ? "0 total entries"
                : `${rangeStart}–${rangeEnd} of ${total.toLocaleString()} (latest first)`}
            </p>
            {total > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={cn(adminBtnSecondary, "px-2 py-1")}
                  disabled={page === 0 || loading}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span>
                  Page {page + 1} / {totalPages}
                </span>
                <button
                  type="button"
                  className={cn(adminBtnSecondary, "px-2 py-1")}
                  disabled={page + 1 >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          <div
            className={cn(
              "overflow-x-auto rounded-[20px] border border-white/[0.09]",
              loading && "opacity-60"
            )}
          >
            <table className="min-w-full text-left text-xs">
              <thead className="bg-white/[0.03] text-white/45">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Table</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-white/35">
                      No audit entries yet.
                    </td>
                  </tr>
                ) : (
                  logs.map((row) => (
                    <tr key={String(row.id)} className="border-t border-white/[0.06] text-white/75">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-white/50">
                        {row.created_at || "—"}
                      </td>
                      <td className="px-3 py-2">{row.action || "—"}</td>
                      <td className="px-3 py-2 font-mono">{row.target_table || "—"}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">{row.actor_user_id || "—"}</td>
                      <td className="max-w-md truncate px-3 py-2 font-mono text-[10px] text-white/45">
                        {typeof row.detail === "string" ? row.detail : JSON.stringify(row.detail ?? {})}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminTabPage>
  );
}
