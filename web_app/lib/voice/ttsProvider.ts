/**
 * Sarvam AI Bulbul v3 TTS Provider Adapter for NyaySahayak Voice Moderator.
 *
 * Supports:
 * 1. SarvamTTSProvider (Default/Sole Production Provider): High-fidelity streaming speech
 *    using Sarvam Bulbul v3 proxied securely through the backend /api/voice-session/tts.
 *    (SARVAM_API_KEY is never exposed to the client).
 * 2. WebSpeechTTSProvider: Optional dev-only browser SpeechSynthesis fallback
 *    enabled only when NEXT_PUBLIC_ENABLE_WEBSPEECH_FALLBACK=true.
 * 3. Dynamic VoiceProfile support: Applies calm, slower-paced voice profile for sensitive cases
 *    (pace=0.85, soothing speaker persona).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface VoiceProfile {
  name?: string;
  target_language_code?: string;
  languageCode?: string;
  speaker?: string; // e.g. 'meera' for sensitive/calm, 'shubh' for standard
  pace?: number; // 0.85 for sensitive/calm, 1.0 for standard
  temperature?: number;
  model?: string;
  isSensitive?: boolean;
  is_sensitive?: boolean;
}

export function getVoiceProfileForRiskFlags(
  riskFlags?: string[] | string | null,
  languageCode: string = "en-IN"
): VoiceProfile {
  const flags: string[] = Array.isArray(riskFlags)
    ? riskFlags.map((f) => String(f).toLowerCase())
    : typeof riskFlags === "string"
    ? [riskFlags.toLowerCase()]
    : [];

  const lang = languageCode || "en-IN";

  if (flags.includes("sensitive")) {
    return {
      name: "sensitive_calm",
      target_language_code: lang,
      languageCode: lang,
      speaker: "meera", // Calmer, empathetic voice persona
      pace: 0.85, // Slower, calm pacing for sensitive cases
      temperature: 0.4,
      model: "bulbul:v3",
      isSensitive: true,
      is_sensitive: true,
    };
  }

  return {
    name: "standard",
    target_language_code: lang,
    languageCode: lang,
    speaker: "shubh",
    pace: 1.0,
    temperature: 0.6,
    model: "bulbul:v3",
    isSensitive: false,
    is_sensitive: false,
  };
}

export interface TTSProvider {
  readonly providerName: string;
  speak(text: string, voiceProfile?: VoiceProfile): Promise<void>;
  stop(): void;
}

/**
 * Sarvam AI Bulbul v3 TTS Provider (Default Production Provider).
 * Proxies speech synthesis securely through the backend /api/voice-session/tts.
 */
export class SarvamTTSProvider implements TTSProvider {
  readonly providerName = "sarvam";
  private currentAudio: HTMLAudioElement | null = null;

  async speak(text: string, voiceProfile?: VoiceProfile): Promise<void> {
    if (!text || typeof window === "undefined") {
      return;
    }

    this.stop();

    const profile = voiceProfile || getVoiceProfileForRiskFlags();

    try {
      const response = await fetch(`${API_URL}/api/voice-session/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          is_sensitive: Boolean(profile.isSensitive || profile.is_sensitive),
          target_language_code: profile.target_language_code || profile.languageCode || "en-IN",
          voice_profile: profile,
        }),
      });

      if (!response.ok) {
        console.warn(`Sarvam TTS response not ok (${response.status})`);
        return;
      }

      const contentType = response.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        // Backend indicated client-side fallback
        const devFallback = new WebSpeechTTSProvider();
        return devFallback.speak(text, profile);
      }

      const audioBlob = await response.blob();
      if (!audioBlob || audioBlob.size === 0) {
        return;
      }

      return new Promise((resolve) => {
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        this.currentAudio = audio;

        audio.onended = () => {
          this.currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          resolve();
        };

        audio.onerror = (e) => {
          console.warn("Sarvam audio playback notice:", e);
          this.currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          resolve();
        };

        audio.play().catch((err) => {
          console.warn("Audio autoplay notice:", err);
          this.currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          resolve();
        });
      });
    } catch (err) {
      console.warn("Sarvam TTS streaming error:", err);
    }
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
  }
}

/**
 * Optional development-only fallback provider using the browser's native Web Speech API.
 */
export class WebSpeechTTSProvider implements TTSProvider {
  readonly providerName = "webspeech";
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  async speak(text: string, voiceProfile?: VoiceProfile): Promise<void> {
    if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    this.stop();

    const profile = voiceProfile || getVoiceProfileForRiskFlags();
    const cleanText = text.replace(/[*_#`~\[\]]/g, "").trim();

    return new Promise((resolve) => {
      try {
        const utterance = new SpeechSynthesisUtterance(cleanText);
        this.currentUtterance = utterance;

        utterance.rate = profile.pace ?? (profile.isSensitive ? 0.85 : 1.0);
        utterance.lang = profile.target_language_code || profile.languageCode || "en-IN";

        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          const matchingVoice =
            voices.find((v) => v.lang.includes("en-IN") || v.name.includes("India")) ||
            voices.find((v) => v.lang.startsWith("en")) ||
            voices[0];
          if (matchingVoice) {
            utterance.voice = matchingVoice;
          }
        }

        utterance.onend = () => {
          this.currentUtterance = null;
          resolve();
        };

        utterance.onerror = () => {
          this.currentUtterance = null;
          resolve();
        };

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("SpeechSynthesis execution notice:", err);
        this.currentUtterance = null;
        resolve();
      }
    });
  }

  stop(): void {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;
  }
}

/**
 * Returns the configured TTSProvider instance.
 * Defaults to Sarvam AI Bulbul v3 (SarvamTTSProvider).
 */
export function getTTSProvider(enableWebSpeechFallback?: boolean): TTSProvider {
  const allowDevWebSpeech =
    enableWebSpeechFallback !== undefined
      ? enableWebSpeechFallback
      : process.env.NEXT_PUBLIC_ENABLE_WEBSPEECH_FALLBACK === "true";

  if (allowDevWebSpeech) {
    return new WebSpeechTTSProvider();
  }

  return new SarvamTTSProvider();
}
