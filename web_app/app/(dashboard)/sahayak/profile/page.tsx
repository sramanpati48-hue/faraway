"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Save, User, Phone, MapPin, Briefcase, Globe, Camera, Loader2,
  CheckCircle2, AlertCircle, HeartHandshake, Languages, Star
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Image from "next/image";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const LANGUAGES_OPTIONS = [
  "Hindi", "English", "Bengali", "Telugu", "Marathi",
  "Tamil", "Gujarati", "Kannada", "Malayalam", "Odia", "Punjabi"
];

export default function SahayakProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  const [profile, setProfile] = useState({
    name: "",
    email: "",
    contactNumber: "",
    location: "",
    city: "",
    state: "",
    occupation: "",
    bio: "",
    avatar: "",
    availability: "Available",
    languages: [] as string[],
  });
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (authLoading || !mounted) return;
    if (!user) { router.push("/login"); return; }
    fetchProfile();
  }, [user, authLoading, mounted]);

  const fetchProfile = async () => {
    if (!user) return;
    setLoadingProfile(true);
    try {
      const res = await fetch(`${API_URL}/api/sahayak/profile/${user.uid}`);
      const data = await res.json();
      if (data.profile) {
        const p = data.profile;
        setProfile({
          name: p.name || user.display_name || "",
          email: p.email || user.email || "",
          contactNumber: p.contact_number || "",
          location: p.location || "",
          city: p.city || "",
          state: p.state || "",
          occupation: p.occupation || "",
          bio: p.bio || "",
          avatar: p.avatar || "",
          availability: p.availability || "Available",
          languages: p.languages || [],
        });
        if (p.avatar) setAvatarPreview(p.avatar);
      } else {
        setProfile(prev => ({
          ...prev,
          name: user.display_name || "",
          email: user.email || "",
        }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingProfile(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    // Local preview
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    // Upload
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_URL}/api/upload-avatar`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) setProfile(p => ({ ...p, avatar: data.url }));
    } catch { /* no avatar upload endpoint yet, just use preview */ }
  };

  const toggleLanguage = (lang: string) => {
    setProfile(p => ({
      ...p,
      languages: p.languages.includes(lang)
        ? p.languages.filter(l => l !== lang)
        : [...p.languages, lang],
    }));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setSaveStatus("idle");
    try {
      const location =
        profile.location ||
        [profile.city, profile.state].filter(Boolean).join(", ");
      const res = await fetch(`${API_URL}/api/sahayak/profile/${user.uid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profile,
          location,
          city: profile.city || undefined,
          state: profile.state || undefined,
        }),
      });
      setSaveStatus(res.ok ? "success" : "error");
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  const avatarSrc = avatarPreview || profile.avatar ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name || "N")}&background=1e3a6e&color=fff&size=128`;

  if (!mounted || authLoading || loadingProfile) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-2 sm:px-4 py-4 sm:py-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-blue-900 rounded-2xl flex items-center justify-center shrink-0">
                <HeartHandshake className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="font-black text-gray-900 text-xl sm:text-2xl">Nyay Guide Profile</h1>
                <p className="text-sm text-gray-500">Your public profile visible to those seeking help</p>
              </div>
            </div>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-900 hover:bg-blue-800 text-white font-black rounded-2xl text-sm transition-all shadow-lg shadow-blue-900/20 disabled:opacity-50 shrink-0"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </div>

          {/* Save status */}
          {saveStatus !== "idle" && (
            <div className={`flex items-center gap-3 p-4 rounded-2xl mb-6 border ${
              saveStatus === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"
            }`}>
              {saveStatus === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <span className="font-bold text-sm">
                {saveStatus === "success" ? "Profile saved successfully!" : "Failed to save. Please try again."}
              </span>
            </div>
          )}

          {/* Avatar Section */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-6">
            <div className="flex items-center gap-6">
              <div className="relative">
                <div className="w-24 h-24 rounded-3xl overflow-hidden ring-4 ring-white shadow-lg">
                  <Image src={avatarSrc} alt="Avatar" width={96} height={96} className="object-cover" unoptimized />
                </div>
                <button onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-2 -right-2 w-8 h-8 bg-blue-900 rounded-xl flex items-center justify-center text-white shadow-md hover:bg-blue-700 transition-colors"
                >
                  <Camera size={14} />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </div>
              <div>
                <h3 className="font-black text-gray-900 text-lg">{profile.name || "Your Name"}</h3>
                <p className="text-sm text-gray-500">{profile.occupation || "Nyay Guide"}</p>
                <div className="flex items-center gap-4 mt-2">
                  <div
                    className={
                      profile.availability === "Available"
                        ? "flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 transition-colors cursor-pointer"
                        : "flex items-center gap-1.5 rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-800 transition-colors cursor-pointer"
                    }
                    onClick={() => setProfile(p => ({ ...p, availability: p.availability === "Available" ? "Busy" : "Available" }))}
                  >
                    <div
                      className={
                        profile.availability === "Available"
                          ? "h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
                          : "h-2 w-2 rounded-full bg-slate-600"
                      }
                    />
                    {profile.availability}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Personal Info */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-6">
            <h2 className="font-black text-gray-900 mb-4 flex items-center gap-2">
              <User size={16} className="text-blue-900" /> Personal Information
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Full Name", key: "name", icon: User, placeholder: "Your name" },
                { label: "Email", key: "email", icon: User, placeholder: "your@email.com" },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">{f.label}</label>
                  <input
                    value={profile[f.key as keyof typeof profile] as string}
                    onChange={e => setProfile(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent transition-all"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">Contact Number</label>
                <input
                  value={profile.contactNumber}
                  onChange={e => setProfile(p => ({ ...p, contactNumber: e.target.value }))}
                  placeholder="+91 9876543210"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">City</label>
                <input
                  value={profile.city}
                  onChange={e => setProfile(p => ({ ...p, city: e.target.value }))}
                  placeholder="e.g. Delhi"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">State</label>
                <input
                  value={profile.state}
                  onChange={e => setProfile(p => ({ ...p, state: e.target.value }))}
                  placeholder="e.g. Delhi"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">Location label</label>
                <input
                  value={profile.location}
                  onChange={e => setProfile(p => ({ ...p, location: e.target.value }))}
                  placeholder="City, District, State (auto-filled from city/state if empty)"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">Occupation / Role</label>
                <input
                  value={profile.occupation}
                  onChange={e => setProfile(p => ({ ...p, occupation: e.target.value }))}
                  placeholder="e.g. Social Worker, Paralegal, Community Volunteer"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">Bio</label>
                <textarea
                  value={profile.bio}
                  onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))}
                  placeholder="Tell people about your experience helping with legal matters..."
                  rows={3}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent resize-none"
                />
              </div>
            </div>
          </div>

          {/* Languages */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-black text-gray-900 mb-4 flex items-center gap-2">
              <Globe size={16} className="text-blue-900" /> Languages Spoken
            </h2>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES_OPTIONS.map(lang => (
                <button key={lang} onClick={() => toggleLanguage(lang)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                    profile.languages.includes(lang)
                      ? "bg-blue-900 text-white border-blue-900 shadow-sm"
                      : "bg-gray-50 text-gray-600 border-gray-200 hover:border-blue-300"
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
    </div>
  );
}
