import React from 'react';
import { FileText, Users, BookOpen, Search, ArrowRight, PlayCircle, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { translations } from './Header';
import { useLanguage } from '@/context/LanguageContext';

export const QuickActions = () => {
    const { language } = useLanguage();
    const t = translations[language];
    const actions = [
        {
            title: t.fileCase,
            desc: language === 'en' ? "Start Now" : (language === 'hi' ? "अभी शुरू करें" : "এখনই শুরু করুন"),
            icon: FileText,
            color: "text-[#00634B]",
            bg: "bg-[#E6F0ED]"
        },
        {
            title: t.talkLawyer,
            desc: language === 'en' ? "Free Consultation" : (language === 'hi' ? "निःशुल्क परामर्श" : "বিনামূল্যে পরামর্শ"),
            icon: Users,
            color: "text-[#F57C00]",
            bg: "bg-[#FFF4E5]",
            tag: language === 'en' ? "Hot" : (language === 'hi' ? "लोकप्रिय" : "জনপ্রিয়")
        },
        {
            title: t.knowRights,
            desc: language === 'en' ? "Learn More" : (language === 'hi' ? "अधिक जानें" : "আরও জানুন"),
            icon: BookOpen,
            color: "text-[#F5A623]",
            bg: "bg-[#FFF8E1]"
        },
        {
            title: t.trackStatus,
            desc: language === 'en' ? "Check Now" : (language === 'hi' ? "अभी जांचें" : "এখনই দেখুন"),
            icon: Search,
            color: "text-[#00634B]",
            bg: "bg-[#E6F0ED]"
        },
    ];

    return (
        <section className="mb-12">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">{t.quickActions}</h3>
                <button className="text-[#00634B] text-sm font-semibold flex items-center gap-1 hover:underline">
                    {t.viewAll} <ArrowRight size={16} />
                </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {actions.map((action, index) => (
                    <div key={index} className="group cursor-pointer bg-white p-4 sm:p-5 rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl hover:border-[#00634B]/20 transition-all duration-300 hover:-translate-y-2 relative">
                        {action.tag && (
                            <span className="absolute -top-3 right-4 bg-[#F57C00] text-white text-[10px] font-bold px-3 py-1.5 rounded-full border-2 border-white shadow-lg z-10 animate-bounce">
                                {action.tag}
                            </span>
                        )}
                        <div className="flex items-center gap-3 sm:gap-4">
                            <div className={`${action.bg} ${action.color} p-3 sm:p-4 rounded-2xl group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 flex-shrink-0`}>
                                <action.icon size={24} />
                            </div>
                            <div className="min-w-0">
                                <h4 className="font-bold text-gray-900 text-sm group-hover:text-[#00634B] transition-colors">{action.title}</h4>
                                <p className="text-[#00634B] text-xs flex items-center gap-1 font-semibold opacity-80 group-hover:opacity-100 transition-opacity">
                                    {action.desc} <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform flex-shrink-0" />
                                </p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};

export const HowItWorks = () => {
    const { language } = useLanguage();
    const steps = [
        {
            title: language === 'en' ? "Share your issue" : (language === 'hi' ? "अपनी समस्या साझा करें" : "আপনার সমস্যা শেয়ার করুন"),
            desc: language === 'en' ? "In your Language" : (language === 'hi' ? "अपनी भाषा में" : "আপনার ভাষায়"),
            color: "bg-[#FFEFD2]",
            text: "text-[#B45309]"
        },
        {
            title: language === 'en' ? "AI Analysis" : (language === 'hi' ? "एआई विश्लेषण" : "এআই বিশ্লেষণ"),
            desc: language === 'en' ? "Instant risk check" : (language === 'hi' ? "त्वरित जोखिम जांच" : "তাৎক্ষণিক ঝুঁকি যাচাই"),
            color: "bg-[#F3F4FB]",
            text: "text-[#4338CA]",
            active: true
        },
        {
            title: language === 'en' ? "Get Resolution" : (language === 'hi' ? "समाधान प्राप्त करें" : "সমাধান পান"),
            desc: language === 'en' ? "Fast & Legal" : (language === 'hi' ? "तेज और कानूनी" : "দ্রুত এবং আইনি"),
            color: "bg-[#F0FDFF]",
            text: "text-[#0891B2]"
        },
        {
            title: language === 'en' ? "Case resolution" : (language === 'hi' ? "केस समाधान" : "মামলা সমাধান"),
            desc: language === 'en' ? "Track progress" : (language === 'hi' ? "प्रगति ट्रैक करें" : "অগ্রগতি ট্র্যাক করুন"),
            color: "bg-[#E6F9F2]",
            text: "text-[#059669]"
        }
    ];

    return (
        <section className="mb-12">
            <h3 className="text-xl font-bold text-gray-900 mb-6">
                {language === 'en' ? "How It Works" : (language === 'hi' ? "यह कैसे काम करता है" : "এটি কিভাবে কাজ করে")}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
                {steps.map((step, index) => (
                    <div key={index} className="bg-white p-4 rounded-[24px] border border-gray-100 shadow-sm flex items-center gap-4">
                        <div className={`w-12 h-12 ${step.color} ${step.text} flex items-center justify-center rounded-2xl font-bold text-xl flex-shrink-0`}>
                            {index + 1}
                        </div>
                        <div className="min-w-0">
                            <h4 className="font-bold text-gray-900 text-sm">{step.title}</h4>
                            <p className="text-gray-400 text-xs">{step.desc}</p>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};
