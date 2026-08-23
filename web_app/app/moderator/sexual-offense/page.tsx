"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Phone, ShieldAlert, XCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { ModeratorShell } from "@/components/moderator/ModeratorShell";
import {
  fetchSoCallConfirmations,
  markSoConfirmationCall,
  type FemaleNyayGuideOption,
  type SoCallConfirmation,
} from "@/lib/moderatorApi";

function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function telHref(phone?: string | null) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

function guideId(g: FemaleNyayGuideOption) {
  return String(g.id || g.uid || "");
}

export default function SexualOffenseConfirmationPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [rows, setRows] = useState<SoCallConfirmation[]>([]);
  const [guides, setGuides] = useState<FemaleNyayGuideOption[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guideChoice, setGuideChoice] = useState<Record<string, string>>({});

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (loading || !mounted) return;
    if (!user) router.push("/login");
  }, [user, loading, mounted, router]);

  const load = useCallback(async () => {
    const data = await fetchSoCallConfirmations("pending_call");
    setRows(data.cases);
    setGuides(data.guides);
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setError(e.message || "Could not load queue"));
  }, [user, load]);

  const defaultGuide = useMemo(() => guideId(guides[0] || {}), [guides]);

  const onCallResult = async (row: SoCallConfirmation, callDone: boolean) => {
    setBusyId(row.id);
    setError(null);
    try {
      const selectedId = guideChoice[row.id] || defaultGuide;
      const selected = guides.find((g) => guideId(g) === selectedId) || guides[0];
      await markSoConfirmationCall(row.id, {
        call_done: callDone,
        nyayguide_id: selected ? guideId(selected) : undefined,
        nyayguide_name: selected?.name,
      });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  if (!mounted || loading || !user) {
    return <ModeratorShell loading />;
  }

  return (
    <ModeratorShell>
      <div className="max-w-4xl space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00634B]/10 text-[#00634B]">
            <ShieldAlert size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">
              Sexual offence confirmation
            </h1>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl leading-relaxed">
              Place one unpaid confirmation call. After it is done, the case and report
              are assigned to a female Nyay Guide — the same Help Queue canvas they already use.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 font-semibold">
            {error}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
            <Phone className="w-9 h-9 text-gray-300 mx-auto mb-3" />
            <p className="font-bold text-gray-800">No pending confirmation calls</p>
            <p className="text-sm text-gray-500 mt-1">New consented cases will appear here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => {
              const href = telHref(row.victim_phone);
              const busy = busyId === row.id;
              return (
                <article
                  key={row.id}
                  className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Survivor
                      </p>
                      <p className="text-lg font-black text-gray-900">{row.victim_name || "Survivor"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Time of filing
                      </p>
                      <p className="text-sm font-bold text-gray-800">{formatWhen(row.created_at)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {href ? (
                      <a
                        href={href}
                        className="inline-flex items-center gap-2 rounded-full bg-[#00634B] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#004D3C]"
                      >
                        <Phone size={15} />
                        Call {row.victim_phone}
                      </a>
                    ) : (
                      <span className="text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-3 py-1.5">
                        No phone on file
                      </span>
                    )}
                    <span className="text-xs font-black uppercase tracking-widest text-amber-600">
                      Pending confirmation call
                    </span>
                  </div>

                  {guides.length > 0 && (
                    <label className="block text-sm text-gray-600">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                        Female Nyay Guide
                      </span>
                      <select
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800"
                        value={guideChoice[row.id] || defaultGuide}
                        onChange={(e) =>
                          setGuideChoice((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                      >
                        {guides.map((g) => (
                          <option key={guideId(g)} value={guideId(g)}>
                            {g.name || "Female Nyay Guide"}
                            {g.city ? ` · ${g.city}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onCallResult(row, true)}
                      className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 hover:bg-emerald-700"
                    >
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                      Call done — assign
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onCallResult(row, false)}
                      className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-50 hover:bg-gray-50"
                    >
                      <XCircle size={15} />
                      Call not done
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </ModeratorShell>
  );
}
