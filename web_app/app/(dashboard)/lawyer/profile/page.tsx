"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  Save, Loader2, Pencil, X, Plus, Trash2, Camera, CheckCircle2, AlertCircle,
} from "lucide-react";
import {
  PRACTICE_AREAS,
  LAWYER_TYPES,
  CONSULTATION_MODES,
  type EducationItem,
  type ExperienceItem,
  type LawyerProfile,
  normalizeLawyerProfile,
} from "@/lib/lawyerTypes";
import { LawyerProfileSheet } from "@/components/lawyer/LawyerProfileSheet";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type FormState = {
  name: string;
  email: string;
  contactNumber: string;
  location: string;
  city: string;
  state: string;
  headline: string;
  about: string;
  specialization: string;
  practiceAreas: string[];
  lawyerType: string;
  experience: number;
  hourlyRate: number;
  barRegistrationNumber: string;
  avatar: string;
  coverImage: string;
  courtsPracticed: string[];
  languages: string[];
  availabilityHours: string;
  consultationModes: string[];
  websiteUrl: string;
  linkedinUrl: string;
  education: EducationItem[];
  experienceHistory: ExperienceItem[];
  skills: string[];
};

const emptyForm = (user?: { display_name?: string | null; email?: string | null } | null): FormState => ({
  name: user?.display_name || "",
  email: user?.email || "",
  contactNumber: "",
  location: "",
  city: "",
  state: "",
  headline: "",
  about: "",
  specialization: PRACTICE_AREAS[0],
  practiceAreas: [PRACTICE_AREAS[0]],
  lawyerType: LAWYER_TYPES[0],
  experience: 5,
  hourlyRate: 2000,
  barRegistrationNumber: "",
  avatar: "",
  coverImage: "",
  courtsPracticed: [],
  languages: ["English", "Hindi"],
  availabilityHours: "9 AM – 6 PM",
  consultationModes: ["Chat", "Phone"],
  websiteUrl: "",
  linkedinUrl: "",
  education: [],
  experienceHistory: [],
  skills: [],
});

