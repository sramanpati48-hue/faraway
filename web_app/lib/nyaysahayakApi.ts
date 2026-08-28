const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return { "Content-Type": "application/json" };
  const token = localStorage.getItem("nyaya_access_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export type AiVerificationStatus = "pending" | "verified" | "flagged" | "rejected";

export class AiVerificationError extends Error {
  code?: string;
  aiVerificationStatus?: AiVerificationStatus | string;
  reason?: string;
  status: number;

  constructor(
    message: string,
    status: number,
    details?: { code?: string; ai_verification_status?: string; reason?: string }
  ) {
    super(message);
    this.name = "AiVerificationError";
    this.status = status;
    this.code = details?.code;
    this.aiVerificationStatus = details?.ai_verification_status;
    this.reason = details?.reason;
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    if (
      typeof detail === "object" &&
      detail &&
      ("code" in detail || "ai_verification_status" in detail)
    ) {
      const d = detail as {
        code?: string;
        message?: string;
        ai_verification_status?: string;
        reason?: string;
      };
      throw new AiVerificationError(
        d.message || "Case AI verification is required before booking.",
        res.status,
        d
      );
    }
    const msg =
      typeof detail === "string"
        ? detail
        : typeof detail === "object" && detail && "message" in detail
          ? String((detail as { message: string }).message)
          : "Request failed";
    throw new Error(msg);
  }
  return data as T;
}


export type LocalForum = {
  state?: string;
  institution_type?: string;
  institution_name?: string;
  regional_name?: string;
  label?: string;
  note?: string;
};

export type NodalGuideProfile = {
  uid: string;
  id?: string;
  name: string;
  location: string;
  state?: string;
  occupation: string;
  bio: string;
  avatar: string;
  contact_number: string;
  email: string;
  availability: string;
  rating: number;
  cases_resolved: number;
  languages: string[];
  institution_type?: string;
  institution_name?: string;
  regional_name?: string;
  forum_label?: string;
  forum_note?: string;
};

export async function fetchNodalGuides(args: {
  state?: string;
  lat?: number;
  lon?: number;
}): Promise<{ forum: LocalForum; guides: NodalGuideProfile[] }> {
  const params = new URLSearchParams();
  if (args.state) params.set("state", args.state);
  if (args.lat != null) params.set("lat", String(args.lat));
  if (args.lon != null) params.set("lon", String(args.lon));
  const qs = params.toString();
  return parseJson(
    await fetch(`${API_URL}/api/nodal-guides${qs ? `?${qs}` : ""}`, { headers: authHeaders() })
  );
}

export async function forwardToNodalGuide(args: {
  guideId: string;
  sessionId: string;
  caseId?: string | null;
  state?: string;
}): Promise<{
  forward: {
    role?: string;
    role_label?: string;
    target_id?: string;
    case_id?: string;
    queue_status?: string;
    follow_ups?: { statement: string; created_at?: string }[];
    pdf_url?: string;
  };
  sahayak_case_id?: string;
  guide?: NodalGuideProfile;
  forum?: LocalForum;
}> {
  return parseJson(
    await fetch(`${API_URL}/api/nodal-guides/forward`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        guide_id: args.guideId,
        session_id: args.sessionId,
        case_id: args.caseId || undefined,
        state: args.state,
      }),
    })
  );
}

export async function createNyaySahayakOrder(args: {
  sessionId: string;
  caseId?: string | null;
  state?: string;
  area?: string;
}): Promise<{
  key_id: string;
  order_id: string;
  amount: number;
  currency: string;
  sahayak?: { uid?: string; name?: string; state?: string; location?: string };
  area?: string;
}> {
  return parseJson(
    await fetch(`${API_URL}/api/nyaysahayak/book`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        session_id: args.sessionId,
        case_id: args.caseId || undefined,
        state: args.state,
        area: args.area,
      }),
    })
  );
}

export async function verifyNyaySahayakPayment(args: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  sessionId: string;
  caseId?: string | null;
  state?: string;
}): Promise<{
  thread_id?: string;
  sahayak_case_id?: string;
  area?: string;
  sahayak?: { uid?: string; name?: string; state?: string; location?: string; city?: string };
}> {
  return parseJson(
    await fetch(`${API_URL}/api/nyaysahayak/verify`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        razorpay_order_id: args.razorpay_order_id,
        razorpay_payment_id: args.razorpay_payment_id,
        razorpay_signature: args.razorpay_signature,
        session_id: args.sessionId,
        case_id: args.caseId || undefined,
        state: args.state,
      }),
    })
  );
}
