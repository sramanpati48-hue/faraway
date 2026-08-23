"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminTabPage } from "@/components/admin/AdminPageLayout";
import {
  AdminErrorBanner,
  AdminFieldLabel,
  AdminLoading,
  adminBtnPrimary,
  adminBtnSecondary,
  adminCard,
  adminInput,
} from "@/components/admin/admin-ui";
import {
  adminApi,
  type RagRetrievalConfig,
  type RagRetrievalSaveBody,
  type RagRetrievalSnapshot,
  type ScamMatchRetrievalSettings,
} from "@/lib/adminApi";
import { cn } from "@/lib/utils";

type GraphDraft = {
  top_k: string;
  min_similarity: string;
};

type ScamDraft = {
  city_min_similarity: string;
  national_min_similarity: string;
  top_k: string;
};

function draftsFromConfig(config: RagRetrievalConfig): Record<string, GraphDraft> {
  const out: Record<string, GraphDraft> = {};
  for (const [gid, settings] of Object.entries(config || {})) {
    out[gid] = {
      top_k: String(settings?.top_k ?? ""),
      min_similarity: String(settings?.min_similarity ?? 0),
    };
  }
  return out;
}

function scamDraftFromSettings(settings: ScamMatchRetrievalSettings | undefined): ScamDraft {
  return {
    city_min_similarity: String(settings?.city_min_similarity ?? 0.78),
    national_min_similarity: String(settings?.national_min_similarity ?? 0.82),
    top_k: String(settings?.top_k ?? 5),
  };
}

