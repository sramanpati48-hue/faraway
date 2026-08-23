"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";

import { AdminTabPage, adminTableScroll } from "@/components/admin/AdminPageLayout";
import {
  AdminModelSelector,
  defaultForProvider,
} from "@/components/admin/AdminModelSelector";
import { adminBtnPrimary, adminBtnSecondary, adminInput } from "@/components/admin/admin-ui";
import { cn } from "@/lib/utils";
import { adminApi, type AdminModelsSnapshot } from "@/lib/adminApi";

const DEFAULT_SQL = `SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name
LIMIT 50`;

const CELL_PREVIEW_MAX = 80;

type CellViewerState = {
  column: string;
  rowIndex: number;
  value: unknown;
};

type SqlResult = {
  kind?: "rows" | "command";
  columns?: string[];
  rows?: Record<string, unknown>[];
  row_count?: number;
  rowcount?: number;
  truncated?: boolean;
  execution_ms?: number;
  message?: string;
};

type SchemaTable = {
  name: string;
  columns: { name: string; data_type: string; nullable: boolean }[];
};

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isJsonLike(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "object") return true;
  if (typeof value === "string") {
    const t = value.trim();
    return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
  }
  return false;
}

function isExpandableCell(value: unknown): boolean {
  return isJsonLike(value) || formatCell(value).length > CELL_PREVIEW_MAX;
}

