"use client";

import { ExternalLink, Landmark, Scale, Sparkles, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LocalForum } from "@/lib/nyaysahayakApi";

export type SuggestionAction = {
  label: string;
  node?: string;
  action?: string;
  payload?: string;
};

export type SuggestionLink = {
  label: string;
  url: string;
};

export type ScamMatch = {
  id?: string;
  title?: string;
  city?: string;
  similarity?: number;
  description?: string;
  lat?: number;
  lon?: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  actions: SuggestionAction[];
  links: SuggestionLink[];
  lawyerNeeded?: boolean;
  lawyerCategory?: string | null;
  lawyerNeedReason?: string | null;
  localForum?: LocalForum | null;
  scamMatches?: ScamMatch[];
  scamSimilarityNote?: string;
  isAdmin?: boolean;
  aiVerificationStatus?: string | null;
  aiVerificationReason?: string | null;
  onAction: (action: SuggestionAction) => void;
  onOpenLawyers?: () => void;
  onOpenVoiceModerator?: () => void;
  /** Desktop side rail vs mobile floating sheet */
  presentation?: "rail" | "modal";
};

function SuggestionsBody({
  actions,
  links,
  lawyerNeeded,
  lawyerCategory,
  lawyerNeedReason,
  localForum,
  scamMatches,
  scamSimilarityNote,
  isAdmin,
  aiVerificationStatus,
  aiVerificationReason,
  onAction,
  onOpenLawyers,
  onOpenVoiceModerator,
}: Omit<Props, "open" | "onClose" | "presentation">) {
  const nodalAction = actions.find((a) => a.action === "open_nodal_guide");
  const nyayAction = actions.find((a) => a.action === "book_nyaysahayak");
  const heatmapAction = actions.find((a) => a.action === "open_scam_heatmap");
  const otherActions = actions.filter(
    (a) =>
      a.action !== "open_nodal_guide" &&
      a.action !== "book_nyaysahayak" &&
      a.action !== "open_scam_heatmap" &&
      a.action !== "browse_lawyers" &&
      a.action !== "show_lawyers"
  );

  const verificationStatus = (aiVerificationStatus || "pending").toLowerCase();
  const isVerified = verificationStatus === "verified";
  const isPending = verificationStatus === "pending";
  const isFlagged = verificationStatus === "flagged";
  const isRejected = verificationStatus === "rejected";

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
      {(scamMatches?.length || heatmapAction) && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 dark:border-rose-900/40 dark:bg-rose-950/30">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-800 dark:text-rose-200">
            <TriangleAlert className="size-3.5" /> Area scam similarity
          </p>
          {scamSimilarityNote && (
            <p className="mt-1 text-xs text-rose-900/90 dark:text-rose-100/80">{scamSimilarityNote}</p>
          )}
          {!!scamMatches?.length && (
            <ul className="mt-2 space-y-1.5">
              {scamMatches.slice(0, 4).map((match, idx) => (
                <li key={match.id || `${match.title}-${idx}`} className="text-xs text-rose-900 dark:text-rose-100">
                  <span className="font-medium">{match.title || "Scam alert"}</span>
                  {match.city ? ` · ${match.city}` : ""}
                  {typeof match.similarity === "number" ? ` · ${Math.round(match.similarity * 100)}%` : ""}
                </li>
              ))}
            </ul>
          )}
          {heatmapAction && (
            <button
              type="button"
              onClick={() => onAction(heatmapAction)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#00634B]"
            >
              Open scam heatmap
            </button>
          )}
        </section>
      )}

      {localForum?.institution_name && (
        <section>
          <button
            type="button"
            onClick={() => {
              if (nodalAction) onAction(nodalAction);
              else onAction({ label: "View local forum", action: "open_nodal_guide", payload: "open_nodal_guide" });
            }}
            className="w-full rounded-xl border border-[#00634B]/20 bg-[#00634B]/5 px-3 py-3 text-left transition-colors hover:bg-[#00634B]/10"
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[#00634B]">
              <Landmark className="size-3.5" /> Local forum near you
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
              {localForum.institution_name}
            </p>
            {localForum.regional_name && (
              <p className="text-xs text-[#00634B]/80">{localForum.regional_name}</p>
            )}
            {localForum.note && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{localForum.note}</p>
            )}
            <p className="mt-2 text-xs font-semibold text-[#00634B]">
              Tap to view forum &amp; nodal guide →
            </p>
          </button>
        </section>
      )}

      {nyayAction && (
        <section className={cn(
          "rounded-xl border px-3 py-3",
          isVerified
            ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/30"
            : isFlagged
            ? "border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/30"
            : isRejected
            ? "border-slate-200 bg-slate-50 opacity-75 dark:border-slate-800 dark:bg-slate-900/30"
            : "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30"
        )}>
          <div className="flex items-center justify-between">
            <p className={cn(
              "text-xs font-semibold",
              isVerified
                ? "text-emerald-900 dark:text-emerald-200"
                : isFlagged
                ? "text-rose-900 dark:text-rose-200"
                : isRejected
                ? "text-slate-700 dark:text-slate-300"
                : "text-amber-900 dark:text-amber-200"
            )}>
              {isVerified
                ? `On-ground NyaySahayak · ${isAdmin ? "Free (Admin Bypass)" : "₹49"}`
                : isFlagged
                ? "Priority Human Review Required"
                : isRejected
                ? "Booking Unavailable"
                : "AI Verification in Progress"}
            </p>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              isVerified
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
                : isFlagged
                ? "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200"
                : isRejected
                ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
            )}>
              {verificationStatus}
            </span>
          </div>

          <p className={cn(
            "mt-1 text-xs leading-relaxed",
            isVerified
              ? "text-emerald-800/90 dark:text-emerald-200/80"
              : isFlagged
              ? "text-rose-800/90 dark:text-rose-200/80"
              : isRejected
              ? "text-slate-600 dark:text-slate-400"
              : "text-amber-800/90 dark:text-amber-200/80"
          )}>
            {isVerified
              ? "Case verified — book NyaySahayak for ₹49"
              : isFlagged
              ? "Your case needs priority human review. We will guide you to the next safe step."
              : isRejected
              ? "Booking is unavailable because this case could not be verified."
              : "Verifying your case with AI Moderator... Booking unlocks after AI verification."}
          </p>

          {isVerified && (
            <button
              type="button"
              onClick={() => onAction(nyayAction)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#00634B] hover:underline"
            >
              {isAdmin ? "Book NyaySahayak (Free / Admin Bypass)" : "Book NyaySahayak (₹49)"}
            </button>
          )}

          {isPending && onOpenVoiceModerator && (
            <button
              type="button"
              onClick={onOpenVoiceModerator}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:underline"
            >
              Clarify with Voice Moderator →
            </button>
          )}

          {isFlagged && (
            <button
              type="button"
              onClick={() => {
                if (nodalAction) onAction(nodalAction);
                else onAction({ label: "Connect with Human Reviewer", action: "open_nodal_guide", payload: "open_nodal_guide" });
              }}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-rose-900 dark:text-rose-200 hover:underline"
            >
              Connect to Human Reviewer →
            </button>
          )}
        </section>
      )}


      {otherActions.length > 0 && (
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Actions</p>
          <div className="flex flex-col gap-2">
            {otherActions.map((action, idx) => (
              <button
                key={`${action.label}-${idx}`}
                type="button"
                onClick={() => {
                  if (action.label === "Connect to Nyay Guide" && isPending && onOpenVoiceModerator) {
                    onOpenVoiceModerator();
                  } else {
                    onAction(action);
                  }
                }}
                className="rounded-xl border border-[#00634B]/20 bg-[#00634B]/5 px-3 py-2.5 text-left text-sm font-medium text-[#00634B] hover:bg-[#00634B]/10"
              >
                {action.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {lawyerNeeded && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 dark:border-amber-900/40 dark:bg-amber-950/30">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
            <Scale className="size-3.5" /> Legal assistance
          </p>
          {lawyerCategory && (
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800/80 dark:text-amber-200/70">
              {lawyerCategory}
            </p>
          )}
          <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/80">
            {lawyerNeedReason ||
              "A lawyer in this category may help. Browse matched advocates to see fees, then connect to forward your case report."}
          </p>
          {onOpenLawyers && (
            <button
              type="button"
              onClick={onOpenLawyers}
              className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#00634B] px-3 py-2 text-xs font-semibold text-white hover:bg-[#014D3C]"
            >
              <Sparkles className="size-3.5" />
              Browse {lawyerCategory ? `${lawyerCategory.replace(" & ", "/")} ` : ""}lawyers
            </button>
          )}
        </section>
      )}

      {links.length > 0 && (
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Official links</p>
          <ul className="space-y-1.5">
            {links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-[#00634B] underline-offset-2 hover:underline"
                  )}
                >
                  <span className="truncate">{link.label}</span>
                  <ExternalLink className="size-3.5 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function CaseSuggestionsRail({
  open,
  onClose,
  actions,
  links,
  lawyerNeeded,
  lawyerCategory,
  lawyerNeedReason,
  localForum,
  scamMatches,
  scamSimilarityNote,
  isAdmin,
  aiVerificationStatus,
  aiVerificationReason,
  onAction,
  onOpenLawyers,
  onOpenVoiceModerator,
  presentation = "rail",
}: Props) {
  if (!open) return null;

  const header = (
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#00634B]/70">Next steps</p>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Suggestions</h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
        aria-label="Close suggestions"
      >
        <X className="size-4" />
      </button>
    </div>
  );
  const body = (
    <SuggestionsBody
      actions={actions}
      links={links}
      lawyerNeeded={lawyerNeeded}
      lawyerCategory={lawyerCategory}
      lawyerNeedReason={lawyerNeedReason}
      localForum={localForum}
      scamMatches={scamMatches}
      scamSimilarityNote={scamSimilarityNote}
      isAdmin={isAdmin}
      aiVerificationStatus={aiVerificationStatus}
      aiVerificationReason={aiVerificationReason}
      onAction={onAction}
      onOpenLawyers={onOpenLawyers}
      onOpenVoiceModerator={onOpenVoiceModerator}
    />
  );

  if (presentation === "modal") {
    return (
      <div className="fixed inset-0 z-[60] flex items-end justify-center p-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:hidden">
        <button
          type="button"
          aria-label="Dismiss suggestions"
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Suggestions"
          className="relative z-10 flex max-h-[min(70vh,32rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.45)] dark:border-slate-700 dark:bg-slate-900"
        >
          {header}
          {body}
        </div>
      </div>
    );
  }

  return (
    <aside className="hidden h-full w-[min(360px,100%)] flex-shrink-0 flex-col overflow-hidden border-l border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-900 md:flex">
      {header}
      {body}
    </aside>
  );
}
