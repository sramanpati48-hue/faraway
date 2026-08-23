"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { adminBtnDanger, adminBtnSecondary, adminInput } from "@/components/admin/admin-ui";
import type { PolicyDocument } from "@/lib/adminApi";

const RISK_STYLES: Record<string, string> = {
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  high: "border-red-500/30 bg-red-500/10 text-red-300",
};

export function PolicyImplementDialog({
  policy,
  busy,
  onClose,
  onConfirm,
}: {
  policy: PolicyDocument;
  busy: boolean;
  onClose: () => void;
  onConfirm: (confirm: string) => void;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const changeSet = policy.change_set || {};
  const changes = changeSet.config_changes || [];
  const followups = changeSet.manual_followups || [];
  const risk = String(changeSet.risk || policy.risk || "medium");

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="admin-scrollbar max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[22px] border border-white/[0.1] bg-[#0b0b0b] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.7)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                RISK_STYLES[risk] || RISK_STYLES.medium
              }`}
            >
              <AlertTriangle className="h-3 w-3" />
              {risk} risk
            </span>
            <h2 className="mt-2 text-lg font-semibold text-white">Implement this policy</h2>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              Config values are written immediately and the policy text starts steering live agents.
              Manual follow-ups are never applied automatically.
            </p>
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-lg p-1.5 text-white/40 transition hover:bg-white/[0.06] hover:text-white"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="mt-5">
          <h3 className="text-xs font-medium uppercase tracking-wider text-white/40">
            Configuration changes ({changes.length})
          </h3>
          {changes.length === 0 ? (
            <p className="mt-2 text-xs text-white/40">
              No automatic configuration changes — this activates policy text only.
            </p>
          ) : (
            <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08]">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/[0.03]">
                  <tr>
                    <th className="px-3 py-2 font-medium text-white/45">Target</th>
                    <th className="px-3 py-2 font-medium text-white/45">From</th>
                    <th className="px-3 py-2 font-medium text-white/45">To</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((change, i) => (
                    <tr key={i} className="border-t border-white/[0.05]">
                      <td className="px-3 py-2 font-mono text-[11px] text-white/70">
                        {change.key}.{change.path}
                        {change.reason ? (
                          <span className="mt-1 block font-sans text-[11px] text-white/35">
                            {change.reason}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-red-300/80">
                        {formatValue(change.from)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-emerald-300/90">
                        {formatValue(change.to)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {policy.policy_text ? (
          <section className="mt-5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-white/40">
              Policy text injected into agents
            </h3>
            <pre className="admin-scrollbar mt-2 max-h-40 overflow-auto rounded-xl border border-white/[0.08] bg-black/40 p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-white/65">
              {policy.policy_text}
            </pre>
            <p className="mt-1.5 text-[11px] text-white/35">
              Scope: {(policy.agent_scope || []).join(", ") || "all listed agents"}
            </p>
          </section>
        ) : null}

        {followups.length > 0 ? (
          <section className="mt-5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-white/40">
              Manual follow-ups ({followups.length}) — not applied
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {followups.map((item, i) => (
                <li key={i} className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3">
                  <p className="text-xs font-medium text-amber-200">{item.title}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/55">{item.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-6">
          <label htmlFor="policy-confirm" className="mb-1.5 block text-xs text-white/60">
            Type <span className="font-mono text-white/90">IMPLEMENT</span> to confirm
          </label>
          <input
            id="policy-confirm"
            className={adminInput}
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
            placeholder="IMPLEMENT"
          />
        </section>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={adminBtnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={adminBtnDanger}
            disabled={busy || typed.trim().toUpperCase() !== "IMPLEMENT"}
            onClick={() => onConfirm(typed.trim().toUpperCase())}
          >
            {busy ? "Applying…" : "Implement policy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
