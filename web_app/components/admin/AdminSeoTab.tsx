"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  RotateCcw,
  Save,
  Search,
  X,
} from "lucide-react";
import {
  AdminMainPanel,
  AdminNavItem,
  AdminTabPage,
  AdminWorkspace,
} from "@/components/admin/AdminPageLayout";
import {
  AdminErrorBanner,
  AdminFieldLabel,
  AdminHoverHint,
  AdminLoading,
  adminBtnPrimary,
  adminBtnSecondary,
  adminInput,
} from "@/components/admin/admin-ui";
import { AdminOgImageField } from "@/components/admin/AdminOgImageField";
import {
  adminApi,
  SEO_RESTORE_DEFAULTS_CONFIRM,
  type AdminArticle,
  type AdminArticleRow,
  type AdminSeoPagesConfig,
} from "@/lib/adminApi";
import { DEFAULT_OG_IMAGE } from "@/lib/seo/og-image-defaults";
import {
  articleStructuredDataTemplate,
  structuredDataTemplateForRoute,
} from "@/lib/seo/structured-data-templates";
import {
  ROUTE_KEY_TO_PATH,
  ROUTE_LABELS,
  type RouteKey,
  type SeoRouteConfig,
} from "@/lib/seo/types";
import { cn } from "@/lib/utils";

type SideTab =
  | { kind: "route"; key: RouteKey }
  | { kind: "globals" }
  | { kind: "sitemap" }
  | { kind: "articles" };

const ROUTE_KEYS = Object.keys(ROUTE_LABELS) as RouteKey[];
const ARTICLE_PAGE_SIZE = 10;

function emptyRoute(): SeoRouteConfig {
  return {
    title: "",
    description: "",
    keywords: "",
    canonical_path: "",
    index: true,
    follow: true,
    og_image: null,
    structured_data: null,
  };
}

function SeoFieldsForm({
  route,
  canonicalDefault,
  globalOgImage,
  onChange,
  onError,
}: {
  route: SeoRouteConfig;
  canonicalDefault: string;
  globalOgImage: string;
  onChange: (patch: Partial<SeoRouteConfig>) => void;
  onError?: (message: string) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="block text-xs text-white/50">
        Title
        <input
          className={cn(adminInput, "mt-1")}
          value={route.title || ""}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </label>
      <label className="block text-xs text-white/50">
        Description
        <textarea
          className={cn(adminInput, "mt-1 min-h-[80px] resize-y")}
          value={route.description || ""}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </label>
      <label className="block text-xs text-white/50">
        Keywords (comma-separated)
        <input
          className={cn(adminInput, "mt-1")}
          value={route.keywords || ""}
          onChange={(e) => onChange({ keywords: e.target.value })}
        />
      </label>
      <label className="block text-xs text-white/50">
        Canonical path
        <input
          className={cn(adminInput, "mt-1 font-mono text-xs")}
          value={route.canonical_path || canonicalDefault}
          onChange={(e) => onChange({ canonical_path: e.target.value })}
          placeholder={canonicalDefault}
        />
      </label>
      <AdminOgImageField
        label="OG image URL"
        value={route.og_image}
        onChange={(url) => onChange({ og_image: url })}
        placeholder={globalOgImage || DEFAULT_OG_IMAGE}
        folder="site"
        hint="Optional per-page override. Leave empty to use the global default OG image."
        onError={onError}
      />
      <div className="flex flex-wrap gap-4 pt-1 text-sm text-white/70">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={route.index !== false}
            onChange={(e) => onChange({ index: e.target.checked })}
          />
          Index
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={route.follow !== false}
            onChange={(e) => onChange({ follow: e.target.checked })}
          />
          Follow
        </label>
      </div>
    </div>
  );
}

