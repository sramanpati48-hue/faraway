export const PRACTICE_AREAS = [
  "Cyber & Financial Fraud",
  "Criminal Law",
  "Family & Matrimonial",
  "Property & Land",
  "Civil & Consumer Disputes",
  "Business & Employment",
  "Claims & Compensation",
] as const;

export const LAWYER_TYPES = [
  "Private Practice (PVT)",
  "Senior Counsel / Specialist",
  "Legal Aid / Pro Bono",
  "Panel / Retainer Lawyer",
  "Nyay Guide (Non-lawyer Support)",
] as const;

export const CONSULTATION_MODES = [
  "In-person",
  "Video call",
  "Phone",
  "Chat",
] as const;

export interface EducationItem {
  institution?: string;
  degree?: string;
  year?: string;
}

export interface ExperienceItem {
  title?: string;
  organization?: string;
  years?: string;
  description?: string;
}

export interface LawyerProfileExtras {
  education?: EducationItem[];
  experience_history?: ExperienceItem[];
  skills?: string[];
}

export interface LawyerProfile {
  id?: string;
  user_id?: string;
  name: string;
  email?: string;
  specialization?: string;
  lawyer_type?: string;
  experience?: number | string;
  hourly_rate?: number | string;
  bio?: string;
  about?: string;
  headline?: string;
  location?: string;
  city?: string;
  state?: string;
  rating?: number;
  avatar?: string;
  cover_image?: string;
  bar_registration_number?: string;
  contact_number?: string;
  verified?: boolean;
  practice_areas?: string[];
  courts_practiced?: string[];
  languages?: string[];
  availability_hours?: string;
  consultation_modes?: string[];
  website_url?: string;
  linkedin_url?: string;
  profile_extras?: LawyerProfileExtras;
}

export interface LawyerThread {
  id: string;
  victim_user_id: string;
  lawyer_user_id: string;
  lawyer_case_id?: string | null;
  status?: string;
  lawyer_name?: string;
  lawyer_avatar?: string;
  lawyer_specialization?: string;
  lawyer_headline?: string;
  lawyer_practice_areas?: string[];
  lawyer_rating?: number;
  lawyer_location?: string;
  lawyer_verified?: boolean;
  last_message?: string | null;
  last_message_at?: string | null;
  victim_name?: string;
  victim_email?: string;
  updated_at?: string;
  created_at?: string;
}

export interface LawyerMessage {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
}

export function normalizeLawyerProfile(raw: Record<string, unknown> | LawyerProfile | null | undefined): LawyerProfile {
  const r = (raw || {}) as Record<string, any>;
  const extras = (r.profile_extras || r.profileExtras || {}) as LawyerProfileExtras;
  const practice =
    r.practice_areas ||
    r.practiceAreas ||
    (r.specialization ? [String(r.specialization)] : []);
  return {
    id: r.id ? String(r.id) : undefined,
    user_id: r.user_id || r.userId ? String(r.user_id || r.userId) : r.id ? String(r.id) : undefined,
    name: String(r.name || "Advocate"),
    email: r.email,
    specialization: r.specialization || (Array.isArray(practice) ? practice[0] : undefined),
    lawyer_type: r.lawyer_type || r.lawyerType,
    experience: r.experience != null ? Number(r.experience) || r.experience : undefined,
    hourly_rate: r.hourly_rate != null ? Number(r.hourly_rate) || r.hourly_rate : r.hourlyRate,
    bio: r.bio,
    about: r.about || r.bio,
    headline: r.headline,
    location: r.location,
    city: r.city,
    state: r.state,
    rating: r.rating != null ? Number(r.rating) : undefined,
    avatar: r.avatar,
    cover_image: r.cover_image || r.coverImage,
    bar_registration_number: r.bar_registration_number || r.barRegistrationNumber,
    contact_number: r.contact_number || r.contactNumber,
    verified: Boolean(r.verified),
    practice_areas: Array.isArray(practice) ? practice.map(String) : [],
    courts_practiced: Array.isArray(r.courts_practiced || r.courtsPracticed)
      ? (r.courts_practiced || r.courtsPracticed).map(String)
      : [],
    languages: Array.isArray(r.languages) ? r.languages.map(String) : [],
    availability_hours: r.availability_hours || r.availabilityHours,
    consultation_modes: Array.isArray(r.consultation_modes || r.consultationModes)
      ? (r.consultation_modes || r.consultationModes).map(String)
      : [],
    website_url: r.website_url || r.websiteUrl,
    linkedin_url: r.linkedin_url || r.linkedinUrl,
    profile_extras: {
      education: Array.isArray(extras.education) ? extras.education : [],
      experience_history: Array.isArray(extras.experience_history) ? extras.experience_history : [],
      skills: Array.isArray(extras.skills) ? extras.skills : [],
    },
  };
}

export function lawyerIdOf(l: LawyerProfile): string {
  return String(l.user_id || l.id || l.name);
}