export default function LawyerProfilePage() {
  const { user, accessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [form, setForm] = useState<FormState>(() => emptyForm(user));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState("");
  const [courtDraft, setCourtDraft] = useState("");
  const [langDraft, setLangDraft] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/lawyer/profile/${user.uid}`);
        if (res.ok) {
          const data = await res.json();
          const p = normalizeLawyerProfile(data.profile);
          setForm({
            name: p.name || user.display_name || "",
            email: p.email || user.email || "",
            contactNumber: p.contact_number || "",
            location: p.location || "",
            city: p.city || "",
            state: p.state || "",
            headline: p.headline || "",
            about: p.about || p.bio || "",
            specialization: p.specialization || PRACTICE_AREAS[0],
            practiceAreas: p.practice_areas?.length ? p.practice_areas : [p.specialization || PRACTICE_AREAS[0]],
            lawyerType: p.lawyer_type || LAWYER_TYPES[0],
            experience: Number(p.experience) || 0,
            hourlyRate: Number(p.hourly_rate) || 0,
            barRegistrationNumber: p.bar_registration_number || "",
            avatar: p.avatar || "",
            coverImage: p.cover_image || "",
            courtsPracticed: p.courts_practiced || [],
            languages: p.languages || [],
            availabilityHours: p.availability_hours || "9 AM – 6 PM",
            consultationModes: p.consultation_modes || [],
            websiteUrl: p.website_url || "",
            linkedinUrl: p.linkedin_url || "",
            education: p.profile_extras?.education || [],
            experienceHistory: p.profile_extras?.experience_history || [],
            skills: p.profile_extras?.skills || [],
          });
        } else {
          setForm(emptyForm(user));
          setIsEditing(true);
        }
      } catch {
        setForm(emptyForm(user));
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const toggleArea = (area: string) => {
    setForm((prev) => {
      const has = prev.practiceAreas.includes(area);
      const next = has
        ? prev.practiceAreas.filter((a) => a !== area)
        : [...prev.practiceAreas, area];
      return {
        ...prev,
        practiceAreas: next.length ? next : [area],
        specialization: next[0] || area,
      };
    });
  };

  const toggleMode = (mode: string) => {
    setForm((prev) => {
      const has = prev.consultationModes.includes(mode);
      return {
        ...prev,
        consultationModes: has
          ? prev.consultationModes.filter((m) => m !== mode)
          : [...prev.consultationModes, mode],
      };
    });
  };

  const toPreviewLawyer = (): LawyerProfile =>
    normalizeLawyerProfile({
      user_id: user?.uid,
      name: form.name,
      email: form.email,
      specialization: form.specialization,
      lawyer_type: form.lawyerType,
      experience: form.experience,
      hourly_rate: form.hourlyRate,
      about: form.about,
      bio: form.about,
      headline: form.headline,
      location: form.location || [form.city, form.state].filter(Boolean).join(", "),
      city: form.city,
      state: form.state,
      avatar: avatarPreview || form.avatar,
      cover_image: form.coverImage,
      bar_registration_number: form.barRegistrationNumber,
      contact_number: form.contactNumber,
      practice_areas: form.practiceAreas,
      courts_practiced: form.courtsPracticed,
      languages: form.languages,
      availability_hours: form.availabilityHours,
      consultation_modes: form.consultationModes,
      website_url: form.websiteUrl,
      linkedin_url: form.linkedinUrl,
      profile_extras: {
        education: form.education,
        experience_history: form.experienceHistory,
        skills: form.skills,
      },
      verified: false,
      rating: 4.5,
    });

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setStatus("idle");
    try {
      let avatarUrl = form.avatar;
      if (avatarFile) {
        const fd = new FormData();
        fd.append("uid", user.uid);
        fd.append("avatar", avatarFile);
        const uploadRes = await fetch("/api/lawyer/profile", { method: "PUT", body: fd });
        if (uploadRes.ok) {
          const up = await uploadRes.json();
          avatarUrl = up.avatarUrl || avatarUrl;
        }
      }
      const location =
        form.location || [form.city, form.state].filter(Boolean).join(", ");
      const payload = {
        uid: user.uid,
        name: form.name,
        email: form.email,
        specialization: form.practiceAreas[0] || form.specialization,
        lawyerType: form.lawyerType,
        experience: form.experience,
        hourlyRate: form.hourlyRate,
        bio: form.about,
        about: form.about,
        headline: form.headline,
        location,
        city: form.city,
        state: form.state,
        avatar: avatarUrl,
        coverImage: form.coverImage,
        barRegistrationNumber: form.barRegistrationNumber,
        contactNumber: form.contactNumber,
        practiceAreas: form.practiceAreas,
        courtsPracticed: form.courtsPracticed,
        languages: form.languages,
        availabilityHours: form.availabilityHours,
        consultationModes: form.consultationModes,
        websiteUrl: form.websiteUrl,
        linkedinUrl: form.linkedinUrl,
        profileExtras: {
          education: form.education,
          experience_history: form.experienceHistory,
          skills: form.skills,
        },
      };
      const res = await fetch(`${API_URL}/api/lawyers/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("save failed");
      setForm((f) => ({ ...f, avatar: avatarUrl, location }));
      setAvatarFile(null);
      setStatus("success");
      setIsEditing(false);
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-[#00634B]">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900">Professional profile</h1>
          <p className="text-sm text-gray-500 mt-1">
            Build a LinkedIn-style directory listing clients can trust.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            Preview
          </button>
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-700 inline-flex items-center gap-1.5"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-[#00634B] text-white text-sm font-bold inline-flex items-center gap-1.5 hover:bg-[#004D3C] disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save profile
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="px-4 py-2 rounded-xl bg-[#00634B] text-white text-sm font-bold inline-flex items-center gap-1.5 hover:bg-[#004D3C]"
            >
              <Pencil className="w-4 h-4" /> Edit profile
            </button>
          )}
        </div>
      </div>

      {status === "success" && (
        <p className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
          <CheckCircle2 className="w-4 h-4" /> Profile updated and live in the directory.
        </p>
      )}
      {status === "error" && (
        <p className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <AlertCircle className="w-4 h-4" /> Failed to update profile. Try again.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <Card title="About">
            <div className="flex items-center gap-4 mb-4">
              <button
                type="button"
                disabled={!isEditing}
                onClick={() => avatarInputRef.current?.click()}
                className="relative h-20 w-20 rounded-2xl overflow-hidden border-2 border-[#00634B]/15 bg-[#E6F0ED] flex-shrink-0"
              >
                {(avatarPreview || form.avatar) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarPreview || form.avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl font-black text-[#00634B]">
                    {(form.name || "A").charAt(0)}
                  </span>
                )}
                {isEditing && (
                  <span className="absolute inset-0 bg-black/35 flex items-center justify-center text-white">
                    <Camera className="w-5 h-5" />
                  </span>
                )}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setAvatarFile(f);
                  setAvatarPreview(URL.createObjectURL(f));
                }}
              />
              <div className="flex-1 min-w-0 space-y-2">
                <Field label="Full name" value={form.name} disabled={!isEditing} onChange={(v) => setForm({ ...form, name: v })} />
                <Field label="Headline" value={form.headline} disabled={!isEditing} placeholder="e.g. Criminal defence counsel | Missing persons & FIR matters" onChange={(v) => setForm({ ...form, headline: v })} />
              </div>
            </div>
            <Field label="About" value={form.about} disabled={!isEditing} textarea onChange={(v) => setForm({ ...form, about: v })} />
          </Card>

          <Card title="Practice">
            <p className="text-xs text-gray-500 mb-2">Practice areas (select all that apply)</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {PRACTICE_AREAS.map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled={!isEditing}
                  onClick={() => toggleArea(a)}
                  className={`px-3 py-2 rounded-xl text-[11px] font-bold transition-all ${
                    form.practiceAreas.includes(a)
                      ? "bg-[#00634B] text-white"
                      : "bg-gray-50 text-gray-500 border border-gray-100"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <label className="block mb-3">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Engagement model</span>
              <select
                disabled={!isEditing}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm disabled:bg-gray-50"
                value={form.lawyerType}
                onChange={(e) => setForm({ ...form, lawyerType: e.target.value })}
              >
                {LAWYER_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Years of experience" type="number" value={String(form.experience)} disabled={!isEditing} onChange={(v) => setForm({ ...form, experience: Number(v) || 0 })} />
              <Field label="Hourly rate (₹)" type="number" value={String(form.hourlyRate)} disabled={!isEditing} onChange={(v) => setForm({ ...form, hourlyRate: Number(v) || 0 })} />
            </div>
            <TagEditor
              label="Courts practiced"
              values={form.courtsPracticed}
              draft={courtDraft}
              setDraft={setCourtDraft}
              disabled={!isEditing}
              onAdd={() => {
                if (!courtDraft.trim()) return;
                setForm({ ...form, courtsPracticed: [...form.courtsPracticed, courtDraft.trim()] });
                setCourtDraft("");
              }}
              onRemove={(i) => setForm({ ...form, courtsPracticed: form.courtsPracticed.filter((_, idx) => idx !== i) })}
            />
            <TagEditor
              label="Languages"
              values={form.languages}
              draft={langDraft}
              setDraft={setLangDraft}
              disabled={!isEditing}
              onAdd={() => {
                if (!langDraft.trim()) return;
                setForm({ ...form, languages: [...form.languages, langDraft.trim()] });
                setLangDraft("");
              }}
              onRemove={(i) => setForm({ ...form, languages: form.languages.filter((_, idx) => idx !== i) })}
            />
            <TagEditor
              label="Skills"
              values={form.skills}
              draft={skillDraft}
              setDraft={setSkillDraft}
              disabled={!isEditing}
              onAdd={() => {
                if (!skillDraft.trim()) return;
                setForm({ ...form, skills: [...form.skills, skillDraft.trim()] });
                setSkillDraft("");
              }}
              onRemove={(i) => setForm({ ...form, skills: form.skills.filter((_, idx) => idx !== i) })}
            />
          </Card>

          <Card title="Experience">
            {form.experienceHistory.map((ex, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 mb-3 space-y-2">
                <div className="flex justify-between">
                  <p className="text-xs font-bold text-gray-400 uppercase">Role {i + 1}</p>
                  {isEditing && (
                    <button type="button" onClick={() => setForm({ ...form, experienceHistory: form.experienceHistory.filter((_, idx) => idx !== i) })}>
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  )}
                </div>
                <Field label="Title" value={ex.title || ""} disabled={!isEditing} onChange={(v) => {
                  const next = [...form.experienceHistory];
                  next[i] = { ...next[i], title: v };
                  setForm({ ...form, experienceHistory: next });
                }} />
                <Field label="Organization" value={ex.organization || ""} disabled={!isEditing} onChange={(v) => {
                  const next = [...form.experienceHistory];
                  next[i] = { ...next[i], organization: v };
                  setForm({ ...form, experienceHistory: next });
                }} />
                <Field label="Years" value={ex.years || ""} disabled={!isEditing} placeholder="2019 – Present" onChange={(v) => {
                  const next = [...form.experienceHistory];
                  next[i] = { ...next[i], years: v };
                  setForm({ ...form, experienceHistory: next });
                }} />
              </div>
            ))}
            {isEditing && (
              <button
                type="button"
                onClick={() => setForm({ ...form, experienceHistory: [...form.experienceHistory, {}] })}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-[#00634B]"
              >
                <Plus className="w-4 h-4" /> Add experience
              </button>
            )}
          </Card>

          <Card title="Education">
            {form.education.map((ed, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 mb-3 space-y-2">
                <div className="flex justify-between">
                  <p className="text-xs font-bold text-gray-400 uppercase">School {i + 1}</p>
                  {isEditing && (
                    <button type="button" onClick={() => setForm({ ...form, education: form.education.filter((_, idx) => idx !== i) })}>
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  )}
                </div>
                <Field label="Institution" value={ed.institution || ""} disabled={!isEditing} onChange={(v) => {
                  const next = [...form.education];
                  next[i] = { ...next[i], institution: v };
                  setForm({ ...form, education: next });
                }} />
                <Field label="Degree" value={ed.degree || ""} disabled={!isEditing} onChange={(v) => {
                  const next = [...form.education];
                  next[i] = { ...next[i], degree: v };
                  setForm({ ...form, education: next });
                }} />
                <Field label="Year" value={ed.year || ""} disabled={!isEditing} onChange={(v) => {
                  const next = [...form.education];
                  next[i] = { ...next[i], year: v };
                  setForm({ ...form, education: next });
                }} />
              </div>
            ))}
            {isEditing && (
              <button
                type="button"
                onClick={() => setForm({ ...form, education: [...form.education, {}] })}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-[#00634B]"
              >
                <Plus className="w-4 h-4" /> Add education
              </button>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Contact & availability">
            <Field label="Email" value={form.email} disabled={!isEditing} onChange={(v) => setForm({ ...form, email: v })} />
            <Field label="Phone" value={form.contactNumber} disabled={!isEditing} onChange={(v) => setForm({ ...form, contactNumber: v })} />
            <Field label="Bar registration" value={form.barRegistrationNumber} disabled={!isEditing} onChange={(v) => setForm({ ...form, barRegistrationNumber: v })} />
            <Field label="City" value={form.city} disabled={!isEditing} onChange={(v) => setForm({ ...form, city: v })} />
            <Field label="State" value={form.state} disabled={!isEditing} onChange={(v) => setForm({ ...form, state: v })} />
            <Field label="Location display" value={form.location} disabled={!isEditing} placeholder="Kolkata, West Bengal" onChange={(v) => setForm({ ...form, location: v })} />
            <Field label="Availability hours" value={form.availabilityHours} disabled={!isEditing} onChange={(v) => setForm({ ...form, availabilityHours: v })} />
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mt-3 mb-2">Consultation modes</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {CONSULTATION_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={!isEditing}
                  onClick={() => toggleMode(m)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold ${
                    form.consultationModes.includes(m) ? "bg-[#00634B] text-white" : "bg-gray-50 text-gray-500"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <Field label="Website" value={form.websiteUrl} disabled={!isEditing} onChange={(v) => setForm({ ...form, websiteUrl: v })} />
            <Field label="LinkedIn URL" value={form.linkedinUrl} disabled={!isEditing} onChange={(v) => setForm({ ...form, linkedinUrl: v })} />
          </Card>
        </div>
      </div>

      <LawyerProfileSheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        lawyer={toPreviewLawyer()}
        accessToken={accessToken}
        currentUserId={user?.uid}
        showConnect={false}
      />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm shadow-gray-200/30">
      <h2 className="text-sm font-black uppercase tracking-wider text-[#00634B] mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  textarea,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  textarea?: boolean;
  type?: string;
  placeholder?: string;
}) {
  const cls =
    "mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#00634B]/25 focus:border-[#00634B]";
  return (
    <label className="block mb-3">
      <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{label}</span>
      {textarea ? (
        <textarea
          className={`${cls} min-h-[100px]`}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={type}
          className={cls}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function TagEditor({
  label,
  values,
  draft,
  setDraft,
  onAdd,
  onRemove,
  disabled,
}: {
  label: string;
  values: string[];
  draft: string;
  setDraft: (v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 mb-2">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-[#E6F0ED] px-2.5 py-1 text-[11px] font-semibold text-[#00634B]">
            {v}
            {!disabled && (
              <button type="button" onClick={() => onRemove(i)} className="text-[#00634B]/70 hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAdd();
              }
            }}
            placeholder={`Add ${label.toLowerCase()}`}
          />
          <button type="button" onClick={onAdd} className="px-3 rounded-xl bg-[#E6F0ED] text-[#00634B]">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
