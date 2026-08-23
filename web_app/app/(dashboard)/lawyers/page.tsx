"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useLawyers, Lawyer } from "@/context/LawyerContext";
import {
  Search, Filter, Star, MapPin, Briefcase, Award,
  ArrowRight, IndianRupee, Clock, Calendar,
  Verified, Sparkles, ChevronDown, CheckCircle2
} from "lucide-react";
import Image from "next/image";

export default function LawyersDirectoryPage() {
  const { language } = useLanguage();
  const { lawyers, loading, filters, setFilters, searchLawyers } = useLawyers();
  const [searchTerm, setSearchTerm] = useState("");

  const t = {
    en: {
      title: "Legal Expert Directory",
      subtitle: "Verified legal professionals ready to assist you.",
      searchPlaceholder: "Search by keyword or expertise...",
      filters: "Filters",
      specialization: "Specialization",
      experience: "Min Experience",
      budget: "Max Hourly Rate",
      allFields: "All Fields",
      years: "years",
      verified: "Verified",
      book: "Consult Now",
      noResults: "No lawyers match your search criteria.",
      loading: "Updating directory...",
      availability: "Available Today",
      aiBadge: "AI Search Enabled"
    },
    hi: {
      title: "कानूनी विशेषज्ञ निर्देशिका",
      subtitle: "आपकी सहायता के लिए तैयार सत्यापित कानूनी पेशेवर।",
      searchPlaceholder: "कीवर्ड या विशेषज्ञता द्वारा खोजें...",
      filters: "फ़िल्टर",
      specialization: "विशेषज्ञता",
      experience: "न्यूनतम अनुभव",
      budget: "अधिकतम दर",
      allFields: "सभी क्षेत्र",
      years: "वर्ष",
      verified: "सत्यापित",
      book: "परामर्श लें",
      noResults: "कोई वकील आपके खोज मानदंड से मेल नहीं खाता।",
      loading: "निर्देशिका अपडेट हो रही है...",
      availability: "आज उपलब्ध",
      aiBadge: "एआई खोज सक्षम"
    },
    bn: {
      title: "আইনি বিশেষজ্ঞ ডিরেক্টরি",
      subtitle: "আপনার সহায়তার জন্য প্রস্তুত যাচাইকৃত আইনি পেশাদাররা।",
      searchPlaceholder: "কীওয়ার্ড বা দক্ষতা দ্বারা অনুসন্ধান করুন...",
      filters: "ফিল্টার",
      specialization: "বিশেষজ্ঞতা",
      experience: "ন্যূনতম অভিজ্ঞতা",
      budget: "সর্বোচ্চ হার",
      allFields: "সব ক্ষেত্র",
      years: "বছর",
      verified: "যাচাইকৃত",
      book: "পরামর্শ নিন",
      noResults: "আপনার অনুসন্ধানের সাথে কোনো আইনজীবী মেলেনি।",
      loading: "ডিরেক্টরি আপডেট হচ্ছে...",
      availability: "আজ উপলব্ধ",
      aiBadge: "এআই অনুসন্ধান সক্ষম"
    }
  }[language];

  const specializations = [
    "Cyber & Financial Fraud", "Criminal Law", "Family & Matrimonial",
    "Property & Land", "Civil & Consumer Disputes", "Business & Employment",
    "Claims & Compensation"
  ];

  const lawyerTypes = [
    "Private Practice (PVT)", "Senior Counsel / Specialist",
    "Legal Aid / Pro Bono", "Panel / Retainer Lawyer",
    "Nyay Guide (Non-lawyer Support)"
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters({ ...filters, keyword: searchTerm });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-[#00634B] rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-100">
            <Sparkles size={12} className="text-emerald-500" /> {t.aiBadge}
          </div>
          <h1 className="text-4xl font-black text-gray-900 tracking-tight">{t.title}</h1>
          <p className="text-gray-500 text-lg font-medium">{t.subtitle}</p>
        </div>

        <form onSubmit={handleSearch} className="relative group w-full max-w-md">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#00634B] transition-colors" size={20} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full h-14 pl-14 pr-24 bg-white border border-gray-200 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-[#00634B] transition-all shadow-sm font-medium"
          />
          <button
            type="submit"
            className="absolute right-2 top-2 bottom-2 bg-[#00634B] text-white px-5 rounded-xl font-bold text-sm hover:scale-105 active:scale-95 transition-all"
          >
            Search
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        {/* Sidebar Filters */}
        <aside className="lg:col-span-1 space-y-6 lg:sticky lg:top-8">
          <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm space-y-8 h-[calc(100vh-140px)] overflow-y-auto custom-scrollbar">
            <div className="flex items-center gap-2 pb-4 border-b border-gray-50">
              <Filter size={18} className="text-[#00634B]" />
              <h3 className="font-bold text-gray-900">{t.filters}</h3>
            </div>

            {/* Practice Category */}
            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Practice Category</label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => setFilters({ ...filters, specialization: undefined })}
                  className={`text-left px-4 py-3 rounded-xl text-[10px] font-black transition-all ${!filters.specialization ? 'bg-emerald-50 text-[#00634B]' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  {t.allFields}
                </button>
                {specializations.map(spec => (
                  <button
                    key={spec}
                    onClick={() => setFilters({ ...filters, specialization: spec })}
                    className={`text-left px-4 py-3 rounded-xl text-[10px] font-black transition-all ${filters.specialization === spec ? 'bg-emerald-50 text-[#00634B]' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    {spec}
                  </button>
                ))}
              </div>
            </div>

            {/* Engagement Model */}
            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Lawyer Type</label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => setFilters({ ...filters, lawyerType: undefined })}
                  className={`text-left px-4 py-3 rounded-xl text-[10px] font-black transition-all ${!filters.lawyerType ? 'bg-emerald-50 text-[#00634B]' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  Any Type
                </button>
                {lawyerTypes.map(type => (
                  <button
                    key={type}
                    onClick={() => setFilters({ ...filters, lawyerType: type })}
                    className={`text-left px-4 py-3 rounded-xl text-[10px] font-black transition-all ${filters.lawyerType === type ? 'bg-emerald-50 text-[#00634B]' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Price Toggles */}
            <div className="space-y-4">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t.budget}</label>
              <div className="grid grid-cols-2 gap-2">
                {[1000, 3000, 5000].map(p => (
                  <button
                    key={p}
                    onClick={() => setFilters({ ...filters, maxBudget: p })}
                    className={`py-2 px-1 rounded-xl text-[10px] font-black border transition-all ${filters.maxBudget === p ? 'bg-[#00634B] text-white border-[#00634B]' : 'bg-white border-gray-100 text-gray-500 hover:border-emerald-200'}`}
                  >
                    ₹{p}+
                  </button>
                ))}
                <button
                  onClick={() => setFilters({ ...filters, maxBudget: undefined })}
                  className="py-2 px-1 rounded-xl text-[10px] font-black border border-gray-100 text-gray-400 hover:text-[#00634B]"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* Directory Grid */}
        <div className="lg:col-span-3">
          {loading ? (
            <div className="bg-white p-12 rounded-[32px] border border-gray-100 shadow-sm flex flex-col items-center justify-center space-y-4 animate-pulse">
              <div className="w-12 h-12 bg-emerald-50 rounded-full"></div>
              <p className="font-bold text-gray-400">{t.loading}</p>
            </div>
          ) : lawyers.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {lawyers.map((lawyer) => (
                <div key={lawyer.id} className="group bg-white p-6 rounded-[40px] border border-gray-100 shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-500 relative overflow-hidden flex flex-col">


                  <div className="flex gap-6 mb-6">
                    <div className="relative w-24 h-24 rounded-3xl overflow-hidden shadow-xl ring-4 ring-emerald-50 group-hover:scale-105 transition-transform">
                      <Image src={lawyer.avatar} alt={lawyer.name} fill className="object-cover" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-black text-gray-900">Adv. {lawyer.name}</h3>
                        {lawyer.verified && <Verified className="text-blue-500" size={18} />}
                      </div>
                      <p className="text-[#00634B] font-bold text-xs bg-emerald-50 w-fit px-2 py-0.5 rounded-lg border border-emerald-100/50">
                        {lawyer.specialization}
                      </p>
                      <div className="flex items-center gap-1 text-amber-400">
                        <Star size={14} fill="currentColor" />
                        <span className="font-black text-xs text-gray-900">{lawyer.rating}</span>
                        <span className="text-gray-400 font-bold ml-1">Rating</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-gray-500 text-xs font-medium italic mb-6 line-clamp-2 leading-relaxed">
                    "{lawyer.bio}"
                  </p>

                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="bg-gray-50/50 p-3 rounded-2xl flex items-center gap-3 border border-gray-100/50">
                      <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-gray-400 shadow-sm">
                        <Briefcase size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Experience</p>
                        <p className="text-xs font-black text-gray-900">{lawyer.experience}+ Years</p>
                      </div>
                    </div>
                    <div className="bg-gray-50/50 p-3 rounded-2xl flex items-center gap-3 border border-gray-100/50">
                      <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-[#00634B] shadow-sm">
                        <IndianRupee size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Rate</p>
                        <p className="text-xs font-black text-gray-900">₹{lawyer.hourlyRate}/hr</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-[10px] font-bold text-gray-400 mb-6 px-1">
                    <div className="flex items-center gap-1.5"><MapPin size={12} /> {lawyer.location}</div>
                    <div className="flex items-center gap-1.5"><Clock size={12} /> 9 AM - 6 PM</div>
                  </div>

                  <button className="w-full bg-[#00634B] text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 group-hover:bg-[#004D3C] transition-all shadow-xl shadow-emerald-900/10 hover:shadow-emerald-900/20 active:scale-95">
                    <Calendar size={18} />
                    {t.book}
                    <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white p-20 rounded-[48px] border border-dashed border-gray-200 text-center space-y-6">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto text-gray-300">
                <Search size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-black text-gray-900">{t.noResults}</h3>
                <p className="text-gray-400 text-sm font-medium">Try broader keywords or clear your filters.</p>
              </div>
              <button
                onClick={() => {
                  setSearchTerm("");
                  setFilters({});
                }}
                className="bg-[#00634B] text-white px-8 py-3 rounded-xl font-bold hover:bg-[#004D3C] transition-all"
              >
                Reset All Filters
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
