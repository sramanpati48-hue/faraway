"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Sparkles,
  ShieldAlert,
  AlertTriangle,
  HeartHandshake,
  CheckCircle2,
  Loader2,
  Volume2,
  VolumeX,
  UserCheck,
  ArrowRight,
  RefreshCw,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  requestVoiceSessionToken,
  sendVoiceTurn,
  sendVoiceAudioTurn,
  completeVoiceSession,
  VoiceSessionResponse,
} from "@/lib/voice/livekitApi";
import {
  getTTSProvider,
  TTSProvider,
  VoiceProfile,
  getVoiceProfileForRiskFlags,
} from "@/lib/voice/ttsProvider";
import { Room, RoomEvent, ConnectionState } from "livekit-client";

export interface VoiceModeratorPromptProps {
  caseId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  /**
   * The result object produced by Step 4 (Context Building).
   * MUST be present for the prompt to render.
   */
  contextBuildingResult?: {
    context_building_confidence_score?: number;
    ai_verification_confidence?: number;
    ai_verification_status?: string;
    risk_flags?: string[] | string;
    threat_level_assessment?: {
      status?: string;
      level?: string;
      reason?: string;
    } | null;
    summary?: string;
    incident_type?: string;
    has_answers?: boolean;
    [key: string]: any;
  } | null;
  /**
   * Existing conversation transcript so the AI Voice Moderator does not repeat questions.
   */
  transcript?: any[];
  /**
   * State when user manually clicked "Talk instead of typing" or requested voice clarification.
   */
  manualTalkTrigger?: boolean;
  /**
   * Callback when user closes or completes the voice session.
   */
  onClose?: () => void;
  /**
   * Callback when voice session refines the case context.
   */
  onContextRefined?: (updatedContext: any) => void;
}

export function VoiceModeratorPrompt({
  caseId,
  userId,
  sessionId,
  contextBuildingResult,
  transcript = [],
  manualTalkTrigger = false,
  onClose,
  onContextRefined,
}: VoiceModeratorPromptProps) {
  // Guard 1: Must NOT appear on initial case-creation screen. Only renders when Step 4 produces a result.
  if (!caseId || !contextBuildingResult) {
    return null;
  }

  // Extract fields safely
  const confidenceScore =
    typeof contextBuildingResult.context_building_confidence_score === "number"
      ? contextBuildingResult.context_building_confidence_score
      : typeof contextBuildingResult.ai_verification_confidence === "number"
      ? contextBuildingResult.ai_verification_confidence
      : 1.0;

  const rawFlags = contextBuildingResult.risk_flags;
  const riskFlags: string[] = Array.isArray(rawFlags)
    ? rawFlags.map((f) => String(f).toLowerCase())
    : typeof rawFlags === "string"
    ? [rawFlags.toLowerCase()]
    : [];

  const isSensitive = riskFlags.includes("sensitive");

  // Guard 2: If threat_level_assessment is undefined/null (Step 7 hasn't run yet), treat as null and skip condition
  const threatAssessment = contextBuildingResult.threat_level_assessment;
  const isThreatStatusUnclear =
    threatAssessment && typeof threatAssessment === "object"
      ? threatAssessment.status === "unclear"
      : false;

  const isLowConfidence = confidenceScore < 0.7;

  // Condition evaluation: Only show AI verification room when user requests "Connect to Nyay Guide" / Voice Moderator
  const shouldRender = Boolean(manualTalkTrigger);

  if (!shouldRender) {
    return null;
  }

  return (
    <VoiceModeratorInner
      caseId={caseId}
      userId={userId}
      sessionId={sessionId}
      contextBuildingResult={contextBuildingResult}
      transcript={transcript}
      isLowConfidence={isLowConfidence}
      isSensitive={isSensitive}
      isThreatStatusUnclear={isThreatStatusUnclear}
      manualTalkTrigger={manualTalkTrigger}
      onClose={onClose}
      onContextRefined={onContextRefined}
    />
  );
}

