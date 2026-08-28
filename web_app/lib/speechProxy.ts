/**
 * Secure Backend Speech Proxy Client
 *
 * Proxies Speech-to-Text (STT) and Text-to-Speech (TTS) through the NyaySahayak backend
 * endpoints (/api/transcribe and /api/synthesize).
 *
 * No provider API keys are ever stored, referenced, or exposed in the frontend.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const SUPPORTED_LANGS = new Set([
  "bn-IN",
  "en-IN",
  "gu-IN",
  "hi-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "od-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
]);

export function normalizeSpeechLang(code?: string | null): string {
  const raw = String(code || "").trim();
  if (SUPPORTED_LANGS.has(raw)) return raw;
  const short = raw.split("-")[0]?.toLowerCase();
  const map: Record<string, string> = {
    bn: "bn-IN",
    en: "en-IN",
    gu: "gu-IN",
    hi: "hi-IN",
    kn: "kn-IN",
    ml: "ml-IN",
    mr: "mr-IN",
    or: "od-IN",
    od: "od-IN",
    pa: "pa-IN",
    ta: "ta-IN",
    te: "te-IN",
  };
  return map[short || ""] || "en-IN";
}

/** Backward-compatible alias */
export const normalizeSarvamLang = normalizeSpeechLang;

export interface TranscriptionResult {
  text: string;
  languageCode: string;
}

/**
 * Transcribes an audio blob by proxying through the backend /api/transcribe endpoint.
 * Requires zero frontend credentials; uses server-side SARVAM_API_KEY.
 */
export async function transcribeAudioProxy(
  audioBlob: Blob,
  languageCode?: string
): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");
  formData.append("language_code", languageCode || "unknown");

  const response = await fetch(`${API_URL}/api/transcribe`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let errMessage = "Transcription failed";
    try {
      const errData = await response.json();
      errMessage =
        (typeof errData?.detail === "string" && errData.detail) ||
        (typeof errData?.message === "string" && errData.message) ||
        JSON.stringify(errData) ||
        errMessage;
    } catch {
      errMessage = (await response.text().catch(() => errMessage)) || errMessage;
    }
    throw new Error(`STT proxy failed (${response.status}): ${errMessage}`);
  }

  const data = await response.json();
  const text = String(
    data.transcript || data.text || data.data || ""
  ).trim();

  return {
    text,
    languageCode: normalizeSpeechLang(data.language_code),
  };
}

/** Backward-compatible alias for existing components */
export const transcribeWavWithSarvam = transcribeAudioProxy;

function chunkForTts(text: string, maxLen = 1400): string[] {
  const clean = text.trim();
  if (clean.length <= maxLen) return clean ? [clean] : [];
  const parts: string[] = [];
  let rest = clean;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(". ", maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf(" ", maxLen);
    if (cut < 1) cut = maxLen;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export interface SynthesizeOptions {
  speaker?: string;
  pace?: number;
  temperature?: number;
  model?: string;
}

/**
 * Synthesizes text into an audio Blob by proxying through the backend /api/synthesize endpoint.
 * Requires zero frontend credentials; uses server-side SARVAM_API_KEY.
 */
export async function synthesizeSpeechProxy(
  text: string,
  languageCode?: string,
  options?: SynthesizeOptions
): Promise<Blob> {
  const lang = normalizeSpeechLang(languageCode);
  const chunks = chunkForTts(text);
  if (!chunks.length) throw new Error("Nothing to speak");

  const blobs: Blob[] = [];
  for (const chunk of chunks) {
    const response = await fetch(`${API_URL}/api/synthesize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: chunk,
        target_language_code: lang,
        speaker: options?.speaker || "shubh",
        pace: options?.pace ?? 1.0,
        model: options?.model || "bulbul:v3",
        temperature: options?.temperature ?? 0.6,
        output_audio_codec: "mp3",
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`TTS proxy failed (${response.status}): ${errText.slice(0, 240)}`);
    }

    const audioBlob = await response.blob();
    blobs.push(audioBlob);
  }

  return new Blob(blobs, { type: "audio/mpeg" });
}

/** Backward-compatible alias for existing components */
export const synthesizeWithSarvam = synthesizeSpeechProxy;

export function cleanTextForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s]+/g, "")
    .replace(/<[^>]*>?/gm, "")
    .replace(/\[.*?\]/g, "")
    .replace(/\{.*?\}/g, "")
    .replace(/[*_#`~>-]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
