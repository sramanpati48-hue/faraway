import type { SuggestionAction } from "@/components/chat/CaseSuggestionsRail";

/** Server-approved workflow states that may render an enabled NyayGuide action. */
export const NYAYGUIDE_PERMITTING_STATES = new Set<string>([
  "ELIGIBLE",
  "MODERATOR_APPROVED",
]);

export function isNyayguideSuggestion(action: SuggestionAction): boolean {
  const kind = String(action.kind || action.action || "");
  const id = String(action.id || "");
  return kind === "nyayguide_suggestion" || id.startsWith("nyayguide_suggestion");
}

/**
 * Version guard for intervention_resolved events. Versions are ISO timestamps
 * (or any comparable string); an event older than or equal to the locally
 * applied snapshot must not overwrite newer state.
 */
export function isNewerResolutionVersion(
  incoming?: string | null,
  stored?: string | null
): boolean {
  if (!incoming) return false;
  if (!stored) return true;
  if (incoming === stored) return false;
  const incomingTime = Date.parse(incoming);
  const storedTime = Date.parse(stored);
  if (!Number.isNaN(incomingTime) && !Number.isNaN(storedTime)) {
    return incomingTime > storedTime;
  }
  return incoming > stored;
}

/**
 * Server-authoritative action merge for a resolution snapshot: stale
 * nyayguide_suggestion actions are replaced by the fresh typed action;
 * unrelated actions are preserved.
 */
export function applyResolutionActions(
  prev: SuggestionAction[] | null | undefined,
  incoming?: SuggestionAction[] | null
): SuggestionAction[] {
  const base = (prev || []).filter((a) => !isNyayguideSuggestion(a));
  const additions = (incoming || []).filter((a) => a && typeof a === "object");
  const out = [...base];
  const seen = new Set(
    out.map((a) =>
      [
        String(a.action || ""),
        String(a.node || ""),
        String(a.payload || ""),
        String(a.label || "").trim().toLowerCase(),
      ].join("|")
    )
  );
  for (const item of additions) {
    const key = [
      String(item.action || ""),
      String(item.node || ""),
      String(item.payload || ""),
      String(item.label || "").trim().toLowerCase(),
    ].join("|");
    if (!key.replace(/\|/g, "") || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
