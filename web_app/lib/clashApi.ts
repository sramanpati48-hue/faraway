/** Same-origin Next.js proxy routes (see web_app/app/api/clash/). */
function clashApiBase(): string {
  if (typeof window !== "undefined") {
    return "";
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
}

export type ClashMode = "practice" | "real_life";
export type AgentSide = "prosecution" | "defence" | "judge" | "system";
export type UserRole = "prosecution" | "defence";
export type UserAction = "argue" | "ask" | "answer";
export type DeclaredWinner = "prosecution" | "defence" | "draw";

export interface ClashMockCase {
  id: string;
  title: string;
  summary: string;
  facts: string;
  tags: string[];
}

export interface JudgeParameter {
  id: string;
  label: string;
  description?: string;
}

export interface ParameterScore {
  parameter_id: string;
  parameter_label: string;
  prosecution_score: number;
  defence_score: number;
  winner: DeclaredWinner;
  rationale: string;
}

export interface JudgeScore {
  phase?: string;
  legal_accuracy: number;
  coherence: number;
  evidence_usage: number;
  procedural_soundness: number;
  phase_fulfillment: number;
  round_total: number;
  bench_note?: string;
  parameters?: ParameterScore[];
  prosecution_average?: number;
  defence_average?: number;
  round_winner?: DeclaredWinner;
}

export interface FinalClashResult {
  overall_score: number;
  confidence_band: string;
  mock_verdict: string;
  declared_winner: DeclaredWinner;
  winner_explanation: string;
  actionability_notes: string;
  evidence_gaps: string[];
  unresolved_questions: string[];
  round_scores?: JudgeScore[];
  judge_parameters?: JudgeParameter[];
  parameter_totals?: ParameterScore[];
  prosecution_overall_average?: number;
  defence_overall_average?: number;
}

export interface RagCitation {
  act_name?: string | null;
  section_number?: string | null;
  title?: string | null;
  label?: string;
  similarity?: number;
  id?: string | number;
}

export interface ClashStreamEvent {
  event_type: string;
  session_id: string;
  mode: ClashMode;
  agent_side: AgentSide;
  phase?: string;
  content?: string;
  payload?: Record<string, unknown>;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let detail: unknown = text || res.statusText;
    try {
      detail = JSON.parse(text);
    } catch {
      /* keep text */
    }
    const err = new Error(
      typeof detail === "object" && detail && "detail" in (detail as object)
        ? JSON.stringify((detail as { detail: unknown }).detail)
        : text || res.statusText
    ) as Error & { status?: number; detail?: unknown };
    err.status = res.status;
    err.detail = typeof detail === "object" && detail && "detail" in (detail as object)
      ? (detail as { detail: unknown }).detail
      : detail;
    throw err;
  }
  return res.json();
}

function clashAuthHeaders(json = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("nyaya_access_token");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function createClashSession(
  mode: ClashMode,
  userId?: string,
  userRole: UserRole = "prosecution"
) {
  return parseJson<{
    session_id: string;
    mode: ClashMode;
    status: string;
    user_role?: UserRole;
  }>(
    await fetch(`${clashApiBase()}/api/clash/sessions`, {
      method: "POST",
      headers: clashAuthHeaders(),
      body: JSON.stringify({ mode, user_id: userId, user_role: userRole }),
    })
  );
}

export async function fetchMockCases() {
  const data = await parseJson<{ cases: ClashMockCase[] }>(
    await fetch(`${clashApiBase()}/api/clash/mock-cases`)
  );
  return data.cases;
}

export async function attachClashCase(
  sessionId: string,
  body: { title: string; facts: string; mock_case_id?: string }
) {
  return parseJson<Record<string, unknown>>(
    await fetch(`${clashApiBase()}/api/clash/sessions/${sessionId}/case`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export function streamClashDebate(sessionId: string): Promise<Response> {
  return fetch(`${clashApiBase()}/api/clash/sessions/${sessionId}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export function streamClashAnswer(
  sessionId: string,
  questionId: string,
  answer: string,
  options?: { delegate?: boolean }
): Promise<Response> {
  const delegate = Boolean(options?.delegate);
  return fetch(`${clashApiBase()}/api/clash/sessions/${sessionId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      delegate
        ? { question_id: questionId, delegate: true }
        : { question_id: questionId, answer, delegate: false }
    ),
  });
}

function looksLikeCounselJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{")) return false;
  return (
    t.includes("reasoning_steps") ||
    t.includes('"speaker"') ||
    t.includes('"argument"') ||
    t.includes("law_sections")
  );
}

function unescapeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function extractJsonStringField(text: string, field: string): string | null {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
  const match = text.match(re);
  if (!match?.[1]) return null;
  const value = unescapeJsonString(match[1]).trim();
  return value || null;
}

function extractReasoningStepsLoose(text: string): string[] {
  const re = /"reasoning_steps"\s*:\s*\[([\s\S]*?)(?:\]\s*,|\]\s*}|\]\s*$)/i;
  let body = text.match(re)?.[1];
  if (!body) {
    body = text.match(/"reasoning_steps"\s*:\s*\[([\s\S]*)$/i)?.[1];
  }
  if (!body) return [];
  const steps: string[] = [];
  for (const raw of body.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    const step = unescapeJsonString(raw[1] || "").trim();
    if (step && !["prosecution", "defence", "defense"].includes(step.toLowerCase())) {
      steps.push(step);
    }
  }
  const dangling = body.match(/(?:^|[,[])\s*"((?:\\.|[^"\\])*)$/);
  if (dangling?.[1]) {
    const step = unescapeJsonString(dangling[1]).trim();
    if (
      step &&
      !["prosecution", "defence", "defense"].includes(step.toLowerCase()) &&
      steps[steps.length - 1] !== step
    ) {
      steps.push(step);
    }
  }
  return steps;
}

/** Turn leaked counsel JSON blobs into readable courtroom text for the transcript UI. */
export function sanitizeCounselDisplayText(text: string): string {
  const trimmed = (text || "").trim();
  if (!trimmed || !looksLikeCounselJson(trimmed)) return text;

  let argument = "";
  let steps: string[] = [];
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.argument === "string") argument = parsed.argument.trim();
    else if (typeof parsed.answer === "string") argument = parsed.answer.trim();
    else if (typeof parsed.submission === "string") argument = parsed.submission.trim();
    if (Array.isArray(parsed.reasoning_steps)) {
      steps = parsed.reasoning_steps
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim());
    }
  } catch {
    argument = extractJsonStringField(trimmed, "argument") || "";
    steps = extractReasoningStepsLoose(trimmed);
  }

  if (argument && !looksLikeCounselJson(argument)) return argument;
  if (steps.length) {
    const last = steps[steps.length - 1];
    const colon = last.indexOf(":");
    if (colon > 0 && ["prosecution", "defence", "defense"].includes(last.slice(0, colon).trim().toLowerCase())) {
      return last.slice(colon + 1).trim() || last;
    }
    return last;
  }
  return "";
}
