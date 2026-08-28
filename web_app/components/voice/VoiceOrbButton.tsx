// components/voice/VoiceOrbButton.tsx
import { useState } from "react";
import "./voice-orb.css";

export type VoiceOrbState = "idle" | "listening" | "processing" | "speaking";

export function VoiceOrbButton({
  state,
  onPressStart,
  onPressEnd,
}: {
  state: VoiceOrbState;
  onPressStart: () => void;
  onPressEnd: () => void;
}) {
  return (
    <button
      className={`voice-orb voice-orb--${state}`}
      onMouseDown={onPressStart}
      onMouseUp={onPressEnd}
      onTouchStart={onPressStart}
      onTouchEnd={onPressEnd}
      aria-label="Press and hold to speak"
    >
      <span className="voice-orb__rings" />
      <span className="voice-orb__pill" />
      <span className="voice-orb__dot" />
    </button>
  );
}
