const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const ACCESS_KEY = "nyaya_access_token";
const REFRESH_KEY = "nyaya_refresh_token";
const USER_KEY = "nyaya_user";
const ROLE_KEY = "nyaya_role";

export class NyayGuideApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = "NyayGuideApiError";
    this.status = status;
    this.code = code;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

export async function tryRefreshAccessToken(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refresh = localStorage.getItem(REFRESH_KEY);
    if (!refresh) return false;

    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });

      if (!res.ok) {
        clearNyayGuideSession();
        return false;
      }

      const data = await res.json().catch(() => ({}));
      if (!data.access_token) {
        clearNyayGuideSession();
        return false;
      }

      localStorage.setItem(ACCESS_KEY, data.access_token);
      if (data.refresh_token) {
        localStorage.setItem(REFRESH_KEY, data.refresh_token);
      }
      if (data.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        const role = String(data.user.role || "").toLowerCase();
        if (role && role !== "victim") {
          localStorage.setItem(ROLE_KEY, role);
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export function clearNyayGuideSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROLE_KEY);
}

export async function authenticatedNyayGuideFetch<T = any>(
  path: string,
  init?: RequestInit,
  retried = false,
  tokenOverride?: string | null
): Promise<T> {
  const token =
    tokenOverride ||
    (typeof window !== "undefined" ? localStorage.getItem(ACCESS_KEY) : null);

  if (!token) {
    throw new NyayGuideApiError("Please sign in again.", 401, "MISSING_TOKEN");
  }

  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(init?.headers as Record<string, string> || {}),
  };

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (res.ok) {
    return data as T;
  }

  const status = res.status;
  const detail = data?.detail;
  const rawMessage =
    typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((d: any) => (typeof d === "string" ? d : d?.msg || JSON.stringify(d))).join("; ")
        : "";

  // 401: Token expired or invalid -> attempt token refresh exactly once
  if (status === 401) {
    if (!retried) {
      const refreshed = await tryRefreshAccessToken();
      if (refreshed) {
        return authenticatedNyayGuideFetch<T>(path, init, true, null);
      }
    }
    clearNyayGuideSession();
    throw new NyayGuideApiError("Your session expired. Please sign in again.", 401, "SESSION_EXPIRED");
  }

  // 403: Forbidden (user authenticated but lacks access to the case)
  if (status === 403) {
    throw new NyayGuideApiError(
      "You are not authorized to request assistance for this case.",
      403,
      "FORBIDDEN"
    );
  }

  // 409: Conflict (request already active)
  if (status === 409) {
    throw new NyayGuideApiError(
      rawMessage || "A NyayGuide request is already active for this case.",
      409,
      "ALREADY_ACTIVE"
    );
  }

  // 422: Validation error
  if (status === 422 || status === 400) {
    throw new NyayGuideApiError(
      rawMessage && !rawMessage.toLowerCase().includes("token")
        ? rawMessage
        : "Please confirm the assistance request and required details.",
      status,
      "VALIDATION_ERROR"
    );
  }

  // 5xx / other server errors
  throw new NyayGuideApiError(
    rawMessage || "We could not start the NyayGuide search. Please retry.",
    status,
    "SERVER_ERROR"
  );
}

export type NyayGuideRequestStatus =
  | "REQUESTED"
  | "SEARCHING"
  | "OFFER_SENT"
  | "MATCHED"
  | "NYAYGUIDE_EN_ROUTE"
  | "NYAYGUIDE_ARRIVED"
  | "ASSISTANCE_ACTIVE"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "NO_NYAYGUIDE_AVAILABLE"
  | "FAILED";

export type NyayGuideProfile = {
  id: string;
  user_id?: string;
  display_name: string;
  profile_photo_url?: string | null;
  gender?: string | null;
  languages: string[];
  specializations?: string[];
  availability_status?: string;
  verification_status?: string;
  rating: number;
};

export type NyayGuideRequest = {
  id: string;
  case_id: string;
  user_id: string;
  assistance_type: string;
  safe_task_summary: string;
  risk_flags?: string[];
  preferred_gender?: string | null;
  location_consent_at?: string | null;
  location_consented?: boolean;
  user_latitude?: number | null;
  user_longitude?: number | null;
  status: NyayGuideRequestStatus;
  assigned_nyayguide_id?: string | null;
  assigned_nyayguide?: NyayGuideProfile | null;
  search_radius_km: number;
  requested_at: string;
  accepted_at?: string | null;
  nyayguide_en_route_at?: string | null;
  nyayguide_arrived_at?: string | null;
  assistance_started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  completion_notes?: string | null;
  citizen_rating?: number | null;
  citizen_feedback?: string | null;
  failure_reason?: string | null;
  current_offer?: {
    id: string;
    distance_km?: number | null;
    estimated_minutes?: number | null;
    expires_at: string;
  } | null;
};

export type NyayGuideConsoleOffer = {
  id: string;
  request_id: string;
  distance_km?: number | null;
  estimated_minutes?: number | null;
  expires_at: string;
  assistance_type: string;
  safe_task_summary: string;
  preferred_gender?: string | null;
};