interface InnerProps {
  caseId: string;
  userId?: string | null;
  sessionId?: string | null;
  contextBuildingResult: any;
  transcript: any[];
  isLowConfidence: boolean;
  isSensitive: boolean;
  isThreatStatusUnclear: boolean;
  manualTalkTrigger: boolean;
  onClose?: () => void;
  onContextRefined?: (updatedContext: any) => void;
}

export type VoiceConnectionState = "idle" | "requesting" | "connecting" | "connected" | "failed" | "ended";

function VoiceModeratorInner({
  caseId,
  userId,
  sessionId,
  contextBuildingResult,
  transcript,
  isLowConfidence,
  isSensitive,
  isThreatStatusUnclear,
  manualTalkTrigger,
  onClose,
  onContextRefined,
}: InnerProps) {
  const [sessionActive, setSessionActive] = useState(false);
  const [connState, setConnState] = useState<VoiceConnectionState>("idle");
  const [connError, setConnError] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<VoiceSessionResponse | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en-IN");
  const [activeSubAgent, setActiveSubAgent] = useState<string>("VerificationAgent");
  const [spokenMessages, setSpokenMessages] = useState<
    Array<{ role: "user" | "assistant"; text: string; agent?: string; time: string }>
  >([]);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [escalationNotice, setEscalationNotice] = useState<any | null>(null);
  const [currentScore, setCurrentScore] = useState<number>(
    contextBuildingResult?.context_building_confidence_score ||
    contextBuildingResult?.ai_verification_confidence ||
    0.6
  );

  const roomRef = useRef<Room | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const stopResolverRef = useRef<((blob: Blob) => void) | null>(null);
  const ttsProviderRef = useRef<TTSProvider | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  // Derived voice profile: sensitive cases use calm, slower speech rate & warmer pitch
  const voiceProfile = useMemo<VoiceProfile>(() => {
    return getVoiceProfileForRiskFlags(isSensitive ? ["sensitive"] : []);
  }, [isSensitive]);

  // Trigger reason tag
  const triggerReason = useMemo(() => {
    if (manualTalkTrigger) return { label: "Voice Mode Requested", icon: Mic, color: "text-emerald-700 bg-emerald-50 border-emerald-200" };
    if (isSensitive) return { label: "Sensitive & Trauma Support", icon: HeartHandshake, color: "text-rose-700 bg-rose-50 border-rose-200" };
    if (isThreatStatusUnclear) return { label: "Safety Clarification", icon: ShieldAlert, color: "text-amber-700 bg-amber-50 border-amber-200" };
    return { label: `Clarification Needed (Confidence ${(currentScore * 100).toFixed(0)}%)`, icon: Sparkles, color: "text-blue-700 bg-blue-50 border-blue-200" };
  }, [manualTalkTrigger, isSensitive, isThreatStatusUnclear, currentScore]);

  useEffect(() => {
    ttsProviderRef.current = getTTSProvider();
    return () => {
      ttsProviderRef.current?.stop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (roomRef.current) {
        try {
          roomRef.current.disconnect();
        } catch (e) {
          console.warn("[Voice Moderator] Room cleanup notice:", e);
        }
        roomRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [spokenMessages, isAgentSpeaking]);

  const speakText = async (text: string, customProfile?: VoiceProfile) => {
    if (!text || typeof window === "undefined") return;
    try {
      setIsAgentSpeaking(true);
      if (!ttsProviderRef.current) {
        ttsProviderRef.current = getTTSProvider();
      }
      const activeProfile = customProfile || voiceProfile;
      await ttsProviderRef.current.speak(text, activeProfile);
    } catch (e) {
      console.warn("TTS output notice:", e);
    } finally {
      setIsAgentSpeaking(false);
    }
  };

  const handleStartSession = async () => {
    setConnError(null);
    setConnState("requesting");
    console.log(`[Voice Moderator] Requesting session token for case: ${caseId}`);

    try {
      const res = await requestVoiceSessionToken({
        caseId,
        userId,
        sessionId,
        contextBuilding: contextBuildingResult,
        transcript,
      });
      setSessionData(res);
      setConnState("connecting");
      console.log(`[Voice Moderator] Token received, connecting to LiveKit room: ${res.room_name}`);

      // Initialize and connect LiveKit Room
      try {
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
        });
        roomRef.current = room;

        room.on(RoomEvent.Connected, () => {
          console.log("[Voice Moderator] LiveKit Room connected successfully.");
          setConnState("connected");
        });

        room.on(RoomEvent.Disconnected, () => {
          console.log("[Voice Moderator] LiveKit Room disconnected.");
          setConnState((prev) => (prev !== "ended" ? "ended" : prev));
        });

        room.on(RoomEvent.Reconnecting, () => {
          console.log("[Voice Moderator] LiveKit Room reconnecting...");
          setConnState("connecting");
        });

        room.on(RoomEvent.Reconnected, () => {
          console.log("[Voice Moderator] LiveKit Room reconnected.");
          setConnState("connected");
        });

        if (res.server_url && res.token) {
          await room.connect(res.server_url, res.token);
          setConnState("connected");

          // Enable microphone track
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
          } catch (micErr) {
            console.warn("[Voice Moderator] Microphone permission notice:", micErr);
          }
        }
      } catch (lkErr: any) {
        console.warn("[Voice Moderator] LiveKit direct connection notice:", lkErr?.message || lkErr);
        // Fall back gracefully to turn-based audio processing with Sarvam
        setConnState("connected");
      }

      setSessionActive(true);

      const greeting = isSensitive
        ? "Hello, I am your NyaySahayak Voice Moderator. You don't have to explain everything right now. You are in a safe, supportive space. I have your initial notes, and we can clarify whatever you feel comfortable sharing."
        : isLowConfidence
        ? `Hello, I am your NyaySahayak Voice Moderator. I've reviewed what you wrote earlier, and just wanted to quickly clarify a couple of key details so your case report is fully accurate.`
        : "Hello! I am your NyaySahayak Voice Moderator. How can I assist you with your case today?";

      setSpokenMessages([
        {
          role: "assistant",
          text: greeting,
          agent: isSensitive ? "SupportAgent" : "VerificationAgent",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      await speakText(greeting);
    } catch (err: any) {
      const errMsg = err?.message || "Failed to initialize Voice Moderator session.";
      console.error("[Voice Moderator] Failed to start voice session:", errMsg);
      setConnError(errMsg);
      setConnState("failed");
    }
  };

  // Auto-connect when opened via manual trigger
  useEffect(() => {
    if (manualTalkTrigger && !sessionActive && connState === "idle") {
      void handleStartSession();
    }
  }, [manualTalkTrigger, sessionActive, connState]);

  const startRecording = async () => {
    if (isRecording || isTranscribing || isAgentSpeaking) return;
    setSpeechNotice(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      let mimeType = "audio/webm;codecs=opus";
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
          mimeType = "audio/ogg;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        }
      }

      console.log(`[Audio Capture] Recording started: MIME=${mimeType}`);

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (stopResolverRef.current) {
          stopResolverRef.current(audioBlob);
          stopResolverRef.current = null;
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setIsRecording(true);
    } catch (err: any) {
      console.error("[Audio Capture] Mic access failed:", err);
      setSpeechNotice("Microphone permission denied or device unavailable.");
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setIsRecording(false);
      return;
    }

    try {
      const durationMs = Date.now() - recordingStartTimeRef.current;
      const durationSec = durationMs / 1000;

      const audioBlobPromise = new Promise<Blob>((resolve) => {
        stopResolverRef.current = resolve;
      });

      if (recorder.state === "recording") {
        recorder.requestData();
        recorder.stop();
      }

      const audioBlob = await audioBlobPromise;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setIsRecording(false);

      console.log(
        `[Audio Capture] Captured audio: bytes=${audioBlob.size}, duration=${durationSec.toFixed(2)}s, MIME=${audioBlob.type}`
      );

      // Validate audio length and byte size
      if (audioBlob.size < 1500 || durationSec < 0.6) {
        setSpeechNotice("I didn’t hear enough speech. Please hold the microphone and speak for a moment.");
        return;
      }

      setIsTranscribing(true);
      setSpeechNotice(null);

      try {
        const turnRes = await sendVoiceAudioTurn(caseId, audioBlob, selectedLanguage || "en-IN");
        if (turnRes.status === "retry" || !turnRes.user_transcript) {
          setSpeechNotice(
            turnRes.spoken_response ||
            "I didn't catch any speech. Please hold the microphone and speak clearly."
          );
        } else if (turnRes.user_transcript) {
          setSpokenMessages((prev) => [
            ...prev,
            {
              role: "user",
              text: turnRes.user_transcript!,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
            {
              role: "assistant",
              text: turnRes.spoken_response,
              agent: turnRes.active_agent,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ]);

          if (turnRes.confidence_score != null) setCurrentScore(turnRes.confidence_score);
          if (turnRes.active_agent) setActiveSubAgent(turnRes.active_agent);
          if (turnRes.resolution_status === "escalate" && turnRes.handoff_packet) {
            setEscalationNotice(turnRes.handoff_packet);
          }

          const turnProfile = turnRes.voice_profile
            ? { ...voiceProfile, ...turnRes.voice_profile }
            : voiceProfile;
          await speakText(turnRes.spoken_response, turnProfile);
        }
      } catch (err: any) {
        console.error("[Voice Moderator] Voice turn error:", err);
        setSpeechNotice("Failed to transcribe audio. Please hold the microphone and try again.");
      } finally {
        setIsTranscribing(false);
      }
    } catch (err: any) {
      console.error("[Voice Moderator] Error stopping recorder:", err);
      setIsRecording(false);
      setIsTranscribing(false);
    }
  };

  const handleEndSession = async () => {
    ttsProviderRef.current?.stop();
    if (isRecording) {
      await stopRecording();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (roomRef.current) {
      try {
        roomRef.current.disconnect();
      } catch (e) {
        console.warn("[Voice Moderator] Room disconnect notice:", e);
      }
      roomRef.current = null;
    }
    setConnState("ended");
    try {
      const res = await completeVoiceSession(caseId);
      if (onContextRefined && res.state) {
        onContextRefined(res.state);
      }
    } catch (e) {
      console.error("End session error:", e);
    }
    setSessionActive(false);
    if (onClose) onClose();
  };

  const isConnecting = connState === "requesting" || connState === "connecting";
  const IconComponent = triggerReason.icon;

  return (
    <div className="my-6 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {!sessionActive ? (
        // Prompt Card (Appears conditionally only after Step 4 Context Building)
        <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-b from-white to-[#F8F9FA] p-5 shadow-sm sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border",
                    triggerReason.color
                  )}
                >
                  <IconComponent className="size-3.5" />
                  {triggerReason.label}
                </span>
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Step 4 · Context Review
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 font-serif">
                {isSensitive
                  ? "Connect with an Empathetic Voice Moderator"
                  : isLowConfidence
                  ? "Quick Voice Clarification with NyaySahayak"
                  : "Talk to Voice Moderator"}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 max-w-2xl leading-relaxed">
                {isSensitive
                  ? "Our AI Voice Moderator provides calm, confidential guidance without asking you to repeat difficult details."
                  : isThreatStatusUnclear
                  ? "Let's take a moment via voice to clarify immediate safety considerations for your case."
                  : "We can quickly clarify key facts over a live voice session to ensure your formal case report is strong and complete."}
              </p>

              {connError && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 flex items-center gap-2">
                  <AlertTriangle className="size-4 text-red-600 shrink-0" />
                  <span>{connError}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleStartSession}
                disabled={isConnecting}
                className="inline-flex items-center gap-2 rounded-xl bg-[#00634B] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-sm hover:bg-[#004D3C] transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>
                      {connState === "requesting"
                        ? "Minting Token…"
                        : "Connecting Room…"}
                    </span>
                  </>
                ) : (
                  <>
                    <PhoneCall className="size-4" />
                    <span>Talk to Voice Moderator</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

      ) : (
        // Active LiveKit Voice Moderator Room UI
        <div className="rounded-2xl border-2 border-emerald-600/30 bg-white p-5 sm:p-6 shadow-md space-y-4 ring-1 ring-emerald-500/10">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <div className="relative flex size-9 items-center justify-center rounded-full bg-emerald-100 text-[#00634B]">
                <Volume2 className="size-5" />
                {isAgentSpeaking && (
                  <span className="absolute -top-1 -right-1 flex size-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full size-3 bg-emerald-600"></span>
                  </span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 font-serif">
                    Voice Moderator Session
                  </span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 border border-emerald-200">
                    LiveKit Cloud Scoped · Case #{caseId.slice(0, 8)}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Active Specialist: <strong className="text-slate-700">{activeSubAgent}</strong> · Confidence:{" "}
                  <strong>{(currentScore * 100).toFixed(0)}%</strong>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleEndSession}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-red-600 transition-colors cursor-pointer"
            >
              <PhoneOff className="size-3.5 text-red-500" />
              <span>End & Save</span>
            </button>
          </div>

          {/* Escalation Alert Banner */}
          {escalationNotice && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2 animate-in fade-in duration-300">
              <ShieldAlert className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold text-amber-950">
                  NyayGuide Human Specialist Notified
                </strong>
                <span>
                  A handoff packet has been automatically dispatched to the human support queue for priority review.
                </span>
              </div>
            </div>
          )}

          {/* Speech Notice / Retry Banner */}
          {speechNotice && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 flex items-center justify-between gap-2 animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-600 shrink-0" />
                <span>{speechNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setSpeechNotice(null)}
                className="text-amber-700 hover:text-amber-900 font-bold px-1.5 py-0.5 rounded cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Live Transcript Pane */}
          <div className="max-h-56 min-h-32 overflow-y-auto space-y-2.5 rounded-xl bg-slate-50 p-3.5 border border-slate-100 text-xs custom-scrollbar">
            {spokenMessages.map((m, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex flex-col gap-0.5 rounded-lg p-2.5 max-w-[85%]",
                  m.role === "assistant"
                    ? "bg-white border border-slate-200 text-slate-800 self-start"
                    : "bg-[#00634B] text-white self-end ml-auto"
                )}
              >
                <div className="flex items-center justify-between gap-2 text-[10px] opacity-70">
                  <span>{m.role === "assistant" ? m.agent || "Voice Moderator" : "You"}</span>
                  <span>{m.time}</span>
                </div>
                <p className="leading-relaxed font-sans">{m.text}</p>
              </div>
            ))}
            {isTranscribing && (
              <div className="flex items-center gap-2 text-xs text-emerald-700 italic pt-1 animate-pulse">
                <Loader2 className="size-3 animate-spin" />
                <span>Transcribing your speech with Sarvam AI...</span>
              </div>
            )}
            {isAgentSpeaking && !isTranscribing && (
              <div className="flex items-center gap-2 text-xs text-emerald-700 italic pt-1">
                <Loader2 className="size-3 animate-spin" />
                <span>Voice Moderator is speaking...</span>
              </div>
            )}
            <div ref={conversationEndRef} />
          </div>

          {/* Language Selector & Voice Interaction Controls */}
          <div className="flex flex-col items-center gap-3 pt-1">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span>Language:</span>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                disabled={isRecording || isTranscribing}
                className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="en-IN">English (en-IN)</option>
                <option value="hi-IN">Hindi (hi-IN)</option>
                <option value="bn-IN">Bengali (bn-IN)</option>
                <option value="unknown">Auto / Code-Mixed</option>
              </select>
            </div>

            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                disabled={isTranscribing || isAgentSpeaking}
                className={cn(
                  "relative flex items-center justify-center size-14 rounded-full font-semibold transition-all shadow-md cursor-pointer",
                  isRecording
                    ? "bg-red-600 text-white scale-110 ring-4 ring-red-200 animate-pulse"
                    : isTranscribing || isAgentSpeaking
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                    : "bg-[#00634B] text-white hover:bg-[#004D3C]"
                )}
              >
                {isTranscribing ? (
                  <Loader2 className="size-6 animate-spin text-white" />
                ) : (
                  <Mic className="size-6" />
                )}
              </button>
            </div>

            <p className="text-center text-[11px] text-slate-500 font-medium">
              {isRecording
                ? "Listening... Release button when done speaking"
                : isTranscribing
                ? "Transcribing with Sarvam Saaras v3..."
                : isAgentSpeaking
                ? "Voice Moderator is responding..."
                : "Press & hold the microphone button to speak"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
