"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Layers, RefreshCw, Search, X } from "lucide-react";
import {
  adminBtnSecondary,
  adminInput,
  adminSelect,
} from "@/components/admin/admin-ui";
import {
  adminApi,
  type AdminModelsSnapshot,
  type PolicyCatalog,
  type PolicyContextRef,
} from "@/lib/adminApi";

type Props = {
  attached: PolicyContextRef[];
  onAttach: (ref: PolicyContextRef) => void;
  onDetach: (ref: PolicyContextRef) => void;
  onError: (message: string) => void;
};

export function PolicyContextPicker({ attached, onAttach, onDetach, onError }: Props) {
  const [catalog, setCatalog] = useState<PolicyCatalog | null>(null);
  const [models, setModels] = useState<AdminModelsSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PolicyContextRef[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cat, mdl] = await Promise.all([
        adminApi.policyCatalog(),
        adminApi.aiModels().catch(() => null),
      ]);
      setCatalog(cat);
      if (mdl) setModels(mdl);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load the context catalog");
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const attachedKeys = useMemo(
    () => new Set(attached.map((r) => `${r.kind}:${r.ref_id}`)),
    [attached]
  );

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await adminApi.policyContextSearch(q, 10);
      setResults(res.results || []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Semantic search failed");
    } finally {
      setSearching(false);
    }
  }

  async function reindex() {
    setReindexing(true);
    try {
      const res = await adminApi.policyReindex();
      setCatalog((prev) => (prev ? { ...prev, index: res.index } : prev));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Reindex failed");
    } finally {
      setReindexing(false);
    }
  }

  async function saveEmbeddingModel(provider: string, model: string) {
    if (!models) return;
    setSavingModel(true);
    try {
      await adminApi.patchSystemConfig("ai_embeddings", {
        ...models.config.ai_embeddings,
        provider,
        model,
      });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save the embedding model");
    } finally {
      setSavingModel(false);
    }
  }

  const embedding = models?.config.ai_embeddings || {};
  const embeddingProviders = models?.catalog.embedding_providers || ["nyaysahayak", "vertex", "gemini"];
  const embeddingModels =
    models?.catalog.embedding_models?.[String(embedding.provider || "nyaysahayak")] || [];
  const browse = results ?? defaultBrowse(catalog);
  const index = catalog?.index;
  const indexStale = !!index && index.indexed < index.expected;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <input
            className={`${adminInput} pl-9 text-xs`}
            placeholder="Search tables and features — e.g. moderator throughput, lawyer fees"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runSearch();
              }
            }}
          />
        </div>
        <button
          type="button"
          className={`${adminBtnSecondary} text-xs`}
          onClick={() => void runSearch()}
          disabled={searching}
        >
          {searching ? "Searching…" : "Search"}
        </button>
        {results ? (
          <button
            type="button"
            className={`${adminBtnSecondary} text-xs`}
            onClick={() => {
              setResults(null);
              setQuery("");
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {attached.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {attached.map((ref) => (
            <button
              key={`${ref.kind}:${ref.ref_id}`}
              type="button"
              onClick={() => onDetach(ref)}
              className="group inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.1] px-2 py-1 text-[11px] text-emerald-200 transition hover:bg-emerald-500/[0.16]"
            >
              {ref.kind === "table" ? <Database className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
              {ref.title || ref.ref_id}
              <X className="h-3 w-3 opacity-50 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-white/35">
          Nothing attached yet. The studio still auto-attaches the closest matches when you run it.
        </p>
      )}

      <div className="admin-scrollbar max-h-56 overflow-y-auto rounded-xl border border-white/[0.08] bg-black/30">
        {browse.length === 0 ? (
          <p className="px-3 py-4 text-xs text-white/35">
            {results ? "No matches. Try different words." : "Loading catalog…"}
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {browse.map((ref) => {
              const key = `${ref.kind}:${ref.ref_id}`;
              const isAttached = attachedKeys.has(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => (isAttached ? onDetach(ref) : onAttach(ref))}
                    className={`flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition hover:bg-white/[0.04] ${
                      isAttached ? "bg-emerald-500/[0.06]" : ""
                    }`}
                  >
                    {ref.kind === "table" ? (
                      <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300/70" />
                    ) : (
                      <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300/70" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-white/80">{ref.title}</span>
                      {ref.content ? (
                        <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-white/35">
                          {ref.content}
                        </span>
                      ) : null}
                    </span>
                    {typeof ref.similarity === "number" ? (
                      <span className="shrink-0 font-mono text-[10px] text-white/30">
                        {ref.similarity.toFixed(2)}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <div className="min-w-[150px]">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">
            Embedding provider
          </label>
          <select
            className={`${adminSelect} w-full text-xs`}
            value={String(embedding.provider || "nyaysahayak")}
            disabled={savingModel || !models}
            onChange={(e) => {
              const provider = e.target.value;
              const first = models?.catalog.embedding_models?.[provider]?.[0] || "";
              void saveEmbeddingModel(provider, first);
            }}
          >
            {embeddingProviders.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[190px] flex-1">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">
            Embedding model
          </label>
          <select
            className={`${adminSelect} w-full text-xs`}
            value={String(embedding.model || "")}
            disabled={savingModel || !models}
            onChange={(e) => void saveEmbeddingModel(String(embedding.provider || "nyaysahayak"), e.target.value)}
          >
            {embeddingModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className={`${adminBtnSecondary} gap-2 text-xs`}
          onClick={() => void reindex()}
          disabled={reindexing}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${reindexing ? "animate-spin" : ""}`} />
          {reindexing ? "Reindexing…" : "Regenerate embeddings"}
        </button>
        <p className={`w-full text-[11px] ${indexStale ? "text-amber-300/80" : "text-white/35"}`}>
          {index
            ? `${index.indexed} of ${index.expected} context items indexed${
                indexStale ? " — regenerate so search covers everything." : "."
              }`
            : "Index status unavailable."}
        </p>
      </div>
    </div>
  );
}

function defaultBrowse(catalog: PolicyCatalog | null): PolicyContextRef[] {
  if (!catalog) return [];
  const features: PolicyContextRef[] = (catalog.features || []).map((f) => ({
    kind: "feature",
    ref_id: f.id,
    title: f.title,
    content: f.summary,
    metadata: { tables: f.tables, config_keys: f.config_keys },
  }));
  const tables: PolicyContextRef[] = (catalog.tables || []).map((t) => ({
    kind: "table",
    ref_id: t.name,
    title: t.name,
    content: `Columns: ${(t.columns || []).slice(0, 12).join(", ")}`,
  }));
  return [...features, ...tables];
}
