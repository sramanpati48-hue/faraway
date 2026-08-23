"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminTabPage } from "@/components/admin/AdminPageLayout";
import {
  AdminErrorBanner,
  AdminLoading,
  adminBtnPrimary,
  adminBtnSecondary,
  adminCard,
  adminInput,
} from "@/components/admin/admin-ui";
import { adminApi } from "@/lib/adminApi";
import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";

type QueueConfig = {
  cases_per_hour: number;
  sla_minutes: number;
  delay_tick_minutes: number;
  respect_penalty_per_tick: number;
};

export function AdminModeratorRevisionsPanel() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<QueueConfig | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, cfgRes] = await Promise.all([
        adminApi.moderatorRevisions({ q, page, limit, semantic: true }),
        adminApi.moderatorQueueConfig(),
      ]);
      setItems(list.items || []);
      setTotal(list.total || 0);
      setConfig(cfgRes.config as QueueConfig);
    } catch (e: any) {
      setError(e.message || "Failed to load revisions");
    } finally {
      setLoading(false);
    }
  }, [q, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveConfig = async () => {
    if (!config) return;
    setSavingCfg(true);
    setError(null);
    try {
      const res = await adminApi.patchModeratorQueueConfig(config);
      setConfig(res.config as QueueConfig);
    } catch (e: any) {
      setError(e.message || "Failed to save capacity settings");
    } finally {
      setSavingCfg(false);
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const res = await adminApi.moderatorRevision(id);
      setDetail(res.revision);
    } catch (e: any) {
      setError(e.message || "Failed to load revision");
    } finally {
      setDetailLoading(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <AdminTabPage
      badge="Cases"
      title="Moderator audit"
      description="Hourly capacity settings and agent vs moderator payload revisions (paginated semantic search)."
      actions={
        <button type="button" className={adminBtnSecondary} onClick={() => void load()}>
          Refresh
        </button>
      }
    >
      {error && <AdminErrorBanner message={error} />}

      {config && (
        <div className={cn(adminCard, "mb-6 space-y-3 p-4 sm:p-5")}>
          <h3 className="text-sm font-semibold text-white/90">Queue capacity & SLA</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CfgField
              label="Cases / hour"
              value={config.cases_per_hour}
              onChange={(n) => setConfig({ ...config, cases_per_hour: n })}
            />
            <CfgField
              label="SLA minutes"
              value={config.sla_minutes}
              onChange={(n) => setConfig({ ...config, sla_minutes: n })}
            />
            <CfgField
              label="Delay tick (min)"
              value={config.delay_tick_minutes}
              onChange={(n) => setConfig({ ...config, delay_tick_minutes: n })}
            />
            <CfgField
              label="Respect penalty / tick"
              value={config.respect_penalty_per_tick}
              step={0.5}
              onChange={(n) => setConfig({ ...config, respect_penalty_per_tick: n })}
            />
          </div>
          <button
            type="button"
            className={adminBtnPrimary}
            disabled={savingCfg}
            onClick={() => void saveConfig()}
          >
            {savingCfg ? "Saving…" : "Save capacity settings"}
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            className={`${adminInput} pl-9`}
            placeholder="Semantic / text search by case id, summary, moderator…"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
        </div>
      </div>

      {loading ? (
        <AdminLoading />
      ) : (
        <div className={cn(adminCard, "overflow-hidden")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-left text-[10px] font-semibold uppercase tracking-widest text-white/40">
                <tr>
                  <th className="px-3 py-2.5">Intervention</th>
                  <th className="px-3 py-2.5">Case</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Moderator</th>
                  <th className="px-3 py-2.5">Delay</th>
                  <th className="px-3 py-2.5">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-white/35">
                      No revisions found
                    </td>
                  </tr>
                ) : (
                  items.map((row) => (
                    <tr
                      key={String(row.id)}
                      className="cursor-pointer border-t border-white/[0.06] transition hover:bg-emerald-500/10"
                      onClick={() => void openDetail(String(row.id))}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-white/75">
                        {String(row.intervention_id || "").slice(0, 10)}…
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-white/75">
                        {row.case_id ? `${String(row.case_id).slice(0, 10)}…` : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-white/85">
                        {String(row.status || "")}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-white/60">
                        {row.moderator_id
                          ? `${String(row.moderator_id).slice(0, 8)}…`
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-white/80">{String(row.delay_score ?? 0)}</td>
                      <td className="px-3 py-2.5 text-xs text-white/40">
                        {row.updated_at
                          ? new Date(String(row.updated_at)).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2.5 text-xs text-white/40">
            <span>
              {total} total · page {page} / {pages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className={adminBtnSecondary}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className={adminBtnSecondary}
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4">
          <div className="relative flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0c0c0c] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0B3D2E] px-4 py-3 text-white">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-200">
                  Payload comparison
                </p>
                <p className="font-black">
                  {detail
                    ? `Intervention ${String(detail.intervention_id || "").slice(0, 12)}…`
                    : "Loading…"}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                className="rounded-lg p-2 hover:bg-white/10"
                onClick={() => setDetail(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="admin-scrollbar flex-1 overflow-y-auto p-4">
              {detailLoading || !detail ? (
                <AdminLoading />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  <JsonPane title="Agent payload" value={detail.agent_payload} />
                  <JsonPane title="Agent report" value={detail.agent_report} />
                  <JsonPane title="Moderator payload" value={detail.moderator_payload} />
                  <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-sm text-white/80">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
                      Meta
                    </p>
                    <p>
                      <span className="font-semibold text-white/90">Status:</span>{" "}
                      {String(detail.status)}
                    </p>
                    <p>
                      <span className="font-semibold text-white/90">Moderator:</span>{" "}
                      {String(detail.moderator_id || "—")}
                    </p>
                    <p>
                      <span className="font-semibold text-white/90">Case id:</span>{" "}
                      {String(detail.case_id || "—")}
                    </p>
                    <p>
                      <span className="font-semibold text-white/90">Delay score:</span>{" "}
                      {String(detail.delay_score ?? 0)}
                    </p>
                    <p>
                      <span className="font-semibold text-white/90">SLA breached:</span>{" "}
                      {detail.sla_breached_at
                        ? new Date(String(detail.sla_breached_at)).toLocaleString()
                        : "—"}
                    </p>
                    {detail.search_text ? (
                      <p className="border-t border-white/[0.08] pt-2 text-xs text-white/50">
                        {String(detail.search_text).slice(0, 400)}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminTabPage>
  );
}

function CfgField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="block text-xs font-medium text-white/50">
      {label}
      <input
        type="number"
        step={step}
        min={0}
        className={`${adminInput} mt-1`}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function JsonPane({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08]">
      <div className="border-b border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">
        {title}
      </div>
      <pre className="max-h-[40vh] overflow-x-auto whitespace-pre-wrap break-words bg-black/40 p-3 text-xs text-white/75">
        {value == null ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
