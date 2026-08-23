import { Mic, Square, MessageSquare, Type } from "lucide-react";
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { cn } from "@/lib/utils";
import { touchIconButton } from "@/lib/motion";
import { transcribeWavWithSarvam } from "@/lib/speechProxy";

export type VoiceMode = "dictation" | "conversation";

interface VoiceInputProps {
  onTranscription: (text: string, mode: VoiceMode, languageCode?: string) => void;
  isProcessing?: boolean;
  /** Compact dark styling for admin toolbars (e.g. LangGraph tester). */
  variant?: "default" | "admin";
  /** Mic-only on mobile so the chat composer stays wide. */
  compact?: boolean;
}

export interface VoiceInputRef {
  startRecording: () => void;
  stopRecording: () => void;
  setMode: (mode: VoiceMode) => void;
  mode: VoiceMode;
}

export const VoiceInput = forwardRef<VoiceInputRef, VoiceInputProps>(
  ({ onTranscription, isProcessing, variant = "default", compact = false }, ref) => {
  const admin = variant === "admin";
  const [isRecording, setIsRecording] = useState(false);
  const [mode, setMode] = useState<VoiceMode>("dictation");
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Refs for raw PCM capture
  const pcmBufferRef = useRef<Float32Array[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        }
      });
      streamRef.current = stream;
      pcmBufferRef.current = [];

      // --- Use Web Audio API to capture RAW PCM data directly ---
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      // ScriptProcessorNode to capture raw audio samples
      const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
      scriptNodeRef.current = scriptNode;
      source.connect(scriptNode);
      scriptNode.connect(audioContext.destination); // required for processing to work

      scriptNode.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        // Store a copy of the float32 samples
        pcmBufferRef.current.push(new Float32Array(inputData));
      };

      audioContextRef.current = audioContext;

      // --- Volume-based Silence Detection ---
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let lastSoundTime = Date.now();
      const startTime = Date.now();
      let hasStartedSpeaking = false;
      const SILENCE_THRESHOLD = 5;
      const SILENCE_DURATION = mode === "conversation" ? 2000 : 3500;
      const MAX_DURATION = 20000;

      const checkVolume = () => {
        if (!streamRef.current || !streamRef.current.active) return;

        if (Date.now() - startTime >= MAX_DURATION) {
          console.log("Max 20s duration reached, turning off mic");
          stopRecording();
          return;
        }

        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const average = sum / bufferLength;

        if (average > SILENCE_THRESHOLD) {
          if (!hasStartedSpeaking) console.log("Speech detected, starting silence countdown...");
          hasStartedSpeaking = true;
          lastSoundTime = Date.now();
        } else if (hasStartedSpeaking) {
          if (Date.now() - lastSoundTime > SILENCE_DURATION) {
            console.log("Silence auto-stop triggered");
            stopRecording();
            return;
          }
        }
        animationFrameRef.current = requestAnimationFrame(checkVolume);
      };

      setIsRecording(true);
      checkVolume();
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
    }
  };

  const handleTranscription = async (audioBlob: Blob) => {
    try {
      console.log(`Sending audio blob: size=${audioBlob.size} bytes, type=${audioBlob.type}`);
      if (audioBlob.size < 5000) {
        console.warn("Audio blob is too small, likely no speech was captured.");
        if (mode === "conversation") {
          startRecording();
        }
        return;
      }

      const { text, languageCode } = await transcribeWavWithSarvam(audioBlob);
      if (text) {
        onTranscription(text, mode, languageCode);
      } else {
        console.warn("Empty or missing transcript in Sarvam STT response");
        if (mode === "conversation") {
          console.log("Restarting conversation loop after empty transcription detection.");
          startRecording();
        }
      }
    } catch (error: any) {
      console.warn("Transcription failed:", error?.message || error);
      // If we are in conversation mode, pause for 3 seconds then try again to avoid spinning
      if (mode === "conversation") {
        console.log("Retrying conversation mode after error...");
        setTimeout(() => startRecording(), 3000);
      }
    }
  };

  const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
    const length = samples.length;
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);          // chunk size
    view.setUint16(20, 1, true);           // PCM format
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);   // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);           // block align
    view.setUint16(34, 16, true);          // bits per sample
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
  };

  const stopRecording = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

    // Disconnect ScriptProcessorNode
    if (scriptNodeRef.current) {
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }

    // Close AudioContext
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      const sampleRate = audioContextRef.current.sampleRate;
      audioContextRef.current.close();

      // Merge all PCM buffers into a single Float32Array
      const totalLength = pcmBufferRef.current.reduce((acc, buf) => acc + buf.length, 0);
      const mergedBuffer = new Float32Array(totalLength);
      let writeOffset = 0;
      for (const buf of pcmBufferRef.current) {
        mergedBuffer.set(buf, writeOffset);
        writeOffset += buf.length;
      }

      console.log(`PCM capture: ${totalLength} samples at ${sampleRate}Hz = ${(totalLength / sampleRate).toFixed(1)}s, max amplitude: ${Math.max(...mergedBuffer.slice(0, 1000).map(Math.abs))}`);

      // Resample to 16kHz if needed
      let finalSamples = mergedBuffer;
      let finalRate = sampleRate;
      if (sampleRate !== 16000) {
        const ratio = 16000 / sampleRate;
        const newLength = Math.round(totalLength * ratio);
        const resampled = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
          const srcIdx = i / ratio;
          const idx = Math.floor(srcIdx);
          const frac = srcIdx - idx;
          resampled[i] = (1 - frac) * (mergedBuffer[idx] || 0) + frac * (mergedBuffer[idx + 1] || 0);
        }
        finalSamples = resampled;
        finalRate = 16000;
      }

      const wavBlob = encodeWav(finalSamples, finalRate);
      console.log(`WAV blob created: ${wavBlob.size} bytes`);
      handleTranscription(wavBlob);
    }

    // Stop mic stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipClickRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useImperativeHandle(ref, () => ({
    startRecording,
    stopRecording,
    setMode,
    mode
  }));

  const pickMode = (next: VoiceMode) => {
    if (isRecording || isProcessing) return;
    setMode(next);
    setMenuOpen(false);
  };

  const onMicPointerDown = () => {
    if (isRecording || isProcessing) return;
    skipClickRef.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      skipClickRef.current = true;
      setMenuOpen(true);
    }, 420);
  };

  const onMicClick = () => {
    clearLongPress();
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    if (isProcessing) return;
    if (isRecording) stopRecording();
    else {
      setMenuOpen(false);
      void startRecording();
    }
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={onMicClick}
        onPointerDown={onMicPointerDown}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!isRecording && !isProcessing) setMenuOpen(true);
        }}
        disabled={isProcessing}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={cn(
          "relative flex shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-200",
          admin ? "p-1.5" : compact ? "h-9 w-9 md:h-8 md:w-8" : cn(touchIconButton, "md:h-10 md:w-10"),
          isRecording
            ? "scale-105 animate-pulse bg-red-500 text-white shadow-lg shadow-red-500/30"
            : admin
              ? "text-emerald-300 hover:bg-white/10"
              : "text-[#00634B] hover:bg-[#E6F0ED] dark:hover:bg-emerald-900/30",
          isProcessing ? "cursor-not-allowed opacity-50" : ""
        )}
        title={
          isRecording
            ? "Stop recording"
            : "Tap to speak · hold for voice options"
        }
      >
        {isRecording ? (
          <Square className={cn("fill-current", admin ? "h-3.5 w-3.5" : "h-4 w-4")} />
        ) : (
          <Mic className={admin ? "h-3.5 w-3.5" : "h-4 w-4"} />
        )}
        {!isRecording && mode === "conversation" && (
          <span
            className={cn(
              "absolute right-0.5 top-0.5 h-2 w-2 rounded-full border-2 bg-emerald-500",
              admin ? "border-zinc-900" : "border-white dark:border-slate-800"
            )}
          />
        )}
      </button>

      {menuOpen && !isRecording && (
        <div
          role="menu"
          className={cn(
            "absolute bottom-[calc(100%+0.4rem)] left-0 z-50 w-52 origin-bottom-left overflow-hidden rounded-xl border py-1 shadow-xl",
            admin
              ? "border-white/15 bg-zinc-900 text-white"
              : "border-slate-200/80 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          )}
        >
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Voice
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => pickMode("dictation")}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm",
              mode === "dictation"
                ? admin
                  ? "bg-white/10 text-emerald-300"
                  : "bg-emerald-50 font-medium text-[#00634B]"
                : admin
                  ? "hover:bg-white/5"
                  : "hover:bg-slate-50"
            )}
          >
            <Type className="h-4 w-4 shrink-0" />
            <span>
              <span className="block">Dictate</span>
              <span className="block text-[11px] font-normal text-slate-400">Fill the message box</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pickMode("conversation")}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm",
              mode === "conversation"
                ? admin
                  ? "bg-white/10 text-emerald-300"
                  : "bg-emerald-50 font-medium text-[#00634B]"
                : admin
                  ? "hover:bg-white/5"
                  : "hover:bg-slate-50"
            )}
          >
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span>
              <span className="block">Hands-free</span>
              <span className="block text-[11px] font-normal text-slate-400">Send after you pause</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
});

VoiceInput.displayName = "VoiceInput";
