import type { SuggestionAction, SuggestionLink, ScamMatch } from "@/components/chat/CaseSuggestionsRail";
import type { LocalForum } from "@/lib/nyaysahayakApi";

/** Embedded in chat_history.session_data so reopen restores the suggestions rail. */
export const SESSION_UI_ROLE = "session_ui" as const;

export type CaseSessionUi = {
  role: typeof SESSION_UI_ROLE;
  suggested_actions?: SuggestionAction[];
  suggested_links?: SuggestionLink[];
  lawyer_needed?: boolean;
  local_forum?: LocalForum | null;
  matched_scam_trends?: ScamMatch[];
  scam_similarity_note?: string;
  case_id?: string | null;
  pdf_url?: string | null;
  show_suggestions?: boolean;
};

export function isSessionUiRecord(row: unknown): row is CaseSessionUi {
  return Boolean(
    row &&
      typeof row === "object" &&
      (row as { role?: string }).role === SESSION_UI_ROLE
  );
}

export function actionDedupeKey(action: SuggestionAction): string {
  return [
    String(action.action || ""),
    String(action.node || ""),
    String(action.payload || ""),
    String(action.label || "").trim().toLowerCase(),
  ].join("|");
}

/** Keep every unique suggestion; never drop an earlier one when a later batch arrives.
 *  Exception: sexual-offense support chips replace finance/cyber chips that don't belong. */
export function mergeSuggestionActions(
  prev: SuggestionAction[] | null | undefined,
  next: SuggestionAction[] | null | undefined
): SuggestionAction[] {
  const incoming = next || [];
  const isSexualOffenseBatch = incoming.some((a) => {
    if (!a || typeof a !== "object") return false;
    const node = String(a.node || "").toLowerCase();
    const label = String(a.label || "").toLowerCase();
    return (
      node === "sexual_offense" ||
      label.includes("female nyayguide") ||
      label.includes("female lawyer") ||
      label.includes("urgent help")
    );
  });

  const base = isSexualOffenseBatch
    ? (prev || []).filter((a) => {
        if (!a || typeof a !== "object") return false;
        const label = String(a.label || "").toLowerCase();
        const payload = String(a.payload || "").toLowerCase();
        const action = String(a.action || "").toLowerCase();
        if (label.includes("bank") || payload === "1930") return false;
        if (action === "open_scam_heatmap") return false;
        if (action === "show_guide" && payload.includes("cyber")) return false;
        return true;
      })
    : prev || [];

  const out: SuggestionAction[] = [];
  const seen = new Set<string>();
  for (const list of [base, incoming]) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const key = actionDedupeKey(item);
      if (!key.replace(/\|/g, "") || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function mergeSuggestionLinks(
  prev: SuggestionLink[] | null | undefined,
  next: SuggestionLink[] | null | undefined
): SuggestionLink[] {
  const out: SuggestionLink[] = [];
  const seen = new Set<string>();
  for (const list of [prev || [], next || []]) {
    for (const item of list) {
      if (!item?.url) continue;
      const key = String(item.url).trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function stripSessionUi<T extends { role?: string }>(
  rows: T[] | null | undefined
): { messages: T[]; ui: CaseSessionUi | null } {
  const messages: T[] = [];
  let ui: CaseSessionUi | null = null;
  for (const row of rows || []) {
    if (isSessionUiRecord(row)) {
      ui = row;
      continue;
    }
    messages.push(row);
  }
  return { messages, ui };
}

export function withSessionUi<T extends { role?: string }>(
  messages: T[],
  ui: Omit<CaseSessionUi, "role"> | CaseSessionUi | null | undefined
): Array<T | CaseSessionUi> {
  const cleaned = stripSessionUi(messages).messages;
  if (!ui) return cleaned;
  const payload: CaseSessionUi = {
    role: SESSION_UI_ROLE,
    suggested_actions: ui.suggested_actions || [],
    suggested_links: ui.suggested_links || [],
    lawyer_needed: Boolean(ui.lawyer_needed),
    local_forum: ui.local_forum ?? null,
    matched_scam_trends: ui.matched_scam_trends || [],
    scam_similarity_note: ui.scam_similarity_note || "",
    case_id: ui.case_id ?? null,
    pdf_url: ui.pdf_url ?? null,
    show_suggestions: Boolean(
      ui.show_suggestions ||
        (ui.suggested_actions || []).length ||
        (ui.suggested_links || []).length ||
        ui.lawyer_needed ||
        ui.local_forum?.institution_name ||
        (ui.matched_scam_trends || []).length
    ),
  };
  return [...cleaned, payload];
}

export function sessionUiFromState(input: {
  suggestedActions: SuggestionAction[];
  suggestedLinks: SuggestionLink[];
  lawyerNeeded: boolean;
  localForum: LocalForum | null;
  matchedScamTrends: ScamMatch[];
  scamSimilarityNote: string;
  caseId: string | null;
  pdfUrl: string | null;
  showSuggestions: boolean;
}): CaseSessionUi {
  return {
    role: SESSION_UI_ROLE,
    suggested_actions: input.suggestedActions,
    suggested_links: input.suggestedLinks,
    lawyer_needed: input.lawyerNeeded,
    local_forum: input.localForum,
    matched_scam_trends: input.matchedScamTrends,
    scam_similarity_note: input.scamSimilarityNote,
    case_id: input.caseId,
    pdf_url: input.pdfUrl,
    show_suggestions: input.showSuggestions,
  };
}
