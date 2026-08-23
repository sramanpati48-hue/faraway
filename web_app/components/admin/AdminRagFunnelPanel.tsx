"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileUp,
  Gavel,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import {
  AdminTabPage,
  AdminWorkspace,
  AdminNavItem,
  AdminSidebarRefreshButton,
} from "@/components/admin/AdminPageLayout";
import {
  AdminErrorBanner,
  AdminLoading,
  AdminStatCard,
  adminBtnDanger,
  adminBtnPrimary,
  adminBtnSecondary,
  adminCard,
  adminInput,
} from "@/components/admin/admin-ui";
import { AdminModelSelector } from "@/components/admin/AdminModelSelector";
import { cn } from "@/lib/utils";
import {
  adminApi,
  type AdminModelsSnapshot,
  type RagChunk,
  type RagFunnelConfig,
  type RagSession,
  type ScrCase,
  type ScrFetchSession,
  type ScrFetchSessionDetail,
  type ScrSearchRun,
  type ScamTrendDraft,
  type ScamTrendsConfig,
  type ScamTrendsRun,
  type ScamTrendsSchemaField,
} from "@/lib/adminApi";

const ACTIVE_STATUSES = new Set(["pending", "queued", "running"]);
/** Only poll while the worker is actively downloading — never while the admin is typing a CAPTCHA. */
const SCR_POLL_STATUSES = new Set(["running"]);
const SCAM_POLL_STATUSES = new Set(["queued", "running"]);
/** Providers whose API accepts the raw PDF; others get the extracted text. */
const PDF_NATIVE_PROVIDERS = new Set(["gemini", "vertex"]);

function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "text-emerald-300";
    case "promoted":
      return "text-blue-300";
    case "failed":
      return "text-red-300";
    case "running":
    case "queued":
    case "pending":
    case "awaiting_captcha":
    case "awaiting_model":
    case "awaiting_duplicate":
    case "paused_quota":
      return "text-amber-300";
    default:
      return "text-white/50";
  }
}

function isRateLimitError(text?: string | null): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes("429") ||
    t.includes("rate limit") ||
    t.includes("free-models-per-day") ||
    t.includes("paused_quota") ||
    t.includes("daily limit")
  );
}

function chunkStatusBadge(status: string): string {
  switch (status) {
    case "approved":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "rejected":
      return "border-red-500/40 bg-red-500/10 text-red-300";
    case "promoted":
      return "border-blue-500/40 bg-blue-500/10 text-blue-300";
    case "embedded":
      return "border-white/15 bg-white/[0.05] text-white/70";
    default:
      return "border-white/10 bg-white/[0.03] text-white/45";
  }
}

const PAGE_SIZE = 20;

type SubTab = "upload" | "scr" | "scam";
type PanelView =
  | "upload_list"
  | "new_upload"
  | "upload_session"
  | "scr_list"
  | "new_scr"
  | "scr_fetch"
  | "scr_pdf"
  | "scr_cases"
  | "scr_case_session"
  | "scam_list"
  | "scam_run";

function TabToggle({
  subTab,
  onSwitch,
}: {
  subTab: SubTab;
  onSwitch: (tab: SubTab) => void;
}) {
  return (
    <div className="grid shrink-0 grid-cols-3 gap-0.5 rounded-lg border border-white/[0.08] bg-black/50 p-0.5">
      <button
        type="button"
        onClick={() => onSwitch("upload")}
        className={cn(
          "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
          subTab === "upload" ? "bg-white/12 text-white" : "text-white/45 hover:text-white/70"
        )}
      >
        Upload
      </button>
      <button
        type="button"
        onClick={() => onSwitch("scr")}
        className={cn(
          "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
          subTab === "scr" ? "bg-white/12 text-white" : "text-white/45 hover:text-white/70"
        )}
      >
        SCR
      </button>
      <button
        type="button"
        onClick={() => onSwitch("scam")}
        className={cn(
          "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
          subTab === "scam" ? "bg-white/12 text-white" : "text-white/45 hover:text-white/70"
        )}
      >
        Scam Trends
      </button>
    </div>
  );
}

function HeaderModelControls({
  snapshot,
  provider,
  model,
  onChange,
}: {
  snapshot: AdminModelsSnapshot | null;
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
}) {
  if (!snapshot) {
    return <span className="text-[11px] text-white/35">Loading models…</span>;
  }
  return (
    <div className="min-w-0 max-w-[22rem]">
      <AdminModelSelector
        label="LLM"
        provider={provider}
        model={model}
        catalog={snapshot.catalog}
        env={snapshot.env}
        onChange={onChange}
        compact
      />
    </div>
  );
}

