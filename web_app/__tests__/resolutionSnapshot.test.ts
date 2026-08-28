import { describe, expect, it } from "vitest";
import {
  NYAYGUIDE_PERMITTING_STATES,
  applyResolutionActions,
  isNewerResolutionVersion,
  isNyayguideSuggestion,
} from "@/lib/chat/resolutionSnapshot";

const typedAction = {
  id: "nyayguide_suggestion:case-1",
  kind: "nyayguide_suggestion",
  label: "Review NyayGuide request",
  enabled: true,
  workflow_state: "MODERATOR_APPROVED",
  requires_user_confirmation: true,
};

describe("NYAYGUIDE_PERMITTING_STATES", () => {
  it("matches the server-side permitting contract", () => {
    expect(NYAYGUIDE_PERMITTING_STATES.has("ELIGIBLE")).toBe(true);
    expect(NYAYGUIDE_PERMITTING_STATES.has("MODERATOR_APPROVED")).toBe(true);
    expect(NYAYGUIDE_PERMITTING_STATES.has("HIGH_RISK_HUMAN_REVIEW")).toBe(false);
    expect(NYAYGUIDE_PERMITTING_STATES.has("EMERGENCY_ESCALATION")).toBe(false);
    expect(NYAYGUIDE_PERMITTING_STATES.has("UNABLE_TO_VERIFY")).toBe(false);
    expect(NYAYGUIDE_PERMITTING_STATES.has("NEEDS_CLARIFICATION")).toBe(false);
    expect(NYAYGUIDE_PERMITTING_STATES.has("")).toBe(false);
  });
});

describe("isNewerResolutionVersion", () => {
  it("accepts the first event", () => {
    expect(isNewerResolutionVersion("2026-01-01T00:00:00Z", null)).toBe(true);
  });

  it("rejects events older than or equal to the stored version", () => {
    const stored = "2026-01-02T00:00:00Z";
    expect(isNewerResolutionVersion("2026-01-01T00:00:00Z", stored)).toBe(false);
    expect(isNewerResolutionVersion(stored, stored)).toBe(false);
  });

  it("accepts strictly newer events", () => {
    expect(isNewerResolutionVersion("2026-01-03T00:00:00Z", "2026-01-02T00:00:00Z")).toBe(true);
  });

  it("ignores legacy events without a version", () => {
    expect(isNewerResolutionVersion(null, "2026-01-02T00:00:00Z")).toBe(false);
  });
});

describe("applyResolutionActions", () => {
  it("replaces stale nyayguide suggestions with the fresh typed action", () => {
    const stale = { ...typedAction, label: "Connect to Nyay Guide", enabled: false };
    const prev = [
      { label: "Recommend a lawyer", node: "lawyer_forwarder", payload: "lawyer" },
      stale,
    ];
    const out = applyResolutionActions(prev as any, [typedAction as any]);
    const nyay = out.filter(isNyayguideSuggestion);
    expect(nyay).toHaveLength(1);
    expect(nyay[0].label).toBe("Review NyayGuide request");
    expect(out.some((a) => a.label === "Recommend a lawyer")).toBe(true);
  });

  it("keeps unrelated actions when the snapshot has no nyayguide action", () => {
    const prev = [{ label: "Recommend a lawyer", payload: "lawyer" }];
    const out = applyResolutionActions(prev as any, []);
    expect(out).toHaveLength(1);
  });

  it("does not duplicate identical actions across repeated snapshots", () => {
    const once = applyResolutionActions([], [typedAction as any]);
    const twice = applyResolutionActions(once, [typedAction as any]);
    expect(twice.filter(isNyayguideSuggestion)).toHaveLength(1);
  });
});
