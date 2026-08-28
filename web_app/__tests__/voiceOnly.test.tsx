import React from "react";
import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VoiceModeratorPrompt } from "@/components/voice/VoiceModeratorPrompt";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock("next/font/google", () => ({
  DM_Sans: () => ({ className: "font-dm-sans", variable: "--font-dm-sans" }),
  Instrument_Serif: () => ({ className: "font-instrument-serif", variable: "--font-instrument-serif" }),
}));

vi.mock("@/lib/voice/livekitApi", () => ({
  requestVoiceSessionToken: vi.fn().mockResolvedValue({
    status: "success",
    case_id: "case-1",
    room_name: "room-1",
    server_url: "wss://example.test",
    token: "test-token",
    participant_identity: "citizen",
    agent_status: "active",
  }),
  sendVoiceTurn: vi.fn(),
  sendVoiceAudioTurn: vi.fn(),
  completeVoiceSession: vi.fn().mockResolvedValue({ state: {} }),
}));

vi.mock("@/lib/voice/ttsProvider", () => ({
  getTTSProvider: () => ({
    speak: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }),
  getVoiceProfileForRiskFlags: () => ({ rate: 1, pitch: 1 }),
}));

vi.mock("livekit-client", () => {
  class Room {
    on() {}
    async connect() {}
    disconnect() {}
    localParticipant = { setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined) };
  }
  return { Room, RoomEvent: { Connected: "connected" }, ConnectionState: {} };
});

const baseContext = {
  ai_verification_status: "pending",
  summary: "Synthetic summary",
};

describe("VoiceModeratorPrompt (active session)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders no textbox and no Send button once connected", async () => {
    render(
      <VoiceModeratorPrompt
        caseId="case-1"
        contextBuildingResult={baseContext}
        manualTalkTrigger={true}
      />
    );

    expect(await screen.findByText(/Voice Moderator Session/i)).toBeInTheDocument();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/type to voice moderator/i)).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: /end & save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /end & save/i }).textContent).toContain("End");
  });

  it("keeps microphone and language controls available", async () => {
    render(
      <VoiceModeratorPrompt
        caseId="case-1"
        contextBuildingResult={baseContext}
        manualTalkTrigger={true}
      />
    );
    await screen.findByText(/Voice Moderator Session/i);
    expect(screen.getByText(/Language:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Press & hold the microphone button to speak/i)
    ).toBeInTheDocument();
  });
});
