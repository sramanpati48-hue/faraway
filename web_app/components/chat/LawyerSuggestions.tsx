"use client";

import { useState, useEffect } from "react";
import { Scale, CheckCircle, MapPin, Phone, Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface Lawyer {
  uid: string;
  name: string;
  specialization: string;
  experience: number;
  location: string;
  contactNumber: string;
  verified: boolean;
}

export function LawyerSuggestions() {
  const [lawyers, setLawyers] = useState<Lawyer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchLawyers = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/lawyers`);
        if (res.ok) {
          const data = await res.json();
          const normalized = (data.lawyers || []).map((l: any) => {
            const pd = l?.professional_details || {};
            return {
              uid: String(l?.user_id ?? l?.uid ?? l?.firebase_uid ?? l?.id ?? l?.email ?? crypto.randomUUID()),
              name: String(l?.name ?? pd?.fullName ?? "Legal Expert"),
              specialization: String(l?.specialization ?? pd?.specialization ?? "General Practice"),
              experience: Number(l?.experience ?? pd?.yearsOfExperience ?? 0) || 0,
              location: String(l?.location ?? pd?.officeAddress ?? "India"),
              contactNumber: String(l?.contact_number ?? pd?.contactNumber ?? "N/A"),
              verified: Boolean(l?.verified ?? pd?.fullName),
            } as Lawyer;
          });

          const verified = normalized.filter((l: Lawyer) => l.verified);
          setLawyers(verified);
        }
      } catch (err) {
        console.error("Failed to fetch lawyers", err);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchLawyers();
  }, []);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-6 shadow-sm flex flex-col items-center justify-center min-h-[200px] animate-pulse">
        <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-full mb-4"></div>
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-2"></div>
        <div className="h-3 bg-slate-100 dark:bg-slate-600 rounded w-1/2"></div>
      </div>
    );
  }

  if (lawyers.length === 0) {
    return null; // Don't show the section if no verified lawyers exist yet
  }

  return (
    <div className="bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 border border-[#00634B]/20 dark:border-emerald-500/20 rounded-2xl p-6 shadow-sm mt-4 animate-in slide-in-from-bottom-4 duration-500">
      
      <div className="flex items-center gap-3 mb-6 border-b border-slate-100 dark:border-slate-700 pb-4">
        <div className="bg-[#E6F0ED] dark:bg-emerald-900/30 p-2 rounded-xl text-[#00634B]">
          <Scale className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900 dark:text-slate-100">Verified Legal Partners</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Available for immediate consultation</p>
        </div>
        <div className="ml-auto text-[10px] font-black tracking-widest uppercase text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full border border-emerald-100 dark:border-emerald-800/50 flex flex-col items-center">
          <Star className="w-3 h-3 fill-current mb-0.5" />
          Pro
        </div>
      </div>

      <div className="space-y-4">
        {lawyers.slice(0, 3).map((lawyer, idx) => (
          <div 
            key={lawyer.uid || idx} 
            className="group flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-[#00634B]/30 hover:shadow-md transition-all"
          >
            {/* Avatar Placeholder */}
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 font-bold text-lg flex-shrink-0 border-2 border-white dark:border-slate-800 shadow-sm">
              {lawyer.name.charAt(0) || "L"}
            </div>

            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 line-clamp-1">
                    {lawyer.name}
                    <CheckCircle className="w-3.5 h-3.5 text-blue-500" />
                  </h4>
                  <p className="text-xs font-semibold text-[#00634B] dark:text-emerald-400 mb-2">
                    {lawyer.specialization} • {lawyer.experience} Yrs Exp
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-[11px] text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1.5 line-clamp-1">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                  {lawyer.location}
                </div>
                <div className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                  {lawyer.contactNumber}
                </div>
              </div>
            </div>

            <div className="flex items-center sm:pl-4 sm:border-l border-slate-100 dark:border-slate-700">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  alert(`Requesting contact with ${lawyer.name}`);
                }}
                className="w-full sm:w-auto bg-slate-900 dark:bg-emerald-600 text-white text-xs font-bold py-2 px-4 rounded-lg hover:bg-slate-800 dark:hover:bg-emerald-500 transition-colors"
              >
                Consult
              </button>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
