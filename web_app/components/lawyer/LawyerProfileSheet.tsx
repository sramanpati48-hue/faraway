"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  X, MapPin, Briefcase, Shield, Phone, Mail, Award,
  Globe, Linkedin, MessageCircle, CheckCircle, Loader2, GraduationCap, Building2
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LawyerProfile } from "@/lib/lawyerTypes";
import { LawyerChatPane } from "./LawyerChatPane";
import { connectLawyerThread } from "@/lib/lawyerChatApi";

interface Props {
  lawyer: LawyerProfile | null;
  open: boolean;
  onClose: () => void;
  accessToken?: string | null;
  currentUserId?: string | null;
  lawyerCaseId?: string | null;
  /** When opening from lawyer side of a case */
  victimUserId?: string | null;
  onConnected?: (payload: { threadId: string; lawyer: LawyerProfile }) => void;
  /** Optional: also call legacy accept flow before/after connect */
  onConnectLegacy?: (lawyer: LawyerProfile) => void | Promise<void>;
  initialMode?: "profile" | "chat";
  initialThreadId?: string | null;
  showConnect?: boolean;
}

export function LawyerProfileSheet({
  lawyer,
  open,
  onClose,
  accessToken,
  currentUserId,
  lawyerCaseId,
  victimUserId,
  onConnected,
  onConnectLegacy,
  initialMode = "profile",
  initialThreadId = null,
  showConnect = true,
}: Props) {
  const [mode, setMode] = useState<"profile" | "chat">(initialMode);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setThreadId(initialThreadId);
      setError(null);
    }
  }, [open, lawyer?.user_id, lawyer?.id, initialMode, initialThreadId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !lawyer) return null;

  const areas = lawyer.practice_areas?.length
    ? lawyer.practice_areas
    : lawyer.specialization
      ? [lawyer.specialization]
      : [];
  const extras = lawyer.profile_extras || {};
  const education = extras.education || [];
  const experience = extras.experience_history || [];
  const skills = extras.skills || [];
  const about = lawyer.about || lawyer.bio || "";

  const handleConnect = async () => {
    if (!accessToken || !currentUserId) {
      setError("Please sign in to connect with this lawyer.");
      return;
    }
    const lid = lawyer.user_id || lawyer.id;
    if (!lid) {
      setError("Lawyer profile is missing an id.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      if (onConnectLegacy) await onConnectLegacy(lawyer);
      const { thread } = await connectLawyerThread(accessToken, {
        lawyerUserId: String(lid),
        lawyerCaseId: lawyerCaseId || undefined,
        victimUserId: victimUserId || undefined,
        initialMessage: lawyerCaseId
          ? "Hello — I’d like to discuss my case with you."
          : "Hello — I’d like to connect regarding legal assistance.",
      });
      setThreadId(String(thread.id));
      setMode("chat");
      onConnected?.({ threadId: String(thread.id), lawyer });
    } catch (e: any) {
      setError(e.message || "Could not connect");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 flex w-full flex-col bg-white shadow-2xl overflow-hidden",
          "max-h-[92dvh] sm:max-h-[88vh]",
          "rounded-t-3xl sm:rounded-3xl",
          "sm:max-w-2xl sm:mx-4",
          "animate-in slide-in-from-bottom-4 sm:fade-in sm:zoom-in-95 duration-200"
        )}
      >
        {/* Cover */}
        <div className="relative h-24 sm:h-28 bg-gradient-to-r from-[#00634B] to-[#0A8F6C] flex-shrink-0">
          {lawyer.cover_image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lawyer.cover_image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 h-9 w-9 rounded-xl bg-black/30 text-white flex items-center justify-center hover:bg-black/45"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="absolute -bottom-10 left-4 sm:left-6">
            {lawyer.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lawyer.avatar}
                alt={lawyer.name}
                className="h-20 w-20 rounded-2xl border-4 border-white object-cover shadow-lg"
              />
            ) : (
              <div className="h-20 w-20 rounded-2xl border-4 border-white bg-[#E6F0ED] flex items-center justify-center text-2xl font-black text-[#00634B] shadow-lg">
                {(lawyer.name || "A").charAt(0)}
              </div>
            )}
          </div>
        </div>

        <div className="pt-12 px-4 sm:px-6 pb-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-gray-900 truncate">{lawyer.name}</h2>
                {lawyer.verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                    <Shield className="w-3 h-3" /> Verified
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
                    Verification pending
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-[#00634B] mt-0.5">
                {lawyer.headline || areas[0] || "Legal professional"}
              </p>
              {lawyer.location && (
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500">
                  <MapPin className="w-3 h-3" /> {lawyer.location}
                </p>
              )}
            </div>
            <div className="flex rounded-xl bg-[#F0F4F3] p-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => setMode("profile")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                  mode === "profile" ? "bg-white text-[#00634B] shadow-sm" : "text-gray-500"
                )}
              >
                Profile
              </button>
              <button
                type="button"
                onClick={() => threadId && setMode("chat")}
                disabled={!threadId}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                  mode === "chat" ? "bg-white text-[#00634B] shadow-sm" : "text-gray-500",
                  !threadId && "opacity-40 cursor-not-allowed"
                )}
              >
                Chat
              </button>
            </div>
          </div>
        </div>

        {mode === "profile" ? (
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5 min-h-0">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Rating" value={`${(lawyer.rating ?? 4.5).toFixed(1)}★`} />
              <Stat label="Experience" value={lawyer.experience != null ? `${lawyer.experience} yrs` : "—"} />
              <Stat
                label="Rate"
                value={lawyer.hourly_rate != null && lawyer.hourly_rate !== "" ? `₹${lawyer.hourly_rate}` : "—"}
              />
            </div>

            {about && (
              <Section title="About">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{about}</p>
              </Section>
            )}

            {areas.length > 0 && (
              <Section title="Practice areas">
                <div className="flex flex-wrap gap-1.5">
                  {areas.map((a) => (
                    <Chip key={a}>{a}</Chip>
                  ))}
                </div>
              </Section>
            )}

            {(lawyer.courts_practiced || []).length > 0 && (
              <Section title="Courts practiced">
                <div className="flex flex-wrap gap-1.5">
                  {lawyer.courts_practiced!.map((c) => (
                    <Chip key={c}>{c}</Chip>
                  ))}
                </div>
              </Section>
            )}

            {(lawyer.languages || []).length > 0 && (
              <Section title="Languages">
                <div className="flex flex-wrap gap-1.5">
                  {lawyer.languages!.map((l) => (
                    <Chip key={l}>{l}</Chip>
                  ))}
                </div>
              </Section>
            )}

            {skills.length > 0 && (
              <Section title="Skills">
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s) => (
                    <Chip key={s}>{s}</Chip>
                  ))}
                </div>
              </Section>
            )}

            {experience.length > 0 && (
              <Section title="Experience">
                <ul className="space-y-3">
                  {experience.map((ex, i) => (
                    <li key={i} className="flex gap-3">
                      <Building2 className="w-4 h-4 text-[#00634B] mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-bold text-gray-900">{ex.title || "Role"}</p>
                        <p className="text-xs text-gray-600">{ex.organization}{ex.years ? ` · ${ex.years}` : ""}</p>
                        {ex.description && <p className="text-xs text-gray-500 mt-1">{ex.description}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {education.length > 0 && (
              <Section title="Education">
                <ul className="space-y-3">
                  {education.map((ed, i) => (
                    <li key={i} className="flex gap-3">
                      <GraduationCap className="w-4 h-4 text-[#00634B] mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-bold text-gray-900">{ed.institution || "Institution"}</p>
                        <p className="text-xs text-gray-600">{ed.degree}{ed.year ? ` · ${ed.year}` : ""}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Details">
              <div className="space-y-2.5 text-sm">
                {lawyer.lawyer_type && (
                  <DetailRow icon={Briefcase} label="Engagement" value={lawyer.lawyer_type} />
                )}
                {lawyer.bar_registration_number && (
                  <DetailRow icon={Award} label="Bar registration" value={lawyer.bar_registration_number} />
                )}
                {lawyer.availability_hours && (
                  <DetailRow icon={Briefcase} label="Availability" value={lawyer.availability_hours} />
                )}
                {(lawyer.consultation_modes || []).length > 0 && (
                  <DetailRow
                    icon={MessageCircle}
                    label="Consultation"
                    value={lawyer.consultation_modes!.join(", ")}
                  />
                )}
                {lawyer.email && <DetailRow icon={Mail} label="Email" value={lawyer.email} />}
                {lawyer.contact_number && <DetailRow icon={Phone} label="Phone" value={lawyer.contact_number} />}
                {lawyer.website_url && <DetailRow icon={Globe} label="Website" value={lawyer.website_url} />}
                {lawyer.linkedin_url && <DetailRow icon={Linkedin} label="LinkedIn" value={lawyer.linkedin_url} />}
              </div>
            </Section>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
            )}
          </div>
        ) : threadId && accessToken && currentUserId ? (
          <LawyerChatPane
            threadId={threadId}
            accessToken={accessToken}
            currentUserId={currentUserId}
            peerLabel={lawyer.name.split(" ")[0]}
            className="flex-1 min-h-[280px]"
          />
        ) : null}

        {mode === "profile" && showConnect && (
          <div className="flex-shrink-0 border-t border-gray-100 p-4 sm:p-5 bg-[#F8F9FA] flex flex-col gap-2">
            {!accessToken && (
              <p className="text-xs text-gray-500 text-center sm:text-left">
                Sign in as a client to connect with this lawyer.{" "}
                <Link href="/login?next=/find-help" className="font-bold text-[#00634B] hover:underline">
                  Log in
                </Link>
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              {threadId && accessToken && currentUserId ? (
                <button
                  type="button"
                  onClick={() => setMode("chat")}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold py-3 text-sm transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  Open chat
                </button>
              ) : !accessToken ? (
                <Link
                  href="/login?next=/find-help"
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold py-3 text-sm transition-colors"
                >
                  Log in to connect
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={connecting}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold py-3 text-sm transition-colors disabled:opacity-60"
                >
                  {connecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  Connect & chat
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="sm:w-auto px-5 rounded-2xl border border-gray-200 bg-white text-gray-700 font-bold py-3 text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-black uppercase tracking-wider text-gray-400 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[#E6F0ED] px-2.5 py-1 text-[11px] font-semibold text-[#00634B]">
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-[#F8F9FA] p-3 text-center">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-sm font-black text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
        <p className="text-sm font-semibold text-gray-800 break-words">{value}</p>
      </div>
    </div>
  );
}
