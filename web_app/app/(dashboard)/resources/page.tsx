"use client";

import { useLanguage } from "@/context/LanguageContext";
import { translations } from "@/components/dashboard/Header";

export default function Page() {
  const { language } = useLanguage();
  const t = translations[language];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        {language === 'en' ? "Welcome to" : (language === 'hi' ? "में आपका स्वागत है" : "স্বাগতম")} RESOURCES
      </h1>
      <p className="text-gray-500 text-lg">
        {language === 'en' ? "This feature is coming soon to NyaySahayak." : (language === 'hi' ? "यह सुविधा जल्द ही न्यायसहायक पर आ रही है।" : "এই বৈশিষ্ট্যটি শীঘ্রই ন্যায়সহায়কে আসছে।")}
      </p>
      
      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl transition-all duration-300">
            <div className="w-12 h-12 bg-emerald-50 rounded-2xl mb-4 flex items-center justify-center text-emerald-600 font-bold text-xl">
              {i}
            </div>
            <h3 className="font-bold text-gray-900 mb-2">Feature Module {i}</h3>
            <p className="text-gray-500 text-sm">
              We are working hard to bring you the best legal assistance experience.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
