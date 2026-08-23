import React from 'react';
import Link from 'next/link';
import {
    ArrowRight,
    Users,
    Home,
    Scale,
    Briefcase,
    Heart,
    Building2,
    ShieldAlert,
    Plus,
    Clock,
    MessageCircle,
    ChevronRight,
    Calendar,
    Loader2,
    FolderOpen
} from 'lucide-react';
import { translations } from './Header';
import { useLanguage } from '@/context/LanguageContext';
import { useCases } from '@/context/CaseContext';

export const PopularServices = () => {
    const { language } = useLanguage();
    const t = translations[language];
    const services = [
        {
            name: language === 'en' ? "Family Law" : (language === 'hi' ? "पारिवारिक कानून" : "পারিবারিক আইন"),
            icon: Users,
            desc: language === 'en' ? "Divorce, Maintenance" : (language === 'hi' ? "तलाक, रखरखाव" : "বিবাহবিচ্ছেদ, ভরণপোষণ"),
            color: "bg-[#FFF4E5]",
            iconColor: "text-[#F57C00]"
        },
        {
            name: language === 'en' ? "Property" : (language === 'hi' ? "संपत्ति" : "সম্পত্তি"),
            icon: Home,
            desc: language === 'en' ? "Disputes, Registrations" : (language === 'hi' ? "विवाद, पंजीकरण" : "বিরোধ, নিবন্ধন"),
            color: "bg-[#E6F0ED]",
            iconColor: "text-[#00634B]"
        },
        {
            name: language === 'en' ? "Criminal" : (language === 'hi' ? "आपराधिक" : "ফৌজদারি"),
            icon: Scale,
            desc: language === 'en' ? "FIR, Bail, Defense" : (language === 'hi' ? "एफआईआर, जमानत, बचाव" : "এফআইআর, জামিন, প্রতিরক্ষা"),
            color: "bg-[#FFF4F0]",
            iconColor: "text-[#FF5722]"
        },
        {
            name: language === 'en' ? "Employment" : (language === 'hi' ? "रोजगार" : "কর্মসংস্থান"),
            icon: Briefcase,
            desc: language === 'en' ? "Workplace Rights" : (language === 'hi' ? "कार्यस्थल अधिकार" : "কর্মক্ষেত্রের অধিকার"),
            color: "bg-[#E0F2F1]",
            iconColor: "text-[#009688]"
        },
        {
            name: language === 'en' ? "Consumer" : (language === 'hi' ? "उपभोक्ता" : "ভোক্তা"),
            icon: ShieldAlert,
            desc: language === 'en' ? "Complaints, Refunds" : (language === 'hi' ? "शिकायतें, धनवापसी" : "অভিযোগ, ফেরত"),
            color: "bg-[#F3F4FB]",
            iconColor: "text-[#4338CA]"
        },
        {
            name: language === 'en' ? "Cyber Law" : (language === 'hi' ? "साइबर कानून" : "সাইবার আইন"),
            icon: ShieldAlert,
            desc: language === 'en' ? "Fraud, Privacy" : (language === 'hi' ? "धोखाधड़ी, गोपनीयता" : "প্রতারণা, গোপনীয়তা"),
            color: "bg-[#E3F2FD]",
            iconColor: "text-[#1E88E5]"
        },
    ];

    return (
        <div className="flex-1">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">{t.popularServices}</h3>
                <button className="text-[#00634B] text-sm font-semibold flex items-center gap-1 hover:underline">
                    {t.viewAll} <ArrowRight size={16} />
                </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {services.map((service, index) => (
                    <div key={index} className="bg-white p-4 rounded-[24px] border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center gap-4 group">
                        <div className={`${service.color} ${service.iconColor} p-3 rounded-2xl group-hover:scale-110 transition-transform flex-shrink-0`}>
                            <service.icon size={24} />
                        </div>
                        <div className="min-w-0">
                            <h4 className="font-bold text-gray-900 text-sm">{service.name}</h4>
                            <p className="text-gray-400 text-xs">{service.desc}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const nextStepForStatus = (status: string): string => {
    const s = (status || "").toLowerCase();
    if (s.includes("pending")) return "Awaiting review by a legal expert.";
    if (s.includes("review")) return "Under review — a response is on the way.";
    if (s.includes("progress")) return "Your case is being actively worked on.";
    if (s.includes("assigned")) return "A lawyer has been assigned to your case.";
    if (s.includes("closed") || s.includes("resolved")) return "This case has been resolved.";
    return "Continue the conversation to move your case forward.";
};

export const CaseTracker = () => {
    const { language } = useLanguage();
    const { cases: realCases, loading } = useCases();
    const t = translations[language];

    const displayCases = realCases.slice(0, 3);
    const topCase = displayCases[0];
    const seeAllLabel = language === 'en' ? "See All" : (language === 'hi' ? "सभी देखें" : "সব দেখুন");

    return (
        <div className="w-full lg:w-96 lg:flex-shrink-0">
            <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-5 sm:p-6 mb-4">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-gray-900">{t.caseTracker}</h3>
                    <Link href="/my-cases" className="text-[#00634B] text-sm font-semibold flex items-center gap-1 hover:underline">
                        {seeAllLabel} <ArrowRight size={16} />
                    </Link>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-10">
                        <Loader2 className="w-7 h-7 text-[#00634B] animate-spin" />
                    </div>
                ) : displayCases.length > 0 ? (
                    <>
                        <div className="space-y-6 relative">
                            <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gray-100"></div>
                            {displayCases.map((c, index) => (
                                <Link
                                    key={c.id || index}
                                    href="/my-cases"
                                    className="flex items-center gap-4 relative group"
                                >
                                    <div className={`w-3.5 h-3.5 rounded-full border-2 border-white ring-2 ${index === 0 ? 'ring-[#00634B]' : 'ring-gray-200'} bg-white z-10`}></div>
                                    <div className="flex-1 flex items-center justify-between">
                                        <h4 className="text-sm font-semibold text-gray-800 group-hover:text-[#00634B] transition-colors">
                                            Case <span className="text-gray-400 font-normal">{String(c.id).slice(0, 6)}</span> — {c.title}
                                        </h4>
                                        <span className={`text-[10px] font-bold px-3 py-1 rounded-full ${c.statusColor || 'bg-gray-100 text-gray-600'}`}>
                                            {c.status}
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>

                        {topCase && (
                            <div className="mt-8 pt-6 border-t border-gray-100">
                                <h4 className="text-sm font-bold text-gray-900 mb-4">Next Step</h4>
                                <div className="bg-[#E6F0ED]/60 rounded-2xl p-4 flex items-center gap-4 border border-[#00634B]/10">
                                    <div className="bg-white p-2 rounded-xl shadow-sm text-[#00634B]">
                                        <Clock size={24} />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-bold text-gray-900">{topCase.status}</p>
                                        <p className="text-xs text-gray-500">{nextStepForStatus(topCase.status)}</p>
                                    </div>
                                    <Link href="/my-cases" className="bg-white px-4 py-2 rounded-xl text-xs font-bold text-gray-800 shadow-sm border border-gray-100 hover:bg-gray-50">
                                        View
                                    </Link>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="py-8 text-center space-y-4">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto text-gray-300">
                            <FolderOpen size={30} />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-gray-900">No cases yet</p>
                            <p className="text-xs text-gray-400 mt-1">Start a conversation to open your first case.</p>
                        </div>
                        <Link href="/cases" className="inline-flex items-center gap-2 text-[#00634B] text-sm font-bold hover:underline">
                            Start a case <ArrowRight size={15} />
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
};
