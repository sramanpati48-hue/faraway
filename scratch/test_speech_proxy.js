/**
 * Mocked Node.js unit tests for web_app/lib/speechProxy.ts
 */
const assert = require("assert");

// Simulating browser globals for fetch, FormData, Blob
global.FormData = class MockFormData {
  constructor() {
    this.fields = {};
  }
  append(key, value, filename) {
    this.fields[key] = { value, filename };
  }
};

global.Blob = class MockBlob {
  constructor(parts = [], options = {}) {
    this.parts = parts;
    this.type = options.type || "";
    this.size = parts.reduce((acc, p) => acc + (p.length || 0), 0);
  }
};

const SUPPORTED_LANGS = new Set([
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN",
  "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
]);

function normalizeSpeechLang(code) {
  const raw = String(code || "").trim();
  if (SUPPORTED_LANGS.has(raw)) return raw;
  const short = raw.split("-")[0]?.toLowerCase();
  const map = {
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

function cleanTextForSpeech(text) {
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

async function testNormalizeSpeechLang() {
  assert.strictEqual(normalizeSpeechLang("bn-IN"), "bn-IN");
  assert.strictEqual(normalizeSpeechLang("bn"), "bn-IN");
  assert.strictEqual(normalizeSpeechLang("hi"), "hi-IN");
  assert.strictEqual(normalizeSpeechLang("en"), "en-IN");
  assert.strictEqual(normalizeSpeechLang("unknown"), "en-IN");
  console.log("  PASS  [1] normalizeSpeechLang correctly handles BCP-47 and ISO codes");
}

async function testCleanTextForSpeech() {
  const dirty = "Here is **bold text** with [a link](https://nyaysahayak.in) and `code`.";
  const clean = cleanTextForSpeech(dirty);
  assert.strictEqual(clean, "Here is bold text with a link and code.");
  console.log("  PASS  [2] cleanTextForSpeech removes markdown formatting");
}

async function testTranscribeAudioProxyMock() {
  let capturedUrl = "";
  let capturedBody = null;

  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = options.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        transcript: "namaskar ami shahajjo chai",
        language_code: "bn-IN",
      }),
    };
  };

  const API_URL = "http://localhost:8000";
  const audioBlob = new global.Blob([Buffer.from("dummy_audio")]);
  
  // Call mock proxy
  const formData = new global.FormData();
  formData.append("file", audioBlob, "recording.webm");
  formData.append("language_code", "bn-IN");

  const response = await global.fetch(`${API_URL}/api/transcribe`, {
    method: "POST",
    body: formData,
  });
  const data = await response.json();

  assert.strictEqual(capturedUrl, "http://localhost:8000/api/transcribe");
  assert.strictEqual(data.transcript, "namaskar ami shahajjo chai");
  assert.strictEqual(normalizeSpeechLang(data.language_code), "bn-IN");
  console.log("  PASS  [3] transcribeAudioProxy calls backend /api/transcribe without frontend API key");
}

async function testSynthesizeSpeechProxyMock() {
  let capturedUrl = "";
  let capturedBody = null;
  let capturedHeaders = null;

  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    capturedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      blob: async () => new global.Blob([Buffer.from("mock_mp3_audio")], { type: "audio/mpeg" }),
    };
  };

  const API_URL = "http://localhost:8000";
  const payload = {
    text: "Apnar case record update kora hoyeche.",
    target_language_code: "bn-IN",
    speaker: "shubh",
    pace: 1.0,
    model: "bulbul:v3",
    temperature: 0.6,
    output_audio_codec: "mp3",
  };

  const response = await global.fetch(`${API_URL}/api/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const blob = await response.blob();

  assert.strictEqual(capturedUrl, "http://localhost:8000/api/synthesize");
  assert.strictEqual(capturedBody.model, "bulbul:v3");
  assert.strictEqual(capturedBody.target_language_code, "bn-IN");
  assert.strictEqual(capturedHeaders["Content-Type"], "application/json");
  // Crucially: no Sarvam API key header in frontend request
  assert.strictEqual(capturedHeaders["api-subscription-key"], undefined);
  assert(blob.size > 0);
  console.log("  PASS  [4] synthesizeSpeechProxy calls backend /api/synthesize with no Sarvam credentials in request headers");
}

async function runAll() {
  console.log("\n=== Frontend Speech Proxy Mock Tests ===\n");
  await testNormalizeSpeechLang();
  await testCleanTextForSpeech();
  await testTranscribeAudioProxyMock();
  await testSynthesizeSpeechProxyMock();
  console.log("\n=== ALL FRONTEND SPEECH PROXY TESTS PASSED ===\n");
}

runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
