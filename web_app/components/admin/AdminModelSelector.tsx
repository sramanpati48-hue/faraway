"use client";

import { AdminFieldLabel, AdminHoverHint, adminSelect } from "@/components/admin/admin-ui";
import type { AdminModelsSnapshot } from "@/lib/adminApi";

const PROVIDER_KEY_HINTS: Record<string, string> = {
  groq: "Set GROQ_API_KEY in the server .env for Groq models.",
  gemini: "Set GEMINI_API_KEY (or GOOGLE_API_KEY) in the server .env for Gemini models.",
  openrouter: "Set OPEN_ROUTER_API_KEY in the server .env for OpenRouter models.",
  selfhost:
    "Set SELFHOST_LLM_BASE_URL and SELFHOST_LLM_API_KEY for the Cloud Run Qwen service. Cold starts can take several minutes.",
  vertex:
    "Set VERTEX_API_KEY in the server .env for Gemini Enterprise (google.genai Client enterprise=True).",
};

/** Always merge known providers so UI stays current if the API snapshot is stale. */
const KNOWN_TEXT_PROVIDERS = ["groq", "gemini", "openrouter", "selfhost", "vertex"] as const;

const PROVIDER_FIELD_HINT =
  "Which LLM backend runs this task. Changing provider resets the model to that provider’s default.";

function modelFieldHint(provider: string, configured: boolean, providerHint: string): string {
  const keyStatus = configured
    ? "API key is configured for this provider."
    : "API key missing — requests will fail until the server .env is set.";
  return `Model used when this task runs via ${provider}. ${keyStatus} ${providerHint}`;
}

export function modelsForProvider(
  catalog: AdminModelsSnapshot["catalog"],
  provider: string
): string[] {
  if (provider === "gemini") return catalog.gemini_text_models || [];
  if (provider === "openrouter") return catalog.openrouter_text_models || [];
  if (provider === "selfhost") return catalog.selfhost_text_models || ["Qwen2.5-3B-Instruct"];
  if (provider === "vertex") {
    return (
      catalog.vertex_text_models || [
        "gemini-3.5-flash",
        "gemini-2.5-flash",
      ]
    );
  }
  return catalog.groq_text_models || [];
}

function providersForCatalog(catalog: AdminModelsSnapshot["catalog"]): string[] {
  const fromApi = Array.isArray(catalog.text_providers) ? catalog.text_providers : [];
  const merged = [...fromApi];
  for (const p of KNOWN_TEXT_PROVIDERS) {
    if (!merged.includes(p)) merged.push(p);
  }
  return merged;
}

export function defaultForProvider(
  env: AdminModelsSnapshot["env"],
  provider: string
): string {
  if (provider === "gemini") return env.default_gemini_model;
  if (provider === "openrouter") return env.default_openrouter_model;
  if (provider === "selfhost") return env.default_selfhost_model || "Qwen2.5-3B-Instruct";
  if (provider === "vertex") return env.default_vertex_model || "gemini-3.5-flash";
  return env.default_groq_model || "llama-3.3-70b-versatile";
}

export function AdminModelSelector({
  label,
  provider,
  model,
  catalog,
  env,
  onChange,
  compact = false,
}: {
  label: string;
  provider: string;
  model: string;
  catalog: AdminModelsSnapshot["catalog"];
  env: AdminModelsSnapshot["env"];
  onChange: (provider: string, model: string) => void;
  compact?: boolean;
}) {
  const modelList = modelsForProvider(catalog, provider);
  const providerList = providersForCatalog(catalog);
  const safeModel = modelList.includes(model) ? model : defaultForProvider(env, provider);
  const providerHint =
    catalog.provider_api_key_hints?.[provider] ||
    env.provider_api_key_hints?.[provider] ||
    PROVIDER_KEY_HINTS[provider] ||
    "Set the API key for this provider in the server .env.";
  const configured =
    provider === "gemini"
      ? env.gemini_configured
      : provider === "openrouter"
        ? env.openrouter_configured
        : provider === "selfhost"
          ? Boolean(env.selfhost_configured)
          : provider === "vertex"
            ? Boolean(env.vertex_configured)
            : Boolean(env.groq_configured);

  if (compact) {
    const compactSelect =
      "h-8 rounded-lg border border-white/[0.12] bg-[#141414] px-2 text-xs leading-8 text-white outline-none focus:border-emerald-500/50";
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-white/50">
          {label}
        </span>
        <AdminHoverHint hint={providerHint} />
        <select
          className={`${compactSelect} w-[8.5rem] shrink-0`}
          value={provider}
          aria-label="Provider"
          onChange={(e) => {
            const nextProvider = e.target.value;
            onChange(nextProvider, defaultForProvider(env, nextProvider));
          }}
        >
          {providerList.map((item) => (
            <option key={item} value={item} className="bg-[#141414] text-white">
              {item}
            </option>
          ))}
        </select>
        <select
          className={`${compactSelect} min-w-0 max-w-[16rem] flex-1`}
          value={safeModel}
          aria-label="Model"
          onChange={(e) => onChange(provider, e.target.value)}
        >
          {modelList.map((item) => (
            <option key={item} value={item} className="bg-[#141414] text-white">
              {item}
            </option>
          ))}
        </select>
        <span
          className={
            configured
              ? "group/hint relative shrink-0 text-[10px] text-emerald-400/80"
              : "group/hint relative shrink-0 text-[10px] text-amber-300/80"
          }
        >
          {configured ? "ok" : "!"}
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 w-44 -translate-x-1/2 rounded-lg border border-white/15 bg-[#141414] px-2.5 py-2 text-left text-[11px] leading-snug font-normal text-white/80 opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.55)] transition-opacity duration-150 group-hover/hint:opacity-100"
          >
            {configured
              ? "API key configured for this provider."
              : "API key missing — set it in the server .env."}
          </span>
        </span>
      </div>
    );
  }

  const modelHint = modelFieldHint(provider, configured, providerHint);

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/45">{label}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <AdminFieldLabel
          label="Provider"
          hint={`${PROVIDER_FIELD_HINT} ${providerHint}`}
        >
          <select
            className={`${adminSelect} mt-1 w-full text-xs`}
            value={provider}
            onChange={(e) => {
              const nextProvider = e.target.value;
              onChange(nextProvider, defaultForProvider(env, nextProvider));
            }}
          >
            {providerList.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </AdminFieldLabel>
        <AdminFieldLabel label="Model" hint={modelHint}>
          <select
            className={`${adminSelect} mt-1 w-full text-xs`}
            value={safeModel}
            onChange={(e) => onChange(provider, e.target.value)}
          >
            {modelList.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </AdminFieldLabel>
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-white/50">
        Active: {provider} · {safeModel}
        <span className={configured ? " text-emerald-400/80" : " text-amber-300/80"}>
          {configured ? " · key ok" : " · key missing"}
        </span>
      </p>
    </div>
  );
}