export function AdminSeoTab() {
  const [config, setConfig] = useState<AdminSeoPagesConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<AdminSeoPagesConfig | null>(null);
  const [tab, setTab] = useState<SideTab>({ kind: "route", key: "home" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [structuredJson, setStructuredJson] = useState("");
  const [defaultsModalOpen, setDefaultsModalOpen] = useState(false);
  const [defaultsConfirm, setDefaultsConfirm] = useState("");
  const [articles, setArticles] = useState<AdminArticleRow[]>([]);
  const [articleTotal, setArticleTotal] = useState(0);
  const [articlePage, setArticlePage] = useState(0);
  const [articleSearchInput, setArticleSearchInput] = useState("");
  const [articleSearchResults, setArticleSearchResults] = useState<AdminArticleRow[] | null>(null);
  const [articleSearching, setArticleSearching] = useState(false);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [editingArticle, setEditingArticle] = useState<AdminArticle | null>(null);
  const [articleStructuredJson, setArticleStructuredJson] = useState("");

  const articleSearchMode = articleSearchResults !== null;
  const articleTotalPages = Math.max(1, Math.ceil(articleTotal / ARTICLE_PAGE_SIZE));
  const displayArticles = articleSearchMode ? articleSearchResults : articles;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const seo = await adminApi.getSeoPages();
      setConfig(seo);
      setSavedConfig(JSON.parse(JSON.stringify(seo)) as AdminSeoPagesConfig);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load SEO settings");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadArticles = useCallback(async (pageIndex: number) => {
    setArticlesLoading(true);
    setError(null);
    try {
      const res = await adminApi.articles({
        limit: ARTICLE_PAGE_SIZE,
        offset: pageIndex * ARTICLE_PAGE_SIZE,
      });
      setArticles(res.articles || []);
      setArticleTotal(res.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load articles");
    } finally {
      setArticlesLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab.kind !== "articles" || articleSearchMode) return;
    void loadArticles(articlePage);
  }, [tab.kind, articlePage, articleSearchMode, loadArticles]);

  async function runArticleSearch() {
    const q = articleSearchInput.trim();
    if (!q) {
      setArticleSearchResults(null);
      return;
    }
    setArticleSearching(true);
    setError(null);
    try {
      const res = await adminApi.searchArticles(q, 24);
      setArticleSearchResults(res.articles || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Semantic search failed");
    } finally {
      setArticleSearching(false);
    }
  }

  function clearArticleSearch() {
    setArticleSearchInput("");
    setArticleSearchResults(null);
  }

  async function openArticleModal(row: AdminArticleRow) {
    setError(null);
    try {
      const res = await adminApi.article(row.id);
      const article = res.article;
      setEditingArticle(article);
      setArticleStructuredJson(
        JSON.stringify(
          article.structured_data ||
            articleStructuredDataTemplate({
              title: article.meta_title || article.title,
              description: article.meta_description || article.summary || "",
              slug: article.slug,
              author: article.author,
            }),
          null,
          2
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load article");
    }
  }

  function closeArticleModal() {
    setEditingArticle(null);
    setArticleStructuredJson("");
  }

  async function handleSaveArticleSeo() {
    if (!editingArticle) return;
    setSaving(true);
    setError(null);
    try {
      let structured: Record<string, unknown> | null = null;
      if (articleStructuredJson.trim()) {
        structured = JSON.parse(articleStructuredJson) as Record<string, unknown>;
      }
      await adminApi.patchArticleSeo(editingArticle.id, {
        meta_title: editingArticle.meta_title || null,
        meta_description: editingArticle.meta_description || null,
        meta_keywords: editingArticle.meta_keywords || null,
        og_image: editingArticle.og_image || null,
        robots: editingArticle.robots || "index,follow",
        canonical_path: editingArticle.canonical_path || `/blogs/${editingArticle.slug}`,
        structured_data: structured,
      });
      setMsg("Article SEO saved");
      setTimeout(() => setMsg(null), 2500);
      closeArticleModal();
      if (articleSearchMode) {
        await runArticleSearch();
      } else {
        await loadArticles(articlePage);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Article SEO save failed");
    } finally {
      setSaving(false);
    }
  }

  const currentRoute = useMemo(() => {
    if (!config || tab.kind !== "route") return emptyRoute();
    const path = ROUTE_KEY_TO_PATH[tab.key];
    return { ...emptyRoute(), ...(config.routes[path] as SeoRouteConfig | undefined) };
  }, [config, tab]);

  useEffect(() => {
    if (tab.kind !== "route") return;
    const data =
      currentRoute.structured_data ||
      structuredDataTemplateForRoute(
        tab.key,
        currentRoute.title || ROUTE_LABELS[tab.key],
        currentRoute.description || ""
      );
    setStructuredJson(JSON.stringify(data, null, 2));
  }, [tab, currentRoute]);

  function insertRouteTemplate() {
    if (tab.kind !== "route") return;
    const data = structuredDataTemplateForRoute(
      tab.key,
      currentRoute.title || ROUTE_LABELS[tab.key],
      currentRoute.description || ""
    );
    setStructuredJson(JSON.stringify(data, null, 2));
    setMsg("Template inserted — click Apply JSON to draft, then Save SEO");
    setTimeout(() => setMsg(null), 3000);
  }

  function updateRoute(path: string, patch: Partial<SeoRouteConfig>) {
    if (!config) return;
    setConfig({
      ...config,
      routes: {
        ...config.routes,
        [path]: { ...(config.routes[path] as SeoRouteConfig), ...patch },
      },
    });
  }

  function handleReset() {
    if (savedConfig) setConfig(JSON.parse(JSON.stringify(savedConfig)) as AdminSeoPagesConfig);
    setMsg("Discarded unsaved changes");
    setTimeout(() => setMsg(null), 2000);
  }

  async function handleSavePages() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminApi.putSeoPages({
        base_url: config.base_url,
        default_og_image: config.default_og_image,
        revalidate_seconds: config.revalidate_seconds,
        routes: config.routes,
        sitemap: config.sitemap,
      });
      const next = (res.config || config) as AdminSeoPagesConfig;
      setConfig({ ...next, previous_json: res.has_backup ? next.previous_json ?? {} : null });
      setSavedConfig(JSON.parse(JSON.stringify(next)) as AdminSeoPagesConfig);
      setMsg("SEO settings saved");
      setTimeout(() => setMsg(null), 2500);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreBackup() {
    setSaving(true);
    setError(null);
    try {
      await adminApi.restoreSeoBackup();
      setMsg("Restored previous SEO backup");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore backup failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreDefaults() {
    if (defaultsConfirm.trim() !== SEO_RESTORE_DEFAULTS_CONFIRM) {
      setError(`Type "${SEO_RESTORE_DEFAULTS_CONFIRM}" to confirm`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminApi.restoreSeoDefaults(defaultsConfirm.trim());
      setDefaultsModalOpen(false);
      setDefaultsConfirm("");
      setMsg("Restored factory SEO defaults");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore defaults failed");
    } finally {
      setSaving(false);
    }
  }

  function handleApplyStructured() {
    if (tab.kind !== "route") return;
    try {
      const parsed = structuredJson.trim() ? JSON.parse(structuredJson) : null;
      updateRoute(ROUTE_KEY_TO_PATH[tab.key], { structured_data: parsed });
      setMsg("Structured data updated in draft — click Save SEO to persist");
      setTimeout(() => setMsg(null), 2500);
    } catch {
      setError("Structured data must be valid JSON");
    }
  }

  function moveSitemap(idx: number, dir: -1 | 1) {
    if (!config) return;
    const next = [...config.sitemap];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setConfig({ ...config, sitemap: next });
  }

  if (loading || !config) {
    return (
      <AdminTabPage badge="Content" title="SEO" description="Loading SEO settings…">
        {error && <AdminErrorBanner message={error} />}
        <AdminLoading label="Loading SEO settings…" />
      </AdminTabPage>
    );
  }

  const hasBackup = Boolean(config.previous_json);
  const seoTitle =
    tab.kind === "route"
      ? ROUTE_LABELS[tab.key]
      : tab.kind === "sitemap"
        ? "Sitemap order"
        : tab.kind === "articles"
          ? "Blog articles"
          : "Global SEO";

  const sidebarNav = (
    <div className="space-y-4">
      <div>
        <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
          Pages
        </p>
        <div className="space-y-0.5">
          {ROUTE_KEYS.map((key) => (
            <AdminNavItem
              key={key}
              active={tab.kind === "route" && tab.key === key}
              onClick={() => setTab({ kind: "route", key })}
              title={ROUTE_LABELS[key]}
              subtitle={ROUTE_KEY_TO_PATH[key]}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
          Content
        </p>
        <div className="space-y-0.5">
          <AdminNavItem
            active={tab.kind === "articles"}
            onClick={() => setTab({ kind: "articles" })}
            title="Blog articles"
            subtitle={
              articleSearchMode
                ? `/blogs/[id] · ${articleSearchResults.length} results`
                : `/blogs/[id] · ${articleTotal}`
            }
          />
        </div>
      </div>
      <div>
        <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
          Site
        </p>
        <div className="space-y-0.5">
          <AdminNavItem
            active={tab.kind === "globals"}
            onClick={() => setTab({ kind: "globals" })}
            title="Globals"
            subtitle="base URL, OG image"
          />
          <AdminNavItem
            active={tab.kind === "sitemap"}
            onClick={() => setTab({ kind: "sitemap" })}
            title="Sitemap"
            subtitle="priority order"
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <AdminWorkspace
        badge="Content"
        title="SEO"
        description={seoTitle}
        actions={
          <>
            <button type="button" className={adminBtnSecondary} onClick={handleReset} disabled={saving}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset
            </button>
            {tab.kind !== "articles" && (
              <button
                type="button"
                className={adminBtnPrimary}
                onClick={() => void handleSavePages()}
                disabled={saving}
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save SEO"}
              </button>
            )}
            {hasBackup && (
              <button
                type="button"
                className={adminBtnSecondary}
                onClick={() => void handleRestoreBackup()}
                disabled={saving}
              >
                Restore previous
              </button>
            )}
            {msg && <span className="text-sm text-emerald-400">{msg}</span>}
          </>
        }
        sidebar={sidebarNav}
        sidebarFooter={
          <button
            type="button"
            className={cn(adminBtnSecondary, "w-full text-amber-200/90")}
            onClick={() => setDefaultsModalOpen(true)}
            disabled={saving}
          >
            Restore defaults…
          </button>
        }
      >
        <AdminMainPanel className="max-w-3xl p-5 md:p-6">
          {error && (
            <div className="mb-4">
              <AdminErrorBanner message={error} onDismiss={() => setError(null)} />
            </div>
          )}

          {tab.kind === "globals" && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-white">Global SEO</h2>
              <label className="block text-xs text-white/50">
                Base URL
                <input
                  className={cn(adminInput, "mt-1")}
                  value={config.base_url}
                  onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                />
              </label>
              <AdminOgImageField
                label="Default OG / Twitter image"
                value={config.default_og_image}
                onChange={(url) =>
                  setConfig({ ...config, default_og_image: url || DEFAULT_OG_IMAGE })
                }
                placeholder={DEFAULT_OG_IMAGE}
                folder="site"
                hint="Default social share image for pages without an override. Uploads go to Cloudinary."
                onError={setError}
              />
              <label className="block text-xs text-white/50">
                ISR revalidate (seconds)
                <input
                  type="number"
                  min={10}
                  className={cn(adminInput, "mt-1")}
                  value={config.revalidate_seconds}
                  onChange={(e) =>
                    setConfig({ ...config, revalidate_seconds: Number(e.target.value) || 60 })
                  }
                />
              </label>
            </section>
          )}

          {tab.kind === "sitemap" && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-white">Sitemap priority order</h2>
              <p className="text-sm text-white/45">Higher entries appear first in sitemap.xml. Admin is never listed.</p>
              <ul className="space-y-2">
                {config.sitemap.map((entry, idx) => (
                  <li
                    key={`${entry.path}-${idx}`}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm"
                  >
                    <span className="flex-1 font-mono text-blue-200">{entry.path}</span>
                    <span className="text-white/40">p={entry.priority ?? 0.5}</span>
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
                      onClick={() => moveSitemap(idx, -1)}
                      disabled={idx === 0}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
                      onClick={() => moveSitemap(idx, 1)}
                      disabled={idx === config.sitemap.length - 1}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab.kind === "route" && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-white">{ROUTE_LABELS[tab.key]}</h2>
              <p className="font-mono text-xs text-white/40">{ROUTE_KEY_TO_PATH[tab.key]}</p>
              <SeoFieldsForm
                route={currentRoute}
                canonicalDefault={ROUTE_KEY_TO_PATH[tab.key]}
                globalOgImage={config.default_og_image || DEFAULT_OG_IMAGE}
                onChange={(patch) => updateRoute(ROUTE_KEY_TO_PATH[tab.key], patch)}
                onError={setError}
              />
              <div className="space-y-2">
                <AdminFieldLabel
                  label="Structured data (JSON-LD)"
                  hint="Schema.org markup injected as a <script type='application/ld+json'> tag on this page. Helps Google understand the page (Organization, WebPage, FAQPage, etc.). Leave empty for no structured data."
                >
                  <textarea
                    value={structuredJson}
                    onChange={(e) => setStructuredJson(e.target.value)}
                    rows={10}
                    className={cn(adminInput, "font-mono text-xs")}
                    placeholder='{"@context":"https://schema.org","@type":"WebPage","name":"…"}'
                  />
                </AdminFieldLabel>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={cn(adminBtnSecondary, "group/tpl relative")}
                    onClick={insertRouteTemplate}
                  >
                    Reset to template
                    <AdminHoverHint
                      hint="Replaces the textarea with the predefined Schema.org JSON for this page (based on current title/description)."
                      showToast={false}
                      className="ml-1.5"
                    />
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-[calc(100%+8px)] left-0 z-50 w-64 rounded-lg border border-white/15 bg-[#141414] px-2.5 py-2 text-left text-[11px] font-normal leading-snug text-white/80 opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.55)] transition-opacity duration-150 group-hover/tpl:opacity-100"
                    >
                      Replaces the textarea with the predefined Schema.org JSON for this page (based
                      on current title/description).
                    </span>
                  </button>
                  <button
                    type="button"
                    className={cn(adminBtnSecondary, "group/apply relative")}
                    onClick={handleApplyStructured}
                  >
                    Apply JSON to draft
                    <AdminHoverHint
                      hint="Validates the JSON above and copies it into the unsaved route draft. You still need to click Save SEO to publish it live."
                      showToast={false}
                      className="ml-1.5"
                    />
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-[calc(100%+8px)] left-0 z-50 w-64 rounded-lg border border-white/15 bg-[#141414] px-2.5 py-2 text-left text-[11px] font-normal leading-snug text-white/80 opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.55)] transition-opacity duration-150 group-hover/apply:opacity-100"
                    >
                      Validates the JSON above and copies it into the unsaved route draft. You still
                      need to click Save SEO to publish it live.
                    </span>
                  </button>
                </div>
              </div>
            </section>
          )}

          {tab.kind === "articles" && (
            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Blog article SEO</h2>
                <p className="text-sm text-white/45">
                  Each article at <code className="text-white/60">/blogs/[id]</code> has its own
                  metadata. Click a row to edit — saves per article (not via Save SEO).
                </p>
              </div>

              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runArticleSearch();
                }}
              >
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
                  <input
                    type="search"
                    value={articleSearchInput}
                    onChange={(e) => setArticleSearchInput(e.target.value)}
                    placeholder="Semantic search (meaning, not just title)…"
                    className={cn(adminInput, "w-full py-2 pl-8 text-xs")}
                  />
                </div>
                <button type="submit" className={adminBtnPrimary} disabled={articleSearching}>
                  {articleSearching ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {articleSearching ? "Searching…" : "Search"}
                </button>
                {articleSearchMode && (
                  <button type="button" className={adminBtnSecondary} onClick={clearArticleSearch}>
                    Clear
                  </button>
                )}
              </form>

              <div
                className={cn(
                  "overflow-hidden rounded-xl border border-white/10",
                  articlesLoading && "opacity-60"
                )}
              >
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase text-white/50">
                    <tr>
                      <th className="px-4 py-3 font-medium">Article</th>
                      <th className="px-4 py-3 font-medium">Slug</th>
                      <th className="px-4 py-3 font-medium">Meta title</th>
                      {articleSearchMode && (
                        <th className="px-4 py-3 font-medium">Match</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {articlesLoading && displayArticles.length === 0 ? (
                      <tr>
                        <td
                          colSpan={articleSearchMode ? 4 : 3}
                          className="px-4 py-8 text-center text-white/40"
                        >
                          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                        </td>
                      </tr>
                    ) : displayArticles.length === 0 ? (
                      <tr>
                        <td
                          colSpan={articleSearchMode ? 4 : 3}
                          className="px-4 py-8 text-center text-white/40"
                        >
                          {articleSearchMode
                            ? "No semantic matches."
                            : "No articles yet."}
                        </td>
                      </tr>
                    ) : (
                      displayArticles.map((a) => (
                        <tr
                          key={a.id}
                          className="cursor-pointer border-b border-white/5 transition hover:bg-blue-500/10"
                          onClick={() => void openArticleModal(a)}
                        >
                          <td className="px-4 py-3 font-medium text-white">{a.title}</td>
                          <td className="px-4 py-3 font-mono text-xs text-blue-300/90">{a.slug}</td>
                          <td className="max-w-[240px] truncate px-4 py-3 text-white/60">
                            {a.meta_title || "—"}
                          </td>
                          {articleSearchMode && (
                            <td className="px-4 py-3 text-xs text-white/40">
                              {typeof a.similarity === "number"
                                ? `${Math.round(a.similarity * 100)}%`
                                : "—"}
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {!articleSearchMode && articleTotal > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/45">
                  <span>
                    {articlePage * ARTICLE_PAGE_SIZE + 1}–
                    {Math.min((articlePage + 1) * ARTICLE_PAGE_SIZE, articleTotal)} of{" "}
                    {articleTotal}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={cn(adminBtnSecondary, "px-2 py-1")}
                      disabled={articlePage === 0 || articlesLoading}
                      onClick={() => setArticlePage((p) => Math.max(0, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span>
                      Page {articlePage + 1} / {articleTotalPages}
                    </span>
                    <button
                      type="button"
                      className={cn(adminBtnSecondary, "px-2 py-1")}
                      disabled={articlePage + 1 >= articleTotalPages || articlesLoading}
                      onClick={() => setArticlePage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
              {articleSearchMode && (
                <p className="text-xs text-white/40">
                  {displayArticles.length} semantic result(s) — Clear to return to paginated list.
                </p>
              )}
            </section>
          )}
        </AdminMainPanel>
      </AdminWorkspace>

      {editingArticle && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) closeArticleModal();
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/15 bg-[#141414] shadow-xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{editingArticle.title}</h3>
                <p className="mt-0.5 font-mono text-xs text-blue-300/90">
                  /blogs/{editingArticle.slug}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
                aria-label="Close"
                onClick={closeArticleModal}
                disabled={saving}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <label className="block text-xs text-white/50">
                Meta title
                <input
                  className={cn(adminInput, "mt-1")}
                  value={editingArticle.meta_title || ""}
                  onChange={(e) =>
                    setEditingArticle({ ...editingArticle, meta_title: e.target.value })
                  }
                  placeholder={editingArticle.title}
                />
              </label>
              <label className="block text-xs text-white/50">
                Meta description
                <textarea
                  className={cn(adminInput, "mt-1 min-h-[72px] resize-y")}
                  value={editingArticle.meta_description || ""}
                  onChange={(e) =>
                    setEditingArticle({ ...editingArticle, meta_description: e.target.value })
                  }
                  placeholder={editingArticle.summary}
                />
              </label>
              <label className="block text-xs text-white/50">
                Keywords
                <input
                  className={cn(adminInput, "mt-1")}
                  value={editingArticle.meta_keywords || ""}
                  onChange={(e) =>
                    setEditingArticle({ ...editingArticle, meta_keywords: e.target.value })
                  }
                />
              </label>
              <label className="block text-xs text-white/50">
                Canonical path
                <input
                  className={cn(adminInput, "mt-1 font-mono text-xs")}
                  value={editingArticle.canonical_path || `/blogs/${editingArticle.slug}`}
                  onChange={(e) =>
                    setEditingArticle({ ...editingArticle, canonical_path: e.target.value })
                  }
                />
              </label>
              <div className="space-y-2">
                <AdminOgImageField
                  label="OG image URL"
                  value={editingArticle.og_image}
                  onChange={(url) => setEditingArticle({ ...editingArticle, og_image: url })}
                  placeholder={
                    editingArticle.hero_image || config.default_og_image || DEFAULT_OG_IMAGE
                  }
                  folder="articles"
                  hint="Upload via Cloudinary, or paste a URL. Falls back to hero image / global default."
                  onError={setError}
                />
                {editingArticle.hero_image ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={cn(adminBtnSecondary, "text-xs")}
                      onClick={() =>
                        setEditingArticle({
                          ...editingArticle,
                          og_image: editingArticle.hero_image || null,
                        })
                      }
                      disabled={editingArticle.og_image === editingArticle.hero_image}
                    >
                      Use hero image
                    </button>
                    <div className="h-10 w-16 overflow-hidden rounded-lg border border-white/10 bg-black/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={editingArticle.hero_image}
                        alt="Article hero"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <span className="text-[11px] text-white/35">
                      {editingArticle.og_image === editingArticle.hero_image
                        ? "Hero image is set as OG"
                        : "Article has a hero image"}
                    </span>
                  </div>
                ) : (
                  <p className="text-[11px] text-white/30">
                    No hero image on this article — upload an OG image or paste a URL.
                  </p>
                )}
              </div>
              <label className="block text-xs text-white/50">
                Robots
                <input
                  className={cn(adminInput, "mt-1")}
                  value={editingArticle.robots || "index,follow"}
                  onChange={(e) =>
                    setEditingArticle({ ...editingArticle, robots: e.target.value })
                  }
                  placeholder="index,follow"
                />
              </label>
              <AdminFieldLabel
                label="Structured data (JSON-LD)"
                hint="Schema.org Article markup for this blog post. Prefilled from a template — edit as needed. Saved with Save article SEO."
              >
                <textarea
                  className={cn(adminInput, "font-mono text-xs")}
                  rows={8}
                  value={articleStructuredJson}
                  onChange={(e) => setArticleStructuredJson(e.target.value)}
                  placeholder='{"@context":"https://schema.org","@type":"Article","headline":"…"}'
                />
              </AdminFieldLabel>
              <button
                type="button"
                className={adminBtnSecondary}
                onClick={() =>
                  setArticleStructuredJson(
                    JSON.stringify(
                      articleStructuredDataTemplate({
                        title: editingArticle.meta_title || editingArticle.title,
                        description:
                          editingArticle.meta_description || editingArticle.summary || "",
                        slug: editingArticle.slug,
                        author: editingArticle.author,
                      }),
                      null,
                      2
                    )
                  )
                }
              >
                Reset to article template
              </button>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 px-5 py-3">
              <button type="button" className={adminBtnSecondary} disabled={saving} onClick={closeArticleModal}>
                Cancel
              </button>
              <button
                type="button"
                className={adminBtnPrimary}
                disabled={saving}
                onClick={() => void handleSaveArticleSeo()}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save article SEO"}
              </button>
            </div>
          </div>
        </div>
      )}

      {defaultsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setDefaultsModalOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#141414] p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-amber-200">Restore factory SEO defaults?</h3>
            <p className="mt-2 text-sm text-white/55">
              This replaces live SEO with the permanent snapshot. Type{" "}
              <code className="text-amber-200/90">{SEO_RESTORE_DEFAULTS_CONFIRM}</code> to confirm.
            </p>
            <input
              className={cn(adminInput, "mt-3")}
              value={defaultsConfirm}
              onChange={(e) => setDefaultsConfirm(e.target.value)}
              placeholder={SEO_RESTORE_DEFAULTS_CONFIRM}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={adminBtnSecondary}
                disabled={saving}
                onClick={() => setDefaultsModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={adminBtnPrimary}
                disabled={saving || defaultsConfirm.trim() !== SEO_RESTORE_DEFAULTS_CONFIRM}
                onClick={() => void handleRestoreDefaults()}
              >
                Restore defaults
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