export type NyayGuideConsoleStatus = {
  status: "success" | "unregistered";
  message?: string;
  guide?: NyayGuideProfile;
  pending_offers: NyayGuideConsoleOffer[];
  active_request?: NyayGuideRequest | null;
  available_demo_guides?: {
    id: string;
    user_id: string;
    display_name: string;
    gender?: string;
    languages: string[];
    availability_status: string;
    rating: number;
  }[];
};

export async function createNyayGuideRequest(
  params: {
    case_id: string;
    assistance_type: string;
    location_consent: boolean;
    latitude?: number | null;
    longitude?: number | null;
    preferred_gender?: string | null;
    confirmed: boolean;
    idempotency_key?: string;
  },
  tokenOverride?: string | null
): Promise<NyayGuideRequest> {
  const data = await authenticatedNyayGuideFetch<{ status: string; request: NyayGuideRequest }>(
    "/api/nyayguide/requests",
    {
      method: "POST",
      body: JSON.stringify(params),
    },
    false,
    tokenOverride
  );
  return data.request;
}

export async function fetchNyayGuideRequest(requestId: string, tokenOverride?: string | null): Promise<NyayGuideRequest> {
  const data = await authenticatedNyayGuideFetch<{ status: string; request: NyayGuideRequest }>(
    `/api/nyayguide/requests/${requestId}`,
    undefined,
    false,
    tokenOverride
  );
  return data.request;
}

export async function fetchActiveCaseRequest(caseId: string, tokenOverride?: string | null): Promise<NyayGuideRequest | null> {
  try {
    const data = await authenticatedNyayGuideFetch<{ status: string; request: NyayGuideRequest | null }>(
      `/api/nyayguide/requests/by-case/${encodeURIComponent(caseId)}`,
      undefined,
      false,
      tokenOverride
    );
    return data.request || null;
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403 || err?.status === 404) {
      return null;
    }
    return null;
  }
}

export async function cancelNyayGuideRequest(requestId: string, reason?: string, tokenOverride?: string | null): Promise<NyayGuideRequest> {
  const data = await authenticatedNyayGuideFetch<{ status: string; request: NyayGuideRequest }>(
    `/api/nyayguide/requests/${requestId}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ reason: reason || "Citizen cancelled" }),
    },
    false,
    tokenOverride
  );
  return data.request;
}

export async function acceptOffer(offerId: string, tokenOverride?: string | null): Promise<any> {
  const data = await authenticatedNyayGuideFetch<{ status: string; request: any }>(
    `/api/nyayguide/offers/${offerId}/accept`,
    {
      method: "POST",
    },
    false,
    tokenOverride
  );
  return data.request;
}

export async function rejectOffer(offerId: string, tokenOverride?: string | null): Promise<any> {
  const data = await authenticatedNyayGuideFetch<{ status: string; request: any }>(
    `/api/nyayguide/offers/${offerId}/reject`,
    {
      method: "POST",
    },
    false,
    tokenOverride
  );
  return data.request;
}

export async function markRequestEnRoute(requestId: string, tokenOverride?: string | null): Promise<any> {
  const data = await authenticatedNyayGuideFetch<{ status: string; request: any }>(
    `/api/nyayguide/requests/${requestId}/en-route`,
    {
      method: "POST",
    },
    false,
    tokenOverride
  );
  return data.request;
}

export async function markRequestArrived(requestId: string, tokenOverride?: string | null): Promise<any> {
  const data = await authenticatedNyayGuideFetch<{ status: string; request: any }>(
    `/api/nyayguide/requests/${requestId}/arrived`,
    {
      method: "POST",
    },
    false,
    tokenOverride
  );
  return data.request;
}

export async function startRequestAssistance(requestId: string, tokenOverride?: string | null): Promise<any> {
  const data = await authenticatedNyayGuideFetch<{ status: string; request: any }>(
    `/api/nyayguide/requests/${requestId}/start-assistance`,
    {
      method: "POST",
    },
    false,
    tokenOverride
  );
  return data.request;
}

export async function completeRequestAssistance(requestId: string, notes?: string, tokenOverride?: string | null): Promise<any> {
  const data = await authenticatedNyayGuideFetch<{ status: string; request: any }>(
    `/api/nyayguide/requests/${requestId}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ completion_notes: notes }),
    },
    false,
    tokenOverride
  );
  return data.request;
}

export async function fetchNyayGuideConsoleStatus(guideUserId?: string, tokenOverride?: string | null): Promise<NyayGuideConsoleStatus> {
  const url = guideUserId
    ? `/api/nyayguide/console/status?guide_user_id=${encodeURIComponent(guideUserId)}`
    : `/api/nyayguide/console/status`;
  const data = await authenticatedNyayGuideFetch<NyayGuideConsoleStatus>(url, undefined, false, tokenOverride);
  return data;
}

export async function updateNyayGuideAvailability(
  availability_status: string,
  guideUserId?: string,
  tokenOverride?: string | null
): Promise<any> {
  const url = guideUserId
    ? `/api/nyayguide/console/availability?guide_user_id=${encodeURIComponent(guideUserId)}`
    : `/api/nyayguide/console/availability`;
  const data = await authenticatedNyayGuideFetch<{ status: string; availability_status: string }>(
    url,
    {
      method: "POST",
      body: JSON.stringify({ availability_status }),
    },
    false,
    tokenOverride
  );
  return data;
}
