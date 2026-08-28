const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const ACCESS_KEY = "nyaya_access_token";
const REFRESH_KEY = "nyaya_refresh_token";
const USER_KEY = "nyaya_user";
const ROLE_KEY = "nyaya_role";

export class AdminAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

function authHeaders(json = true): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem(ACCESS_KEY);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function clearAdminSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROLE_KEY);
}

function detailMessage(data: any, status: number): string {
  const detail = data?.detail;
  if (typeof detail === "string") {
    if (status === 405 && /method not allowed/i.test(detail)) {
      return "Method Not Allowed — restart the backend so new SCR routes are loaded, then retry.";
    }
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail.map((d) => (typeof d === "string" ? d : d?.msg || JSON.stringify(d))).join("; ");
  }
  if (status === 405) {
    return "Method Not Allowed — restart the backend so new SCR routes are loaded, then retry.";
  }
  return `Request failed (${status})`;
}

function isAuthFailure(status: number, message: string): boolean {
  if (status === 401 || status === 403) return true;
  const m = message.toLowerCase();
  return (
    m.includes("invalid or expired token") ||
    m.includes("missing bearer token") ||
    m.includes("user not found") ||
    m.includes("insufficient role") ||
    m.includes("account disabled")
  );
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshAccessToken(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refresh = localStorage.getItem(REFRESH_KEY);
    if (!refresh) return false;
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      if (!data.access_token) return false;
      localStorage.setItem(ACCESS_KEY, data.access_token);
      if (data.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
      if (data.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        const role = String(data.user.role || "").toLowerCase();
        if (role && role !== "victim") localStorage.setItem(ROLE_KEY, role);
      }
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export function redirectToAdminLogin(reason = "session_expired") {
  if (typeof window === "undefined") return;
  clearAdminSession();
  const next = encodeURIComponent("/admin");
  const url = `/login?next=${next}&reason=${encodeURIComponent(reason)}`;
  if (window.location.pathname.startsWith("/login")) return;
  window.location.assign(url);
}

async function adminFetch<T = any>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(!isFormData), ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data as T;

  const message = detailMessage(data, res.status);
  if (isAuthFailure(res.status, message)) {
    if (!retried && res.status === 401) {
      const refreshed = await tryRefreshAccessToken();
      if (refreshed) return adminFetch<T>(path, init, true);
    }
    redirectToAdminLogin(
      res.status === 403 ? "insufficient_role" : "session_expired"
    );
    throw new AdminAuthError(
      res.status === 403
        ? "You no longer have admin access. Please sign in with an admin account."
        : "Your session expired. Please sign in again.",
      res.status
    );
  }
  throw new Error(message);
}

export const adminApi = {
  health: () => adminFetch("/api/admin/health"),
  tables: () => adminFetch<{ tables: { name: string; row_count: number | null }[] }>("/api/admin/tables"),
  tableSchema: (table: string) => adminFetch(`/api/admin/tables/${table}`),
  tableRows: (table: string, params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    return adminFetch(`/api/admin/tables/${table}/rows?${qs}`);
  },
  insertRow: (table: string, values: Record<string, unknown>) =>
    adminFetch(`/api/admin/tables/${table}/rows`, { method: "POST", body: JSON.stringify({ values }) }),
  updateRow: (table: string, pk: Record<string, unknown>, values: Record<string, unknown>) =>
    adminFetch(`/api/admin/tables/${table}/rows`, { method: "PATCH", body: JSON.stringify({ pk, values }) }),
  deleteRow: (table: string, pk: Record<string, unknown>) =>
    adminFetch(`/api/admin/tables/${table}/rows`, { method: "DELETE", body: JSON.stringify({ pk }) }),
  sqlInfo: () =>
    adminFetch<{ database?: string; user?: string; schema?: string }>("/api/admin/sql/info"),
  sql: (sql: string, allow_write = false) =>
    adminFetch("/api/admin/sql/query", { method: "POST", body: JSON.stringify({ sql, allow_write }) }),
  sqlSchema: () =>
    adminFetch<{
      tables: {
        name: string;
        columns: { name: string; data_type: string; nullable: boolean }[];
        row_count?: number | null;
      }[];
    }>("/api/admin/sql/schema"),
  sqlGenerate: (body: {
    prompt: string;
    provider: string;
    model: string;
    tables?: string[];
  }) =>
    adminFetch<{
      success: boolean;
      sql: string;
      provider: string;
      model: string;
      tables_used?: string[];
    }>("/api/admin/sql/generate", { method: "POST", body: JSON.stringify(body) }),
  graphs: () => adminFetch("/api/admin/langgraph/graphs"),
  graph: (id: string) => adminFetch(`/api/admin/langgraph/graphs/${id}`),
  presets: (graphId?: string) =>
    adminFetch(`/api/admin/langgraph/presets${graphId ? `?graph_id=${graphId}` : ""}`),
  runs: (graphId?: string) =>
    adminFetch(`/api/admin/langgraph/runs${graphId ? `?graph_id=${graphId}` : ""}`),
  run: (id: string) => adminFetch(`/api/admin/langgraph/runs/${id}`),
  createRun: (body: { graph_id: string; query: string; initial_state?: Record<string, unknown> }) =>
    adminFetch("/api/admin/langgraph/runs", { method: "POST", body: JSON.stringify(body) }),
  resumeRun: (runId: string, body: { message?: string; answers?: Record<string, string> }) =>
    adminFetch(`/api/admin/langgraph/runs/${runId}/resume`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  nodeInput: (runId: string, nodeId: string) =>
    adminFetch<GraphNodeInput>(
      `/api/admin/langgraph/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/input`
    ),
  generateNodePayload: (body: GraphPayloadGenerateRequest) =>
    adminFetch<GraphPayloadGenerateResult>("/api/admin/langgraph/payload/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  forkRun: (runId: string, body: { node_id: string; payload: Record<string, unknown> }) =>
    adminFetch(`/api/admin/langgraph/runs/${encodeURIComponent(runId)}/fork`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createResetCode: (identifier: string) =>
    adminFetch("/api/auth/admin/reset-code", { method: "POST", body: JSON.stringify({ identifier }) }),
  users: (params: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      qs.set(k, String(v));
    });
    const q = qs.toString();
    return adminFetch<{ users: AdminUserRow[]; total: number; offset: number; limit: number }>(
      `/api/admin/users${q ? `?${q}` : ""}`
    );
  },
  user: (userId: string) => adminFetch<{ user: AdminUserRow }>(`/api/admin/users/${encodeURIComponent(userId)}`),
  createUser: (body: {
    email?: string | null;
    mobile?: string | null;
    password: string;
    role: string;
    display_name?: string | null;
  }) =>
    adminFetch<{ success: boolean; user: AdminUserRow }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchUser: (
    userId: string,
    body: { status?: string; role?: string; display_name?: string | null }
  ) =>
    adminFetch<{ user: AdminUserRow }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  resetUserPassword: (userId: string, new_password: string) =>
    adminFetch<{ ok: boolean; message: string; user: AdminUserRow }>(
      `/api/admin/users/${encodeURIComponent(userId)}/reset-password`,
      { method: "POST", body: JSON.stringify({ new_password }) }
    ),
  deleteUser: (userId: string) =>
    adminFetch<{ ok: boolean; deleted_id: string }>(
      `/api/admin/users/${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    ),
  userCases: (userId: string, params: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      qs.set(k, String(v));
    });
    const q = qs.toString();
    return adminFetch<{
      user: AdminUserRow;
      cases: AdminCaseRow[];
      total: number;
      offset: number;
      limit: number;
      case_scope?: AdminCaseSource;
    }>(`/api/admin/users/${encodeURIComponent(userId)}/cases${q ? `?${q}` : ""}`);
  },
  caseDetail: (caseId: string, source?: string) => {
    const qs = source ? `?source=${encodeURIComponent(source)}` : "";
    return adminFetch<AdminCaseDetail>(`/api/admin/cases/${encodeURIComponent(caseId)}${qs}`);
  },
  caseStatuses: (role?: string) =>
    adminFetch<{ statuses: string[] }>(
      `/api/admin/case-statuses${role ? `?role=${encodeURIComponent(role)}` : ""}`
    ),
  aiModels: () => adminFetch<AdminModelsSnapshot>("/api/admin/ai-models"),
  aiUsage: (days = 7) => adminFetch<AiUsageAnalytics>(`/api/admin/ai-usage?days=${days}`),
  mlHealth: () => adminFetch<MlHealth>("/api/admin/ml-health"),
  systemConfig: () => adminFetch<{ config: { key: string; value: unknown; updated_at?: string }[] }>("/api/admin/system-config"),
  patchSystemConfig: (key: string, value: Record<string, unknown>) =>
    adminFetch(`/api/admin/system-config/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify(value),
    }),
  moderatorQueueConfig: () =>
    adminFetch<{
      config: {
        cases_per_hour: number;
        sla_minutes: number;
        delay_tick_minutes: number;
        respect_penalty_per_tick: number;
      };
    }>("/api/admin/moderator-queue/config"),
  patchModeratorQueueConfig: (value: Record<string, unknown>) =>
    adminFetch<{ success: boolean; config: Record<string, unknown> }>(
      "/api/admin/moderator-queue/config",
      { method: "PATCH", body: JSON.stringify(value) }
    ),
  moderatorRevisions: (opts?: { q?: string; page?: number; limit?: number; semantic?: boolean }) => {
    const sp = new URLSearchParams();
    if (opts?.q) sp.set("q", opts.q);
    if (opts?.page) sp.set("page", String(opts.page));
    if (opts?.limit) sp.set("limit", String(opts.limit));
    if (opts?.semantic === false) sp.set("semantic", "false");
    const qs = sp.toString();
    return adminFetch<{
      total: number;
      page: number;
      limit: number;
      items: Record<string, unknown>[];
      config?: Record<string, unknown>;
    }>(`/api/admin/moderator-revisions${qs ? `?${qs}` : ""}`);
  },
  moderatorRevision: (id: string) =>
    adminFetch<{ revision: Record<string, unknown> }>(
      `/api/admin/moderator-revisions/${encodeURIComponent(id)}`
    ),
  auditLogs: (limit = 50, offset = 0) =>
    adminFetch<{ logs: AuditLogRow[]; total: number }>(`/api/admin/audit-logs?limit=${limit}&offset=${offset}`),
  billingSummary: () => adminFetch<AdminBillingSummary>("/api/admin/billing/summary"),
  billingSubscriptions: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      qs.set(k, String(v));
    });
    const q = qs.toString();
    return adminFetch<{
      subscriptions: AdminBillingSubscription[];
      total: number;
      offset: number;
      limit: number;
    }>(`/api/admin/billing/subscriptions${q ? `?${q}` : ""}`);
  },
  billingEvents: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      qs.set(k, String(v));
    });
    const q = qs.toString();
    return adminFetch<{
      events: AdminBillingEvent[];
      total: number;
      offset: number;
      limit: number;
    }>(`/api/admin/billing/events${q ? `?${q}` : ""}`);
  },
  getSeoPages: () => adminFetch<AdminSeoPagesConfig>("/api/admin/seo/pages"),
  putSeoPages: (body: {
    base_url?: string;
    default_og_image?: string;
    revalidate_seconds?: number;
    routes?: Record<string, unknown>;
    sitemap?: unknown[];
  }) =>
    adminFetch<{ success: boolean; config: AdminSeoPagesConfig; has_backup: boolean }>(
      "/api/admin/seo/pages",
      { method: "PUT", body: JSON.stringify(body) }
    ),
  restoreSeoBackup: () =>
    adminFetch<{ success: boolean; config: AdminSeoPagesConfig }>(
      "/api/admin/seo/pages/restore-backup",
      { method: "POST", body: "{}" }
    ),
  restoreSeoDefaults: (confirm: string) =>
    adminFetch<{ success: boolean; config: AdminSeoPagesConfig }>(
      "/api/admin/seo/pages/restore-defaults",
      { method: "POST", body: JSON.stringify({ confirm }) }
    ),
  patchArticleSeo: (
    articleId: string,
    body: {
      meta_title?: string | null;
      meta_description?: string | null;
      meta_keywords?: string | null;
      og_image?: string | null;
      robots?: string | null;
      canonical_path?: string | null;
      structured_data?: Record<string, unknown> | null;
    }
  ) =>
    adminFetch<{ success: boolean; article: AdminArticle; seo: Record<string, unknown> }>(
      `/api/admin/seo/articles/${encodeURIComponent(articleId)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  regenerateEmbeddings: (scope = "all") =>
    adminFetch<{ success: boolean; counts: Record<string, number> }>("/api/admin/embeddings/regenerate", {
      method: "POST",
      body: JSON.stringify({ scope }),
    }),
  regenerateEmbeddingsAsync: (scope = "all") =>
    adminFetch<{ success: boolean; job: EmbeddingJob }>("/api/admin/embeddings/regenerate-async", {
      method: "POST",
      body: JSON.stringify({ scope }),
    }),
  embeddingJobStatus: (jobId: string) =>
    adminFetch<{ job: EmbeddingJob }>(`/api/admin/embeddings/regenerate-status/${encodeURIComponent(jobId)}`),

  ragConfig: () => adminFetch<{ config: RagFunnelConfig }>("/api/admin/rag/config"),
  patchRagConfig: (patch: Partial<RagFunnelConfig>) =>
    adminFetch<{ success: boolean; config: RagFunnelConfig }>("/api/admin/rag/config", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  ragRetrievalConfig: () =>
    adminFetch<RagRetrievalSnapshot>("/api/admin/rag-retrieval"),
  patchRagRetrievalConfig: (body: RagRetrievalSaveBody) =>
    adminFetch<{ success: boolean; config: RagRetrievalConfig; scam_match: ScamMatchRetrievalSettings }>(
      "/api/admin/rag-retrieval",
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  ragSessions: (
    limit = 25,
    sourceKind?: "upload" | "scr",
    opts?: { offset?: number; q?: string; status?: string }
  ) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (sourceKind) qs.set("source_kind", sourceKind);
    if (opts?.offset != null) qs.set("offset", String(opts.offset));
    if (opts?.q) qs.set("q", opts.q);
    if (opts?.status) qs.set("status", opts.status);
    return adminFetch<{ sessions: RagSession[]; total: number; limit: number; offset: number }>(
      `/api/admin/rag/sessions?${qs}`
    );
  },
  ragSession: (id: string) =>
    adminFetch<{ session: RagSession }>(`/api/admin/rag/sessions/${encodeURIComponent(id)}`),
  ragChunks: (id: string, offset = 0, limit = 100) =>
    adminFetch<{ chunks: RagChunk[]; total: number; offset: number; limit: number }>(
      `/api/admin/rag/sessions/${encodeURIComponent(id)}/chunks?offset=${offset}&limit=${limit}`
    ),
  bulkApproveRagSession: (id: string) =>
    adminFetch<{ success: boolean; approved: number }>(
      `/api/admin/rag/sessions/${encodeURIComponent(id)}/bulk-approve`,
      { method: "POST", body: JSON.stringify({}) }
    ),
  createRagSession: (
    file: File,
    document_name: string,
    config: Partial<RagFunnelConfig>,
    uploadToCloudinary = false
  ) => {
    const body = new FormData();
    body.append("file", file);
    body.append("document_name", document_name);
    body.append("config", JSON.stringify(config || {}));
    body.append("upload_to_cloudinary", String(uploadToCloudinary));
    return adminFetch<{ success: boolean; session: RagSession; job: RagJob }>("/api/admin/rag/sessions", {
      method: "POST",
      body,
    });
  },
  updateRagChunk: (chunkId: string, values: Record<string, unknown>) =>
    adminFetch<{ success: boolean; chunk: RagChunk }>(`/api/admin/rag/chunks/${encodeURIComponent(chunkId)}`, {
      method: "PATCH",
      body: JSON.stringify({ values }),
    }),
  rerunRagSession: (id: string, opts?: { provider?: string; model?: string }) =>
    adminFetch<{ success: boolean; job: RagJob }>(`/api/admin/rag/sessions/${encodeURIComponent(id)}/rerun`, {
      method: "POST",
      body: JSON.stringify({
        provider: opts?.provider ?? null,
        model: opts?.model ?? null,
      }),
    }),
  continueRagSession: (id: string, opts?: { provider?: string; model?: string }) =>
    adminFetch<{ success: boolean; job: RagJob }>(`/api/admin/rag/sessions/${encodeURIComponent(id)}/continue`, {
      method: "POST",
      body: JSON.stringify({
        provider: opts?.provider ?? null,
        model: opts?.model ?? null,
      }),
    }),
  ragQuality: (id: string, sampleCount?: number) =>
    adminFetch<{ success: boolean; quality: RagQualityReport }>(
      `/api/admin/rag/sessions/${encodeURIComponent(id)}/quality`,
      { method: "POST", body: JSON.stringify({ sample_count: sampleCount ?? null }) }
    ),
  promoteRagSession: (id: string, onlyApproved = true) =>
    adminFetch<{ success: boolean; promoted: number; skipped: string[]; total_promoted: number }>(
      `/api/admin/rag/sessions/${encodeURIComponent(id)}/promote`,
      { method: "POST", body: JSON.stringify({ only_approved: onlyApproved }) }
    ),
  deleteRagSession: (id: string, deletePromoted = false) =>
    adminFetch<{ success: boolean; deleted_promoted_documents: number }>(
      `/api/admin/rag/sessions/${encodeURIComponent(id)}?delete_promoted=${deletePromoted}`,
      { method: "DELETE" }
    ),

  createScrSearch: (body: ScrSearchCreateBody) =>
    adminFetch<{ success: boolean; run: ScrSearchRun }>("/api/admin/rag/scr/searches", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  submitScrCaptcha: (runId: string, captcha: string) =>
    adminFetch<{ success: boolean; run: ScrSearchRun }>(
      `/api/admin/rag/scr/searches/${encodeURIComponent(runId)}/captcha`,
      { method: "POST", body: JSON.stringify({ captcha }) }
    ),
  scrSearchStatus: (runId: string) =>
    adminFetch<{ run: ScrSearchRun }>(`/api/admin/rag/scr/searches/${encodeURIComponent(runId)}`),
  refreshScrCaptcha: (runId: string) =>
    adminFetch<{ success: boolean; run: ScrSearchRun }>(
      `/api/admin/rag/scr/searches/${encodeURIComponent(runId)}/refresh-captcha`,
      { method: "POST", body: JSON.stringify({}) }
    ),
  scrFetchSessions: (
    limit = 25,
    opts?: { offset?: number; q?: string; status?: string }
  ) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (opts?.offset != null) qs.set("offset", String(opts.offset));
    if (opts?.q) qs.set("q", opts.q);
    if (opts?.status) qs.set("status", opts.status);
    return adminFetch<{ sessions: ScrFetchSession[]; total: number; limit: number; offset: number }>(
      `/api/admin/rag/scr/fetch-sessions?${qs}`
    );
  },
  scrFetchSessionDetail: (runId: string) =>
    adminFetch<{ session: ScrFetchSessionDetail }>(
      `/api/admin/rag/scr/searches/${encodeURIComponent(runId)}/detail`
    ),
  bulkApproveScrFetch: (runId: string) =>
    adminFetch<{ success: boolean; approved: number }>(
      `/api/admin/rag/scr/searches/${encodeURIComponent(runId)}/bulk-approve`,
      { method: "POST", body: JSON.stringify({}) }
    ),
  promoteScrFetch: (runId: string, onlyApproved = true) =>
    adminFetch<{ success: boolean; promoted: number; promoted_sessions: number; skipped: string[] }>(
      `/api/admin/rag/scr/searches/${encodeURIComponent(runId)}/promote`,
      { method: "POST", body: JSON.stringify({ only_approved: onlyApproved }) }
    ),
  scrCases: (keyword?: string, limit = 100) => {
    const qs = new URLSearchParams();
    if (keyword) qs.set("keyword", keyword);
    qs.set("limit", String(limit));
    return adminFetch<{ cases: ScrCase[] }>(`/api/admin/rag/scr/cases?${qs}`);
  },
  deleteScrSearch: (runId: string, deletePdfs = true) =>
    adminFetch<{ success: boolean; deleted_pdfs?: number }>(
      `/api/admin/rag/scr/searches/${encodeURIComponent(runId)}?delete_pdfs=${deletePdfs}`,
      { method: "DELETE" }
    ),
  resumeScrWithModel: (runId: string, provider: string, model: string) =>
    adminFetch<{ success: boolean; run: ScrSearchRun }>(
      `/api/admin/rag/scr/searches/${encodeURIComponent(runId)}/resume-model`,
      { method: "POST", body: JSON.stringify({ provider, model }) }
    ),
  resolveScrDuplicate: (runId: string, action: "skip" | "reingest") =>
    adminFetch<{ success: boolean; run: ScrSearchRun }>(
      `/api/admin/rag/scr/searches/${encodeURIComponent(runId)}/resolve-duplicate`,
      { method: "POST", body: JSON.stringify({ action }) }
    ),

  createScamTrendsRun: (body: {
    target_date?: string;
    areas?: string[];
    count?: number;
    provider: string;
    model: string;
    custom_query?: string;
  }) =>
    adminFetch<{ success: boolean; run: ScamTrendsRun }>("/api/admin/scam-trends/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listScamTrendsRuns: (limit = 50) =>
    adminFetch<{ runs: ScamTrendsRun[] }>(`/api/admin/scam-trends/runs?limit=${limit}`),
  scamTrendsRunStatus: (runId: string) =>
    adminFetch<{ run: ScamTrendsRun }>(`/api/admin/scam-trends/runs/${encodeURIComponent(runId)}`),
  /** Fire-and-forget: keeps a Cloud Run request open so the job gets CPU (no min-instances). */
  kickScamTrendsProcess: (runId: string) => {
    if (typeof window === "undefined") return;
    void fetch(`${API_URL}/api/admin/scam-trends/runs/${encodeURIComponent(runId)}/process`, {
      method: "POST",
      headers: authHeaders(false),
    }).catch(() => undefined);
  },
  scamTrendsConfig: () =>
    adminFetch<{
      config: ScamTrendsConfig;
      defaults: ScamTrendsConfig;
      schema: ScamTrendsSchemaField[];
    }>("/api/admin/scam-trends/config"),
  patchScamTrendsConfig: (patch: Partial<ScamTrendsConfig>) =>
    adminFetch<{ success: boolean; config: ScamTrendsConfig }>("/api/admin/scam-trends/config", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  listScamTrendDrafts: (runId: string) =>
    adminFetch<{ drafts: ScamTrendDraft[]; run: ScamTrendsRun }>(
      `/api/admin/scam-trends/runs/${encodeURIComponent(runId)}/drafts`
    ),
  setScamTrendDraftStatus: (draftId: string, status: "draft" | "approved" | "rejected") =>
    adminFetch<{ success: boolean; draft: ScamTrendDraft; run?: ScamTrendsRun }>(
      `/api/admin/scam-trends/drafts/${encodeURIComponent(draftId)}/status`,
      { method: "POST", body: JSON.stringify({ status }) }
    ),
  approveAllScamTrendDrafts: (runId: string) =>
    adminFetch<{ success: boolean; approved: number; run?: ScamTrendsRun }>(
      `/api/admin/scam-trends/runs/${encodeURIComponent(runId)}/approve-all`,
      { method: "POST", body: JSON.stringify({}) }
    ),
  promoteScamTrendDrafts: (runId: string) =>
    adminFetch<{ success: boolean; promoted: number; failed?: string[]; run?: ScamTrendsRun }>(
      `/api/admin/scam-trends/runs/${encodeURIComponent(runId)}/promote`,
      { method: "POST", body: JSON.stringify({}) }
    ),

  scamClassifierConfig: () =>
    adminFetch<{ config: ScamClassifierConfig }>("/api/admin/scam-classifier/config"),
  scamClassifierRunNow: () =>
    adminFetch<{ success: boolean; run: ScamClassifierRun }>("/api/admin/scam-classifier/run-now", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  listScamClassifierRuns: (limit = 30) =>
    adminFetch<{ runs: ScamClassifierRun[] }>(`/api/admin/scam-classifier/runs?limit=${limit}`),
  scamClassifierRunStatus: (runId: string) =>
    adminFetch<{ run: ScamClassifierRun }>(
      `/api/admin/scam-classifier/runs/${encodeURIComponent(runId)}`
    ),
  /** Fire-and-forget: keeps a Cloud Run request open so the job gets CPU (no min-instances). */
  kickScamClassifierProcess: (runId: string) => {
    if (typeof window === "undefined") return;
    void fetch(`${API_URL}/api/admin/scam-classifier/runs/${encodeURIComponent(runId)}/process`, {
      method: "POST",
      headers: authHeaders(false),
    }).catch(() => undefined);
  },

  articles: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      qs.set(k, String(v));
    });
    const q = qs.toString();
    return adminFetch<{
      articles: AdminArticleRow[];
      total: number;
      categories: string[];
      limit: number;
      offset: number;
    }>(`/api/admin/articles${q ? `?${q}` : ""}`);
  },
  article: (id: string) =>
    adminFetch<{ article: AdminArticle }>(`/api/admin/articles/${encodeURIComponent(id)}`),
  createArticle: (body: AdminArticleInput) =>
    adminFetch<{ success: boolean; article: AdminArticle; embedded: boolean }>("/api/admin/articles", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateArticle: (id: string, body: Partial<AdminArticleInput>) =>
    adminFetch<{ success: boolean; article: AdminArticle; embedded: boolean }>(
      `/api/admin/articles/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  deleteArticle: (id: string) =>
    adminFetch<{ success: boolean }>(`/api/admin/articles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  searchArticles: (query: string, top_k = 12, category?: string) =>
    adminFetch<{ articles: AdminArticleRow[]; query: string }>("/api/admin/articles/search", {
      method: "POST",
      body: JSON.stringify({ query, top_k, category }),
    }),
  regenerateArticleEmbedding: (id: string) =>
    adminFetch<{ success: boolean; has_embedding: boolean }>(
      `/api/admin/articles/${encodeURIComponent(id)}/regenerate-embedding`,
      { method: "POST" }
    ),
  uploadImage: (file: File, folder = "articles") => {
    const body = new FormData();
    body.append("file", file);
    body.append("folder", folder);
    return adminFetch<{
      success: boolean;
      url: string;
      public_id?: string;
      width?: number;
      height?: number;
      format?: string;
      bytes?: number;
      folder?: string;
    }>("/api/admin/upload/image", { method: "POST", body });
  },

  // --- Improvise policies studio -------------------------------------------
  policyCatalog: () => adminFetch<PolicyCatalog>("/api/admin/policies/catalog"),
  policyContextSearch: (query: string, top_k = 8, kind?: string) =>
    adminFetch<{ results: PolicyContextRef[] }>("/api/admin/policies/context/search", {
      method: "POST",
      body: JSON.stringify({ query, top_k, kind }),
    }),
  policyReindex: () =>
    adminFetch<{ success: boolean; counts: Record<string, number>; index: PolicyIndexStatus }>(
      "/api/admin/policies/context/reindex",
      { method: "POST", body: JSON.stringify({ scope: "policy_context" }) }
    ),
  policyImpactSnapshot: (days = 30) =>
    adminFetch<{ snapshot: Record<string, unknown> }>(`/api/admin/policies/impact?days=${days}`),
  policyList: (limit = 50) =>
    adminFetch<{ policies: PolicyDocument[] }>(`/api/admin/policies?limit=${limit}`),
  policyDetail: (id: string) =>
    adminFetch<{ policy: PolicyDocument }>(`/api/admin/policies/${encodeURIComponent(id)}`),
  policyImplement: (id: string, confirm: string) =>
    adminFetch<{
      policy: PolicyDocument;
      applied: PolicyConfigChange[];
      skipped: PolicyConfigChange[];
    }>(`/api/admin/policies/${encodeURIComponent(id)}/implement`, {
      method: "POST",
      body: JSON.stringify({ confirm }),
    }),
  policyRollback: (id: string) =>
    adminFetch<{ policy: PolicyDocument; restored: string[] }>(
      `/api/admin/policies/${encodeURIComponent(id)}/rollback`,
      { method: "POST" }
    ),
  policyDraftStream: (body: PolicyDraftRequest, onEvent: (event: PolicyStreamEvent) => void, signal?: AbortSignal) =>
    ndjsonStream("/api/admin/policies/draft/stream", body, onEvent, signal),
};

/** POST a JSON body and dispatch each newline-delimited JSON object as it arrives. */
async function ndjsonStream<T>(
  path: string,
  body: unknown,
  onEvent: (event: T) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = detailMessage(data, res.status);
    if (isAuthFailure(res.status, message)) {
      redirectToAdminLogin(res.status === 403 ? "insufficient_role" : "session_expired");
      throw new AdminAuthError(message, res.status);
    }
    throw new Error(message);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Streaming is not supported in this browser");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as T);
        } catch {
          // Partial or malformed line — the next chunk usually completes it.
        }
      }
      newline = buffer.indexOf("\n");
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      onEvent(JSON.parse(tail) as T);
    } catch {
      /* ignore trailing noise */
    }
  }
}

export type PolicyContextRef = {
  kind: "feature" | "table" | string;
  ref_id: string;
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
  similarity?: number;
};

export type PolicyIndexStatus = {
  indexed: number;
  expected: number;
  last_indexed_at?: string | null;
};

export type PolicyFeature = {
  id: string;
  title: string;
  summary: string;
  tables?: string[];
  config_keys?: string[];
  code_paths?: string[];
};

export type PolicyCatalog = {
  features: PolicyFeature[];
  tables: { name: string; columns: string[] }[];
  index: PolicyIndexStatus;
  writable_config_keys: string[];
  agent_scopes: string[];
};

export type PolicyConfigChange = {
  key: string;
  path: string;
  from?: unknown;
  to?: unknown;
  reason?: string;
  reason_skipped?: string;
};

export type PolicyChangeSet = {
  summary?: string;
  policy_text?: string;
  config_changes?: PolicyConfigChange[];
  agent_scope?: string[];
  manual_followups?: { title: string; detail: string; risk?: string }[];
  open_questions?: string[];
  risk?: "low" | "medium" | "high";
  ready?: boolean;
  applied?: PolicyConfigChange[];
  skipped?: PolicyConfigChange[];
  previous?: Record<string, unknown>;
};

export type PolicyDocument = {
  id: string;
  title: string;
  description: string;
  policy_text: string;
  change_set: PolicyChangeSet;
  context_refs: PolicyContextRef[];
  answers: Record<string, string>;
  agent_scope: string[];
  risk: string;
  status: "draft" | "active" | "archived" | "rolled_back" | string;
  version: number;
  created_at?: string | null;
  activated_at?: string | null;
};

export type PolicyDraftRequest = {
  description: string;
  title?: string;
  policy_id?: string | null;
  context_refs?: PolicyContextRef[];
  answers?: Record<string, string>;
  genui_prompt?: string;
  impact_prompt?: string;
  period_days?: number;
};

export type PolicyStreamEvent =
  | { type: "stage"; stage: string; label: string }
  | { type: "context"; context: PolicyContextRef[] }
  | { type: "plan"; plan: PolicyChangeSet }
  | { type: "questions_ui"; content: string }
  | { type: "impact_ui"; content: string }
  | { type: "impact_data"; snapshot: Record<string, unknown> }
  | { type: "saved"; policy: PolicyDocument }
  | { type: "done"; ready: boolean }
  | { type: "error"; message: string };

export type EmbeddingJob = {
  job_id: string;
  scope: string;
  status: "queued" | "running" | "completed" | "failed";
  counts?: Record<string, number> | null;
  error?: string | null;
  created_at?: number;
  started_at?: number;
  finished_at?: number;
};

export type RagIngestMode = "pages" | "summary";

export type RagFunnelConfig = {
  provider: string;
  model: string;
  ingest_mode?: RagIngestMode;
  pages_per_batch: number;
  chunk_target_length: number;
  summary_target_length?: number;
  quality_sample_count: number;
  document_name?: string;
  act_name?: string;
  category?: string;
  authority?: string;
};

export type RagRetrievalGraphSettings = {
  top_k: number;
  min_similarity: number;
};

export type RagRetrievalConfig = Record<string, RagRetrievalGraphSettings>;

export type ScamMatchRetrievalSettings = {
  city_min_similarity: number;
  national_min_similarity: number;
  top_k: number;
};

export type RagRetrievalSaveBody = {
  chat_agent?: RagRetrievalGraphSettings;
  clash_agent?: RagRetrievalGraphSettings;
  scam_match?: ScamMatchRetrievalSettings;
};

export type RagRetrievalSnapshot = {
  config: RagRetrievalConfig;
  defaults: RagRetrievalConfig;
  graphs: { id: string; label: string }[];
  limits: { top_k_min: number; top_k_max: number };
  scam_match?: ScamMatchRetrievalSettings;
  scam_match_defaults?: ScamMatchRetrievalSettings;
};

export type RagSessionStatus = "pending" | "queued" | "running" | "completed" | "failed" | "promoted" | "awaiting_captcha" | "awaiting_model" | "awaiting_duplicate" | "paused_quota";

export type RagSession = {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  document_name: string;
  act_name?: string | null;
  source_filename?: string | null;
  source_pdf_url?: string | null;
  source_page_count?: number;
  config?: Partial<RagFunnelConfig>;
  status: RagSessionStatus;
  total_pages: number;
  processed_pages: number;
  chunk_count: number;
  promoted_count: number;
  quality?: RagQualityReport | null;
  error?: string | null;
  source_kind?: "upload" | "scr" | string;
  scr_fetch_session_id?: string | null;
};

export type RagChunkStatus = "draft" | "embedded" | "approved" | "rejected" | "promoted";

export type RagChunk = {
  id: string;
  session_id: string;
  seq: number;
  page_start?: number | null;
  page_end?: number | null;
  status: RagChunkStatus;
  document_name?: string | null;
  act_name?: string | null;
  category?: string | null;
  year_introduced?: number | null;
  year_amendment?: number | null;
  section_number?: string | null;
  subsection_text?: string | null;
  title?: string | null;
  content?: string | null;
  summary?: string | null;
  authority?: string | null;
  jurisdiction?: string | null;
  legal_status?: string | null;
  related_acts?: string[] | null;
  keywords?: string[] | null;
  severity_level?: string | null;
  applicable_sections?: string[] | null;
  punishments?: string | null;
  source_url?: string | null;
  source_type?: string | null;
  pdf_page_reference?: string | null;
  version?: string | null;
  language?: string | null;
  has_embedding?: boolean;
  quality?: Record<string, unknown> | null;
  promoted_document_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type RagJob = {
  session_id: string;
  status: "queued" | "running" | "completed" | "failed";
};

export type RagQualityReport = {
  overall_score?: number | null;
  verdict?: string;
  issues?: string[];
  per_chunk?: { id?: string; seq?: number; score?: number; notes?: string }[];
  recommendation?: string;
  sample_size?: number;
  assessed_at?: number;
  raw?: string;
};

export type ScrSearchCreateBody = {
  keyword: string;
  search_opt?: "PHRASE" | "AND" | "OR";
  from_date?: string;
  to_date?: string;
  max_results?: number;
  language?: string;
  upload_to_cloudinary?: boolean;
  provider?: string;
  model?: string;
  summary_target_length?: number;
  quality_sample_count?: number;
  category?: string;
  authority?: string;
  act_name?: string;
};

export type ScrSearchStatus =
  | "awaiting_captcha"
  | "awaiting_model"
  | "awaiting_duplicate"
  | "running"
  | "completed"
  | "failed";

export type ScrPendingDuplicate = {
  case_path: string;
  title?: string | null;
  neutral_citation?: string | null;
  prior_session_keyword?: string | null;
  prior_document_name?: string | null;
  prior_rag_session_id?: string | null;
  prior_fetch_session_id?: string | null;
  current_keyword?: string | null;
};

export type ScrCreatedSession = {
  session_id: string;
  case_path?: string;
  neutral_citation?: string | null;
  title?: string | null;
};

export type ScrSearchRun = {
  run_id: string;
  status: ScrSearchStatus;
  keyword: string;
  search_opt?: string;
  from_date?: string;
  to_date?: string;
  max_results?: number;
  language?: string;
  found: number;
  downloaded: number;
  skipped_duplicates: number;
  failed_downloads?: number;
  remaining: number;
  created_sessions: ScrCreatedSession[];
  captcha_image?: string | null;
  error?: string | null;
  message?: string | null;
  created_at?: number;
  updated_at?: number;
};

export type ScrCase = {
  id: string;
  case_path: string;
  neutral_citation?: string | null;
  citation_year?: string | null;
  title?: string | null;
  keyword?: string | null;
  keywords?: string[] | null;
  language_codes?: string[] | null;
  source_pdf_url?: string | null;
  rag_session_id?: string | null;
  scr_fetch_session_id?: string | null;
  status?: string;
  created_by?: string | null;
  downloaded_at?: string | null;
};

export type ScrFetchSession = {
  id: string;
  run_id?: string;
  keyword: string;
  search_opt?: string;
  from_date?: string | null;
  to_date?: string | null;
  max_results?: number;
  language?: string | null;
  status: ScrSearchStatus | string;
  found: number;
  downloaded: number;
  skipped_duplicates: number;
  failed_downloads?: number;
  remaining: number;
  pdf_count?: number;
  provider?: string | null;
  model?: string | null;
  message?: string | null;
  error?: string | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
};

export type ScrFetchSessionDetail = ScrFetchSession & {
  captcha_image?: string | null;
  created_sessions?: ScrCreatedSession[];
  pdfs?: RagSession[];
  paused_session_id?: string | null;
  pending_duplicate?: ScrPendingDuplicate | null;
  chunk_stats?: {
    reviewable?: number;
    approved?: number;
    promoted?: number;
    total_chunks?: number;
  };
};

export type AdminArticleRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  summary: string;
  author?: string;
  tags?: string[];
  read_minutes?: number;
  hero_image?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  has_embedding?: boolean;
  similarity?: number;
  meta_title?: string | null;
  meta_description?: string | null;
  meta_keywords?: string | null;
  og_image?: string | null;
  robots?: string | null;
  canonical_path?: string | null;
  structured_data?: Record<string, unknown> | null;
};

export type AdminArticle = AdminArticleRow & {
  content: string;
};

export type AdminArticleInput = {
  title: string;
  category?: string;
  summary?: string;
  content?: string;
  author?: string;
  tags?: string[];
  read_minutes?: number;
  hero_image?: string | null;
  slug?: string;
  published_at?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  meta_keywords?: string | null;
  og_image?: string | null;
  robots?: string | null;
  canonical_path?: string | null;
  structured_data?: Record<string, unknown> | null;
};

export type AiUsageAnalytics = {
  periodDays: number;
  totals: { requests: number; tokens: number };
  requestsByTask: { name: string; value: number }[];
  tokensByTask: { name: string; value: number }[];
  requestsByModel: { name: string; value: number }[];
  tokensByModel: { name: string; value: number }[];
  models: string[];
  timeSeries: {
    label: string;
    bucket: string;
    byModel: Record<string, { requests: number; tokens: number }>;
  }[];
};

export type AdminModelsSnapshot = {
  catalog: {
    text_providers: string[];
    groq_text_models?: string[];
    gemini_text_models: string[];
    openrouter_text_models: string[];
    selfhost_text_models?: string[];
    vertex_text_models?: string[];
    nyaysahayak_embedding_model: string;
    gemini_embedding_model?: string;
    embedding_providers?: string[];
    embedding_models?: Record<string, string[]>;
    embedding_dim?: number;
    chat_nodes: string[];
    clash_nodes: string[];
    scam_classifier_nodes?: string[];
    policy_nodes?: string[];
    default_groq_model?: string;
    default_gemini_model?: string;
    default_openrouter_model: string;
    default_selfhost_model?: string;
    default_vertex_model?: string;
    provider_api_key_hints?: Record<string, string>;
  };
  env: {
    groq_configured?: boolean;
    gemini_configured: boolean;
    openrouter_configured: boolean;
    selfhost_configured?: boolean;
    vertex_configured?: boolean;
    default_groq_model?: string;
    default_gemini_model: string;
    default_openrouter_model: string;
    default_selfhost_model?: string;
    default_vertex_model?: string;
    default_embedding_url: string;
    provider_api_key_hints?: Record<string, string>;
  };
  config: {
    graph_node_models: Record<string, Record<string, { provider?: string; model?: string }>>;
    ai_embeddings: {
      provider?: string;
      model?: string;
      output_dimensionality?: number;
      external_embedding_url?: string;
    };
    sql_generation: Record<string, unknown>;
  };
  resolved: Record<string, { provider: string; model: string; graph_id?: string; node_id?: string }>;
};

export type GraphNodeInput = {
  run_id: string;
  node_id: string;
  payload: Record<string, unknown>;
  checkpoint_config?: Record<string, unknown>;
  validation: { ok: boolean; errors: string[] };
};

export type GraphPayloadGenerateRequest = {
  graph_id: string;
  node_id: string;
  prompt: string;
  base_payload: Record<string, unknown>;
  provider: string;
  model: string;
};

export type GraphPayloadGenerateResult = {
  payload: Record<string, unknown>;
  validation: { ok: boolean; errors: string[] };
  model_used: { provider: string; model: string };
};

export type MlHealth = {
  ok: boolean;
  embedding_url?: string;
  model?: string;
  provider?: string;
  postgres?: boolean;
  health?: Record<string, unknown>;
  error?: string;
};

export type AdminBillingSummary = {
  subscriptions: Record<string, number>;
  active_by_plan: { plan_id: string; plan_name: string; price_paise: number; count: number }[];
  events_total: number;
  mrr_paise: number;
};

export type AdminBillingSubscription = {
  id: string;
  user_id?: string | null;
  email?: string | null;
  mobile?: string | null;
  display_name?: string | null;
  role?: string | null;
  user_status?: string | null;
  plan_id?: string | null;
  plan_name?: string | null;
  price_paise?: number;
  status?: string | null;
  razorpay_subscription_id?: string | null;
  razorpay_customer_id?: string | null;
  cancel_at_period_end?: boolean;
  current_period_start?: string | null;
  current_period_end?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AdminBillingEvent = {
  id: number | null;
  razorpay_event_id?: string | null;
  event_type?: string | null;
  processed_at?: string | null;
  payment_id?: string | null;
  order_id?: string | null;
  subscription_id?: string | null;
  payment_status?: string | null;
  method?: string | null;
  amount_paise?: number | null;
  plan_id?: string | null;
  payment_email?: string | null;
  payment_contact?: string | null;
  user_id?: string | null;
  email?: string | null;
  mobile?: string | null;
  display_name?: string | null;
  role?: string | null;
  user_status?: string | null;
  payload?: Record<string, unknown> | null;
};

export type AuditLogRow = {
  id: number | string;
  actor_user_id?: string | null;
  action?: string;
  target_table?: string | null;
  detail?: unknown;
  created_at?: string | null;
};

export type AdminCaseSource =
  | "victim_case"
  | "lawyer_case"
  | "sahayak_case"
  | "intervention";

export type AdminUserRow = {
  id: string;
  email?: string | null;
  mobile?: string | null;
  display_name?: string | null;
  role?: string | null;
  status?: string | null;
  firebase_uid?: string | null;
  password_reset_required?: boolean | null;
  failed_login_attempts?: number | null;
  locked_until?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  case_count?: number;
  case_scope?: AdminCaseSource;
};

export type ScamTrendResult = {
  id?: string;
  title?: string;
  description?: string;
  scam_type?: string;
  risk_level?: string;
  city?: string;
  lat?: number | null;
  lon?: number | null;
  status?: string;
  stored?: boolean;
  skipped_duplicate?: boolean;
  similar_to_existing?: boolean;
  similarity_score?: number | null;
};

export type ScamTrendDraft = {
  id: string;
  run_id?: string;
  seq?: number;
  status: string;
  title?: string;
  description?: string;
  scam_type?: string;
  risk_level?: string;
  city?: string;
  state?: string | null;
  lat?: number | null;
  lon?: number | null;
  /** How the location was decided: model | geocoded | nationwide. */
  location_source?: string | null;
  location_basis?: string | null;
  source_url?: string | null;
  reported_on?: string | null;
  /** Quote naming the real report behind the trend (complaint count, FIR, advisory). */
  evidence?: string | null;
  similar_to_existing?: boolean;
  similarity_score?: number | null;
  promoted_mock_scam_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ScamTrendsConfig = {
  system_prompt: string;
  recency_days: number;
  /** DuckDuckGo recency window: d / w / m / y, or "" for no limit. */
  search_timelimit: string;
  prefer_news: boolean;
  strict_filters: boolean;
  blocked_domains: string[];
};

export type ScamTrendsSchemaField = {
  key: string;
  type: string;
  rule: string;
};

export type ScamTrendsRun = {
  id: string;
  status: string;
  progress?: number;
  target_date?: string;
  areas?: string[] | string;
  requested_count?: number;
  stored_count?: number;
  extracted_count?: number;
  approved_count?: number;
  promoted_count?: number;
  searched_count?: number;
  provider?: string;
  model?: string;
  custom_query?: string | null;
  config?: {
    custom_query?: string;
    provider?: string;
    model?: string;
    results?: ScamTrendResult[];
  } | null;
  message?: string | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ScamClassifierConfig = {
  enabled?: boolean;
  interval_hours?: number;
  similarity_threshold?: number;
  min_same_case_count?: number;
  lookback_days?: number;
  last_run_at?: string | null;
};

export type ScamClassifierRun = {
  id: string;
  status: string;
  progress?: number;
  trigger_source?: string;
  cases_scanned?: number;
  clusters_found?: number;
  clusters_registered?: number;
  message?: string | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AdminCaseRow = {
  id: string;
  user_id?: string | null;
  session_id?: string | null;
  status?: string | null;
  pending?: boolean | null;
  has_answers?: boolean | null;
  user_language?: string | null;
  pdf_url?: string | null;
  timestamp?: string | null;
  updated_at?: string | null;
  incident_type?: string | null;
  summary_preview?: string | null;
  source?: AdminCaseSource;
  assigned_lawyer_id?: string | null;
  assigned_sahayak_id?: string | null;
  assigned_sahayak_name?: string | null;
  user_name?: string | null;
  collection_name?: string | null;
};

export type AdminCaseDetail = {
  case: Record<string, unknown>;
  user?: AdminUserRow | null;
  source?: AdminCaseSource;
  incident_type?: string | null;
  interventions?: Record<string, unknown>[];
  sahayak_cases?: Record<string, unknown>[];
  lawyer_cases?: Record<string, unknown>[];
};

export type AdminSeoPagesConfig = {
  base_url: string;
  default_og_image: string;
  revalidate_seconds: number;
  routes: Record<string, Record<string, unknown>>;
  sitemap: { path: string; priority?: number; changefreq?: string; dynamic?: string | null }[];
  previous_json?: Record<string, unknown> | null;
};

export const SEO_RESTORE_DEFAULTS_CONFIRM = "restore-defaults";