export function AdminRagRetrievalPanel() {
  const [snap, setSnap] = useState<RagRetrievalSnapshot | null>(null);
  const [drafts, setDrafts] = useState<Record<string, GraphDraft>>({});
  const [scamDraft, setScamDraft] = useState<ScamDraft>(scamDraftFromSettings(undefined));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await adminApi.ragRetrievalConfig();
    setSnap(res);
    setDrafts(draftsFromConfig(res.config));
    setScamDraft(scamDraftFromSettings(res.scam_match));
  }, []);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load RAG retrieval settings")
    );
  }, [load]);

  async function saveAll() {
    if (!snap) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const body: RagRetrievalSaveBody = {
        scam_match: {
          city_min_similarity: Number(scamDraft.city_min_similarity),
          national_min_similarity: Number(scamDraft.national_min_similarity),
          top_k: Number(scamDraft.top_k),
        },
      };
      for (const graph of snap.graphs) {
        const d = drafts[graph.id] || { top_k: "10", min_similarity: "0" };
        const settings = {
          top_k: Number(d.top_k),
          min_similarity: Number(d.min_similarity),
        };
        if (graph.id === "clash_agent") body.clash_agent = settings;
        else body.chat_agent = settings;
      }
      const res = await adminApi.patchRagRetrievalConfig(body);
      setSnap((prev) =>
        prev
          ? { ...prev, config: res.config, scam_match: res.scam_match }
          : {
              config: res.config,
              defaults: res.config,
              graphs: Object.keys(res.config).map((id) => ({ id, label: id })),
              limits: { top_k_min: 1, top_k_max: 30 },
              scam_match: res.scam_match,
              scam_match_defaults: res.scam_match,
            }
      );
      setDrafts(draftsFromConfig(res.config));
      setScamDraft(scamDraftFromSettings(res.scam_match));
      setMessage("Retrieval thresholds saved. Next chat, clash, and scam match use these values.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  if (!snap) {
    return (
      <AdminTabPage
        badge="Configuration"
        title="RAG retrieval"
        description="Loading…"
      >
        {error && <AdminErrorBanner message={error} onDismiss={() => setError(null)} />}
        <AdminLoading label="Loading retrieval thresholds…" />
      </AdminTabPage>
    );
  }

  const { limits } = snap;
  const scamDefaults = snap.scam_match_defaults;

  return (
    <AdminTabPage
      badge="Configuration"
      title="RAG retrieval thresholds"
      description="Per-graph top_k and minimum similarity for legal_documents retrieval, plus live mock_scams match thresholds. Separate from RAG funnel ingest and from AI Models scam clustering."
      actions={
        <div className="flex gap-2">
          <button
            type="button"
            className={adminBtnSecondary}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </button>
          <button
            type="button"
            className={adminBtnPrimary}
            onClick={() => void saveAll()}
            disabled={loading}
          >
            {loading ? "Saving…" : "Save all"}
          </button>
        </div>
      }
    >
      {error && <AdminErrorBanner message={error} onDismiss={() => setError(null)} />}
      {message && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {message}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {snap.graphs.map((graph) => {
          const draft = drafts[graph.id] || { top_k: "10", min_similarity: "0" };
          const defaults = snap.defaults[graph.id];
          return (
            <div key={graph.id} className={cn(adminCard, "p-4")}>
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-white">{graph.label}</h3>
                <p className="mt-0.5 font-mono text-[10px] text-white/40">{graph.id}</p>
              </div>

              <div className="space-y-3">
                <div>
                  <AdminFieldLabel
                    label="top_k"
                    hint={`How many legal_documents chunks this graph retrieves per query (${limits.top_k_min}–${limits.top_k_max}). Higher = more context, slower/noisier. Default ${defaults?.top_k ?? "—"}. Does not affect mock_scams matching.`}
                  />
                  <input
                    type="number"
                    min={limits.top_k_min}
                    max={limits.top_k_max}
                    className={adminInput}
                    value={draft.top_k}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [graph.id]: { ...draft, top_k: e.target.value },
                      }))
                    }
                  />
                </div>
                <div>
                  <AdminFieldLabel
                    label="min_similarity"
                    hint="Drop legal_documents chunks below this cosine score (0–1). 0 keeps all top_k rows. This is RAG for chat/clash, not the Scams thresholds below."
                  />
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    className={adminInput}
                    value={draft.min_similarity}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [graph.id]: { ...draft, min_similarity: e.target.value },
                      }))
                    }
                  />
                  <p className="mt-1 text-[10px] text-white/35">
                    {Number(draft.min_similarity) > 0
                      ? `Filter on: keep rows with similarity ≥ ${draft.min_similarity}`
                      : "Filtering off (keep all top_k results)"}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Scams thresholds</h2>
          <p className="mt-1 text-xs text-white/50">
            Cosine cutoffs for the silent <span className="font-mono text-white/70">scam_match</span> node
            against <span className="font-mono text-white/70">mock_scams</span>. This is live case flagging,
            not the AI Models classifier cluster threshold.
          </p>
        </div>
        <div className={cn(adminCard, "p-4")}>
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-white">Live mock_scams match</h3>
            <p className="mt-0.5 font-mono text-[10px] text-white/40">scam_match</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <AdminFieldLabel
                label="In-city min similarity"
                hint={`Difference: this is the first pass — only mock_scams whose city matches the user (e.g. Delhi). Keep a row if cosine ≥ this value. Lower = more local hits (noisier); higher = stricter, fewer city hits. If this pass returns nothing, the national fallback runs. Default ${scamDefaults?.city_min_similarity ?? 0.78}. Not the AI Models classifier cluster threshold.`}
              />
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                className={adminInput}
                value={scamDraft.city_min_similarity}
                onChange={(e) =>
                  setScamDraft((prev) => ({ ...prev, city_min_similarity: e.target.value }))
                }
              />
            </div>
            <div>
              <AdminFieldLabel
                label="National fallback min similarity"
                hint={`Difference: this is the second pass — all of India, only if the in-city search returned zero rows (thin city corpus or unknown city). Usually set higher than in-city so a nationwide hit must be a stronger match. Skipped entirely when the city pass already found trends. Default ${scamDefaults?.national_min_similarity ?? 0.82}. Not the AI Models classifier cluster threshold.`}
              />
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                className={adminInput}
                value={scamDraft.national_min_similarity}
                onChange={(e) =>
                  setScamDraft((prev) => ({ ...prev, national_min_similarity: e.target.value }))
                }
              />
            </div>
            <div>
              <AdminFieldLabel
                label="top_k"
                hint={`Max mock_scams rows kept after scoring (city first, then national if city is empty). Those candidates go to the scam LLM to confirm the same modus operandi. Range ${limits.top_k_min}–${limits.top_k_max}. Default ${scamDefaults?.top_k ?? 5}.`}
              />
              <input
                type="number"
                min={limits.top_k_min}
                max={limits.top_k_max}
                className={adminInput}
                value={scamDraft.top_k}
                onChange={(e) => setScamDraft((prev) => ({ ...prev, top_k: e.target.value }))}
              />
            </div>
          </div>
          <p className="mt-3 text-[10px] text-white/35">
            Filter on: in-city ≥ {scamDraft.city_min_similarity || "—"}, national fallback ≥{" "}
            {scamDraft.national_min_similarity || "—"}. Next case chat uses these immediately after save.
          </p>
        </div>
      </section>
    </AdminTabPage>
  );
}
