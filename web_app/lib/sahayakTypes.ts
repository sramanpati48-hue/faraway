export interface SahayakProfile {
  uid: string;
  id?: string;
  name: string;
  location?: string;
  city?: string;
  state?: string;
  occupation?: string;
  bio?: string;
  avatar?: string;
  contact_number?: string;
  email?: string;
  availability?: string;
  rating?: number;
  cases_resolved?: number;
  languages?: string[];
  isAssigned?: boolean;
}

export interface SahayakThread {
  id: string;
  victim_user_id: string;
  sahayak_user_id: string;
  sahayak_case_id?: string | null;
  status?: string;
  sahayak_name?: string;
  sahayak_avatar?: string;
  sahayak_occupation?: string;
  sahayak_location?: string;
  sahayak_city?: string;
  sahayak_state?: string;
  sahayak_rating?: number;
  sahayak_bio?: string;
  sahayak_languages?: string[];
  sahayak_availability?: string;
  sahayak_contact?: string;
  sahayak_email?: string;
  sahayak_cases_resolved?: number;
  last_message?: string | null;
  last_message_at?: string | null;
  victim_name?: string;
  victim_email?: string;
  updated_at?: string;
  created_at?: string;
}

export interface SahayakMessage {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
}

export function sahayakIdOf(s: SahayakProfile | null | undefined): string {
  if (!s) return "";
  return String(s.uid || s.id || "");
}

export function normalizeSahayakProfile(
  raw: Record<string, unknown> | SahayakProfile | null | undefined
): SahayakProfile {
  const r = (raw || {}) as Record<string, any>;
  const city = r.city || r.sahayak_city || "";
  const state = r.state || r.sahayak_state || "";
  const loc =
    r.location ||
    r.sahayak_location ||
    [city, state].filter(Boolean).join(", ") ||
    "";
  return {
    uid: String(r.uid || r.sahayak_user_id || r.id || ""),
    id: r.id ? String(r.id) : undefined,
    name: String(r.name || r.sahayak_name || "Nyay Guide"),
    location: loc,
    city: city || undefined,
    state: state || undefined,
    occupation: r.occupation || r.sahayak_occupation || "Community Legal Aid",
    bio: r.bio || r.sahayak_bio || "",
    avatar: r.avatar || r.sahayak_avatar || "",
    contact_number: r.contact_number || r.contactNumber || r.sahayak_contact || "",
    email: r.email || r.sahayak_email || "",
    availability: r.availability || r.sahayak_availability || "Available",
    rating: Number(r.rating ?? r.sahayak_rating ?? 4.5),
    cases_resolved: Number(r.cases_resolved ?? r.sahayak_cases_resolved ?? 0),
    languages: Array.isArray(r.languages)
      ? r.languages
      : Array.isArray(r.sahayak_languages)
        ? r.sahayak_languages
        : [],
    isAssigned: Boolean(r.isAssigned),
  };
}
