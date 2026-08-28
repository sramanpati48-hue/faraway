"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
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
  sendVoiceAudioTurn,
  completeVoiceSession,
  VoiceSessionResponse,
  VoiceTurnResponse,
} from "@/lib/voice/livekitApi";
import { NyayGuideDispatchCard } from "@/components/nyayguide/NyayGuideDispatchCard";
import type { NyayGuideRequest } from "@/lib/nyayguideApi";
import {
  getTTSProvider,
  TTSProvider,
  VoiceProfile,
  getVoiceProfileForRiskFlags,
} from "@/lib/voice/ttsProvider";
import { Room, RoomEvent, ConnectionState } from "livekit-client";
import { VoiceOrbButton, VoiceOrbState } from "./VoiceOrbButton";

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
  const [nyayGuideConfirmation, setNyayGuideConfirmation] = useState<{
    assistance_type: string;
    safe_task_summary: string;
    escalation_reason?: string;
  } | null>(null);
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

  const handleProcessTurnResult = async (turnRes: VoiceTurnResponse) => {
    if (turnRes.status === "retry" || (!turnRes.user_transcript && !turnRes.spoken_response)) {
      setSpeechNotice(
        turnRes.spoken_response ||
        "I didn't catch any speech. Please hold the microphone and speak clearly."
      );
      return;
    }

    const userText = turnRes.user_transcript || "";
    if (userText) {
      setSpokenMessages((prev) => [
        ...prev,
        {
          role: "user",
          text: userText,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
        {
          role: "assistant",
          text: turnRes.spoken_response,
          agent: turnRes.active_agent,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } else {
      setSpokenMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: turnRes.spoken_response,
          agent: turnRes.active_agent,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    }

    if (turnRes.confidence_score != null) setCurrentScore(turnRes.confidence_score);
    if (turnRes.active_agent) setActiveSubAgent(turnRes.active_agent);

    // Structured action handling
    if (turnRes.action === "request_nyayguide" && turnRes.requires_confirmation) {
      setNyayGuideConfirmation({
        assistance_type: turnRes.assistance_type || "complaint_filing_support",
        safe_task_summary:
          turnRes.safe_task_summary ||
          "Procedural hand-holding and assistance with the complaint filing process.",
        escalation_reason: turnRes.escalation_reason || "User explicitly requested physical assistance",
      });
    } else if (turnRes.resolution_status === "escalate" && turnRes.handoff_packet) {
      setEscalationNotice(turnRes.handoff_packet);
    }

    const turnProfile = turnRes.voice_profile
      ? { ...voiceProfile, ...turnRes.voice_profile }
      : voiceProfile;
    await speakText(turnRes.spoken_response, turnProfile);
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
        await handleProcessTurnResult(turnRes);
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
        // Active LiveKit Voice Moderator Room UI (Avatar Centric Modal)
        <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center p-0 sm:p-6 animate-in fade-in zoom-in-95 duration-300">
           
           {/* Mobile-proportioned App Frame */}
           <div className="relative w-full h-full sm:w-[420px] sm:max-h-[850px] sm:h-[90vh] sm:rounded-[3rem] sm:border-[6px] border-slate-800 overflow-hidden bg-slate-950 shadow-2xl flex flex-col justify-between">
             
             {/* The Avatar Background */}
             <div className={cn("absolute inset-0 z-0 overflow-hidden transition-all duration-700 ease-in-out", 
                isAgentSpeaking ? "scale-[1.02] shadow-[inset_0_0_80px_rgba(74,222,128,0.2)]" : "scale-100"
             )}>
               <Image 
                 src="/avatar.jpg" 
                 alt="Voice Moderator Avatar" 
                 fill 
                 className={cn("object-cover object-top transition-transform duration-[3s] ease-in-out", 
                   isAgentSpeaking ? "scale-105" : "scale-100"
                 )} 
                 priority 
               />
               {/* Gradients for text readability */}
               <div className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-transparent to-slate-950/90" />
               <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
             </div>

             {/* Header */}
             <div className="relative z-20 w-full p-5 flex justify-between items-start">
                <div className="flex flex-col gap-1.5">
                   <span className="text-white font-semibold text-lg drop-shadow-md tracking-tight font-serif">Voice Moderator</span>
                   <div className="flex items-center gap-2 text-xs text-white/70 font-medium">
                      <div className="flex items-center gap-1.5 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30 backdrop-blur-sm">
                        <div className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[9px] text-emerald-100 uppercase tracking-wider">LiveKit Active</span>
                      </div>
                   </div>
                </div>

                <button
                  type="button"
                  onClick={handleEndSession}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/40 backdrop-blur-md px-3 py-1.5 text-xs font-semibold text-white/90 hover:bg-red-500/40 hover:text-red-100 hover:border-red-500/50 transition-all cursor-pointer shadow-sm"
                >
                  <PhoneOff className="size-3.5" />
                  <span>End</span>
                </button>
             </div>

             {/* Banners & Transcript */}
             <div className="relative z-10 w-full flex-1 flex flex-col justify-end p-5 pb-0 pointer-events-none">
                
                {speechNotice && (
                  <div className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/20 backdrop-blur-md p-3 text-xs text-amber-50 flex items-center justify-between gap-3 animate-in fade-in duration-200 pointer-events-auto">
                    <div className="flex items-center gap-2.5">
                      <AlertTriangle className="size-4 text-amber-300 shrink-0" />
                      <span className="font-medium opacity-90">{speechNotice}</span>
                    </div>
                    <button type="button" onClick={() => setSpeechNotice(null)} className="text-amber-200 hover:text-white font-bold p-1">✕</button>
                  </div>
                )}

                {/* Transcript Pane */}
                <div className="w-full max-h-[30vh] overflow-y-auto space-y-3 pointer-events-auto custom-scrollbar no-scrollbar mask-image-top pb-4">
                  {spokenMessages.map((m, idx) => (
                    <div key={idx} className={cn("flex flex-col gap-1 max-w-[90%] animate-in slide-in-from-bottom-2 fade-in duration-300", m.role === "assistant" ? "self-start" : "self-end items-end")}>
                      <span className={cn("text-[9px] font-bold uppercase tracking-wider", m.role === "assistant" ? "text-emerald-400 pl-1" : "text-white/50 pr-1")}>
                        {m.role === "assistant" ? m.agent || "Verification Agent" : "You"}
                      </span>
                      <div className={cn("rounded-2xl px-3.5 py-2 text-sm leading-relaxed backdrop-blur-md shadow-sm", m.role === "assistant" ? "bg-black/40 text-white border border-white/10 rounded-tl-sm" : "bg-emerald-600/90 text-white border border-emerald-500/30 rounded-tr-sm")}>
                        {m.text}
                      </div>
                    </div>
                  ))}
                  
                  {isTranscribing && (
                    <div className="flex items-center gap-2 text-xs text-white/50 italic pt-2 animate-pulse">
                      <Loader2 className="size-3 animate-spin" /><span>Transcribing...</span>
                    </div>
                  )}
                  {isAgentSpeaking && !isTranscribing && (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 italic pt-2 animate-pulse">
                      <Volume2 className="size-3" /><span>Speaking...</span>
                    </div>
                  )}
                  <div ref={conversationEndRef} className="h-1" />
                </div>
             </div>

             {/* Bottom Controls */}
             <div className="relative z-20 w-full p-5 pt-8 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent flex flex-col items-center gap-5">
                
                {/* Custom Sleek Push-to-Talk Button (Replacing the buggy green square) */}
                <button
                  type="button"
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  onMouseLeave={isRecording ? stopRecording : undefined}
                  className={cn(
                    "relative flex items-center justify-center size-20 rounded-full shadow-2xl transition-all duration-300 ease-out cursor-pointer",
                    isRecording 
                      ? "bg-emerald-500 scale-95 shadow-[0_0_40px_rgba(16,185,129,0.5)]" 
                      : "bg-white/10 backdrop-blur-xl border border-white/20 hover:bg-white/20 hover:scale-105"
                  )}
                >
                  {isRecording ? (
                    <Mic className="size-8 text-white animate-pulse" />
                  ) : isTranscribing ? (
                    <Loader2 className="size-8 text-white/70 animate-spin" />
                  ) : isAgentSpeaking ? (
                    <Volume2 className="size-8 text-emerald-400 animate-pulse" />
                  ) : (
                    <Mic className="size-8 text-white/80" />
                  )}
                  
                  {/* Outer ripple rings when idle/listening */}
                  {isRecording && (
                     <>
                       <div className="absolute inset-0 rounded-full border border-emerald-400/50 animate-ping" />
                       <div className="absolute -inset-4 rounded-full border border-emerald-400/20 animate-ping delay-150" />
                     </>
                  )}
                </button>

                {/* Minimal Status Text */}
                <p className={cn("text-[11px] font-medium tracking-wide h-4 transition-all duration-300", 
                  isRecording ? "text-emerald-400 animate-pulse" : "text-white/40"
                )}>
                    {isRecording ? "Listening... Release when done" : isTranscribing ? "Processing audio..." : isAgentSpeaking ? "Agent is speaking" : "Hold button to speak"}
                </p>

                {/* Action Bar */}
                <div className="flex w-full items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[11px] text-white/60 bg-white/5 backdrop-blur-md border border-white/10 px-3 py-2 rounded-full cursor-pointer hover:bg-white/10 transition-colors">
                    <select
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value)}
                      disabled={isRecording || isTranscribing}
                      className="bg-transparent font-medium text-white outline-none cursor-pointer appearance-none text-center"
                    >
                      <option value="en-IN" className="text-black">English</option>
                      <option value="hi-IN" className="text-black">Hindi</option>
                      <option value="bn-IN" className="text-black">Bengali</option>
                      <option value="unknown" className="text-black">Auto</option>
                    </select>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setSpeechNotice("Please try speaking into the microphone again.")} className="flex items-center justify-center size-9 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-colors">
                      <RefreshCw className="size-4" />
                    </button>
                    <button type="button" onClick={handleEndSession} className="flex items-center justify-center size-9 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-colors">
                      <MessageSquare className="size-4" />
                    </button>
                  </div>
                </div>
             </div>

           </div>
        </div>
      )}
    </div>
  );
}
