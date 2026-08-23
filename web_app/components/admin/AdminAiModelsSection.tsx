"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminTabPage } from "@/components/admin/AdminPageLayout";
import {
  AdminErrorBanner,
  AdminFieldLabel,
  AdminHoverHint,
  AdminLoading,
  adminBtnSecondary,
  adminSelect,
} from "@/components/admin/admin-ui";
import { AdminModelSelector } from "@/components/admin/AdminModelSelector";
import {
  adminApi,
  type AdminModelsSnapshot,
  type ScamClassifierConfig,
  type ScamClassifierRun,
} from "@/lib/adminApi";

export function AdminAiModelsSection() {
  const [models, setModels] = useState<AdminModelsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [classifierCfg, setClassifierCfg] = useState<ScamClassifierConfig | null>(null);
  const [classifierRun, setClassifierRun] = useState<ScamClassifierRun | null>(null);
  const [classifierBusy, setClassifierBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [snap, cfgRes] = await Promise.all([
      adminApi.aiModels(),
      adminApi.scamClassifierConfig().catch(() => ({ config: {} as ScamClassifierConfig })),
    ]);
    setModels(snap);
    setClassifierCfg(cfgRes.config || {});
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load models"));
  }, [load]);

  useEffect(() => {
    if (!classifierRun || !["queued", "running"].includes(classifierRun.status)) return;
    // Hold a process HTTP request open so Cloud Run allocates CPU (no min-instances).
    adminApi.kickScamClassifierProcess(classifierRun.id);
    const id = classifierRun.id;
    const t = setInterval(() => {
      void adminApi
        .scamClassifierRunStatus(id)
        .then((r) => {
          setClassifierRun(r.run);
          if (r.run.status === "queued") adminApi.kickScamClassifierProcess(id);
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [classifierRun?.id, classifierRun?.status]);

  async function saveNode(graphId: string, nodeId: string, provider: string, model: string) {
    if (!models) return;
    setLoading(true);
    setError(null);
    try {
      const next = structuredClone(models.config.graph_node_models);
      next[graphId] = next[graphId] || {};
      next[graphId][nodeId] = { provider, model };
      await adminApi.patchSystemConfig("graph_node_models", next);
      setMessage(`Saved ${graphId}.${nodeId}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveEmbeddings(patch: Record<string, unknown>) {
    if (!models) return;
    setLoading(true);
    setError(null);
    try {
      await adminApi.patchSystemConfig("ai_embeddings", {
        ...models.config.ai_embeddings,
        ...patch,
      });
      setMessage("Embedding settings saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  if (!models) {
    return (
      <AdminTabPage badge="AI" title="Model selection" description="Loading…">
        {error && <AdminErrorBanner message={error} onDismiss={() => setError(null)} />}
        <AdminLoading label="Loading AI configuration…" />
      </AdminTabPage>
    );
  }

  const chatNodes = models.catalog.chat_nodes;
  const clashNodes = models.catalog.clash_nodes;
  const scamClassifierNodes = models.catalog.scam_classifier_nodes || ["classifier"];
  const policyNodes = models.catalog.policy_nodes || ["planner", "question_gen", "impact", "implementer"];
  const emb = models.config.ai_embeddings || {};

  return (
    <AdminTabPage
      badge="AI"
      title="Model selection & embeddings"
      description="Defaults: Groq Llama 3.3 for chat nodes, OpenRouter nemotron for clash. Switch provider/model per node anytime."
      actions={
        <button type="button" className={adminBtnSecondary} onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      }
    >
      {error && <AdminErrorBanner message={error} onDismiss={() => setError(null)} />}
      {message && <p className="mb-4 text-sm text-emerald-300/90">{message}</p>}

      <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/55">
        Hover the <span className="text-white/75">?</span> next to Provider/Model for the env key each provider needs:
        <span className="mt-1 block font-mono text-[11px] text-white/40">
          GROQ_API_KEY · GEMINI_API_KEY · OPEN_ROUTER_API_KEY · SELFHOST_LLM_BASE_URL +
          SELFHOST_LLM_API_KEY · VERTEX_API_KEY
        </span>
      </div>

      <div className="mb-6 rounded-[20px] border border-white/[0.09] bg-[#0c0c0c] p-5">
        <h2 className="text-sm font-semibold text-white/85">Embeddings</h2>
        <p className="mt-1 text-xs text-white/40">
          Query + document vectors (768-d) used by article search, chat agent RAG, and clash
          mode RAG. Google <code className="text-white/60">gemini-embedding-001</code> uses
          VERTEX_API_KEY (or GEMINI_API_KEY) and Matryoshka output 768 so existing{" "}
          <code>vector(768)</code> columns stay valid. Switching provider requires regenerating
          stored vectors.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="inline-flex items-center text-[10px] text-white/35">
              Provider
              <AdminHoverHint hint="nyaysahayak = self-host Vyakyarth HTTP API. vertex = Google gemini-embedding-001 via VERTEX_API_KEY." />
            </p>
            <select
              className={`${adminSelect} mt-1 w-full text-xs`}
              value={String(emb.provider || "nyaysahayak")}
              onChange={(e) => {
                const provider = e.target.value;
                const modelsFor =
                  models.catalog.embedding_models?.[provider] ||
                  (provider === "vertex"
                    ? [models.catalog.gemini_embedding_model || "gemini-embedding-001"]
                    : [models.catalog.nyaysahayak_embedding_model]);
                void saveEmbeddings({
                  provider,
                  model: modelsFor[0],
                  output_dimensionality: models.catalog.embedding_dim || 768,
                });
              }}
            >
              {(models.catalog.embedding_providers || ["nyaysahayak", "vertex"]).map((p) => (
                <option key={p} value={p}>
                  {p === "vertex" ? "vertex (Google gemini-embedding-001)" : "nyaysahayak (Vyakyarth)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-[10px] text-white/35">Model</p>
            <select
              className={`${adminSelect} mt-1 w-full text-xs`}
              value={String(emb.model || models.catalog.nyaysahayak_embedding_model)}
              onChange={(e) =>
                void saveEmbeddings({
                  provider: emb.provider || "nyaysahayak",
                  model: e.target.value,
                  output_dimensionality: models.catalog.embedding_dim || 768,
                })
              }
            >
              {(
                models.catalog.embedding_models?.[String(emb.provider || "nyaysahayak")] || [
                  String(emb.model || models.catalog.nyaysahayak_embedding_model),
                ]
              ).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          {String(emb.provider || "nyaysahayak") === "nyaysahayak" && (
            <div className="sm:col-span-2">
              <p className="inline-flex items-center text-[10px] text-white/35">
                API base URL
                <AdminHoverHint hint="Nyaysahayak embedding service base URL (used only when provider is nyaysahayak)." />
              </p>
              <input
                className={`${adminSelect} mt-1 w-full text-xs`}
                defaultValue={String(emb.external_embedding_url || models.env.default_embedding_url)}
                onBlur={(e) => {
                  const url = e.target.value.trim();
                  if (url && url !== emb.external_embedding_url) {
                    void saveEmbeddings({
                      provider: "nyaysahayak",
                      model: models.catalog.nyaysahayak_embedding_model,
                      external_embedding_url: url,
                    });
                  }
                }}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={regenerating || loading}
          className={`${adminBtnSecondary} mt-3 text-xs`}
          onClick={() => {
            if (
              !window.confirm(
                "Regenerate embeddings for lawyers, scams, legal documents, and articles with the currently selected model?"
              )
            )
              return;
            setRegenerating(true);
            void adminApi
              .regenerateEmbeddings("all")
              .then((r) =>
                setMessage(
                  `Regenerated: lawyers ${r.counts.lawyers}, mock_scams ${r.counts.mock_scams}, legal_documents ${r.counts.legal_documents}, scam_reports ${r.counts.scam_reports}, articles ${r.counts.articles ?? 0}`
                )
              )
              .catch((err) => setError(err instanceof Error ? err.message : "Regeneration failed"))
              .finally(() => setRegenerating(false));
          }}
        >
          {regenerating ? "Regenerating…" : "Regenerate embeddings"}
        </button>
        <p className="mt-2 text-[10px] text-white/40">
          Groq: {models.env.groq_configured ? "configured" : "missing"} · Gemini:{" "}
          {models.env.gemini_configured ? "configured" : "missing"} · OpenRouter:{" "}
          {models.env.openrouter_configured ? "configured" : "missing"} · Selfhost:{" "}
          {models.env.selfhost_configured ? "configured" : "missing"} · Vertex:{" "}
          {models.env.vertex_configured ? "configured" : "missing"}
        </p>
      </div>

      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold text-white/85">chat_agent nodes</h2>
        <p className="text-xs text-white/40">Default provider: Groq · llama-3.3-70b-versatile</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {chatNodes.map((nodeId) => {
            const cfg = models.config.graph_node_models?.chat_agent?.[nodeId] || {};
            return (
              <AdminModelSelector
                key={nodeId}
                label={nodeId}
                provider={String(cfg.provider || "groq")}
                model={String(cfg.model || models.env.default_groq_model)}
                catalog={models.catalog}
                env={models.env}
                onChange={(provider, model) => void saveNode("chat_agent", nodeId, provider, model)}
              />
            );
          })}
        </div>
      </section>

      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold text-white/85">clash_agent nodes</h2>
        <p className="text-xs text-white/40">Default provider: OpenRouter · nvidia/nemotron-3-ultra-550b-a55b:free</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {clashNodes.map((nodeId) => {
            const cfg = models.config.graph_node_models?.clash_agent?.[nodeId] || {};
            return (
              <AdminModelSelector
                key={nodeId}
                label={nodeId}
                provider={String(cfg.provider || "openrouter")}
                model={String(cfg.model || models.env.default_openrouter_model)}
                catalog={models.catalog}
                env={models.env}
                onChange={(provider, model) => void saveNode("clash_agent", nodeId, provider, model)}
              />
            );
          })}
        </div>
      </section>

      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold text-white/85">scam_classifier tasks</h2>
        <p className="text-xs text-white/40">
          Default: selfhost · Qwen2.5-3B-Instruct — same-scam confirmation for case clustering
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {scamClassifierNodes.map((nodeId) => {
            const cfg = models.config.graph_node_models?.scam_classifier?.[nodeId] || {};
            return (
              <AdminModelSelector
                key={nodeId}
                label={nodeId}
                provider={String(cfg.provider || "selfhost")}
                model={String(cfg.model || models.env.default_selfhost_model || "Qwen2.5-3B-Instruct")}
                catalog={models.catalog}
                env={models.env}
                onChange={(provider, model) => void saveNode("scam_classifier", nodeId, provider, model)}
              />
            );
          })}
        </div>
      </section>

      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold text-white/85">Policy studio</h2>
        <p className="text-xs text-white/40">
          Improvise policies tab — planner writes the change set, question_gen builds the clarification
          form, impact renders the analysis panel, implementer reviews before apply. Unset nodes inherit
          the chat supervisor&apos;s model.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {policyNodes.map((nodeId) => {
            const cfg =
              models.config.graph_node_models?.policy_studio?.[nodeId] ||
              models.resolved?.[`policy_studio.${nodeId}`] ||
              {};
            return (
              <AdminModelSelector
                key={nodeId}
                label={nodeId}
                provider={String(cfg.provider || "groq")}
                model={String(cfg.model || models.env.default_groq_model)}
                catalog={models.catalog}
                env={models.env}
                onChange={(provider, model) => void saveNode("policy_studio", nodeId, provider, model)}
              />
            );
          })}
        </div>
      </section>

      <section className="mb-2 space-y-3">
        <h2 className="text-sm font-semibold text-white/85">Scam case clustering job</h2>
        <p className="text-xs text-white/40">
          Keeping the API awake (UptimeRobot on <code className="text-white/55">/ping</code>) does{" "}
          <span className="text-white/70">not</span> run this job. Clustering only starts when something
          hits{" "}
          <code className="text-white/55">HEAD /api/cron/scam-classifier/tick?secret=CRON_SECRET</code>
          . Add a <span className="text-white/70">second</span> UptimeRobot HTTP(s) monitor (free tier:
          HEAD only) on that tick URL every 5 min. Each ping is a cheap due-check: Interval + last run
          decide whether clustering actually starts. Embeds recent cases, finds neighbors, confirms with
          the classifier model, registers into mock_scams.
        </p>
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AdminFieldLabel
              label="Interval (hours)"
              hint="How often clustering is allowed to run after a tick. UptimeRobot free monitors HEAD the tick URL every 5 min; this value is checked against last_run_at. 12 ≈ twice/day, 1 = every hour, 168 = weekly. Save settings after changing. The API being always-on is not enough by itself."
            >
              <input
                type="number"
                min={1}
                max={168}
                className={`${adminSelect} mt-1 w-full`}
                value={classifierCfg?.interval_hours ?? 12}
                onChange={(e) =>
                  setClassifierCfg((c) => ({ ...(c || {}), interval_hours: Number(e.target.value) || 12 }))
                }
              />
            </AdminFieldLabel>
            <AdminFieldLabel
              label="Similarity threshold"
              hint="Minimum embedding cosine similarity (0.5–0.99) for two cases to be treated as neighbors. Higher = stricter matching (fewer clusters)."
            >
              <input
                type="number"
                min={0.5}
                max={0.99}
                step={0.01}
                className={`${adminSelect} mt-1 w-full`}
                value={classifierCfg?.similarity_threshold ?? 0.82}
                onChange={(e) =>
                  setClassifierCfg((c) => ({
                    ...(c || {}),
                    similarity_threshold: Number(e.target.value) || 0.82,
                  }))
                }
              />
            </AdminFieldLabel>
            <AdminFieldLabel
              label="Min same-case count"
              hint="A cluster is only registered into mock_scams after the LLM confirms the same scam AND at least this many matching cases exist (default 5)."
            >
              <input
                type="number"
                min={2}
                max={50}
                className={`${adminSelect} mt-1 w-full`}
                value={classifierCfg?.min_same_case_count ?? 5}
                onChange={(e) =>
                  setClassifierCfg((c) => ({
                    ...(c || {}),
                    min_same_case_count: Number(e.target.value) || 5,
                  }))
                }
              />
            </AdminFieldLabel>
            <AdminFieldLabel
              label="Lookback (days)"
              hint="Only scan cases created within this many days that already have embeddings and are not yet clustered."
            >
              <input
                type="number"
                min={1}
                max={365}
                className={`${adminSelect} mt-1 w-full`}
                value={classifierCfg?.lookback_days ?? 30}
                onChange={(e) =>
                  setClassifierCfg((c) => ({ ...(c || {}), lookback_days: Number(e.target.value) || 30 }))
                }
              />
            </AdminFieldLabel>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading}
              className={`${adminBtnSecondary} text-xs`}
              onClick={() => {
                if (!classifierCfg) return;
                setLoading(true);
                void adminApi
                  .patchSystemConfig("scam_classifier", {
                    ...classifierCfg,
                    enabled: classifierCfg.enabled !== false,
                  })
                  .then(() => setMessage("Scam classifier settings saved."))
                  .catch((err) => setError(err instanceof Error ? err.message : "Save failed"))
                  .finally(() => setLoading(false));
              }}
            >
              Save schedule settings
              <AdminHoverHint hint="Persist these settings. The next UptimeRobot tick uses Interval + last_run_at to decide if clustering runs. Keep-alive /ping pings do not count." />
            </button>
            <button
              type="button"
              disabled={classifierBusy}
              className={`${adminBtnSecondary} text-xs`}
              onClick={() => {
                setClassifierBusy(true);
                void adminApi
                  .scamClassifierRunNow()
                  .then((r) => {
                    setClassifierRun(r.run);
                    adminApi.kickScamClassifierProcess(r.run.id);
                    setMessage("Classifier run started.");
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : "Run failed"))
                  .finally(() => setClassifierBusy(false));
              }}
            >
              {classifierBusy ? "Starting…" : "Run now"}
              <AdminHoverHint hint="Run one clustering pass immediately using the current settings (or last saved values). Does not wait for the UptimeRobot tick." />
            </button>
            {classifierCfg?.last_run_at && (
              <span className="inline-flex items-center text-[10px] text-white/35">
                Last run: {classifierCfg.last_run_at}
                <AdminHoverHint hint="UTC time of the last completed clustering run (scheduled or manual)." />
              </span>
            )}
          </div>
          {classifierRun && (
            <div className="mt-3 rounded-lg border border-white/[0.08] bg-black/40 p-3 text-xs text-white/70">
              <div className="flex justify-between">
                <span>
                  Status: <span className="text-white">{classifierRun.status}</span>
                </span>
                <span>{classifierRun.progress ?? 0}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-emerald-500/80 transition-all"
                  style={{ width: `${classifierRun.progress ?? 0}%` }}
                />
              </div>
              <p className="mt-2 text-white/50">
                {classifierRun.message || "—"} · scanned {classifierRun.cases_scanned ?? 0} · found{" "}
                {classifierRun.clusters_found ?? 0} · registered {classifierRun.clusters_registered ?? 0}
              </p>
              {classifierRun.error && <p className="mt-1 text-red-300/90">{classifierRun.error}</p>}
            </div>
          )}
        </div>
      </section>
    </AdminTabPage>
  );
}
