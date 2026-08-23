"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AdminTabPage } from "@/components/admin/AdminPageLayout";
import {
  AdminErrorBanner,
  AdminLoading,
  adminBtnDanger,
  adminBtnPrimary,
  adminBtnSecondary,
  adminCard,
  adminInput,
  adminSelect,
} from "@/components/admin/admin-ui";
import { MarkdownEditor } from "@/components/admin/MarkdownEditor";
import {
  adminApi,
  type AdminArticleRow,
  type EmbeddingJob,
} from "@/lib/adminApi";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

type FormState = {
  title: string;
  category: string;
  slug: string;
  summary: string;
  content: string;
  tags: string;
  read_minutes: number;
  author: string;
  hero_image: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  category: "General",
  slug: "",
  summary: "",
  content: "",
  tags: "",
  read_minutes: 5,
  author: "NyaySahayak Editorial",
  hero_image: "",
};

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function EmbeddingBadge({ has }: { has?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        has
          ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25"
          : "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", has ? "bg-emerald-400" : "bg-amber-400")} />
      {has ? "Embedded" : "No vector"}
    </span>
  );
}

export function AdminArticlesPanel() {
  const [view, setView] = useState<"list" | "editor">("list");

  // List state
  const [rows, setRows] = useState<AdminArticleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<AdminArticleRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Embedding jobs
  const [job, setJob] = useState<EmbeddingJob | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  // Editor state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [savedInfo, setSavedInfo] = useState<string | null>(null);
  const [editorHasEmbedding, setEditorHasEmbedding] = useState<boolean | undefined>(undefined);

  const searchMode = searchResults !== null;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.articles({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        category: category || undefined,
      });
      setRows(res.articles || []);
      setTotal(res.total || 0);
      if (Array.isArray(res.categories)) setCategories(res.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load articles");
    } finally {
      setLoading(false);
    }
  }, [page, category]);

  useEffect(() => {
    if (!searchMode) void loadList();
  }, [loadList, searchMode]);

  // Poll async regenerate job.
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    const timer = setTimeout(async () => {
      try {
        const res = await adminApi.embeddingJobStatus(job.job_id);
        setJob(res.job);
        if (res.job.status === "completed" && !searchMode) void loadList();
      } catch {
        setJob((j) => (j ? { ...j, status: "failed", error: "Lost job status" } : j));
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [job, loadList, searchMode]);

  async function runSearch() {
    const q = searchInput.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const res = await adminApi.searchArticles(q, 24, category || undefined);
      setSearchResults(res.articles || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setSearchInput("");
    setSearchResults(null);
  }

  async function regenAll() {
    setJobBusy(true);
    setError(null);
    try {
      const res = await adminApi.regenerateEmbeddingsAsync("articles");
      setJob(res.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start regeneration");
    } finally {
      setJobBusy(false);
    }
  }

  async function regenOne(id: string) {
    setRowBusyId(id);
    setError(null);
    try {
      await adminApi.regenerateArticleEmbedding(id);
      if (searchMode) {
        setSearchResults((prev) =>
          prev ? prev.map((r) => (r.id === id ? { ...r, has_embedding: true } : r)) : prev
        );
      } else {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, has_embedding: true } : r)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Embedding regeneration failed");
    } finally {
      setRowBusyId(null);
    }
  }

  async function deleteFromList(id: string, title: string) {
    if (!confirm(`Delete article “${title}”? This cannot be undone.`)) return;
    setRowBusyId(id);
    setError(null);
    try {
      await adminApi.deleteArticle(id);
      if (searchMode) {
        setSearchResults((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
      } else {
        await loadList();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setRowBusyId(null);
    }
  }

  async function openEditor(id: string | null) {
    setEditorError(null);
    setSavedInfo(null);
    if (id === null) {
      setEditingId(null);
      setForm(EMPTY_FORM);
      setEditorHasEmbedding(undefined);
      setView("editor");
      return;
    }
    setView("editor");
    setEditorLoading(true);
    try {
      const res = await adminApi.article(id);
      const a = res.article;
      setEditingId(a.id);
      setForm({
        title: a.title || "",
        category: a.category || "General",
        slug: a.slug || "",
        summary: a.summary || "",
        content: a.content || "",
        tags: (a.tags || []).join(", "),
        read_minutes: a.read_minutes || 5,
        author: a.author || "",
        hero_image: a.hero_image || "",
      });
      setEditorHasEmbedding(a.has_embedding);
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "Failed to load article");
    } finally {
      setEditorLoading(false);
    }
  }

  function backToList() {
    setView("list");
    setEditingId(null);
    setForm(EMPTY_FORM);
    setEditorError(null);
    setSavedInfo(null);
  }

  async function save() {
    if (!form.title.trim()) {
      setEditorError("Title is required");
      return;
    }
    setSaving(true);
    setEditorError(null);
    setSavedInfo(null);
    const payload = {
      title: form.title.trim(),
      category: form.category.trim() || "General",
      slug: form.slug.trim() || undefined,
      summary: form.summary.trim(),
      content: form.content,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      read_minutes: Number(form.read_minutes) || 5,
      author: form.author.trim() || undefined,
      hero_image: form.hero_image.trim() || undefined,
    };
    try {
      let embedded = false;
      if (editingId) {
        const res = await adminApi.updateArticle(editingId, payload);
        embedded = res.embedded;
        setForm((f) => ({ ...f, slug: res.article.slug }));
      } else {
        const res = await adminApi.createArticle(payload);
        embedded = res.embedded;
        setEditingId(res.article.id);
        setForm((f) => ({ ...f, slug: res.article.slug }));
      }
      setEditorHasEmbedding(embedded ? true : editorHasEmbedding);
      setSavedInfo(embedded ? "Saved — embedding generated" : "Saved — embedding service unavailable");
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteFromEditor() {
    if (!editingId) return;
    if (!confirm(`Delete article “${form.title}”? This cannot be undone.`)) return;
    setSaving(true);
    setEditorError(null);
    try {
      await adminApi.deleteArticle(editingId);
      backToList();
      await loadList();
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "Delete failed");
      setSaving(false);
    }
  }

  async function regenFromEditor() {
    if (!editingId) return;
    setSaving(true);
    setEditorError(null);
    setSavedInfo(null);
    try {
      await adminApi.regenerateArticleEmbedding(editingId);
      setEditorHasEmbedding(true);
      setSavedInfo("Embedding regenerated");
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "Embedding regeneration failed");
    } finally {
      setSaving(false);
    }
  }

  const displayRows = searchMode ? searchResults || [] : rows;

  const jobLabel = useMemo(() => {
    if (!job) return null;
    if (job.status === "queued") return "Queued…";
    if (job.status === "running") return "Regenerating all embeddings…";
    if (job.status === "completed") return `Done — ${job.counts?.articles ?? 0} articles embedded`;
    if (job.status === "failed") return `Failed: ${job.error || "unknown error"}`;
    return null;
  }, [job]);

  return (
    <AdminTabPage
      badge="Content"
      title="Articles"
      description="Rich legal articles with semantic search and Nyaysahayak embeddings."
      className="!flex !flex-col !overflow-hidden !p-0"
    >
      {view === "list" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Toolbar */}
          <div className="shrink-0 border-b border-white/[0.07] px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <form
                className="relative flex min-w-[220px] flex-1 items-center"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runSearch();
                }}
              >
                <Search className="pointer-events-none absolute left-3 h-4 w-4 text-white/35" />
                <input
                  className={cn(adminInput, "pl-9 pr-8")}
                  placeholder="Semantic search articles…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-2 text-white/35 hover:text-white/70"
                    title="Clear"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </form>
              <select
                className={adminSelect}
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button type="button" className={adminBtnSecondary} disabled={searching} onClick={() => void runSearch()}>
                {searching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                Search
              </button>
              <button type="button" className={adminBtnSecondary} disabled={jobBusy} onClick={() => void regenAll()}>
                <RefreshCw className={cn("mr-1.5 h-4 w-4", jobBusy && "animate-spin")} />
                Regenerate all
              </button>
              <button type="button" className={adminBtnPrimary} onClick={() => void openEditor(null)}>
                <Plus className="mr-1.5 h-4 w-4" />
                New article
              </button>
            </div>

            {jobLabel && (
              <div
                className={cn(
                  "mt-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs",
                  job?.status === "failed"
                    ? "bg-red-500/10 text-red-300 ring-1 ring-red-500/25"
                    : job?.status === "completed"
                      ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25"
                      : "bg-blue-500/10 text-blue-200 ring-1 ring-blue-500/25"
                )}
              >
                {(job?.status === "queued" || job?.status === "running") && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {jobLabel}
                {(job?.status === "completed" || job?.status === "failed") && (
                  <button type="button" className="ml-auto text-white/40 hover:text-white/70" onClick={() => setJob(null)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="admin-table-scroll min-h-0 flex-1 overflow-auto px-5 py-4">
            {error && <AdminErrorBanner message={error} onDismiss={() => setError(null)} />}

            {loading && !searchMode && rows.length === 0 ? (
              <AdminLoading label="Loading articles…" />
            ) : displayRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-20 text-white/40">
                <p className="text-sm">{searchMode ? "No matching articles." : "No articles yet."}</p>
                {!searchMode && (
                  <button type="button" className={adminBtnSecondary} onClick={() => void openEditor(null)}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Create the first article
                  </button>
                )}
              </div>
            ) : (
              <div className={cn(adminCard, "overflow-hidden")}>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-[11px] uppercase tracking-wider text-white/40">
                      <th className="px-4 py-2.5 font-semibold">Title</th>
                      <th className="px-4 py-2.5 font-semibold">Category</th>
                      {searchMode && <th className="px-4 py-2.5 font-semibold">Match</th>}
                      <th className="px-4 py-2.5 font-semibold">Embedding</th>
                      <th className="px-4 py-2.5 font-semibold">Updated</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-white/[0.05] transition last:border-0 hover:bg-white/[0.03]"
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="text-left font-medium text-white/90 hover:text-blue-300"
                            onClick={() => void openEditor(r.id)}
                          >
                            {r.title}
                          </button>
                          {r.summary && (
                            <p className="mt-0.5 line-clamp-1 max-w-md text-xs text-white/40">{r.summary}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-white/60">{r.category}</td>
                        {searchMode && (
                          <td className="px-4 py-3 text-white/60">
                            {typeof r.similarity === "number" ? `${Math.round(r.similarity * 100)}%` : "—"}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <EmbeddingBadge has={r.has_embedding} />
                        </td>
                        <td className="px-4 py-3 text-white/50">{fmtDate(r.updated_at || r.published_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              className="rounded-lg border border-white/[0.08] p-1.5 text-white/55 transition hover:border-white/[0.16] hover:text-white disabled:opacity-40"
                              title="Regenerate embedding"
                              disabled={rowBusyId === r.id}
                              onClick={() => void regenOne(r.id)}
                            >
                              {rowBusyId === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-red-500/25 p-1.5 text-red-300/80 transition hover:bg-red-500/15 hover:text-red-200 disabled:opacity-40"
                              title="Delete"
                              disabled={rowBusyId === r.id}
                              onClick={() => void deleteFromList(r.id, r.title)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagination */}
          {!searchMode && total > 0 && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-2.5 text-xs text-white/45">
              <span>
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
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
            </div>
          )}
          {searchMode && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-2.5 text-xs text-white/45">
              <span>{displayRows.length} semantic result(s)</span>
              <button type="button" className={cn(adminBtnSecondary, "px-2 py-1")} onClick={clearSearch}>
                <X className="mr-1 h-3.5 w-3.5" />
                Clear search
              </button>
            </div>
          )}
        </div>
      ) : (
        <EditorView
          editingId={editingId}
          form={form}
          setForm={setForm}
          loading={editorLoading}
          saving={saving}
          error={editorError}
          savedInfo={savedInfo}
          hasEmbedding={editorHasEmbedding}
          onBack={backToList}
          onSave={save}
          onDelete={deleteFromEditor}
          onRegen={regenFromEditor}
          onDismissError={() => setEditorError(null)}
          onError={setEditorError}
        />
      )}
    </AdminTabPage>
  );
}

function HeroImageField({
  value,
  onChange,
  onError,
}: {
  value: string;
  onChange: (url: string) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("Please choose an image file (JPEG, PNG, WebP, or GIF).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      onError("Image is too large (max 8 MB).");
      return;
    }
    setUploading(true);
    try {
      const res = await adminApi.uploadImage(file, "articles");
      if (!res.url) throw new Error("Upload succeeded but no URL was returned");
      onChange(res.url);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Cloudinary upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="lg:col-span-3">
      <label className="block text-xs text-white/50">
        Hero image
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className={`${adminInput} min-w-0 flex-1`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://… or upload via Cloudinary"
          />
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <button
            type="button"
            className={cn(adminBtnSecondary, "shrink-0")}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="mr-1.5 h-4 w-4" />
            )}
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </label>
      {value ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-black/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Hero preview" className="max-h-40 w-full object-cover" />
        </div>
      ) : null}
    </div>
  );
}

function EditorView({
  editingId,
  form,
  setForm,
  loading,
  saving,
  error,
  savedInfo,
  hasEmbedding,
  onBack,
  onSave,
  onDelete,
  onRegen,
  onDismissError,
  onError,
}: {
  editingId: string | null;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  loading: boolean;
  saving: boolean;
  error: string | null;
  savedInfo: string | null;
  hasEmbedding?: boolean;
  onBack: () => void;
  onSave: () => void;
  onDelete: () => void;
  onRegen: () => void;
  onDismissError: () => void;
  onError: (message: string) => void;
}) {
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  if (loading) {
    return <AdminLoading label="Loading article…" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className={adminBtnSecondary} onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {editingId ? form.title || "Edit article" : "New article"}
            </p>
            <p className="truncate text-[11px] text-white/35">
              {editingId
                ? "Saving re-generates the embedding automatically"
                : "Creating generates the embedding automatically"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {editingId && (
            <>
              <EmbeddingBadge has={hasEmbedding} />
              <button type="button" className={adminBtnSecondary} disabled={saving} onClick={onRegen}>
                <RefreshCw className={cn("mr-1.5 h-4 w-4", saving && "animate-spin")} />
                Regenerate embedding
              </button>
              <button type="button" className={adminBtnDanger} disabled={saving} onClick={onDelete}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete
              </button>
            </>
          )}
          <button type="button" className={adminBtnPrimary} disabled={saving} onClick={onSave}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="admin-no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && <AdminErrorBanner message={error} onDismiss={onDismissError} />}
        {savedInfo && (
          <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200">
            {savedInfo}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-3">
          <label className="block text-xs text-white/50 lg:col-span-2">
            Title
            <input
              className={`${adminInput} mt-1`}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Understanding Your Rights During Police Arrest"
            />
          </label>
          <label className="block text-xs text-white/50">
            Category
            <input
              className={`${adminInput} mt-1`}
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Criminal Law"
            />
          </label>
          <label className="block text-xs text-white/50 lg:col-span-3">
            Summary
            <textarea
              className={`${adminInput} mt-1 min-h-[64px]`}
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              placeholder="One or two sentences shown on cards and used for embeddings."
            />
          </label>
          <label className="block text-xs text-white/50">
            Tags (comma separated)
            <input
              className={`${adminInput} mt-1`}
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="arrest, rights, fir"
            />
          </label>
          <label className="block text-xs text-white/50">
            Author
            <input
              className={`${adminInput} mt-1`}
              value={form.author}
              onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
            />
          </label>
          <label className="block text-xs text-white/50">
            Read minutes
            <input
              type="number"
              min={1}
              className={`${adminInput} mt-1`}
              value={form.read_minutes}
              onChange={(e) => setForm((f) => ({ ...f, read_minutes: Number(e.target.value) }))}
            />
          </label>
          <label className="block text-xs text-white/50 lg:col-span-2">
            Slug {editingId ? "" : "(auto from title if empty)"}
            <input
              className={`${adminInput} mt-1`}
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="understanding-your-rights"
            />
          </label>
          <HeroImageField
            value={form.hero_image}
            onChange={(hero_image) => setForm((f) => ({ ...f, hero_image }))}
            onError={onError}
          />
        </div>

        <div className="mt-4">
          <p className="mb-1 text-xs text-white/50">Content (Markdown)</p>
          <MarkdownEditor
            value={form.content}
            onChange={(v) => setForm((f) => ({ ...f, content: v }))}
            placeholder="Write the full article here. Use the toolbar for headings, bold, lists, quotes and links…"
          />
        </div>
      </div>
    </div>
  );
}