function formatCellForViewer(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  if (typeof value === "string" && isJsonLike(value)) {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return String(value);
}

export function AdminSqlPanel() {
  const [info, setInfo] = useState<{ database?: string; user?: string; schema?: string } | null>(null);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [allowWrites, setAllowWrites] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [cellViewer, setCellViewer] = useState<CellViewerState | null>(null);

  const [snapshot, setSnapshot] = useState<AdminModelsSnapshot | null>(null);
  const [provider, setProvider] = useState("groq");
  const [model, setModel] = useState("");
  const [nlPrompt, setNlPrompt] = useState("");
  const [schemaTables, setSchemaTables] = useState<SchemaTable[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");

  useEffect(() => {
    adminApi
      .sqlInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
    adminApi
      .aiModels()
      .then((snap) => {
        setSnapshot(snap);
        const cfg = snap.config?.sql_generation || {};
        const p = String(cfg.provider || "groq");
        setProvider(p);
        setModel(String(cfg.model || cfg.groq_model || defaultForProvider(snap.env, p)));
      })
      .catch(() => setSnapshot(null));
    adminApi
      .sqlSchema()
      .then((res) => setSchemaTables(res.tables || []))
      .catch(() => setSchemaTables([]));
  }, []);

  useEffect(() => {
    if (!cellViewer) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setCellViewer(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cellViewer]);

  const filteredSchema = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return schemaTables;
    return schemaTables.filter((t) => t.name.toLowerCase().includes(q));
  }, [schemaTables, tableFilter]);

  const runQuery = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setCellViewer(null);
    try {
      const res = await adminApi.sql(sql, allowWrites);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setLoading(false);
    }
  }, [sql, allowWrites]);

  const generateSql = useCallback(async () => {
    if (!nlPrompt.trim()) {
      setGenError("Describe the query you want.");
      return;
    }
    if (!model) {
      setGenError("Select a model first.");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const res = await adminApi.sqlGenerate({
        prompt: nlPrompt.trim(),
        provider,
        model,
        tables: selectedTables.length ? selectedTables : undefined,
      });
      setSql(res.sql);
      setError(null);
      setResult(null);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "SQL generation failed");
    } finally {
      setGenerating(false);
    }
  }, [nlPrompt, model, provider, selectedTables]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void runQuery();
  }

  const toggleTable = (name: string) => {
    setSelectedTables((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  };

  const columns = result?.columns || [];
  const rows = result?.rows || [];
  const kind = result?.kind || (columns.length || rows.length ? "rows" : result ? "command" : undefined);

  return (
    <AdminTabPage
      badge="Database"
      title="SQL console"
      description={
        info ? `${info.database} · ${info.user} · schema ${info.schema}` : "Ad-hoc SQL · AI generator"
      }
      className="!flex !flex-col !overflow-hidden !p-0 md:!p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-5">
        {/* Compact NL → SQL generator */}
        <section className="shrink-0 rounded-xl border border-white/[0.08] bg-[#0a0a0a] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/50">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400/80" />
              SQL generator
            </div>
            {snapshot ? (
              <AdminModelSelector
                label="LLM"
                provider={provider}
                model={model}
                catalog={snapshot.catalog}
                env={snapshot.env}
                onChange={(p, m) => {
                  setProvider(p);
                  setModel(m);
                }}
                compact
              />
            ) : (
              <span className="text-[11px] text-white/35">Loading models…</span>
            )}
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
            <textarea
              value={nlPrompt}
              onChange={(e) => setNlPrompt(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="e.g. Count cases by status from the last 30 days"
              className={cn(adminInput, "min-w-0 flex-1 resize-none font-sans text-xs")}
              aria-label="Natural language SQL request"
            />
            <button
              type="button"
              className={cn(adminBtnPrimary, "shrink-0 gap-1.5 self-stretch text-xs sm:self-auto sm:px-4")}
              disabled={generating || !nlPrompt.trim() || !model}
              onClick={() => void generateSql()}
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generating ? "Generating…" : "Generate SQL"}
            </button>
          </div>
          {genError && <p className="mt-1.5 text-[11px] text-red-300">{genError}</p>}
          <details className="mt-2 group">
            <summary className="cursor-pointer list-none text-[11px] text-white/40 hover:text-white/65 [&::-webkit-details-marker]:hidden">
              <span className="underline-offset-2 group-open:no-underline">
                Attach tables
                {selectedTables.length
                  ? ` · ${selectedTables.length} selected`
                  : ` · all ${schemaTables.length} (default)`}
              </span>
            </summary>
            <div className="mt-2 space-y-2 border-t border-white/[0.06] pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={cn(adminInput, "max-w-xs py-1.5 text-[11px]")}
                  placeholder="Filter tables…"
                  value={tableFilter}
                  onChange={(e) => setTableFilter(e.target.value)}
                />
                <button
                  type="button"
                  className={cn(adminBtnSecondary, "text-[11px]")}
                  onClick={() => setSelectedTables([])}
                >
                  Use all tables
                </button>
              </div>
              <div className="admin-scrollbar flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {filteredSchema.map((t) => {
                  const on = selectedTables.includes(t.name);
                  return (
                    <button
                      key={t.name}
                      type="button"
                      title={t.columns.map((c) => c.name).join(", ")}
                      onClick={() => toggleTable(t.name)}
                      className={cn(
                        "rounded-md border px-2 py-0.5 font-mono text-[10px] transition",
                        on
                          ? "border-emerald-500/40 bg-emerald-600/20 text-emerald-200"
                          : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/80"
                      )}
                    >
                      {t.name}
                      <span className="ml-1 text-white/30">{t.columns.length}</span>
                    </button>
                  );
                })}
                {filteredSchema.length === 0 && (
                  <span className="text-[11px] text-white/35">No tables match.</span>
                )}
              </div>
            </div>
          </details>
        </section>

        {/* Editor | Results — always share remaining height */}
        <form
          onSubmit={handleSubmit}
          className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-3 overflow-hidden md:grid-cols-2 md:grid-rows-1"
        >
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0a0a]">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
              <span className="mr-auto text-xs font-semibold uppercase tracking-wide text-white/45">
                SQL
              </span>
              <button type="submit" disabled={loading || !sql.trim()} className={cn(adminBtnPrimary, "text-xs")}>
                {loading ? "Running…" : "Run query"}
              </button>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-white/60">
                <input
                  type="checkbox"
                  checked={allowWrites}
                  onChange={(e) => setAllowWrites(e.target.checked)}
                />
                Allow writes
              </label>
              <button
                type="button"
                className={cn(adminBtnSecondary, "text-[11px]")}
                onClick={() => setSql(DEFAULT_SQL)}
              >
                Reset
              </button>
            </div>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void runQuery();
                }
              }}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none border-0 bg-transparent p-3 font-mono text-sm text-white/90 outline-none focus:ring-0"
              placeholder="SELECT …"
              aria-label="SQL query"
            />
            <p className="shrink-0 border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-white/30">
              Ctrl+Enter to run · Results appear in the Output panel →
            </p>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0a0a]">
            <div className="shrink-0 border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/45">
              Output
              {result ? (
                <span className="ml-2 font-normal normal-case tracking-normal text-white/50">
                  {result.message ||
                    (result.row_count != null ? `${result.row_count} rows` : "")}
                  {result.execution_ms != null ? ` · ${result.execution_ms} ms` : ""}
                </span>
              ) : null}
              {loading ? (
                <span className="ml-2 inline-flex items-center gap-1 font-normal normal-case tracking-normal text-emerald-300/80">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Running…
                </span>
              ) : null}
            </div>
            <div className="admin-scrollbar min-h-0 flex-1 overflow-auto p-3">
              {error ? <pre className="whitespace-pre-wrap font-mono text-sm text-red-300">{error}</pre> : null}
              {!error && !result && !loading ? (
                <p className="text-sm text-white/40">
                  Query results show here after you click <span className="text-white/60">Run query</span>.
                </p>
              ) : null}
              {kind === "command" ? (
                <p className="text-sm text-green-300/90">
                  {result?.message ?? `Command completed (${result?.rowcount ?? result?.row_count ?? 0} rows affected).`}
                </p>
              ) : null}
              {kind === "rows" && result ? (
                <div className={`${adminTableScroll} max-h-full rounded-lg border border-white/10`}>
                  <table className="w-full min-w-max border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-white/10 bg-[#121212]">
                        {columns.map((col) => (
                          <th key={col} className="px-3 py-2 font-medium text-white/70">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={Math.max(columns.length, 1)} className="px-3 py-4 text-white/40">
                            No rows returned.
                          </td>
                        </tr>
                      ) : (
                        rows.map((row, i) => (
                          <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                            {columns.map((col) => {
                              const raw = row[col];
                              const display = formatCell(raw);
                              const expandable = isExpandableCell(raw);
                              return (
                                <td
                                  key={col}
                                  className={`max-w-xs px-3 py-1.5 font-mono text-white/80 ${
                                    expandable
                                      ? "cursor-pointer truncate text-emerald-200/90 hover:bg-emerald-600/10 hover:text-emerald-100"
                                      : "truncate"
                                  }`}
                                  title={expandable ? "Click to view full value" : display}
                                  onClick={
                                    expandable
                                      ? () => setCellViewer({ column: col, rowIndex: i, value: raw })
                                      : undefined
                                  }
                                  onKeyDown={
                                    expandable
                                      ? (e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            setCellViewer({ column: col, rowIndex: i, value: raw });
                                          }
                                        }
                                      : undefined
                                  }
                                  role={expandable ? "button" : undefined}
                                  tabIndex={expandable ? 0 : undefined}
                                >
                                  {display}
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </form>

        {cellViewer ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setCellViewer(null)}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sql-cell-viewer-title"
              className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-white/10 bg-[#141414] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div className="min-w-0">
                  <h3 id="sql-cell-viewer-title" className="truncate font-semibold text-white">
                    {cellViewer.column}
                  </h3>
                  <p className="text-xs text-white/50">
                    Row {cellViewer.rowIndex + 1}
                    {isJsonLike(cellViewer.value) ? " · JSON" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCellViewer(null)}
                  className="shrink-0 rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <pre className="admin-scrollbar min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-sm text-white/85">
                {formatCellForViewer(cellViewer.value)}
              </pre>
            </div>
          </div>
        ) : null}
      </div>
    </AdminTabPage>
  );
}
