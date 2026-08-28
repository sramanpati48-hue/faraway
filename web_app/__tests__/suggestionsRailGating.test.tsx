import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CaseSuggestionsRail } from "@/components/chat/CaseSuggestionsRail";

function renderRail(overrides: Partial<Parameters<typeof CaseSuggestionsRail>[0]> = {}) {
  const props: Parameters<typeof CaseSuggestionsRail>[0] = {
    open: true,
    onClose: vi.fn(),
    actions: [],
    links: [],
    onAction: vi.fn(),
    onOpenVoiceModerator: vi.fn(),
    aiVerificationStatus: "pending",
    ...overrides,
  };
  return render(<CaseSuggestionsRail {...props} />);
}

const nyayAction = { label: "Book NyaySahayak", action: "book_nyaysahayak" };
const enabledSuggestion = {
  id: "nyayguide_suggestion:case-1",
  kind: "nyayguide_suggestion",
  label: "Connect to Nyay Guide",
  enabled: true,
  workflow_state: "ELIGIBLE",
  requires_user_confirmation: true,
};

describe("CaseSuggestionsRail NyayGuide gating", () => {
  beforeEach(() => cleanup());

  it("human-review state shows only Priority Human Review Required and no NyayGuide action", () => {
    renderRail({
      aiVerificationStatus: "flagged",
      actions: [nyayAction as any, { ...enabledSuggestion }],
    });

    expect(screen.getByText(/Priority Human Review Required/i)).toBeInTheDocument();
    expect(screen.getByText(/Connect to Human Reviewer/i)).toBeInTheDocument();
    expect(screen.queryByText(/Connect to Nyay Guide/i)).not.toBeInTheDocument();
  });

  it("hides disabled nyayguide_suggestion actions for pending cases", () => {
    renderRail({
      aiVerificationStatus: "pending",
      actions: [
        nyayAction as any,
        { ...enabledSuggestion, enabled: false, blocked_reason: "VERIFICATION_INCOMPLETE" },
      ],
    });

    expect(screen.queryByText(/Connect to Nyay Guide/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Clarify with Voice Moderator/i)).toBeInTheDocument();
  });

  it.each([
    ["unknown state", "SOMETHING_ELSE"],
    ["malformed state", "not-a-real-state!!!"],
  ])("hides typed suggestion with %s", (_name, workflowState) => {
    renderRail({
      aiVerificationStatus: "verified",
      actions: [{ ...enabledSuggestion, workflow_state: workflowState }],
    });

    expect(screen.queryByText(/Connect to Nyay Guide/i)).not.toBeInTheDocument();
  });

  it("hides typed suggestion when workflow_state is missing", () => {
    renderRail({
      aiVerificationStatus: "verified",
      actions: [{ ...enabledSuggestion, workflow_state: undefined }],
    });

    expect(screen.queryByText(/Connect to Nyay Guide/i)).not.toBeInTheDocument();
  });

  it("keeps enabled typed suggestion clickable for verified cases", () => {
    const onAction = vi.fn();
    const { container } = renderRail({
      aiVerificationStatus: "verified",
      actions: [{ ...enabledSuggestion }],
      onAction,
    });

    const button = screen.getByText(/Connect to Nyay Guide/i);
    button.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    void container;
  });

  it("renders the typed suggestion for MODERATOR_APPROVED with verified-for-next-step status", () => {
    renderRail({
      aiVerificationStatus: "verified_for_next_step",
      actions: [
        {
          ...enabledSuggestion,
          label: "Review NyayGuide request",
          workflow_state: "MODERATOR_APPROVED",
        },
      ],
    });

    expect(screen.getByText(/Review NyayGuide request/i)).toBeInTheDocument();
  });

  it("hides the typed suggestion for MODERATOR_APPROVED when verification is still flagged", () => {
    renderRail({
      aiVerificationStatus: "flagged",
      actions: [{ ...enabledSuggestion, workflow_state: "MODERATOR_APPROVED" }],
    });

    expect(screen.queryByText(/Connect to Nyay Guide/i)).not.toBeInTheDocument();
  });

  it.each(["EMERGENCY_ESCALATION", "UNABLE_TO_VERIFY", "NEEDS_CLARIFICATION", "HIGH_RISK_HUMAN_REVIEW"])(
    "hides the typed suggestion in %s",
    (workflowState) => {
      renderRail({
        aiVerificationStatus: "verified_for_next_step",
        actions: [{ ...enabledSuggestion, workflow_state: workflowState }],
      });

      expect(screen.queryByText(/Connect to Nyay Guide/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Review NyayGuide request/i)).not.toBeInTheDocument();
    }
  );
});
