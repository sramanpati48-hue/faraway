"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface Lawyer {
    id: string;
    user_id?: string;
    name: string;
    specialization: string;
    lawyerType: string;
    experience: number;
    hourlyRate: number;
    rating: number;
    bio: string;
    about?: string;
    headline?: string;
    avatar: string;
    location: string;
    verified: boolean;
    practice_areas?: string[];
    courts_practiced?: string[];
    languages?: string[];
    availability_hours?: string;
    consultation_modes?: string[];
    website_url?: string;
    linkedin_url?: string;
    bar_registration_number?: string;
    contact_number?: string;
    email?: string;
    profile_extras?: Record<string, unknown>;
}

interface LawyerFilters {
    specialization?: string;
    lawyerType?: string;
    minExperience?: number;
    maxBudget?: number;
    keyword?: string;
}

interface LawyerContextType {
    lawyers: Lawyer[];
    loading: boolean;
    error: string | null;
    filters: LawyerFilters;
    setFilters: (filters: LawyerFilters) => void;
    searchLawyers: (query: string) => Promise<void>;
}

const LawyerContext = createContext<LawyerContextType | undefined>(undefined);

export const LawyerProvider = ({ children }: { children: React.ReactNode }) => {
    const [lawyers, setLawyers] = useState<Lawyer[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filters, setFilters] = useState<LawyerFilters>({});

    const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

    const normalizeLawyer = (raw: any): Lawyer => {
        const professional = raw?.professional_details || {};
        const parsedExperience = Number(raw?.experience ?? professional?.yearsOfExperience ?? 0);
        const parsedRate = Number(raw?.hourly_rate ?? raw?.hourlyRate ?? 0);
        const parsedRating = Number(raw?.rating ?? 0);

        const practiceAreas = Array.isArray(raw?.practice_areas)
            ? raw.practice_areas.map(String)
            : raw?.specialization
              ? [String(raw.specialization)]
              : [];
        return {
            id: String(raw?.id ?? raw?.user_id ?? raw?.uid ?? raw?.firebase_uid ?? raw?.email ?? crypto.randomUUID()),
            user_id: raw?.user_id ? String(raw.user_id) : undefined,
            name: String(raw?.name ?? professional?.fullName ?? "Legal Expert"),
            specialization: String(raw?.specialization ?? professional?.specialization ?? practiceAreas[0] ?? "General Practice"),
            lawyerType: String(raw?.lawyer_type ?? raw?.lawyerType ?? "Consultation"),
            experience: Number.isFinite(parsedExperience) ? parsedExperience : 0,
            hourlyRate: Number.isFinite(parsedRate) ? parsedRate : 0,
            rating: Number.isFinite(parsedRating) && parsedRating > 0 ? parsedRating : 4.5,
            bio: String(raw?.about ?? raw?.bio ?? "Experienced legal professional."),
            about: String(raw?.about ?? raw?.bio ?? ""),
            headline: raw?.headline ? String(raw.headline) : undefined,
            avatar: String(
                raw?.avatar ||
                "https://images.unsplash.com/photo-1556157382-97dee2dcb9d9?q=80&w=2670&auto=format&fit=crop"
            ),
            location: String(raw?.location ?? professional?.officeAddress ?? "India"),
            verified: Boolean(raw?.verified ?? professional?.fullName),
            practice_areas: practiceAreas,
            courts_practiced: Array.isArray(raw?.courts_practiced) ? raw.courts_practiced.map(String) : [],
            languages: Array.isArray(raw?.languages) ? raw.languages.map(String) : [],
            availability_hours: raw?.availability_hours ? String(raw.availability_hours) : undefined,
            consultation_modes: Array.isArray(raw?.consultation_modes) ? raw.consultation_modes.map(String) : [],
            website_url: raw?.website_url ? String(raw.website_url) : undefined,
            linkedin_url: raw?.linkedin_url ? String(raw.linkedin_url) : undefined,
            bar_registration_number: raw?.bar_registration_number ? String(raw.bar_registration_number) : undefined,
            contact_number: raw?.contact_number ? String(raw.contact_number) : undefined,
            email: raw?.email ? String(raw.email) : undefined,
            profile_extras: (raw?.profile_extras && typeof raw.profile_extras === "object") ? raw.profile_extras : {},
        };
    };

    const SPECIALIZATION_ALIASES: Record<string, string[]> = {
        "Criminal Law": ["criminal", "criminal defense", "criminal law", "fir", "theft", "assault", "bail", "sexual offence"],
        "Cyber & Financial Fraud": ["cyber", "cyber law", "fraud", "financial fraud", "scam", "upi", "it act"],
        "Family & Matrimonial": ["family", "family law", "matrimonial", "divorce", "maintenance", "custody", "domestic"],
        "Property & Land": ["property", "property & land", "property & real estate", "real estate", "land", "tenant", "rera"],
        "Civil & Consumer Disputes": ["civil", "civil law", "consumer", "consumer disputes", "contract", "commercial"],
        "Business & Employment": ["business", "employment", "labour", "labour law", "corporate", "workplace"],
        "Claims & Compensation": ["claims", "compensation", "motor accident", "insurance", "mact"],
    };

    const matchesSpecialization = (lawyer: Lawyer, targetSpec: string): boolean => {
        if (!targetSpec) return true;
        const aliases = SPECIALIZATION_ALIASES[targetSpec] || [targetSpec.toLowerCase()];
        const lawyerSpecs = [
            lawyer.specialization,
            ...(lawyer.practice_areas || []),
        ].map(s => (s || "").toLowerCase());

        return lawyerSpecs.some(spec => 
            aliases.some(alias => spec.includes(alias) || alias.includes(spec))
        );
    };

    const applyFilters = (rows: Lawyer[], activeFilters: LawyerFilters): Lawyer[] => {
        return rows.filter((l) => {
            if (activeFilters.specialization) {
                if (!matchesSpecialization(l, activeFilters.specialization)) {
                    return false;
                }
            }
            if (activeFilters.lawyerType && l.lawyerType !== activeFilters.lawyerType) {
                return false;
            }
            if (activeFilters.minExperience && l.experience < activeFilters.minExperience) {
                return false;
            }
            if (activeFilters.maxBudget && l.hourlyRate > activeFilters.maxBudget) {
                return false;
            }
            return true;
        });
    };

    const searchLawyers = async (keyword: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/api/lawyers/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: keyword })
            });
            if (res.ok) {
                const data = await res.json();
                const normalized = (data.lawyers || []).map(normalizeLawyer);
                setLawyers(applyFilters(normalized, filters));
            } else {
                const errData = await res.json().catch(() => ({}));
                setError(errData?.detail || "Failed to search lawyers.");
                setLawyers([]);
            }
        } catch (err: any) {
            console.error("Vector search error:", err);
            setError(err.message);
            setLawyers([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Keyword search uses vector search endpoint.
        if (filters.keyword) {
            searchLawyers(filters.keyword);
            return;
        }

        let cancelled = false;

        const fetchLawyers = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`${API_URL}/api/lawyers`);
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData?.detail || "Failed to fetch lawyers.");
                }
                const data = await res.json();
                const normalized = (data.lawyers || []).map(normalizeLawyer);
                if (!cancelled) {
                    setLawyers(applyFilters(normalized, filters));
                }
            } catch (err: any) {
                console.error("Error fetching lawyers:", err);
                if (!cancelled) {
                    setError(err.message || "Unable to load lawyers.");
                    setLawyers([]);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        fetchLawyers();

        return () => {
            cancelled = true;
        };
    }, [filters, API_URL]);

    return (
        <LawyerContext.Provider value={{ lawyers, loading, error, filters, setFilters, searchLawyers }}>
            {children}
        </LawyerContext.Provider>
    );
};

export const useLawyers = () => {
    const context = useContext(LawyerContext);
    if (context === undefined) {
        throw new Error('useLawyers must be used within a LawyerProvider');
    }
    return context;
};