function formatWhen(value?: string | number | null): string {
  if (value == null || value === "") return "—";
  const d = typeof value === "number" ? new Date(value * (value < 1e12 ? 1000 : 1)) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

export function AdminRagFunnelPanel() {
  const [snapshot, setSnapshot] = useState<AdminModelsSnapshot | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("upload");
  const [view, setView] = useState<PanelView>("upload_list");
  const [uploadSessions, setUploadSessions] = useState<RagSession[]>([]);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadOffset, setUploadOffset] = useState(0);
  const [uploadQ, setUploadQ] = useState("");
  const [uploadQDraft, setUploadQDraft] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [scrFetches, setScrFetches] = useState<ScrFetchSession[]>([]);
  const [scrTotal, setScrTotal] = useState(0);
  const [scrOffset, setScrOffset] = useState(0);
  const [scrQ, setScrQ] = useState("");
  const [scrQDraft, setScrQDraft] = useState("");
  const [scrStatus, setScrStatus] = useState("");
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [selectedFetchId, setSelectedFetchId] = useState<string | null>(null);
  const [selectedPdfId, setSelectedPdfId] = useState<string | null>(null);
  const [openFetchDetail, setOpenFetchDetail] = useState<ScrFetchSessionDetail | null>(null);
  const [loadingOpenFetch, setLoadingOpenFetch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [defaultConfig, setDefaultConfig] = useState<RagFunnelConfig | null>(null);
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("");
  const [savingLlm, setSavingLlm] = useState(false);
  const llmSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistLlm = useCallback(
    (nextProvider: string, nextModel: string) => {
      if (llmSaveTimer.current) clearTimeout(llmSaveTimer.current);
      llmSaveTimer.current = setTimeout(() => {
        setSavingLlm(true);
        void adminApi
          .patchRagConfig({ provider: nextProvider, model: nextModel })
          .then((res) => {
            setDefaultConfig(res.config);
            setMessage(`Saved default LLM: ${nextProvider}/${nextModel}`);
          })
          .catch((err) => {
            setError(err instanceof Error ? err.message : "Failed to save LLM selection");
          })
          .finally(() => setSavingLlm(false));
      }, 350);
    },
    []
  );

  const setLlm = useCallback(
    (nextProvider: string, nextModel: string) => {
      setProvider(nextProvider);
      setModel(nextModel);
      persistLlm(nextProvider, nextModel);
    },
    [persistLlm]
  );

  const reportError = useCallback((m: string) => setError(m), []);
  const reportMessage = useCallback((m: string) => setMessage(m), []);

  const loadSnapshot = useCallback(async () => {
    const [snap, cfgRes] = await Promise.all([adminApi.aiModels(), adminApi.ragConfig()]);
    setSnapshot(snap);
    return cfgRes.config;
  }, []);

  useEffect(() => {
    return () => {
      if (llmSaveTimer.current) clearTimeout(llmSaveTimer.current);
    };
  }, []);

  const loadUploadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await adminApi.ragSessions(PAGE_SIZE, "upload", {
        offset: uploadOffset,
        q: uploadQ || undefined,
        status: uploadStatus || undefined,
      });
      setUploadSessions(res.sessions || []);
      setUploadTotal(res.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load upload sessions");
    } finally {
      setLoadingSessions(false);
    }
  }, [uploadOffset, uploadQ, uploadStatus]);

  const loadScrList = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await adminApi.scrFetchSessions(PAGE_SIZE, {
        offset: scrOffset,
        q: scrQ || undefined,
        status: scrStatus || undefined,
      });
      setScrFetches(res.sessions || []);
      setScrTotal(res.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load SCR sessions");
    } finally {
      setLoadingSessions(false);
    }
  }, [scrOffset, scrQ, scrStatus]);

  const refreshOpenFetch = useCallback(async (fetchId: string, opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoadingOpenFetch(true);
    try {
      const res = await adminApi.scrFetchSessionDetail(fetchId);
      setOpenFetchDetail(res.session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load SCR session";
      if (!opts.silent) setError(msg);
      if (/not found/i.test(msg)) {
        setSelectedFetchId(null);
        setSelectedPdfId(null);
        setOpenFetchDetail(null);
        setView("scr_list");
      }
    } finally {
      if (!opts.silent) setLoadingOpenFetch(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await loadSnapshot();
        setDefaultConfig(cfg);
        if (cfg?.provider) setProvider(cfg.provider);
        if (cfg?.model) setModel(cfg.model);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load AI models");
      }
    })();
  }, [loadSnapshot]);

  useEffect(() => {
    if (view === "upload_list") void loadUploadSessions();
  }, [view, loadUploadSessions]);

  useEffect(() => {
    if (view === "scr_list") void loadScrList();
  }, [view, loadScrList]);

  useEffect(() => {
    if (!selectedFetchId || (view !== "scr_fetch" && view !== "scr_pdf")) {
      setOpenFetchDetail(null);
      return;
    }
    void refreshOpenFetch(selectedFetchId);
  }, [selectedFetchId, view, refreshOpenFetch]);

  // Poll open fetch while download/ingest is active.
  useEffect(() => {
    if (!selectedFetchId || (view !== "scr_fetch" && view !== "scr_pdf")) return;
    const status = openFetchDetail?.status;
    if (!status || !SCR_POLL_STATUSES.has(status)) return;
    const t = window.setInterval(() => {
      void refreshOpenFetch(selectedFetchId, { silent: true });
    }, 4000);
    return () => window.clearInterval(t);
  }, [selectedFetchId, view, openFetchDetail?.status, refreshOpenFetch]);

  const switchTab = (tab: SubTab) => {
    setSubTab(tab);
    setMessage(null);
    setError(null);
    setSelectedUploadId(null);
    setSelectedFetchId(null);
    setSelectedPdfId(null);
    setOpenFetchDetail(null);
    setView(tab === "upload" ? "upload_list" : tab === "scr" ? "scr_list" : "scam_list");
  };

  const selectUploadSession = (id: string) => {
    setSelectedUploadId(id);
    setView("upload_session");
    setMessage(null);
    setError(null);
  };

  const selectScrFetch = (id: string) => {
    setSelectedFetchId(id);
    setSelectedPdfId(null);
    setView("scr_fetch");
    setMessage(null);
    setError(null);
  };

  const selectScrPdf = (fetchId: string, pdfId: string) => {
    setSelectedFetchId(fetchId);
    setSelectedPdfId(pdfId);
    setView("scr_pdf");
    setMessage(null);
    setError(null);
  };

  const deleteScrFetch = async (id: string, keyword: string) => {
    if (
      !window.confirm(
        `Delete SCR session “${keyword}” and all linked PDF ingest sessions/chunks? This cannot be undone.`
      )
    ) {
      return;
    }
    setDeletingId(id);
    try {
      const res = await adminApi.deleteScrSearch(id, true);
      setMessage(`Deleted session${res.deleted_pdfs ? ` and ${res.deleted_pdfs} PDF(s)` : ""}.`);
      if (selectedFetchId === id) {
        setSelectedFetchId(null);
        setSelectedPdfId(null);
        setView("scr_list");
      }
      await loadScrList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete session");
    } finally {
      setDeletingId(null);
    }
  };

  const deleteUploadSession = async (id: string, name: string) => {
    if (!window.confirm(`Delete upload session “${name}”? Chunks for this session will be removed.`)) return;
    setDeletingId(id);
    try {
      await adminApi.deleteRagSession(id, false);
      setMessage("Upload session deleted.");
      if (selectedUploadId === id) {
        setSelectedUploadId(null);
        setView("upload_list");
      }
      await loadUploadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete session");
    } finally {
      setDeletingId(null);
    }
  };

  const tabActions = (
    <div className="flex max-w-full flex-nowrap items-center justify-end gap-2">
      <HeaderModelControls snapshot={snapshot} provider={provider} model={model} onChange={setLlm} />
      {savingLlm ? (
        <span className="shrink-0 text-[10px] text-emerald-400/80">Saving…</span>
      ) : null}
      <TabToggle subTab={subTab} onSwitch={switchTab} />
    </div>
  );
  const alerts = (
    <>
      {error && <AdminErrorBanner message={error} onDismiss={() => setError(null)} />}
      {message && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      )}
    </>
  );

  const openFetchPdfs = openFetchDetail?.pdfs || [];
  const drilledIntoScr = view === "scr_fetch" || view === "scr_pdf";

  if (drilledIntoScr && selectedFetchId) {
    return (
      <AdminWorkspace
        badge="AI"
        title={openFetchDetail?.keyword || "SCR session"}
        description="Judgment PDFs from this fetch · review chunks, then promote."
        sidebarWidth="w-72"
        actions={tabActions}
        sidebarHeader={
          <button
            type="button"
            onClick={() => {
              setSelectedFetchId(null);
              setSelectedPdfId(null);
              setOpenFetchDetail(null);
              setView("scr_list");
              void loadScrList();
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-white/55 transition hover:text-white"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            All SCR sessions
          </button>
        }
        sidebar={
          <>
            <AdminNavItem
              active={view === "scr_fetch" && !selectedPdfId}
              onClick={() => {
                setSelectedPdfId(null);
                setView("scr_fetch");
              }}
              title="Session overview"
              subtitle={
                openFetchDetail
                  ? `${openFetchDetail.downloaded} downloaded · ${openFetchPdfs.length} ingested`
                  : "Loading…"
              }
              meta={
                openFetchDetail ? (
                  <span className={cn("text-[10px] font-semibold uppercase", statusTone(openFetchDetail.status))}>
                    {openFetchDetail.status}
                  </span>
                ) : undefined
              }
            />
            <div className="mx-3 my-2 border-t border-white/[0.06]" />
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">Judgments</p>
            {openFetchPdfs.map((p) => (
              <AdminNavItem
                key={p.id}
                active={view === "scr_pdf" && selectedPdfId === p.id}
                onClick={() => selectScrPdf(selectedFetchId, p.id)}
                title={p.document_name}
                subtitle={`${p.chunk_count} chunks · ${p.status}`}
                meta={
                  <span className={cn("text-[10px] font-semibold uppercase", statusTone(p.status))}>{p.status}</span>
                }
              />
            ))}
            {openFetchPdfs.length === 0 && !loadingOpenFetch && (
              <p className="px-3 py-3 text-xs text-white/35">No PDFs ingested yet.</p>
            )}
            {loadingOpenFetch && openFetchPdfs.length === 0 && (
              <p className="px-3 py-3 text-xs text-white/35">Loading PDFs…</p>
            )}
          </>
        }
        sidebarFooter={
          <AdminSidebarRefreshButton
            label="Refresh"
            loading={loadingOpenFetch}
            onClick={() => void refreshOpenFetch(selectedFetchId)}
          />
        }
      >
        <div className="admin-scrollbar min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
          {alerts}
          {view === "scr_fetch" && (
            <ScrFetchSessionView
              fetchId={selectedFetchId}
              provider={provider}
              model={model}
              onOpenPdf={(pdfId) => selectScrPdf(selectedFetchId, pdfId)}
              onChanged={() => void refreshOpenFetch(selectedFetchId)}
              onMessage={reportMessage}
              onError={reportError}
            />
          )}
          {view === "scr_pdf" && selectedPdfId && (
            <SessionDetail
              sessionId={selectedPdfId}
              provider={provider}
              model={model}
              onChanged={() => void refreshOpenFetch(selectedFetchId)}
              onDeleted={() => {
                void refreshOpenFetch(selectedFetchId);
                setSelectedPdfId(null);
                setView("scr_fetch");
              }}
              onMessage={reportMessage}
              onError={reportError}
              onBack={() => {
                setSelectedPdfId(null);
                setView("scr_fetch");
              }}
            />
          )}
        </div>
      </AdminWorkspace>
    );
  }

  return (
    <AdminTabPage
      badge="AI"
      title="RAG funnel"
      description="Upload legal PDFs or fetch Supreme Court judgments, chunk with an LLM, review, then promote."
      actions={tabActions}
    >
      {alerts}

      {view === "upload_list" && (
        <SessionTableShell
          title="Upload sessions"
          searchDraft={uploadQDraft}
          onSearchDraftChange={setUploadQDraft}
          onSearchSubmit={() => {
            setUploadOffset(0);
            setUploadQ(uploadQDraft.trim());
          }}
          status={uploadStatus}
          onStatusChange={(s) => {
            setUploadOffset(0);
            setUploadStatus(s);
          }}
          statusOptions={[
            "",
            "pending",
            "queued",
            "running",
            "paused_quota",
            "completed",
            "failed",
            "promoted",
          ]}
          loading={loadingSessions}
          onRefresh={() => void loadUploadSessions()}
          offset={uploadOffset}
          pageSize={PAGE_SIZE}
          total={uploadTotal}
          onPrev={() => setUploadOffset((o) => Math.max(0, o - PAGE_SIZE))}
          onNext={() => setUploadOffset((o) => o + PAGE_SIZE)}
          primaryAction={
            <button type="button" className={adminBtnPrimary} onClick={() => setView("new_upload")}>
              <Plus className="h-3.5 w-3.5" />
              New ingestion
            </button>
          }
        >
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="sticky top-0 bg-[#0a0a0a] text-[11px] uppercase tracking-wide text-white/40">
              <tr className="border-b border-white/[0.08]">
                <th className="px-3 py-2.5 font-medium">Document</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Chunks</th>
                <th className="px-3 py-2.5 font-medium">Pages</th>
                <th className="px-3 py-2.5 font-medium">Created</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {uploadSessions.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer border-b border-white/[0.05] transition hover:bg-white/[0.04]"
                  onClick={() => selectUploadSession(s.id)}
                >
                  <td className="px-3 py-3 font-medium text-white/90">{s.document_name}</td>
                  <td className={cn("px-3 py-3 text-xs font-semibold uppercase", statusTone(s.status))}>
                    {s.status}
                  </td>
                  <td className="px-3 py-3 text-white/55">{s.chunk_count}</td>
                  <td className="px-3 py-3 text-white/55">{s.total_pages}</td>
                  <td className="px-3 py-3 text-xs text-white/40">{formatWhen(s.created_at)}</td>
                  <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={cn(adminBtnDanger, "px-2 py-1 text-xs")}
                      disabled={deletingId === s.id}
                      onClick={() => void deleteUploadSession(s.id, s.document_name)}
                      title="Delete session"
                    >
                      {deletingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
              {uploadSessions.length === 0 && !loadingSessions && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-white/35">
                    No upload sessions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </SessionTableShell>
      )}

      {view === "new_upload" && (
        <div>
          <button
            type="button"
            onClick={() => setView("upload_list")}
            className="mb-4 flex items-center gap-1.5 text-xs font-medium text-white/55 hover:text-white"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to sessions
          </button>
          <NewIngestionForm
            provider={provider}
            model={model}
            defaultConfig={defaultConfig}
            onCreated={async (id) => {
              selectUploadSession(id);
              setMessage("Ingestion started. Chunks will appear as pages are processed.");
            }}
            onError={reportError}
          />
        </div>
      )}

      {view === "upload_session" && selectedUploadId && (
        <div>
          <button
            type="button"
            onClick={() => {
              setSelectedUploadId(null);
              setView("upload_list");
              void loadUploadSessions();
            }}
            className="mb-4 flex items-center gap-1.5 text-xs font-medium text-white/55 hover:text-white"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to sessions
          </button>
          <SessionDetail
            sessionId={selectedUploadId}
            provider={provider}
            model={model}
            onChanged={() => void loadUploadSessions()}
            onDeleted={() => {
              setSelectedUploadId(null);
              setView("upload_list");
              void loadUploadSessions();
            }}
            onMessage={reportMessage}
            onError={reportError}
          />
        </div>
      )}

      {view === "scr_list" && (
        <SessionTableShell
          title="SCR fetch sessions"
          searchDraft={scrQDraft}
          onSearchDraftChange={setScrQDraft}
          onSearchSubmit={() => {
            setScrOffset(0);
            setScrQ(scrQDraft.trim());
          }}
          status={scrStatus}
          onStatusChange={(s) => {
            setScrOffset(0);
            setScrStatus(s);
          }}
          statusOptions={[
            "",
            "pending",
            "awaiting_captcha",
            "awaiting_model",
            "awaiting_duplicate",
            "running",
            "completed",
            "failed",
          ]}
          loading={loadingSessions}
          onRefresh={() => void loadScrList()}
          offset={scrOffset}
          pageSize={PAGE_SIZE}
          total={scrTotal}
          onPrev={() => setScrOffset((o) => Math.max(0, o - PAGE_SIZE))}
          onNext={() => setScrOffset((o) => o + PAGE_SIZE)}
          primaryAction={
            <div className="flex flex-wrap gap-2">
              <button type="button" className={adminBtnSecondary} onClick={() => setView("scr_cases")}>
                Downloaded cases
              </button>
              <button type="button" className={adminBtnPrimary} onClick={() => setView("new_scr")}>
                <Plus className="h-3.5 w-3.5" />
                Fetch from SCR
              </button>
            </div>
          }
        >
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="sticky top-0 bg-[#0a0a0a] text-[11px] uppercase tracking-wide text-white/40">
              <tr className="border-b border-white/[0.08]">
                <th className="px-3 py-2.5 font-medium">Keyword</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Found</th>
                <th className="px-3 py-2.5 font-medium">Downloaded</th>
                <th className="px-3 py-2.5 font-medium">Ingested</th>
                <th className="px-3 py-2.5 font-medium">Created</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {scrFetches.map((f) => (
                <tr
                  key={f.id}
                  className="cursor-pointer border-b border-white/[0.05] transition hover:bg-white/[0.04]"
                  onClick={() => selectScrFetch(f.id)}
                >
                  <td className="px-3 py-3">
                    <div className="font-medium text-white/90">{f.keyword}</div>
                    {(f.message || f.error) && (
                      <div className="mt-0.5 max-w-md truncate text-[11px] text-white/35">
                        {f.error || f.message}
                      </div>
                    )}
                  </td>
                  <td className={cn("px-3 py-3 text-xs font-semibold uppercase", statusTone(f.status))}>
                    {f.status}
                  </td>
                  <td className="px-3 py-3 text-white/55">{f.found}</td>
                  <td className="px-3 py-3 text-white/55">{f.downloaded}</td>
                  <td className="px-3 py-3 text-white/55">{f.pdf_count ?? 0}</td>
                  <td className="px-3 py-3 text-xs text-white/40">{formatWhen(f.created_at)}</td>
                  <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={cn(adminBtnDanger, "px-2 py-1 text-xs")}
                      disabled={deletingId === f.id}
                      onClick={() => void deleteScrFetch(f.id, f.keyword)}
                      title="Delete session"
                    >
                      {deletingId === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
              {scrFetches.length === 0 && !loadingSessions && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-sm text-white/35">
                    No SCR fetch sessions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </SessionTableShell>
      )}

      {view === "new_scr" && (
        <div>
          <button
            type="button"
            onClick={() => setView("scr_list")}
            className="mb-4 flex items-center gap-1.5 text-xs font-medium text-white/55 hover:text-white"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to sessions
          </button>
          <ScrFetchForm
            provider={provider}
            model={model}
            defaultConfig={defaultConfig}
            onRunCreated={(runId) => {
              // Navigate only after CAPTCHA is accepted — not while the user is typing it.
              selectScrFetch(runId);
            }}
            onSessionCreated={() => {
              if (selectedFetchId) void refreshOpenFetch(selectedFetchId);
            }}
            onOpenSession={(id) => {
              if (selectedFetchId) selectScrPdf(selectedFetchId, id);
            }}
            onError={reportError}
            onMessage={reportMessage}
          />
        </div>
      )}

      {view === "scr_cases" && (
        <div>
          <button
            type="button"
            onClick={() => setView("scr_list")}
            className="mb-4 flex items-center gap-1.5 text-xs font-medium text-white/55 hover:text-white"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to sessions
          </button>
          <ScrCasesList
            onOpenSession={(id) => {
              setSelectedUploadId(id);
              setView("scr_case_session");
            }}
            onError={reportError}
          />
        </div>
      )}

      {view === "scr_case_session" && selectedUploadId && (
        <div>
          <button
            type="button"
            onClick={() => {
              setSelectedUploadId(null);
              setView("scr_cases");
            }}
            className="mb-4 flex items-center gap-1.5 text-xs font-medium text-white/55 hover:text-white"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to downloaded cases
          </button>
          <SessionDetail
            sessionId={selectedUploadId}
            provider={provider}
            model={model}
            onChanged={() => undefined}
            onDeleted={() => {
              setSelectedUploadId(null);
              setView("scr_cases");
            }}
            onMessage={reportMessage}
            onError={reportError}
          />
        </div>
      )}

      {(view === "scam_list" || view === "scam_run") && (
        <ScamTrendsPanel
          provider={provider}
          model={model}
          onMessage={reportMessage}
          onError={reportError}
        />
      )}
    </AdminTabPage>
  );
}

function ScamTrendsPanel({
  provider,
  model,
  onMessage,
  onError,
}: {
  provider: string;
  model: string;
  onMessage: (m: string) => void;
  onError: (m: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [targetDate, setTargetDate] = useState(today);
  const [areas, setAreas] = useState<string[]>(["India"]);
  const [areaDraft, setAreaDraft] = useState("");
  const [count, setCount] = useState(10);
  const [customQuery, setCustomQuery] = useState("");
  const [runs, setRuns] = useState<ScamTrendsRun[]>([]);
  const [activeRun, setActiveRun] = useState<ScamTrendsRun | null>(null);
  const [drawerRun, setDrawerRun] = useState<ScamTrendsRun | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const kickedProcessRef = useRef<Set<string>>(new Set());

  const kickProcessOnce = useCallback((runId: string, force = false) => {
    if (!force && kickedProcessRef.current.has(runId)) return;
    kickedProcessRef.current.add(runId);
    adminApi.kickScamTrendsProcess(runId);
  }, []);
  const [runSearch, setRunSearch] = useState("");
  const [runPage, setRunPage] = useState(0);
  const RUNS_PAGE_SIZE = 5;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listScamTrendsRuns(100);
      const list = res.runs || [];
      setRuns(list);
      for (const r of list) {
        if (r.status === "queued") kickProcessOnce(r.id, true);
      }
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Failed to load scam trend runs");
    } finally {
      setLoading(false);
    }
  }, [kickProcessOnce]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!activeRun || !SCAM_POLL_STATUSES.has(activeRun.status)) return;
    // One long-lived process request (Cloud Run CPU). Re-kick only if re-queued.
    if (activeRun.status === "queued") {
      kickProcessOnce(activeRun.id, true);
    }
    const t = setInterval(() => {
      void adminApi
        .scamTrendsRunStatus(activeRun.id)
        .then((r) => {
          setActiveRun(r.run);
          if (r.run.status === "queued") {
            kickProcessOnce(r.run.id, true);
          }
          if (!SCAM_POLL_STATUSES.has(r.run.status)) {
            kickedProcessRef.current.delete(r.run.id);
            void loadRuns();
            if (r.run.status === "completed") {
              onMessage(
                r.run.message ||
                  `Staged ${r.run.extracted_count ?? 0} drafts for approval`
              );
            } else if (r.run.status === "failed") {
              onError(r.run.error || r.run.message || "Scam trends run failed");
            }
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [activeRun?.id, activeRun?.status, kickProcessOnce, loadRuns, onMessage, onError]);

  useEffect(() => {
    if (!drawerRun || !SCAM_POLL_STATUSES.has(drawerRun.status)) return;
    const id = drawerRun.id;
    if (drawerRun.status === "queued") kickProcessOnce(id, true);
    const t = setInterval(() => {
      void adminApi
        .scamTrendsRunStatus(id)
        .then((r) => {
          setDrawerRun((cur) => (cur && cur.id === id ? r.run : cur));
          if (r.run.status === "queued") kickProcessOnce(id, true);
          if (!SCAM_POLL_STATUSES.has(r.run.status)) {
            kickedProcessRef.current.delete(id);
            void loadRuns();
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [drawerRun?.id, drawerRun?.status, kickProcessOnce, loadRuns]);

  const filteredRuns = useMemo(() => {
    const q = runSearch.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((r) => {
      const areaLabel = Array.isArray(r.areas)
        ? r.areas.join(", ")
        : typeof r.areas === "string"
          ? r.areas
          : "";
      const cfg =
        r.config && typeof r.config === "object" ? (r.config as { custom_query?: string }) : null;
      const customQ = (r.custom_query || cfg?.custom_query || "").trim();
      const hay = [
        r.id,
        r.target_date,
        r.status,
        areaLabel,
        customQ,
        r.message,
        String(r.extracted_count ?? r.stored_count ?? ""),
        String(r.promoted_count ?? ""),
        r.created_at,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [runs, runSearch]);

  const runTotalPages = Math.max(1, Math.ceil(filteredRuns.length / RUNS_PAGE_SIZE));
  const safeRunPage = Math.min(runPage, runTotalPages - 1);
  const pagedRuns = filteredRuns.slice(
    safeRunPage * RUNS_PAGE_SIZE,
    safeRunPage * RUNS_PAGE_SIZE + RUNS_PAGE_SIZE
  );
  const runRangeStart = filteredRuns.length === 0 ? 0 : safeRunPage * RUNS_PAGE_SIZE + 1;
  const runRangeEnd = Math.min((safeRunPage + 1) * RUNS_PAGE_SIZE, filteredRuns.length);

  const addArea = () => {
    const a = areaDraft.trim();
    if (!a) return;
    if (areas.some((x) => x.toLowerCase() === a.toLowerCase())) {
      setAreaDraft("");
      return;
    }
    setAreas((prev) => [...prev, a]);
    setAreaDraft("");
  };

  const startRunWith = async (opts: {
    target_date?: string;
    areas?: string[];
    count?: number;
    custom_query?: string;
    provider: string;
    model: string;
    successMessage?: string;
  }) => {
    if (!opts.model) {
      onError("Select a model in the header first.");
      return null;
    }
    const res = await adminApi.createScamTrendsRun({
      target_date: opts.target_date,
      areas: opts.areas?.length ? opts.areas : ["India"],
      count: opts.count ?? 10,
      provider: opts.provider,
      model: opts.model,
      custom_query: opts.custom_query?.trim() || undefined,
    });
    kickedProcessRef.current.delete(res.run.id);
    setActiveRun(res.run);
    setDrawerRun(res.run);
    kickProcessOnce(res.run.id, true);
    onMessage(opts.successMessage || "Scam trends scrape started.");
    await loadRuns();
    return res.run;
  };

  const startRun = async () => {
    setBusy(true);
    try {
      await startRunWith({
        target_date: targetDate,
        areas: areas.length ? areas : ["India"],
        count,
        provider,
        model,
        custom_query: customQuery.trim() || undefined,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to start scam trends run");
    } finally {
      setBusy(false);
    }
  };

  const rerunFromDrawer = async (source: ScamTrendsRun) => {
    const cfg =
      source.config && typeof source.config === "object" ? source.config : null;
    const areaList = Array.isArray(source.areas)
      ? source.areas.map(String)
      : typeof source.areas === "string"
        ? (() => {
            try {
              const parsed = JSON.parse(source.areas);
              return Array.isArray(parsed) ? parsed.map(String) : [source.areas];
            } catch {
              return [source.areas];
            }
          })()
        : ["India"];
    const q = (source.custom_query || cfg?.custom_query || "").trim();
    try {
      await startRunWith({
        target_date: source.target_date || targetDate,
        areas: areaList.length ? areaList : ["India"],
        count: source.requested_count || count,
        custom_query: q || undefined,
        provider,
        model,
        successMessage: `Rerun started with ${provider}/${model}`,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to rerun scrape");
      throw err;
    }
  };

  return (
    <div className="space-y-5">
      <div className={cn(adminCard, "p-5")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">Scrape scam trends</h2>
            <p className="mt-1 text-xs text-white/40">
              Web search → read the articles → LLM extract → embed → store in{" "}
              <code className="text-white/60">mock_scams</code>. Only real, recently reported
              incidents are staged — areas just steer the search queries, and each scam&apos;s city
              and map coordinates come from the article the model read.
            </p>
          </div>
          <button
            type="button"
            className={cn(adminBtnSecondary, "shrink-0 gap-1.5 text-xs")}
            onClick={() => setPromptOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Edit system prompt
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block text-xs text-white/50">
            Date
            <input
              type="date"
              className={cn(adminInput, "mt-1 w-full")}
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </label>
          <label className="block text-xs text-white/50">
            Max scams to store
            <input
              type="number"
              min={1}
              max={50}
              className={cn(adminInput, "mt-1 w-full")}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
            />
          </label>
          <label className="block text-xs text-white/50 sm:col-span-2">
            Add search area (state / city)
            <div className="mt-1 flex gap-2">
              <input
                className={cn(adminInput, "w-full")}
                placeholder="e.g. Delhi, West Bengal"
                value={areaDraft}
                onChange={(e) => setAreaDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addArea();
                  }
                }}
              />
              <button type="button" className={adminBtnSecondary} onClick={addArea}>
                Add
              </button>
            </div>
          </label>
          <label className="block text-xs text-white/50 sm:col-span-2 xl:col-span-4">
            Custom query (optional)
            <input
              className={cn(adminInput, "mt-1 w-full")}
              placeholder="e.g. fake RBI KYC SMS, job offer Telegram scam"
              maxLength={240}
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
            />
            <span className="mt-1 block text-[10px] text-white/30">
              Appended to web search and used as an LLM focus theme. Leave blank for default scam-trend queries.
            </span>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {areas.map((a) => (
            <button
              key={a}
              type="button"
              className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80"
              onClick={() => {
                if (a === "India" && areas.length === 1) return;
                setAreas((prev) => prev.filter((x) => x !== a));
              }}
              title={a === "India" && areas.length === 1 ? "India is the default area" : "Remove area"}
            >
              {a}
              {!(a === "India" && areas.length === 1) && <span className="ml-1 text-white/40">×</span>}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" className={adminBtnPrimary} disabled={busy} onClick={() => void startRun()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {busy ? "Starting…" : "Run scrape"}
          </button>
          <button type="button" className={adminBtnSecondary} onClick={() => void loadRuns()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <span className="text-[11px] text-white/35">
            Model: {provider}/{model || "—"} · runs in the API request (no min-instances)
          </span>
        </div>
      </div>

      {activeRun && SCAM_POLL_STATUSES.has(activeRun.status) && (
        <div className={cn(adminCard, "p-4")}>
          <div className="mb-2 flex items-center justify-between text-xs text-white/50">
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />
              {activeRun.message || "Running…"}
            </span>
            <span>{activeRun.progress ?? 0}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-amber-400/80 transition-all"
              style={{ width: `${activeRun.progress ?? 0}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-white/40">
            searched {activeRun.searched_count ?? 0} · extracted{" "}
            {activeRun.extracted_count ?? activeRun.stored_count ?? 0} /{" "}
            {activeRun.requested_count ?? "?"}
            {activeRun.status === "queued" ? " · starting process…" : ""}
          </p>
        </div>
      )}

      <div className={cn(adminCard, "overflow-hidden p-0")}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white/85">Recent runs</h3>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />}
          </div>
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
            <input
              className={cn(adminInput, "w-full py-1.5 pl-8 text-xs")}
              placeholder="Search date, area, status, query…"
              value={runSearch}
              onChange={(e) => {
                setRunSearch(e.target.value);
                setRunPage(0);
              }}
            />
          </div>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-white/40">
            <tr className="border-b border-white/[0.08]">
              <th className="px-3 py-2.5 font-medium">Date</th>
              <th className="px-3 py-2.5 font-medium">Areas</th>
              <th className="px-3 py-2.5 font-medium">Query</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Extracted</th>
              <th className="px-3 py-2.5 font-medium">Promoted</th>
              <th className="px-3 py-2.5 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {pagedRuns.map((r) => {
              const areaLabel = Array.isArray(r.areas)
                ? r.areas.join(", ")
                : typeof r.areas === "string"
                  ? r.areas
                  : "India";
              const cfg =
                r.config && typeof r.config === "object" ? (r.config as { custom_query?: string }) : null;
              const qLabel = (r.custom_query || cfg?.custom_query || "").trim();
              const extracted =
                r.extracted_count ??
                (Array.isArray(cfg && "results" in cfg ? (cfg as { results?: unknown[] }).results : null)
                  ? ((cfg as { results?: unknown[] }).results?.length ?? 0)
                  : r.stored_count ?? 0);
              return (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-white/[0.05] hover:bg-white/[0.03]"
                  onClick={() => setDrawerRun(r)}
                >
                  <td className="px-3 py-2.5 text-white/80">{r.target_date || "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-white/55">{areaLabel}</td>
                  <td className="max-w-[180px] truncate px-3 py-2.5 text-xs text-white/45" title={qLabel || undefined}>
                    {qLabel || "—"}
                  </td>
                  <td className={cn("px-3 py-2.5 text-xs font-semibold uppercase", statusTone(r.status))}>
                    {r.status}
                  </td>
                  <td className="px-3 py-2.5 text-white/55">
                    {extracted}/{r.requested_count ?? "?"}
                  </td>
                  <td className="px-3 py-2.5 text-white/55">{r.promoted_count ?? 0}</td>
                  <td className="px-3 py-2.5 text-xs text-white/40">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                  </td>
                </tr>
              );
            })}
            {filteredRuns.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-white/35">
                  {runs.length === 0
                    ? "No scam trend runs yet."
                    : "No runs match your search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filteredRuns.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-2.5 text-xs text-white/45">
            <span>
              {runRangeStart}–{runRangeEnd} of {filteredRuns.length}
              {runSearch.trim() ? ` (filtered from ${runs.length})` : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={cn(adminBtnSecondary, "px-2 py-1")}
                disabled={safeRunPage === 0 || loading}
                onClick={() => setRunPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>
                Page {safeRunPage + 1} / {runTotalPages}
              </span>
              <button
                type="button"
                className={cn(adminBtnSecondary, "px-2 py-1")}
                disabled={safeRunPage + 1 >= runTotalPages || loading}
                onClick={() => setRunPage((p) => Math.min(runTotalPages - 1, p + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <ScamRunDrawer
        run={drawerRun}
        provider={provider}
        model={model}
        onClose={() => setDrawerRun(null)}
        onRerun={rerunFromDrawer}
        onRunUpdated={(next) => {
          setDrawerRun((cur) => (cur && cur.id === next.id ? next : cur));
          setRuns((prev) => prev.map((r) => (r.id === next.id ? next : r)));
        }}
        onMessage={onMessage}
        onError={onError}
      />

      {promptOpen && (
        <ScamPromptModal
          onClose={() => setPromptOpen(false)}
          onMessage={onMessage}
          onError={onError}
        />
      )}
    </div>
  );
}

function ScamPromptModal({
  onClose,
  onMessage,
  onError,
}: {
  onClose: () => void;
  onMessage: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [config, setConfig] = useState<ScamTrendsConfig | null>(null);
  const [defaults, setDefaults] = useState<ScamTrendsConfig | null>(null);
  const [schema, setSchema] = useState<ScamTrendsSchemaField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void adminApi
      .scamTrendsConfig()
      .then((res) => {
        if (!alive) return;
        setConfig(res.config);
        setDefaults(res.defaults);
        setSchema(res.schema || []);
      })
      .catch((err) => {
        if (!alive) return;
        onError(err instanceof Error ? err.message : "Failed to load prompt config");
        onClose();
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per open
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = (next: Partial<ScamTrendsConfig>) =>
    setConfig((cur) => (cur ? { ...cur, ...next } : cur));

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await adminApi.patchScamTrendsConfig({
        system_prompt: config.system_prompt,
        recency_days: config.recency_days,
        search_timelimit: config.search_timelimit,
        prefer_news: config.prefer_news,
        strict_filters: config.strict_filters,
        blocked_domains: config.blocked_domains,
      });
      setConfig(res.config);
      onMessage("Extraction prompt saved — it applies to the next run.");
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save prompt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close prompt editor"
        className="absolute inset-0 bg-black/70 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <div className="relative z-[96] flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0c] shadow-[0_24px_80px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in-95 duration-150">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white/90">Scam extraction system prompt</h3>
            <p className="mt-0.5 text-[11px] text-white/40">
              Controls what counts as a real, recent scam. Applies to the next run and to reruns.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className={cn(adminBtnSecondary, "shrink-0 gap-1.5 px-2.5 py-1.5 text-xs text-white/80")}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading || !config ? (
            <AdminLoading label="Loading prompt…" />
          ) : (
            <div className="space-y-5">
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-white/50">
                    System prompt
                  </label>
                  <button
                    type="button"
                    className="text-[11px] text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
                    disabled={!defaults}
                    onClick={() => defaults && patch({ system_prompt: defaults.system_prompt })}
                  >
                    Reset to default
                  </button>
                </div>
                <textarea
                  className={cn(
                    adminInput,
                    "min-h-[280px] w-full resize-y font-mono text-[11px] leading-relaxed"
                  )}
                  spellCheck={false}
                  value={config.system_prompt}
                  onChange={(e) => patch({ system_prompt: e.target.value })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-white/50">
                  Drop trends older than (days)
                  <input
                    type="number"
                    min={0}
                    max={3650}
                    className={cn(adminInput, "mt-1 w-full")}
                    value={config.recency_days}
                    onChange={(e) =>
                      patch({ recency_days: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                  <span className="mt-1 block text-[10px] text-white/30">0 disables the check.</span>
                </label>
                <label className="block text-xs text-white/50">
                  Search window
                  <select
                    className={cn(adminInput, "mt-1 w-full")}
                    value={config.search_timelimit}
                    onChange={(e) => patch({ search_timelimit: e.target.value })}
                  >
                    <option value="d">Past day</option>
                    <option value="w">Past week</option>
                    <option value="m">Past month</option>
                    <option value="y">Past year</option>
                    <option value="">No limit</option>
                  </select>
                  <span className="mt-1 block text-[10px] text-white/30">
                    Passed to the search engine before the model sees anything.
                  </span>
                </label>
              </div>

              <div className="space-y-2">
                <label className="flex items-start gap-2 text-xs text-white/60">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={config.prefer_news}
                    onChange={(e) => patch({ prefer_news: e.target.checked })}
                  />
                  <span>
                    Search the news index first
                    <span className="block text-[10px] text-white/30">
                      Surfaces reported incidents instead of evergreen explainers.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-xs text-white/60">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={config.strict_filters}
                    onChange={(e) => patch({ strict_filters: e.target.checked })}
                  />
                  <span>
                    Require evidence and a report date
                    <span className="block text-[10px] text-white/30">
                      Drops trends with no cited incident, and disables the snippet fallback.
                    </span>
                  </span>
                </label>
              </div>

              <label className="block text-xs text-white/50">
                Blocked domains (one per line)
                <textarea
                  className={cn(adminInput, "mt-1 min-h-[90px] w-full resize-y font-mono text-[11px]")}
                  spellCheck={false}
                  value={config.blocked_domains.join("\n")}
                  onChange={(e) =>
                    patch({
                      blocked_domains: e.target.value
                        .split("\n")
                        .map((d) => d.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <span className="mt-1 block text-[10px] text-white/30">
                  Vendor and product blogs whose &quot;scam&quot; posts are marketing, not reporting.
                </span>
              </label>

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/50">
                  Output schema (fixed)
                </p>
                <p className="mb-2 text-[10px] text-white/30">
                  Appended to your prompt automatically. The pipeline parses these exact keys, so
                  they cannot be edited here.
                </p>
                <div className="overflow-hidden rounded-xl border border-white/[0.08]">
                  {schema.map((field, i) => (
                    <div
                      key={field.key}
                      className={cn(
                        "grid grid-cols-[130px_1fr] gap-3 px-3 py-2",
                        i % 2 === 0 ? "bg-white/[0.02]" : "bg-transparent"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] text-white/80">{field.key}</p>
                        <p className="text-[10px] text-white/30">{field.type}</p>
                      </div>
                      <p className="text-[11px] leading-relaxed text-white/55">{field.rule}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.08] px-5 py-3">
          <button type="button" className={cn(adminBtnSecondary, "text-xs")} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={cn(adminBtnPrimary, "gap-1.5 text-xs")}
            disabled={saving || loading || !config}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save prompt
          </button>
        </div>
      </div>
    </div>
  );
}

function draftStatusTone(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "approved":
      return "text-emerald-300/90";
    case "promoted":
      return "text-blue-300/90";
    case "rejected":
      return "text-red-300/80";
    default:
      return "text-amber-300/90";
  }
}

function ScamRunDrawer({
  run,
  provider,
  model,
  onClose,
  onRerun,
  onRunUpdated,
  onMessage,
  onError,
}: {
  run: ScamTrendsRun | null;
  provider: string;
  model: string;
  onClose: () => void;
  onRerun: (source: ScamTrendsRun) => Promise<void>;
  onRunUpdated: (run: ScamTrendsRun) => void;
  onMessage: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [drafts, setDrafts] = useState<ScamTrendDraft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const openRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    openRunIdRef.current = run?.id ?? null;
  }, [run?.id]);

  const loadDrafts = useCallback(
    async (runId: string) => {
      setLoadingDrafts(true);
      try {
        const res = await adminApi.listScamTrendDrafts(runId);
        // Ignore stale responses after the drawer was closed / switched runs.
        if (openRunIdRef.current !== runId) return;
        setDrafts(res.drafts || []);
        if (res.run) onRunUpdated(res.run);
      } catch (err) {
        if (openRunIdRef.current !== runId) return;
        onError(err instanceof Error ? err.message : "Failed to load drafts");
      } finally {
        if (openRunIdRef.current === runId) setLoadingDrafts(false);
      }
    },
    [onError, onRunUpdated]
  );

  useEffect(() => {
    if (!run) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The draft reader sits on top of the drawer — peel it off first.
      if (openDraftId) {
        setOpenDraftId(null);
        return;
      }
      openRunIdRef.current = null;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, onClose, openDraftId]);

  useEffect(() => {
    setOpenDraftId(null);
  }, [run?.id]);

  useEffect(() => {
    if (!run?.id) {
      setDrafts([]);
      return;
    }
    if (SCAM_POLL_STATUSES.has(run.status)) return;
    void loadDrafts(run.id);
    // Only reload when the open run identity/status changes — not when callbacks churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [run?.id, run?.status]);

  if (!run) return null;

  const areaLabel = Array.isArray(run.areas)
    ? run.areas.join(", ")
    : typeof run.areas === "string"
      ? run.areas
      : "India";
  const cfg = run.config && typeof run.config === "object" ? run.config : null;
  const qLabel = (run.custom_query || cfg?.custom_query || "").trim();
  const providerLabel = run.provider || cfg?.provider || "—";
  const modelLabel = run.model || cfg?.model || "—";
  const isActive = SCAM_POLL_STATUSES.has(run.status);
  const extracted =
    run.extracted_count ??
    (drafts.length || (Array.isArray(cfg?.results) ? cfg!.results!.length : 0));
  const approvedCount =
    run.approved_count ?? drafts.filter((d) => d.status === "approved").length;
  const promotedCount =
    run.promoted_count ?? drafts.filter((d) => d.status === "promoted").length;
  const draftPending = drafts.filter((d) => d.status === "draft").length;

  const rows: { label: string; value: ReactNode }[] = [
    { label: "Status", value: <span className={cn("font-semibold uppercase", statusTone(run.status))}>{run.status}</span> },
    { label: "Run ID", value: <span className="font-mono text-[11px] break-all text-white/60">{run.id}</span> },
    { label: "Target date", value: run.target_date || "—" },
    { label: "Areas", value: areaLabel },
    { label: "Custom query", value: qLabel || "—" },
    { label: "Model", value: `${providerLabel}/${modelLabel}` },
    { label: "Extracted", value: `${extracted} / ${run.requested_count ?? "?"}` },
    { label: "Approved", value: approvedCount },
    { label: "Promoted", value: promotedCount },
    { label: "Searched", value: run.searched_count ?? 0 },
    { label: "Created", value: run.created_at ? new Date(run.created_at).toLocaleString() : "—" },
    { label: "Updated", value: run.updated_at ? new Date(run.updated_at).toLocaleString() : "—" },
  ];

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const handleClose = () => {
    openRunIdRef.current = null;
    onClose();
  };

  const setDraftStatus = (draftId: string, status: "approved" | "rejected") =>
    runAction(`${status}-${draftId}`, async () => {
      const res = await adminApi.setScamTrendDraftStatus(draftId, status);
      setDrafts((prev) => prev.map((d) => (d.id === draftId ? res.draft : d)));
      if (res.run) onRunUpdated(res.run);
    });

  const openDraft = openDraftId ? drafts.find((d) => d.id === openDraftId) ?? null : null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <button
        type="button"
        aria-label="Close run details"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={handleClose}
      />
      <aside className="relative z-[81] flex h-full w-full max-w-[440px] flex-col border-l border-white/10 bg-[#0c0c0c] shadow-[-8px_0_40px_rgba(0,0,0,0.6)] animate-in slide-in-from-right duration-200">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white/90">Scam trend run</h3>
            <p className="text-[11px] text-white/40">{run.target_date || "—"} · {areaLabel}</p>
            <p className="mt-0.5 truncate text-[10px] text-white/30" title={`${provider}/${model}`}>
              Rerun model: {provider}/{model || "—"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              aria-label="Rerun scrape with selected model"
              title="Reuse this run’s date, areas, and query with the header LLM selection"
              className={cn(adminBtnPrimary, "gap-1.5 px-2.5 py-1.5 text-xs")}
              disabled={busy !== null || isActive || !model}
              onClick={() => void runAction("rerun", async () => onRerun(run))}
            >
              {busy === "rerun" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Rerun
            </button>
            <button
              type="button"
              aria-label="Close"
              className={cn(
                adminBtnSecondary,
                "gap-1.5 px-2.5 py-1.5 text-xs text-white/80"
              )}
              onClick={handleClose}
            >
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isActive && (
            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between text-xs text-white/50">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />
                  {run.message || "Running…"}
                </span>
                <span>{run.progress ?? 0}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-amber-400/80 transition-all"
                  style={{ width: `${run.progress ?? 0}%` }}
                />
              </div>
            </div>
          )}

          <dl className="divide-y divide-white/[0.06]">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[110px_1fr] gap-3 py-2.5">
                <dt className="text-xs text-white/40">{row.label}</dt>
                <dd className="text-xs text-white/80">{row.value}</dd>
              </div>
            ))}
          </dl>

          {run.message && !isActive && (
            <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-white/35">Message</p>
              <p className="text-xs text-white/70">{run.message}</p>
            </div>
          )}

          {run.error && (
            <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2.5">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-red-300/70">Error</p>
              <p className="text-xs text-red-200/90 break-words">{run.error}</p>
            </div>
          )}

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Drafts for approval
              </h4>
              <span className="text-[10px] text-white/35">
                {loadingDrafts ? "Loading…" : `${drafts.length} item${drafts.length === 1 ? "" : "s"}`}
              </span>
            </div>
            {drafts.length === 0 ? (
              <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-xs text-white/40">
                {isActive
                  ? "Drafts will appear here when extraction finishes."
                  : "No drafts for this run. New scrapes stage into scam_trend_drafts for review."}
              </p>
            ) : (
              <ul className="space-y-2.5">
                {drafts.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.02] transition-colors hover:border-white/20 hover:bg-white/[0.04]"
                  >
                    <button
                      type="button"
                      className="block w-full px-3 py-2.5 text-left"
                      title="Open full scam details"
                      onClick={() => setOpenDraftId(item.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-white/85">{item.title || "Untitled"}</p>
                        <span
                          className={cn(
                            "shrink-0 text-[10px] font-semibold uppercase",
                            draftStatusTone(item.status)
                          )}
                        >
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-white/55 break-words">
                        {item.description || "—"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-white/40">
                        {item.scam_type && (
                          <span className="rounded-md border border-white/10 px-1.5 py-0.5">{item.scam_type}</span>
                        )}
                        {item.risk_level && (
                          <span className="rounded-md border border-white/10 px-1.5 py-0.5">{item.risk_level}</span>
                        )}
                        {item.city && (
                          <span className="rounded-md border border-white/10 px-1.5 py-0.5">
                            {item.city}
                            {item.state ? `, ${item.state}` : ""}
                          </span>
                        )}
                        {item.lat != null && item.lon != null && (
                          <span className="rounded-md border border-emerald-400/25 px-1.5 py-0.5 text-emerald-300/80">
                            {Number(item.lat).toFixed(3)}, {Number(item.lon).toFixed(3)}
                          </span>
                        )}
                        {item.reported_on && (
                          <span className="rounded-md border border-white/10 px-1.5 py-0.5">
                            {String(item.reported_on).slice(0, 10)}
                          </span>
                        )}
                        {item.similar_to_existing && (
                          <span className="rounded-md border border-violet-400/30 px-1.5 py-0.5 text-violet-300/90">
                            near existing mock_scam
                            {item.similarity_score != null
                              ? ` (${Number(item.similarity_score).toFixed(2)})`
                              : ""}
                          </span>
                        )}
                      </div>
                      <span className="mt-2 inline-block text-[10px] text-white/30">Click to read in full</span>
                    </button>
                    {item.status !== "promoted" && (
                      <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
                        <button
                          type="button"
                          className={cn(adminBtnSecondary, "gap-1 px-2 py-1 text-[10px]")}
                          disabled={busy !== null || item.status === "approved"}
                          onClick={() => void setDraftStatus(item.id, "approved")}
                        >
                          {busy === `approved-${item.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          Approve
                        </button>
                        <button
                          type="button"
                          className={cn(adminBtnSecondary, "gap-1 px-2 py-1 text-[10px]")}
                          disabled={busy !== null || item.status === "rejected"}
                          onClick={() => void setDraftStatus(item.id, "rejected")}
                        >
                          {busy === `rejected-${item.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          Reject
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {!isActive && drafts.length > 0 && (
          <div className="space-y-2 border-t border-white/[0.08] px-5 py-3">
            <p className="text-[10px] leading-snug text-white/40">
              {approvedCount === 0
                ? "Step 1: Approve each draft above (or Approve all). Step 2: Promote approved into mock_scams."
                : `${approvedCount} approved — Promote writes them into mock_scams.`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={cn(adminBtnSecondary, "gap-1.5 text-xs")}
                disabled={busy !== null || draftPending === 0}
                onClick={() =>
                  void runAction("bulk", async () => {
                    const res = await adminApi.approveAllScamTrendDrafts(run.id);
                    onMessage(`Approved ${res.approved} draft(s)`);
                    if (res.run) onRunUpdated(res.run);
                    await loadDrafts(run.id);
                  })
                }
              >
                {busy === "bulk" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Approve all ({draftPending})
              </button>
              <button
                type="button"
                className={cn(adminBtnPrimary, "gap-1.5 text-xs")}
                disabled={busy !== null || approvedCount === 0}
                onClick={() =>
                  void runAction("promote", async () => {
                    const res = await adminApi.promoteScamTrendDrafts(run.id);
                    onMessage(`Promoted ${res.promoted} draft(s) into mock_scams`);
                    if (res.run) onRunUpdated(res.run);
                    await loadDrafts(run.id);
                  })
                }
              >
                {busy === "promote" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Promote approved ({approvedCount})
              </button>
            </div>
          </div>
        )}
      </aside>

      {openDraft && (
        <ScamDraftModal
          draft={openDraft}
          busy={busy}
          onClose={() => setOpenDraftId(null)}
          onSetStatus={setDraftStatus}
        />
      )}
    </div>
  );
}

function locationSourceLabel(source?: string | null): string {
  switch ((source || "").toLowerCase()) {
    case "model":
      return "Model read it from the article";
    case "geocoded":
      return "Geocoded from the place the model named";
    case "nationwide":
      return "No place named — plotted at India centroid";
    default:
      return "—";
  }
}

function ScamDraftModal({
  draft,
  busy,
  onClose,
  onSetStatus,
}: {
  draft: ScamTrendDraft;
  busy: string | null;
  onClose: () => void;
  onSetStatus: (draftId: string, status: "approved" | "rejected") => Promise<void>;
}) {
  const facts: { label: string; value: ReactNode }[] = [
    { label: "Scam type", value: draft.scam_type || "—" },
    { label: "Risk level", value: draft.risk_level || "—" },
    {
      label: "Reported on",
      value: draft.reported_on ? String(draft.reported_on).slice(0, 10) : "Undated",
    },
    {
      label: "City",
      value: draft.city ? `${draft.city}${draft.state ? `, ${draft.state}` : ""}` : "—",
    },
    {
      label: "Coordinates",
      value:
        draft.lat != null && draft.lon != null
          ? `${Number(draft.lat).toFixed(4)}, ${Number(draft.lon).toFixed(4)}`
          : "—",
    },
    { label: "Location from", value: locationSourceLabel(draft.location_source) },
    {
      label: "Similarity",
      value: draft.similar_to_existing
        ? `Near an existing mock_scam${
            draft.similarity_score != null ? ` (${Number(draft.similarity_score).toFixed(2)})` : ""
          }`
        : "No close match in mock_scams",
    },
    {
      label: "Promoted row",
      value: draft.promoted_mock_scam_id ? (
        <span className="font-mono text-[11px] break-all text-white/60">
          {draft.promoted_mock_scam_id}
        </span>
      ) : (
        "—"
      ),
    },
  ];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close scam details"
        className="absolute inset-0 bg-black/70 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <div className="relative z-[91] flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0c] shadow-[0_24px_80px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in-95 duration-150">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0">
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wide",
                draftStatusTone(draft.status)
              )}
            >
              {draft.status}
            </span>
            <h3 className="mt-1 text-sm font-semibold text-white/90">{draft.title || "Untitled"}</h3>
            {(draft.city || draft.lat != null) && (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-white/40">
                <MapPin className="h-3 w-3" />
                {draft.city || "Unplaced"}
                {draft.state ? `, ${draft.state}` : ""}
                {draft.lat != null && draft.lon != null
                  ? ` · ${Number(draft.lat).toFixed(3)}, ${Number(draft.lon).toFixed(3)}`
                  : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            className={cn(adminBtnSecondary, "shrink-0 gap-1.5 px-2.5 py-1.5 text-xs text-white/80")}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/75">
            {draft.description || "No description was extracted for this trend."}
          </p>

          {draft.evidence && (
            <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-white/35">
                Reported incident
              </p>
              <p className="text-[11px] leading-relaxed italic text-white/70">{draft.evidence}</p>
            </div>
          )}

          {draft.location_basis && (
            <blockquote className="mt-3 border-l-2 border-emerald-400/40 bg-emerald-400/[0.04] px-3 py-2 text-[11px] italic leading-relaxed text-emerald-100/70">
              {draft.location_basis}
            </blockquote>
          )}

          <dl className="mt-4 divide-y divide-white/[0.06]">
            {facts.map((fact) => (
              <div key={fact.label} className="grid grid-cols-[120px_1fr] gap-3 py-2">
                <dt className="text-xs text-white/40">{fact.label}</dt>
                <dd className="text-xs text-white/80">{fact.value}</dd>
              </div>
            ))}
          </dl>

          {draft.source_url && (
            <a
              href={draft.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(adminBtnSecondary, "mt-4 inline-flex gap-1.5 text-xs")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open source article
            </a>
          )}
        </div>

        {draft.status !== "promoted" && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/[0.08] px-5 py-3">
            <button
              type="button"
              className={cn(adminBtnPrimary, "gap-1.5 text-xs")}
              disabled={busy !== null || draft.status === "approved"}
              onClick={() => void onSetStatus(draft.id, "approved")}
            >
              {busy === `approved-${draft.id}` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Approve
            </button>
            <button
              type="button"
              className={cn(adminBtnSecondary, "gap-1.5 text-xs")}
              disabled={busy !== null || draft.status === "rejected"}
              onClick={() => void onSetStatus(draft.id, "rejected")}
            >
              {busy === `rejected-${draft.id}` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionTableShell({
  title,
  searchDraft,
  onSearchDraftChange,
  onSearchSubmit,
  status,
  onStatusChange,
  statusOptions,
  loading,
  onRefresh,
  offset,
  pageSize,
  total,
  onPrev,
  onNext,
  primaryAction,
  children,
}: {
  title: string;
  searchDraft: string;
  onSearchDraftChange: (v: string) => void;
  onSearchSubmit: () => void;
  status: string;
  onStatusChange: (v: string) => void;
  statusOptions: string[];
  loading: boolean;
  onRefresh: () => void;
  offset: number;
  pageSize: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  primaryAction?: ReactNode;
  children: ReactNode;
}) {
  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-xs text-white/40">
            {total} session{total === 1 ? "" : "s"}
            {loading ? " · loading…" : ""}
          </p>
        </div>
        {primaryAction}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[200px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit();
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <input
            value={searchDraft}
            onChange={(e) => onSearchDraftChange(e.target.value)}
            placeholder="Search…"
            className={cn(adminInput, "pl-9 text-sm")}
          />
        </form>
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          className={cn(adminInput, "w-auto min-w-[140px] text-sm")}
        >
          {statusOptions.map((s) => (
            <option key={s || "all"} value={s}>
              {s ? s : "All statuses"}
            </option>
          ))}
        </select>
        <button type="button" className={adminBtnSecondary} onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>
      <div className={cn(adminCard, "overflow-hidden p-0")}>
        <div className="admin-table-scroll max-h-[min(70vh,720px)] overflow-auto">{children}</div>
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-3 py-2.5">
          <span className="text-xs text-white/40">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <button type="button" className={adminBtnSecondary} disabled={offset === 0 || loading} onClick={onPrev}>
              Previous
            </button>
            <button
              type="button"
              className={adminBtnSecondary}
              disabled={offset + pageSize >= total || loading}
              onClick={onNext}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-white/45">{label}</span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className={cn(adminInput, "text-sm")}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-white/45">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(adminInput, "text-sm")}
      />
    </label>
  );
}

function NewIngestionForm({
  provider,
  model,
  defaultConfig,
  onCreated,
  onError,
}: {
  provider: string;
  model: string;
  defaultConfig: RagFunnelConfig | null;
  onCreated: (sessionId: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [actName, setActName] = useState("");
  const [category, setCategory] = useState("");
  const [authority, setAuthority] = useState("");
  const [pagesPerBatch, setPagesPerBatch] = useState(2);
  const [chunkLength, setChunkLength] = useState(1200);
  const [qualitySample, setQualitySample] = useState(5);
  const [cloudinary, setCloudinary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (defaultConfig) {
      setPagesPerBatch(defaultConfig.pages_per_batch || 2);
      setChunkLength(defaultConfig.chunk_target_length || 1200);
      setQualitySample(defaultConfig.quality_sample_count || 5);
    }
  }, [defaultConfig]);

  const submit = async () => {
    if (!file) {
      onError("Choose a PDF file first.");
      return;
    }
    const name = documentName.trim() || file.name.replace(/\.pdf$/i, "");
    setSubmitting(true);
    try {
      const res = await adminApi.createRagSession(
        file,
        name,
        {
          provider,
          model,
          pages_per_batch: pagesPerBatch,
          chunk_target_length: chunkLength,
          quality_sample_count: qualitySample,
          act_name: actName.trim() || undefined,
          category: category.trim() || undefined,
          authority: authority.trim() || undefined,
        },
        cloudinary
      );
      await onCreated(res.session.id);
      setFile(null);
      setDocumentName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to start ingestion");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className={cn(adminCard, "p-5 md:p-6")}>
        <h3 className="text-sm font-semibold text-white/90">Source PDF</h3>
        <p className="mt-1 text-xs text-white/45">
          The document is split into page batches and sent to the LLM, which returns schema-aligned chunks.
        </p>
        <label
          className={cn(
            "mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition",
            file ? "border-emerald-500/40 bg-emerald-500/[0.04]" : "border-white/15 bg-black/30 hover:border-white/25"
          )}
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <FileUp className="h-6 w-6 text-white/40" />
          <span className="text-sm text-white/70">{file ? file.name : "Click to choose a PDF"}</span>
          {file && <span className="text-[11px] text-white/40">{(file.size / 1024 / 1024).toFixed(2)} MB</span>}
        </label>
      </section>

      <section className={cn(adminCard, "p-5 md:p-6")}>
        <h3 className="text-sm font-semibold text-white/90">Document defaults</h3>
        <p className="mt-1 text-xs text-white/45">Applied to chunks when the model can&apos;t infer them from the text.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TextField label="Document name" value={documentName} onChange={setDocumentName} placeholder="e.g. Bharatiya Nyaya Sanhita, 2023" />
          <TextField label="Act name" value={actName} onChange={setActName} placeholder="e.g. BNS 2023" />
          <TextField label="Category" value={category} onChange={setCategory} placeholder="e.g. Criminal law" />
          <TextField label="Authority" value={authority} onChange={setAuthority} placeholder="e.g. Parliament of India" />
        </div>
      </section>

      <section className={cn(adminCard, "p-5 md:p-6")}>
        <h3 className="text-sm font-semibold text-white/90">Pipeline configuration</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <NumberField label="Pages per LLM batch" value={pagesPerBatch} onChange={setPagesPerBatch} min={1} />
          <NumberField label="Target chunk length (chars)" value={chunkLength} onChange={setChunkLength} min={200} />
          <NumberField label="Quality sample size" value={qualitySample} onChange={setQualitySample} min={1} />
        </div>
        <p className="mt-3 text-xs text-white/40">
          Uses header LLM: <span className="text-white/70">{provider}</span> /{" "}
          <span className="text-white/70">{model || "default"}</span>
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={cloudinary} onChange={(e) => setCloudinary(e.target.checked)} className="h-4 w-4" />
          <UploadCloud className="h-4 w-4 text-white/40" />
          Store source PDF in Cloudinary
        </label>
      </section>

      <div className="flex justify-end">
        <button type="button" className={cn(adminBtnPrimary, "gap-2")} disabled={submitting || !file} onClick={() => void submit()}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Start ingestion
        </button>
      </div>
    </div>
  );
}

function SessionDetail({
  sessionId,
  provider,
  model,
  onChanged,
  onDeleted,
  onMessage,
  onError,
  onBack,
}: {
  sessionId: string;
  provider: string;
  model: string;
  onChanged: () => void;
  onDeleted: () => void;
  onMessage: (m: string) => void;
  onError: (m: string) => void;
  onBack?: () => void;
}) {
  const [session, setSession] = useState<RagSession | null>(null);
  const [chunks, setChunks] = useState<RagChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  const onChangedRef = useRef(onChanged);
  onErrorRef.current = onError;
  onChangedRef.current = onChanged;

  const refresh = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      try {
        const [sRes, cRes] = await Promise.all([adminApi.ragSession(sessionId), adminApi.ragChunks(sessionId, 0, 500)]);
        setSession(sRes.session);
        setChunks(cRes.chunks || []);
        setLoadError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load session";
        setLoadError(msg);
        onErrorRef.current(msg);
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    setLoadError(null);
    void refresh();
  }, [refresh]);

  // Poll while the pipeline is active.
  useEffect(() => {
    if (!session || !ACTIVE_STATUSES.has(session.status)) return;
    const t = setInterval(() => {
      void refresh({ silent: true }).then(() => onChangedRef.current());
    }, 2500);
    return () => clearInterval(t);
  }, [session?.status, refresh]);

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const approvedCount = useMemo(() => chunks.filter((c) => c.status === "approved").length, [chunks]);

  if (loading) return <AdminLoading label="Loading session…" />;
  if (loadError || !session) {
    return (
      <div className="space-y-4 py-10 text-center">
        <p className="text-sm text-red-300">{loadError || "Session not found"}</p>
        <div className="flex items-center justify-center gap-2">
          <button type="button" className={cn(adminBtnSecondary)} onClick={() => void refresh()}>
            Retry
          </button>
          {onBack && (
            <button type="button" className={cn(adminBtnPrimary)} onClick={onBack}>
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  const active = ACTIVE_STATUSES.has(session.status);
  const summaryMode = session.config?.ingest_mode === "summary";
  const progressPct = session.total_pages
    ? Math.min(100, Math.round((session.processed_pages / session.total_pages) * 100))
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mb-1 text-xs text-white/45 hover:text-white/70"
            >
              ← Back to SCR session
            </button>
          )}
          <h2 className="truncate text-lg font-semibold text-white">{session.document_name}</h2>
          <p className="mt-0.5 text-xs text-white/45">
            <span className={cn("font-semibold uppercase", statusTone(session.status))}>{session.status}</span>
            {session.source_filename ? ` · ${session.source_filename}` : ""}
            {session.source_pdf_url ? (
              <>
                {" · "}
                <a href={session.source_pdf_url} target="_blank" rel="noreferrer" className="text-blue-300 underline">
                  PDF
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={cn(adminBtnSecondary, "gap-2")} onClick={() => void refresh()}>
            <RefreshCw className={cn("h-4 w-4", active && "animate-spin")} /> Refresh
          </button>
          <button
            type="button"
            className={cn(adminBtnSecondary, "gap-2")}
            disabled={busy !== null || active}
            onClick={() =>
              void runAction("bulk", async () => {
                const res = await adminApi.bulkApproveRagSession(sessionId);
                await refresh({ silent: true });
                onChanged();
                onMessage(`Approved ${res.approved} chunk(s) in this PDF.`);
              })
            }
          >
            {busy === "bulk" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Approve all
          </button>
          <button
            type="button"
            className={cn(adminBtnSecondary, "gap-2")}
            disabled={busy !== null || active}
            onClick={() => void runAction("quality", async () => {
              await adminApi.ragQuality(sessionId);
              await refresh({ silent: true });
              onMessage("Quality assessment complete.");
            })}
          >
            {busy === "quality" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Quality check
          </button>
          <button
            type="button"
            className={cn(adminBtnSecondary, "gap-2")}
            disabled={busy !== null || active}
            onClick={() =>
              void runAction("rerun", async () => {
                await adminApi.rerunRagSession(sessionId, { provider, model });
                await refresh({ silent: true });
                onChanged();
                onMessage(`Pipeline rerun started with ${provider}/${model}.`);
              })
            }
          >
            {busy === "rerun" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Rerun
          </button>
          <button
            type="button"
            className={cn(adminBtnPrimary, "gap-2")}
            disabled={busy !== null || active || approvedCount === 0}
            onClick={() => void runAction("promote", async () => {
              const res = await adminApi.promoteRagSession(sessionId, true);
              await refresh({ silent: true });
              onChanged();
              onMessage(`Promoted ${res.promoted} chunk(s) into legal_documents.`);
            })}
          >
            {busy === "promote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Promote approved ({approvedCount})
          </button>
          <button
            type="button"
            className={cn(adminBtnDanger, "gap-2")}
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm("Delete this session and all its staging chunks?")) return;
              void runAction("delete", async () => {
                await adminApi.deleteRagSession(sessionId, false);
                onDeleted();
              });
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>

      {(session.status === "paused_quota" || isRateLimitError(session.error)) && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-950/35 px-4 py-3 text-sm text-amber-100">
          <p className="font-semibold text-amber-200">LLM quota paused — progress kept</p>
          <p className="mt-1 text-xs text-amber-100/80">
            {summaryMode ? (
              <>
                The whole-PDF summary call was rate-limited. Wait ~1–2 minutes for capacity, or change
                provider/model in the header ({provider}/{model || "default"}), then continue — the PDF is sent
                again in one call.
              </>
            ) : (
              <>
                Processed {session.processed_pages}/{session.total_pages} pages so far. Wait ~1–2 minutes for Vertex
                capacity, or change provider/model in the header, then continue ({provider}/{model || "default"}).
                Progress is kept — continue resumes from page {Math.max(1, (session.processed_pages || 0) + 1)}.
              </>
            )}
          </p>
          {session.error ? <p className="mt-2 text-[11px] text-amber-100/60">{session.error}</p> : null}
          <button
            type="button"
            className={cn(adminBtnPrimary, "mt-3 gap-2")}
            disabled={busy !== null}
            onClick={() =>
              void runAction("continue", async () => {
                await adminApi.continueRagSession(sessionId, { provider, model });
                await refresh({ silent: true });
                onChanged();
                onMessage(
                  summaryMode
                    ? `Re-summarizing this PDF with ${provider}/${model}.`
                    : `Continuing from page ${(session.processed_pages || 0) + 1} with ${provider}/${model}.`
                );
              })
            }
          >
            {busy === "continue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Continue with selected model
          </button>
        </div>
      )}

      {session.error && session.status !== "paused_quota" && !isRateLimitError(session.error) && (
        <AdminErrorBanner message={session.error} />
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <AdminStatCard
          label="Pages"
          value={summaryMode ? String(session.total_pages) : `${session.processed_pages}/${session.total_pages}`}
          accent="blue"
        />
        <AdminStatCard
          label={summaryMode ? "Summary chunks" : "Chunks"}
          value={String(session.chunk_count)}
          accent="violet"
        />
        <AdminStatCard label="Approved" value={String(approvedCount)} accent="emerald" />
        <AdminStatCard label="Promoted" value={String(session.promoted_count)} accent="blue" />
      </div>

      {active && session.status !== "paused_quota" && (
        <div className={cn(adminCard, "p-4")}>
          {summaryMode ? (
            <span className="flex items-center gap-2 text-xs text-white/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />
              Sending the whole PDF to {provider}/{model || "default"} and writing one summary chunk…
            </span>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between text-xs text-white/50">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" /> Processing pages…
                </span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-amber-400/80 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {session.quality && <QualityReport quality={session.quality} />}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-white/85">
          {summaryMode ? "Summary chunk" : "Staged chunks"} <span className="text-white/40">({chunks.length})</span>
        </h3>
        <div className="space-y-2">
          {chunks.map((chunk) => (
            <ChunkRow
              key={chunk.id}
              chunk={chunk}
              disabled={busy !== null}
              summaryChunk={summaryMode}
              onUpdated={(updated) => setChunks((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))}
              onError={onError}
            />
          ))}
          {chunks.length === 0 && !active && (
            <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center text-sm text-white/40">
              No chunks yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function QualityReport({ quality }: { quality: NonNullable<RagSession["quality"]> }) {
  return (
    <div className={cn(adminCard, "p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white/90">Quality assessment</h3>
        <div className="flex items-center gap-3 text-xs">
          {typeof quality.overall_score === "number" && (
            <span className="rounded-lg bg-white/[0.06] px-2 py-1 font-mono text-white/80">
              Score {quality.overall_score}/100
            </span>
          )}
          {quality.recommendation && (
            <span className="uppercase tracking-wide text-white/50">→ {quality.recommendation}</span>
          )}
        </div>
      </div>
      {quality.verdict && <p className="mt-2 text-sm text-white/70">{quality.verdict}</p>}
      {quality.issues && quality.issues.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-200/80">
          {quality.issues.slice(0, 12).map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
      {quality.raw && <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 p-3 text-[11px] text-white/50">{quality.raw}</pre>}
    </div>
  );
}

function ChunkRow({
  chunk,
  disabled,
  summaryChunk = false,
  onUpdated,
  onError,
}: {
  chunk: RagChunk;
  disabled: boolean;
  summaryChunk?: boolean;
  onUpdated: (chunk: RagChunk) => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(summaryChunk);
  const [saving, setSaving] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    title: chunk.title || "",
    summary: chunk.summary || "",
    content: chunk.content || "",
    keywords: (chunk.keywords || []).join(", "),
    section_number: chunk.section_number || "",
    category: chunk.category || "",
  });

  useEffect(() => {
    setDraft({
      title: chunk.title || "",
      summary: chunk.summary || "",
      content: chunk.content || "",
      keywords: (chunk.keywords || []).join(", "),
      section_number: chunk.section_number || "",
      category: chunk.category || "",
    });
  }, [chunk]);

  const setStatus = async (status: "approved" | "rejected" | "draft") => {
    setSaving(status);
    try {
      const res = await adminApi.updateRagChunk(chunk.id, { status });
      onUpdated(res.chunk);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update chunk");
    } finally {
      setSaving(null);
    }
  };

  const saveEdits = async () => {
    setSaving("save");
    try {
      const res = await adminApi.updateRagChunk(chunk.id, {
        title: draft.title,
        summary: draft.summary,
        content: draft.content,
        keywords: draft.keywords,
        section_number: draft.section_number,
        category: draft.category,
      });
      onUpdated(res.chunk);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save chunk");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className={cn("rounded-xl border border-white/[0.08] bg-white/[0.02]", chunk.status === "rejected" && "opacity-60")}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-white/40 hover:text-white/70">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/85">
            <span className="text-white/35">#{chunk.seq + 1}</span> {chunk.title || "(untitled)"}
          </p>
          <p className="truncate text-[11px] text-white/40">
            {chunk.section_number ? `§${chunk.section_number} · ` : ""}
            {chunk.pdf_page_reference || ""}
            {chunk.has_embedding ? " · embedded" : " · no embedding"}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase", chunkStatusBadge(chunk.status))}>
          {chunk.status}
        </span>
        {chunk.status !== "promoted" && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              title="Approve"
              disabled={disabled || saving !== null}
              onClick={() => void setStatus("approved")}
              className="rounded-lg p-1.5 text-emerald-300/70 hover:bg-emerald-500/10 hover:text-emerald-300 disabled:opacity-40"
            >
              {saving === "approved" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              title="Reject"
              disabled={disabled || saving !== null}
              onClick={() => void setStatus("rejected")}
              className="rounded-lg p-1.5 text-red-300/70 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
            >
              {saving === "rejected" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="space-y-3 border-t border-white/[0.06] px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Title" value={draft.title} onChange={(v) => setDraft((d) => ({ ...d, title: v }))} />
            <TextField label="Section number" value={draft.section_number} onChange={(v) => setDraft((d) => ({ ...d, section_number: v }))} />
            <TextField label="Category" value={draft.category} onChange={(v) => setDraft((d) => ({ ...d, category: v }))} />
            <TextField label="Keywords (comma separated)" value={draft.keywords} onChange={(v) => setDraft((d) => ({ ...d, keywords: v }))} />
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] text-white/45">Summary</span>
            <textarea
              value={draft.summary}
              onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
              rows={2}
              className={cn(adminInput, "text-sm")}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-white/45">Content</span>
            <textarea
              value={draft.content}
              onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
              rows={summaryChunk ? 14 : 6}
              className={cn(adminInput, "font-mono text-xs")}
            />
          </label>
          <ChunkSchemaGrid chunk={chunk} />
          <div className="flex justify-end">
            <button type="button" className={cn(adminBtnPrimary, "gap-2")} disabled={saving !== null} onClick={() => void saveEdits()}>
              {saving === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save &amp; re-embed
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only view of every legal_documents field the model filled in. */
function ChunkSchemaGrid({ chunk }: { chunk: RagChunk }) {
  const rows: [string, string][] = [
    ["document_name", chunk.document_name || "—"],
    ["act_name", chunk.act_name || "—"],
    ["authority", chunk.authority || "—"],
    ["jurisdiction", chunk.jurisdiction || "—"],
    ["legal_status", chunk.legal_status || "—"],
    ["year_introduced", chunk.year_introduced != null ? String(chunk.year_introduced) : "—"],
    ["year_amendment", chunk.year_amendment != null ? String(chunk.year_amendment) : "—"],
    ["applicable_sections", (chunk.applicable_sections || []).join(", ") || "—"],
    ["related_acts", (chunk.related_acts || []).join(", ") || "—"],
    ["severity_level", chunk.severity_level || "—"],
    ["punishments", chunk.punishments || "—"],
    ["source_type", chunk.source_type || "—"],
    ["source_url", chunk.source_url || "—"],
    ["pdf_page_reference", chunk.pdf_page_reference || "—"],
    ["version", chunk.version || "—"],
    ["language", chunk.language || "—"],
  ];
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-white/35">Schema fields</p>
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 gap-2 text-[11px]">
            <dt className="w-36 shrink-0 font-mono text-white/35">{label}</dt>
            <dd className="min-w-0 flex-1 break-words text-white/70">{value}</dd>
          </div>
        ))}
      </dl>
      {chunk.subsection_text ? (
        <div className="mt-3">
          <p className="mb-1 font-mono text-[11px] text-white/35">subsection_text</p>
          <p className="max-h-32 overflow-y-auto text-[11px] leading-relaxed text-white/60">
            {chunk.subsection_text}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ScrFetchForm({
  provider,
  model,
  defaultConfig,
  onRunCreated,
  onSessionCreated,
  onOpenSession,
  onError,
  onMessage,
}: {
  provider: string;
  model: string;
  defaultConfig: RagFunnelConfig | null;
  onRunCreated?: (runId: string) => void;
  onSessionCreated: (sessionId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [searchOpt, setSearchOpt] = useState<"PHRASE" | "AND" | "OR">("PHRASE");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [maxResults, setMaxResults] = useState(50);
  const [language, setLanguage] = useState("");
  const [summaryLength, setSummaryLength] = useState(6000);
  const [qualitySample, setQualitySample] = useState(5);
  const [cloudinary, setCloudinary] = useState(false);
  const [captchaText, setCaptchaText] = useState("");
  const [run, setRun] = useState<ScrSearchRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const seenSessions = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (defaultConfig) {
      setSummaryLength(defaultConfig.summary_target_length || 6000);
      setQualitySample(defaultConfig.quality_sample_count || 5);
    }
  }, [defaultConfig]);

  // Notify parent when new RAG sessions appear from this run.
  useEffect(() => {
    if (!run?.created_sessions?.length) return;
    for (const s of run.created_sessions) {
      if (!seenSessions.current.has(s.session_id)) {
        seenSessions.current.add(s.session_id);
        onSessionCreated(s.session_id);
      }
    }
  }, [run?.created_sessions, onSessionCreated]);

  // Poll only while the download worker is running — never while typing CAPTCHA.
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const runId = run.run_id;
    const t = setInterval(() => {
      void adminApi
        .scrSearchStatus(runId)
        .then((res) => {
          setRun((prev) => {
            const next = res.run;
            // Keep the captcha image if a poll response drops it (stale/fallback payload).
            if (
              prev?.captcha_image &&
              !next.captcha_image &&
              next.status === "awaiting_captcha"
            ) {
              return { ...next, captcha_image: prev.captcha_image };
            }
            return next;
          });
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "";
          if (/not found/i.test(msg)) {
            setRun(null);
            onError(
              "Search run is no longer live after a server restart. Start a new SCR fetch or reopen the saved session from the list."
            );
          }
        });
    }, 2500);
    return () => clearInterval(t);
  }, [run?.run_id, run?.status, onError]);

  const startSearch = async () => {
    const kw = keyword.trim();
    if (!kw) {
      onError("Enter a keyword to search SCR judgments.");
      return;
    }
    setBusy("start");
    try {
      const res = await adminApi.createScrSearch({
        keyword: kw,
        search_opt: searchOpt,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        max_results: maxResults,
        language: language || undefined,
        upload_to_cloudinary: cloudinary,
        provider,
        model,
        summary_target_length: summaryLength,
        quality_sample_count: qualitySample,
        category: "Supreme Court judgment",
        authority: "Supreme Court of India",
        act_name: `SC judgment · ${kw}`,
      });
      seenSessions.current = new Set();
      setRun(res.run);
      setCaptchaText("");
      // Stay on this form so CAPTCHA entry is not interrupted by a view switch.
      onMessage("SCR session ready — solve the CAPTCHA to begin.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to start SCR search");
    } finally {
      setBusy(null);
    }
  };

  const submitCaptcha = async () => {
    if (!run) return;
    const text = captchaText.trim();
    if (!text) {
      onError("Enter the CAPTCHA text shown in the image.");
      return;
    }
    setBusy("captcha");
    try {
      const res = await adminApi.submitScrCaptcha(run.run_id, text);
      setRun(res.run);
      setCaptchaText("");
      onMessage(res.run.message || "CAPTCHA accepted. Working…");
      // Open the persisted session view only after the worker starts.
      if (res.run.status === "running") {
        onRunCreated?.(res.run.run_id);
      }
    } catch (err) {
      // Refresh run status so a new captcha image (if any) appears.
      try {
        const status = await adminApi.scrSearchStatus(run.run_id);
        setRun((prev) => {
          const next = status.run;
          if (prev?.captcha_image && !next.captcha_image && next.status === "awaiting_captcha") {
            return { ...next, captcha_image: prev.captcha_image };
          }
          return next;
        });
      } catch {
        /* ignore */
      }
      onError(err instanceof Error ? err.message : "CAPTCHA rejected");
    } finally {
      setBusy(null);
    }
  };

  const refreshCaptcha = async () => {
    if (!run) return;
    setBusy("refresh");
    try {
      const res = await adminApi.refreshScrCaptcha(run.run_id);
      setRun(res.run);
      setCaptchaText("");
      onMessage("New CAPTCHA loaded.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to refresh CAPTCHA");
    } finally {
      setBusy(null);
    }
  };

  const resetRun = () => {
    setRun(null);
    setCaptchaText("");
    seenSessions.current = new Set();
  };

  const awaitingCaptcha = run?.status === "awaiting_captcha";
  const running = run?.status === "running";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className={cn(adminCard, "p-5 md:p-6")}>
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5">
            <Scale className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white/90">Fetch from Supreme Court (SCR)</h3>
            <p className="mt-1 text-xs text-white/45">
              Search{" "}
              <a
                href="https://scr.sci.gov.in/scrsearch/"
                target="_blank"
                rel="noreferrer"
                className="text-blue-300 underline"
              >
                scr.sci.gov.in
              </a>{" "}
              by keyword, solve the CAPTCHA, and auto-ingest new judgment PDFs into the RAG funnel. Already-downloaded
              case IDs are skipped.
            </p>
          </div>
        </div>
      </section>

      {!run && (
        <>
          <section className={cn(adminCard, "p-5 md:p-6")}>
            <h3 className="text-sm font-semibold text-white/90">Search</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <TextField label="Keyword" value={keyword} onChange={setKeyword} placeholder="e.g. land, arbitration, bail" />
              <label className="block">
                <span className="mb-1 block text-[11px] text-white/45">Match mode</span>
                <select
                  value={searchOpt}
                  onChange={(e) => setSearchOpt(e.target.value as "PHRASE" | "AND" | "OR")}
                  className={cn(adminInput, "text-sm")}
                >
                  <option value="PHRASE">Phrase</option>
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              </label>
              <TextField label="From date (YYYY-MM-DD)" value={fromDate} onChange={setFromDate} placeholder="optional" />
              <TextField label="To date (YYYY-MM-DD)" value={toDate} onChange={setToDate} placeholder="optional" />
              <NumberField label="Max results" value={maxResults} onChange={setMaxResults} min={1} />
              <label className="block">
                <span className="mb-1 block text-[11px] text-white/45">Language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className={cn(adminInput, "text-sm")}
                >
                  <option value="">English (prefer)</option>
                  <option value="EN">English only</option>
                </select>
              </label>
            </div>
          </section>

          <section className={cn(adminCard, "p-5 md:p-6")}>
            <h3 className="text-sm font-semibold text-white/90">RAG pipeline (applied to each PDF)</h3>
            <p className="mt-1 text-xs text-white/45">
              Each judgment PDF goes to the model whole — no page-by-page chunking. The model returns one
              information-rich chunk carrying the full legal_documents schema (sections, related acts, keywords,
              punishments, citation year), which you then review, approve, and promote.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Target summary length (chars)"
                value={summaryLength}
                onChange={setSummaryLength}
                min={800}
              />
              <NumberField label="Quality sample size" value={qualitySample} onChange={setQualitySample} min={1} />
            </div>
            <p className="mt-3 text-xs text-white/40">
              Uses header LLM: <span className="text-white/70">{provider}</span> /{" "}
              <span className="text-white/70">{model || "default"}</span>
              {" · "}
              {PDF_NATIVE_PROVIDERS.has(provider)
                ? "the PDF file itself is sent to the model"
                : "extracted text is sent (Gemini/Vertex read the PDF directly)"}
            </p>
            <label className="mt-4 flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={cloudinary}
                onChange={(e) => setCloudinary(e.target.checked)}
                className="h-4 w-4"
              />
              <UploadCloud className="h-4 w-4 text-white/40" />
              Store source PDFs in Cloudinary
            </label>
          </section>

          <div className="flex justify-end">
            <button
              type="button"
              className={cn(adminBtnPrimary, "gap-2")}
              disabled={busy !== null || !keyword.trim()}
              onClick={() => void startSearch()}
            >
              {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gavel className="h-4 w-4" />}
              Start SCR search
            </button>
          </div>
        </>
      )}

      {run && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <AdminStatCard label="Found" value={String(run.found)} accent="blue" />
            <AdminStatCard label="Downloaded" value={String(run.downloaded)} accent="emerald" />
            <AdminStatCard label="Skipped" value={String(run.skipped_duplicates)} accent="violet" />
            <AdminStatCard label="Remaining" value={String(run.remaining)} accent="amber" />
          </div>

          <section className={cn(adminCard, "p-5 md:p-6")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white/90">
                  Keyword: <span className="text-amber-200">{run.keyword}</span>
                </h3>
                <p className="mt-1 text-xs text-white/45">
                  Status:{" "}
                  <span className={cn("font-semibold uppercase", statusTone(run.status))}>{run.status}</span>
                  {run.message ? ` · ${run.message}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {awaitingCaptcha && (
                  <button
                    type="button"
                    className={cn(adminBtnSecondary, "gap-2")}
                    disabled={busy !== null}
                    onClick={() => void refreshCaptcha()}
                  >
                    {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    New CAPTCHA
                  </button>
                )}
                <button type="button" className={cn(adminBtnSecondary, "gap-2")} onClick={resetRun}>
                  New search
                </button>
              </div>
            </div>

            {run.error && <div className="mt-3"><AdminErrorBanner message={run.error} /></div>}

            {running && (
              <div className="mt-4 flex items-center gap-2 text-sm text-amber-200">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching / downloading judgments…
              </div>
            )}

            {awaitingCaptcha && run.captcha_image && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-white/50">
                  {run.remaining > 0 && run.found > 0
                    ? "Enter the CAPTCHA to continue downloading the remaining judgments."
                    : "Enter the CAPTCHA shown below to start the search."}
                </p>
                <div className="flex flex-wrap items-end gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${run.captcha_image}`}
                    alt="SCR CAPTCHA"
                    className="h-16 rounded-lg border border-white/15 bg-white p-1"
                  />
                  <label className="block min-w-[180px] flex-1">
                    <span className="mb-1 block text-[11px] text-white/45">CAPTCHA text</span>
                    <input
                      type="text"
                      value={captchaText}
                      onChange={(e) => setCaptchaText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitCaptcha();
                      }}
                      className={cn(adminInput, "text-sm tracking-widest")}
                      autoComplete="off"
                      autoFocus
                      placeholder="Type characters"
                    />
                  </label>
                  <button
                    type="button"
                    className={cn(adminBtnPrimary, "gap-2")}
                    disabled={busy !== null || !captchaText.trim()}
                    onClick={() => void submitCaptcha()}
                  >
                    {busy === "captcha" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {run.remaining > 0 && run.found > 0 ? "Continue" : "Submit & search"}
                  </button>
                </div>
              </div>
            )}

            {awaitingCaptcha && !run.captcha_image && (
              <div className="mt-4">
                <button
                  type="button"
                  className={cn(adminBtnPrimary, "gap-2")}
                  disabled={busy !== null}
                  onClick={() => void refreshCaptcha()}
                >
                  {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Load CAPTCHA
                </button>
              </div>
            )}
          </section>

          {run.created_sessions.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-white/85">
                Created RAG sessions <span className="text-white/40">({run.created_sessions.length})</span>
              </h3>
              <div className="space-y-2">
                {run.created_sessions.map((s) => (
                  <button
                    key={s.session_id}
                    type="button"
                    onClick={() => onOpenSession(s.session_id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/20 hover:bg-white/[0.04]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white/85">
                        {s.neutral_citation || s.case_path || s.session_id}
                      </p>
                      <p className="truncate text-[11px] text-white/40">
                        {s.title || s.case_path}
                        {" · "}
                        <span className="font-mono">{s.session_id.slice(0, 8)}…</span>
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-blue-300">Open →</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {run.status === "completed" && run.downloaded === 0 && run.skipped_duplicates > 0 && (
            <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4 text-center text-sm text-white/45">
              All matching judgments were already downloaded for previous keywords.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ScrFetchSessionView({
  fetchId,
  provider,
  model,
  onOpenPdf,
  onChanged,
  onMessage,
  onError,
}: {
  fetchId: string;
  provider: string;
  model: string;
  onOpenPdf: (pdfId: string) => void;
  onChanged: () => void;
  onMessage: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [detail, setDetail] = useState<ScrFetchSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [captchaText, setCaptchaText] = useState("");
  const onErrorRef = useRef(onError);
  const onChangedRef = useRef(onChanged);
  const onMessageRef = useRef(onMessage);
  onErrorRef.current = onError;
  onChangedRef.current = onChanged;
  onMessageRef.current = onMessage;

  const refresh = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      try {
        const res = await adminApi.scrFetchSessionDetail(fetchId);
        setDetail((prev) => {
          const next = res.session;
          // Never wipe the CAPTCHA image while the admin is solving it.
          if (
            prev?.captcha_image &&
            !next.captcha_image &&
            next.status === "awaiting_captcha"
          ) {
            return { ...next, captcha_image: prev.captcha_image };
          }
          return next;
        });
        setLoadError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load SCR session";
        setLoadError(msg);
        if (!opts.silent) onErrorRef.current(msg);
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [fetchId]
  );

  useEffect(() => {
    setLoadError(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Do not poll during awaiting_captcha — refreshing remounts the CAPTCHA UI mid-typing.
    if (!detail || detail.status !== "running") return;
    const t = setInterval(() => {
      void refresh({ silent: true }).then(() => onChangedRef.current());
    }, 2500);
    return () => clearInterval(t);
  }, [detail?.status, refresh]);

  if (loading) return <AdminLoading label="Loading SCR session…" />;
  if (loadError || !detail) {
    return (
      <div className="space-y-4 py-10 text-center">
        <p className="text-sm text-red-300">{loadError || "SCR session not found"}</p>
        <p className="text-xs text-white/45">
          The session may have been deleted, or the server restarted mid-fetch. Retry or return to the list.
        </p>
        <button type="button" className={cn(adminBtnPrimary)} onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  }

  const pdfs = detail.pdfs || [];
  const stats = detail.chunk_stats || {};
  const awaiting = detail.status === "awaiting_captcha";
  const awaitingModel = detail.status === "awaiting_model";
  const awaitingDup = detail.status === "awaiting_duplicate";
  const running = detail.status === "running";
  const dup = detail.pending_duplicate;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-white">{detail.keyword}</h2>
          <p className="mt-0.5 text-xs text-white/45">
            <span className={cn("font-semibold uppercase", statusTone(detail.status))}>{detail.status}</span>
            {detail.message ? ` · ${detail.message}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cn(adminBtnSecondary, "gap-2")} onClick={() => void refresh()}>
            <RefreshCw className={cn("h-4 w-4", running && "animate-spin")} /> Refresh
          </button>
          <button
            type="button"
            className={cn(adminBtnSecondary, "gap-2")}
            disabled={busy !== null || (stats.reviewable || 0) === 0}
            onClick={() => {
              setBusy("bulk");
              void (async () => {
                try {
                  const res = await adminApi.bulkApproveScrFetch(fetchId);
                  await refresh({ silent: true });
                  onChanged();
                  onMessage(`Approved ${res.approved} judgment chunk(s) in this SCR session.`);
                } catch (err) {
                  onError(err instanceof Error ? err.message : "Bulk approve failed");
                } finally {
                  setBusy(null);
                }
              })();
            }}
          >
            {busy === "bulk" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Approve all ({stats.reviewable || 0})
          </button>
          <button
            type="button"
            className={cn(adminBtnPrimary, "gap-2")}
            disabled={busy !== null || (stats.approved || 0) === 0}
            onClick={() => {
              setBusy("promote");
              void (async () => {
                try {
                  const res = await adminApi.promoteScrFetch(fetchId);
                  await refresh({ silent: true });
                  onChanged();
                  onMessage(
                    `Promoted ${res.promoted} judgment chunk(s) from ${res.promoted_sessions} PDF(s) into legal_documents.`
                  );
                } catch (err) {
                  onError(err instanceof Error ? err.message : "Promote failed");
                } finally {
                  setBusy(null);
                }
              })();
            }}
          >
            {busy === "promote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Promote approved ({stats.approved || 0})
          </button>
        </div>
      </div>

      {awaitingModel && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-950/35 px-4 py-4 text-sm text-amber-100">
          <p className="font-semibold text-amber-200">Paused — LLM quota exceeded</p>
          <p className="mt-1 text-xs text-amber-100/80">
            Progress kept ({detail.downloaded} downloaded, {detail.remaining} remaining). Change provider/model in the
            header, then continue. Current selection: {provider}/{model || "default"}.
          </p>
          {detail.error ? <p className="mt-2 text-[11px] text-amber-100/60">{detail.error}</p> : null}
          <button
            type="button"
            className={cn(adminBtnPrimary, "mt-3 gap-2")}
            disabled={busy !== null || !model}
            onClick={() => {
              setBusy("resume");
              void (async () => {
                try {
                  await adminApi.resumeScrWithModel(fetchId, provider, model);
                  await refresh({ silent: true });
                  onChanged();
                  onMessage(`Continuing with ${provider}/${model}.`);
                } catch (err) {
                  onError(err instanceof Error ? err.message : "Failed to resume");
                } finally {
                  setBusy(null);
                }
              })();
            }}
          >
            {busy === "resume" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Continue with selected model
          </button>
        </div>
      )}

      {awaitingDup && dup && (
        <div className="rounded-xl border border-sky-500/35 bg-sky-950/30 px-4 py-4 text-sm text-sky-50">
          <p className="font-semibold text-sky-200">Already ingested judgment</p>
          <p className="mt-1 text-xs text-sky-100/85">
            <span className="font-medium text-white">{dup.neutral_citation || dup.case_path}</span>
            {dup.title ? ` — ${dup.title}` : ""} was previously ingested under keyword session{" "}
            <span className="font-semibold text-white">“{dup.prior_session_keyword || "unknown"}”</span>
            {dup.prior_document_name ? ` (${dup.prior_document_name})` : ""}. Skip it for “{dup.current_keyword || detail.keyword}”, or re-ingest?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(adminBtnPrimary, "gap-2")}
              disabled={busy !== null}
              onClick={() => {
                setBusy("skip");
                void (async () => {
                  try {
                    await adminApi.resolveScrDuplicate(fetchId, "skip");
                    await refresh({ silent: true });
                    onChanged();
                    onMessage(`Skipped ${dup.case_path}.`);
                  } catch (err) {
                    onError(err instanceof Error ? err.message : "Failed to skip duplicate");
                  } finally {
                    setBusy(null);
                  }
                })();
              }}
            >
              {busy === "skip" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Skip this PDF
            </button>
            <button
              type="button"
              className={cn(adminBtnSecondary, "gap-2")}
              disabled={busy !== null}
              onClick={() => {
                setBusy("reingest");
                void (async () => {
                  try {
                    await adminApi.resolveScrDuplicate(fetchId, "reingest");
                    await refresh({ silent: true });
                    onChanged();
                    onMessage(`Re-ingesting ${dup.case_path}…`);
                  } catch (err) {
                    onError(err instanceof Error ? err.message : "Failed to re-ingest");
                  } finally {
                    setBusy(null);
                  }
                })();
              }}
            >
              {busy === "reingest" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Re-ingest
            </button>
          </div>
        </div>
      )}

      {detail.error && !awaitingModel && <AdminErrorBanner message={detail.error} />}

      <div className="grid gap-3 sm:grid-cols-5">
        <AdminStatCard label="Found" value={String(detail.found)} accent="blue" />
        <AdminStatCard label="Downloaded" value={String(detail.downloaded)} accent="emerald" />
        <AdminStatCard label="Awaiting review" value={String(stats.reviewable || 0)} accent="amber" />
        <AdminStatCard label="Approved" value={String(stats.approved || 0)} accent="violet" />
        <AdminStatCard label="Promoted" value={String(stats.promoted || 0)} accent="blue" />
      </div>

      {awaiting && (
        <section className={cn(adminCard, "p-5")}>
          <p className="mb-3 text-xs text-white/50">
            Enter the CAPTCHA to continue this SCR fetch ({detail.remaining} remaining).
          </p>
          {detail.captcha_image ? (
            <div className="flex flex-wrap items-end gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${detail.captcha_image}`}
                alt="SCR CAPTCHA"
                className="h-16 rounded-lg border border-white/15 bg-white p-1"
              />
              <label className="block min-w-[180px] flex-1">
                <span className="mb-1 block text-[11px] text-white/45">CAPTCHA text</span>
                <input
                  type="text"
                  value={captchaText}
                  onChange={(e) => setCaptchaText(e.target.value)}
                  className={cn(adminInput, "text-sm tracking-widest")}
                  autoComplete="off"
                  autoFocus
                />
              </label>
              <button
                type="button"
                className={cn(adminBtnSecondary, "gap-2")}
                disabled={busy !== null}
                onClick={() => {
                  setBusy("refresh");
                  void (async () => {
                    try {
                      await adminApi.refreshScrCaptcha(fetchId);
                      await refresh({ silent: true });
                    } catch (err) {
                      onError(err instanceof Error ? err.message : "Failed to refresh CAPTCHA");
                    } finally {
                      setBusy(null);
                    }
                  })();
                }}
              >
                {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                New CAPTCHA
              </button>
              <button
                type="button"
                className={cn(adminBtnPrimary, "gap-2")}
                disabled={busy !== null || !captchaText.trim()}
                onClick={() => {
                  setBusy("captcha");
                  void (async () => {
                    try {
                      await adminApi.submitScrCaptcha(fetchId, captchaText.trim());
                      setCaptchaText("");
                      await refresh({ silent: true });
                      onChanged();
                      onMessage("CAPTCHA accepted — continuing download/ingest.");
                    } catch (err) {
                      try {
                        await refresh({ silent: true });
                      } catch {
                        /* ignore */
                      }
                      onError(err instanceof Error ? err.message : "CAPTCHA rejected");
                    } finally {
                      setBusy(null);
                    }
                  })();
                }}
              >
                {busy === "captcha" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Continue
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={cn(adminBtnPrimary, "gap-2")}
              disabled={busy !== null}
              onClick={() => {
                setBusy("refresh");
                void (async () => {
                  try {
                    await adminApi.refreshScrCaptcha(fetchId);
                    await refresh({ silent: true });
                  } catch (err) {
                    onError(
                      err instanceof Error
                        ? err.message
                        : "CAPTCHA unavailable — start a new fetch if the backend restarted"
                    );
                  } finally {
                    setBusy(null);
                  }
                })();
              }}
            >
              {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Load CAPTCHA
            </button>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-1 text-sm font-semibold text-white/85">
          Judgment PDFs <span className="text-white/40">({pdfs.length})</span>
        </h3>
        <p className="mb-2 text-xs text-white/40">
          Each PDF is summarized into one schema-complete chunk. Open a judgment to review or edit it before
          promoting.
        </p>
        <div className="space-y-2">
          {pdfs.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpenPdf(p.id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/20 hover:bg-white/[0.04]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white/85">{p.document_name}</p>
                <p className="truncate text-[11px] text-white/40">
                  {p.chunk_count === 1 ? "1 summary chunk" : `${p.chunk_count} chunks`} · {p.total_pages} pages ·{" "}
                  {p.status}
                </p>
              </div>
              <span className={cn("shrink-0 text-[10px] font-semibold uppercase", statusTone(p.status))}>
                {p.status}
              </span>
            </button>
          ))}
          {pdfs.length === 0 && !running && !awaiting && (
            <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center text-sm text-white/40">
              No PDFs ingested for this keyword yet.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function ScrCasesList({
  onOpenSession,
  onError,
}: {
  onOpenSession: (sessionId: string) => void;
  onError: (message: string) => void;
}) {
  const [cases, setCases] = useState<ScrCase[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.scrCases(filter.trim() || undefined, 200);
      setCases(res.cases || []);
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Failed to load SCR cases");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Downloaded SCR cases</h2>
          <p className="mt-0.5 text-xs text-white/45">
            Case IDs recorded so the same judgment PDF is never fetched twice.
          </p>
        </div>
        <button type="button" className={cn(adminBtnSecondary, "gap-2")} onClick={() => void load()}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by keyword, citation, or path…"
          className={cn(adminInput, "flex-1 text-sm")}
        />
      </div>

      {loading ? (
        <AdminLoading label="Loading cases…" />
      ) : cases.length === 0 ? (
        <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-8 text-center text-sm text-white/40">
          No SCR cases downloaded yet. Use &quot;+ Fetch from SCR&quot; to start.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08]">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wide text-white/40">
              <tr>
                <th className="px-3 py-2.5 font-medium">Citation / path</th>
                <th className="px-3 py-2.5 font-medium">Keyword(s)</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Downloaded</th>
                <th className="px-3 py-2.5 font-medium">Session</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-t border-white/[0.06]">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-white/85">{c.neutral_citation || c.case_path}</p>
                    <p className="truncate text-[11px] text-white/35">{c.case_path}</p>
                    {c.title && <p className="mt-0.5 line-clamp-1 text-[11px] text-white/40">{c.title}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-white/60">
                    {(c.keywords && c.keywords.length > 0 ? c.keywords : c.keyword ? [c.keyword] : []).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase text-white/55">
                      {c.status || "downloaded"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-white/45">
                    {c.downloaded_at ? new Date(c.downloaded_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.rag_session_id ? (
                      <button
                        type="button"
                        onClick={() => onOpenSession(c.rag_session_id!)}
                        className="text-xs text-blue-300 underline"
                      >
                        Open
                      </button>
                    ) : (
                      <span className="text-xs text-white/30">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
