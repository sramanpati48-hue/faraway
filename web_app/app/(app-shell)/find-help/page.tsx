"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";
import { useLawyers } from "@/context/LawyerContext";
import { useAuth } from "@/context/AuthContext";
import {
  Search, Filter, ChevronDown, X, MessageCircle, Loader2, LogIn, HeartHandshake,
} from "lucide-react";
import { LawyerListCard } from "@/components/lawyer/LawyerListCard";
import { LawyerProfileSheet } from "@/components/lawyer/LawyerProfileSheet";
import { SahayakProfileSheet } from "@/components/sahayak/SahayakProfileSheet";
import {
  OperateEmptyState,
  OperateHeader,
  OperateLayout,
  OperatePanel,
  OperateSearchBar,
  OperateSkeletonRows,
  OperateTabBar,
} from "@/components/operate/OperatePrimitives";
import { listLawyerThreads } from "@/lib/lawyerChatApi";
import { listSahayakThreads } from "@/lib/sahayakChatApi";
import {
  PRACTICE_AREAS,
  LAWYER_TYPES,
  normalizeLawyerProfile,
  type LawyerProfile,
  type LawyerThread,
} from "@/lib/lawyerTypes";
import {
  normalizeSahayakProfile,
  type SahayakProfile,
  type SahayakThread,
} from "@/lib/sahayakTypes";

type Tab = "browse" | "connected" | "sahayak";

export default function FindHelpPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24 text-[#00634B]">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      }
    >
      <FindHelpInner />
    </Suspense>
  );
}

function FindHelpInner() {
  const { language } = useLanguage();
  const { lawyers, loading, filters, setFilters } = useLawyers();
  const { user, accessToken, role } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleNorm = (role || "").toLowerCase();
  const isLawyerAccount = roleNorm === "lawyer";
  const isSahayakAccount = ["sahayak", "guide", "nyay_guide"].includes(roleNorm);
  const isVictimSession = Boolean(user && accessToken && !isLawyerAccount && !isSahayakAccount);

  const [searchTerm, setSearchTerm] = useState("");
  const initialTab = ((): Tab => {
    const qTab = searchParams.get("tab");
    const channel = searchParams.get("channel");
    if (qTab === "sahayak" || channel === "sahayak") return "sahayak";
    if (qTab === "connected" || channel === "lawyer") return "connected";
    return "browse";
  })();
  const [tab, setTab] = useState<Tab>(initialTab);

  const selectTab = (next: Tab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "browse") {
      params.delete("tab");
      params.delete("channel");
      params.delete("thread");
    } else {
      params.set("tab", next);
      if (next === "connected") params.set("channel", "lawyer");
      if (next === "sahayak") params.set("channel", "sahayak");
    }
    const qs = params.toString();
    router.replace(qs ? `/find-help?${qs}` : "/find-help", { scroll: false });
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<LawyerProfile | null>(null);
  const [selectedSahayak, setSelectedSahayak] = useState<SahayakProfile | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sahayakSheetOpen, setSahayakSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"profile" | "chat">("profile");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [sahayakThreadId, setSahayakThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<LawyerThread[]>([]);
  const [sahayakThreads, setSahayakThreads] = useState<SahayakThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [sahayakThreadsLoading, setSahayakThreadsLoading] = useState(false);

  const t = {
    en: {
      title: "Find Legal Help",
      subtitle: "Browse verified lawyers or continue chats with connected counsel and guides.",
      browse: "Browse network",
      connected: "Connected lawyers",
      connectedSahayak: "Connected Sahayak",
      searchPlaceholder: "Search by keyword or expertise...",
      filterTitle: "Filters",
      budgetLabel: "Max Rate (₹/hr)",
      specLabel: "Practice Category",
      typeLabel: "Lawyer Type",
      allCategories: "All Categories",
      anyType: "Any Type",
      anyRate: "Any Rate",
      clear: "Clear",
      noResults: "No lawyers found matching your criteria.",
      noConnected: "You have not connected with any lawyers yet.",
      noSahayak: "You have not connected with a Nyay Guide yet.",
      signIn: "Sign in to see the lawyers you have connected with.",
      signInCta: "Log in",
      signUpCta: "Create account",
      lawyerHint:
        "Connected lawyers is for clients. Open Client Cases to message people who connected with you.",
      lawyerCta: "Go to Client Cases",
      sahayakHint:
        "Connected Sahayak is for clients. Open the Help Queue to message people you are guiding.",
      sahayakCta: "Go to Help Queue",
    },
    hi: {
      title: "कानूनी सहायता खोजें",
      subtitle: "सत्यापित वकीलों को खोजें या जुड़े वकीलों और सहायकों से चैट जारी रखें।",
      browse: "नेटवर्क देखें",
      connected: "जुड़े वकील",
      connectedSahayak: "जुड़े सहायक",
      searchPlaceholder: "कीवर्ड या विशेषज्ञता द्वारा खोजें...",
      filterTitle: "फ़िल्टर",
      budgetLabel: "अधिकतम दर (₹/घं)",
      specLabel: "अभ्यास श्रेणी",
      typeLabel: "वकील प्रकार",
      allCategories: "सभी श्रेणियाँ",
      anyType: "कोई भी प्रकार",
      anyRate: "कोई भी दर",
      clear: "साफ़",
      noResults: "कोई वकील नहीं मिला।",
      noConnected: "आपने अभी तक किसी वकील से कनेक्ट नहीं किया है।",
      noSahayak: "आप अभी तक किसी न्‍याय गाइड से जुड़े नहीं हैं।",
      signIn: "जिन वकीलों से आप जुड़े हैं उन्हें देखने के लिए साइन इन करें।",
      signInCta: "लॉग इन",
      signUpCta: "खाता बनाएँ",
      lawyerHint:
        "जुड़े वकील क्लाइंट के लिए हैं। संदेश के लिए Client Cases खोलें।",
      lawyerCta: "Client Cases पर जाएँ",
      sahayakHint: "जुड़े सहायक क्लाइंट के लिए हैं। Help Queue खोलें।",
      sahayakCta: "Help Queue पर जाएँ",
    },
    bn: {
      title: "আইনি সহায়তা খুঁজুন",
      subtitle: "যাচাইকৃত আইনজীবী দেখুন বা সংযুক্ত আইনজীবী ও সহায়কের সাথে চ্যাট চালিয়ে যান।",
      browse: "নেটওয়ার্ক",
      connected: "সংযুক্ত আইনজীবী",
      connectedSahayak: "সংযুক্ত সহায়ক",
      searchPlaceholder: "কীওয়ার্ড বা দক্ষতা দিয়ে খুঁজুন...",
      filterTitle: "ফিল্টার",
      budgetLabel: "সর্বোচ্চ হার (₹/ঘণ্টা)",
      specLabel: "প্র্যাকটিস ক্যাটাগরি",
      typeLabel: "আইনজীবী ধরন",
      allCategories: "সব বিভাগ",
      anyType: "যেকোনো ধরন",
      anyRate: "যেকোনো হার",
      clear: "মুছুন",
      noResults: "কোনো আইনজীবী পাওয়া যায়নি।",
      noConnected: "আপনি এখনও কোনো আইনজীবীর সাথে সংযুক্ত নন।",
      noSahayak: "আপনি এখনও কোনো ন্যায় গাইডের সাথে সংযুক্ত নন।",
      signIn: "যে আইনজীবীদের সাথে আপনি সংযুক্ত তাদের দেখতে সাইন ইন করুন।",
      signInCta: "লগ ইন",
      signUpCta: "অ্যাকাউন্ট তৈরি করুন",
      lawyerHint:
        "সংযুক্ত আইনজীবী ক্লায়েন্টদের জন্য। বার্তার জন্য Client Cases খুলুন।",
      lawyerCta: "Client Cases-এ যান",
      sahayakHint: "সংযুক্ত সহায়ক ক্লায়েন্টদের জন্য। Help Queue খুলুন।",
      sahayakCta: "Help Queue-এ যান",
    },
  }[language] || {
    title: "Find Legal Help",
    subtitle: "Browse verified lawyers or continue chats with connected counsel and guides.",
    browse: "Browse network",
    connected: "Connected lawyers",
    connectedSahayak: "Connected Sahayak",
    searchPlaceholder: "Search by keyword or expertise...",
    filterTitle: "Filters",
    budgetLabel: "Max Rate (₹/hr)",
    specLabel: "Practice Category",
    typeLabel: "Lawyer Type",
    allCategories: "All Categories",
    anyType: "Any Type",
    anyRate: "Any Rate",
    clear: "Clear",
    noResults: "No lawyers found matching your criteria.",
    noConnected: "You have not connected with any lawyers yet.",
    noSahayak: "You have not connected with a Nyay Guide yet.",
    signIn: "Sign in to see the lawyers you have connected with.",
    signInCta: "Log in",
    signUpCta: "Create account",
    lawyerHint:
      "Connected lawyers is for clients. Open Client Cases to message people who connected with you.",
    lawyerCta: "Go to Client Cases",
    sahayakHint:
      "Connected Sahayak is for clients. Open the Help Queue to message people you are guiding.",
    sahayakCta: "Go to Help Queue",
  };

  const hasActiveFilters = Boolean(
    filters.specialization || filters.lawyerType || filters.maxBudget || filters.keyword
  );

  const selectClass =
    "w-full appearance-none rounded-lg border border-slate-200/80 bg-slate-50 py-2.5 pl-3 pr-9 text-sm font-medium text-slate-800 outline-none transition-[border-color,background-color] duration-200 ease-out focus:border-emerald-200 focus:bg-white cursor-pointer";

  const threadRowClass =
    "w-full text-left rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm transition-[transform,border-color,box-shadow] duration-200 ease-out hover:border-emerald-200 hover:shadow-md active:scale-[0.99]";

  const linkButtonClass =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-[#00634B] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-[transform,background-color] duration-150 ease-out hover:bg-[#014D3C] active:scale-[0.97]";

  const browseProfiles = useMemo(
    () => lawyers.map((l) => normalizeLawyerProfile({ ...l, user_id: l.user_id || l.id })),
    [lawyers]
  );

  const loadThreads = async () => {
    if (!isVictimSession || !accessToken) {
      setThreads([]);
      return;
    }
    setThreadsLoading(true);
    try {
      const rows = await listLawyerThreads(accessToken, "victim");
      const mine = rows.filter(
        (row) => !row.victim_user_id || String(row.victim_user_id) === String(user?.uid)
      );
      setThreads(mine);
    } catch {
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  };

  const loadSahayakThreads = async () => {
    if (!isVictimSession || !accessToken) {
      setSahayakThreads([]);
      return;
    }
    setSahayakThreadsLoading(true);
    try {
      const rows = await listSahayakThreads(accessToken, "victim");
      const mine = rows.filter(
        (row) => !row.victim_user_id || String(row.victim_user_id) === String(user?.uid)
      );
      setSahayakThreads(mine);
    } catch {
      setSahayakThreads([]);
    } finally {
      setSahayakThreadsLoading(false);
    }
  };

  useEffect(() => {
    if (isVictimSession) {
      loadSahayakThreads();
    } else {
      setSahayakThreads([]);
    }
  }, [accessToken, isVictimSession, user?.uid]);

  useEffect(() => {
    if (tab === "connected") loadThreads();
    if (tab === "sahayak") loadSahayakThreads();
  }, [tab, accessToken, isVictimSession, user?.uid]);

  useEffect(() => {
    const qTab = searchParams.get("tab");
    const qThread = searchParams.get("thread");
    const channel = searchParams.get("channel");
    if (qTab === "sahayak" || channel === "sahayak") setTab("sahayak");
    else if (qTab === "connected" || channel === "lawyer") setTab("connected");
    if (!qThread || !isVictimSession) return;
    if (channel === "sahayak" || qTab === "sahayak") {
      setSahayakThreadId(qThread);
    } else {
      setThreadId(qThread);
    }
  }, [searchParams, isVictimSession]);

  useEffect(() => {
    if (!threadId || tab !== "connected" || !threads.length) return;
    const thr = threads.find((x) => String(x.id) === String(threadId));
    if (thr) openConnected(thr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, threads, tab]);

  useEffect(() => {
    if (!sahayakThreadId || tab !== "sahayak" || !sahayakThreads.length) return;
    const thr = sahayakThreads.find((x) => String(x.id) === String(sahayakThreadId));
    if (thr) openConnectedSahayak(thr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sahayakThreadId, sahayakThreads, tab]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters({ ...filters, keyword: searchTerm });
  };

  const openBrowseLawyer = (lawyer: LawyerProfile) => {
    setSelected(lawyer);
    setThreadId(null);
    setSheetMode("profile");
    setSheetOpen(true);
  };

  const openConnected = (thread: LawyerThread) => {
    const profile = normalizeLawyerProfile({
      user_id: thread.lawyer_user_id,
      name: thread.lawyer_name || "Advocate",
      avatar: thread.lawyer_avatar,
      specialization: thread.lawyer_specialization,
      headline: thread.lawyer_headline,
      practice_areas: thread.lawyer_practice_areas,
      rating: thread.lawyer_rating,
      location: thread.lawyer_location,
      verified: thread.lawyer_verified,
    });
    setSelected(profile);
    setThreadId(thread.id);
    setSheetMode("chat");
    setSheetOpen(true);
  };

  const openConnectedSahayak = (thread: SahayakThread) => {
    const tid = String(thread.id);
    const profile = normalizeSahayakProfile({
      uid: thread.sahayak_user_id,
      name: thread.sahayak_name,
      avatar: thread.sahayak_avatar,
      occupation: thread.sahayak_occupation,
      location: thread.sahayak_location,
      city: thread.sahayak_city,
      state: thread.sahayak_state,
      rating: thread.sahayak_rating,
      bio: thread.sahayak_bio,
      languages: thread.sahayak_languages,
      availability: thread.sahayak_availability,
      contact_number: thread.sahayak_contact,
      email: thread.sahayak_email,
      cases_resolved: thread.sahayak_cases_resolved,
    });
    setSelectedSahayak(profile);
    setSahayakThreadId(tid);
    setSheetMode("chat");
    setSahayakSheetOpen(true);
  };

  const showSahayakTab = isVictimSession && sahayakThreads.length > 0;

  const tabs = [
    { id: "browse" as Tab, label: t.browse },
    { id: "connected" as Tab, label: t.connected, icon: MessageCircle },
    ...(showSahayakTab
      ? [{ id: "sahayak" as Tab, label: t.connectedSahayak, icon: HeartHandshake }]
      : []),
  ];

  return (
    <OperateLayout wide>
      <OperateHeader kicker="Human support" title={t.title} description={t.subtitle} />

      <OperateTabBar tabs={tabs} active={tab} onChange={selectTab} />

      {tab === "browse" ? (
        <>
          <OperateSearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            onSubmit={handleSearch}
            placeholder={t.searchPlaceholder}
          />

          <OperatePanel className="mb-6">
            <button
              type="button"
              className="mb-3 flex w-full items-center justify-between font-semibold text-slate-900 sm:hidden"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <span className="inline-flex items-center gap-2">
                <Filter size={18} className="text-[#00634B]" />
                {t.filterTitle}
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${filtersOpen ? "rotate-180" : ""}`} />
            </button>

            <div className={`${filtersOpen ? "block" : "hidden"} sm:block`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                <div className="hidden shrink-0 items-center gap-2 pb-2.5 text-slate-900 sm:flex">
                  <Filter size={18} className="text-[#00634B]" />
                  <span className="text-sm font-semibold">{t.filterTitle}</span>
                </div>

                <div className="min-w-0 flex-1">
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                    {t.specLabel}
                  </label>
                  <div className="relative">
                    <select
                      value={filters.specialization || ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          specialization: e.target.value || undefined,
                        })
                      }
                      className={selectClass}
                    >
                      <option value="">{t.allCategories}</option>
                      {PRACTICE_AREAS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                    {t.typeLabel}
                  </label>
                  <div className="relative">
                    <select
                      value={filters.lawyerType || ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          lawyerType: e.target.value || undefined,
                        })
                      }
                      className={selectClass}
                    >
                      <option value="">{t.anyType}</option>
                      {LAWYER_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>

                <div className="w-full shrink-0 sm:w-44">
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                    {t.budgetLabel}
                  </label>
                  <div className="relative">
                    <select
                      value={filters.maxBudget ?? ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          maxBudget: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      className={selectClass}
                    >
                      <option value="">{t.anyRate}</option>
                      <option value="1000">≤ ₹1,000</option>
                      <option value="3000">≤ ₹3,000</option>
                      <option value="5000">≤ ₹5,000</option>
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm("");
                      setFilters({});
                    }}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-600 transition-[background-color,color,transform] duration-150 ease-out hover:bg-slate-100 hover:text-[#00634B] active:scale-[0.98]"
                  >
                    <X size={16} />
                    {t.clear}
                  </button>
                )}
              </div>
            </div>
          </OperatePanel>

          {loading ? (
            <OperateSkeletonRows count={4} />
          ) : browseProfiles.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {browseProfiles.map((lawyer) => (
                <LawyerListCard
                  key={lawyer.user_id || lawyer.id}
                  lawyer={lawyer}
                  onClick={() => openBrowseLawyer(lawyer)}
                />
              ))}
            </div>
          ) : (
            <OperateEmptyState icon={Search} title={t.noResults} description="Try adjusting your filters or keyword." />
          )}
        </>
      ) : tab === "sahayak" ? (
        <div className="space-y-3">
          {!user || !accessToken ? (
            <OperateEmptyState icon={LogIn} title={t.signIn}>
              <Link href="/login?next=/find-help" className={linkButtonClass}>
                <LogIn className="h-4 w-4" />
                {t.signInCta}
              </Link>
            </OperateEmptyState>
          ) : isSahayakAccount ? (
            <OperateEmptyState icon={HeartHandshake} title={t.sahayakHint}>
              <Link href="/sahayak" className={linkButtonClass}>
                {t.sahayakCta}
              </Link>
            </OperateEmptyState>
          ) : sahayakThreadsLoading ? (
            <OperateSkeletonRows count={3} />
          ) : sahayakThreads.length === 0 ? (
            <OperateEmptyState icon={HeartHandshake} title={t.noSahayak} />
          ) : (
            sahayakThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => openConnectedSahayak(thread)}
                className={threadRowClass}
              >
                <div className="flex items-start gap-3">
                  {thread.sahayak_avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thread.sahayak_avatar} alt="" className="h-12 w-12 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50 font-bold text-[#00634B]">
                      {(thread.sahayak_name || "G").charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-semibold text-slate-900">{thread.sahayak_name || "Nyay Guide"}</p>
                      <span className="shrink-0 text-[10px] text-slate-400">
                        {thread.last_message_at
                          ? new Date(thread.last_message_at).toLocaleDateString()
                          : ""}
                      </span>
                    </div>
                    <p className="truncate text-xs font-semibold text-[#00634B]">
                      {thread.sahayak_occupation || thread.sahayak_location || "Connected"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                      {thread.last_message || "No messages yet — tap to open chat."}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {!user || !accessToken ? (
            <OperateEmptyState icon={LogIn} title={t.signIn}>
              <div className="flex flex-col items-center gap-3 sm:flex-row">
                <Link href="/login?next=/find-help" className={linkButtonClass}>
                  <LogIn className="h-4 w-4" />
                  {t.signInCta}
                </Link>
                <Link
                  href="/signup?next=/find-help"
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200/80 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-[border-color,transform] duration-150 ease-out hover:border-emerald-200 active:scale-[0.98]"
                >
                  {t.signUpCta}
                </Link>
              </div>
            </OperateEmptyState>
          ) : isLawyerAccount ? (
            <OperateEmptyState icon={MessageCircle} title={t.lawyerHint}>
              <Link href="/lawyer/cases" className={linkButtonClass}>
                {t.lawyerCta}
              </Link>
            </OperateEmptyState>
          ) : isSahayakAccount ? (
            <OperateEmptyState icon={HeartHandshake} title={t.sahayakHint}>
              <Link href="/sahayak" className={linkButtonClass}>
                {t.sahayakCta}
              </Link>
            </OperateEmptyState>
          ) : threadsLoading ? (
            <OperateSkeletonRows count={3} />
          ) : threads.length === 0 ? (
            <OperateEmptyState icon={MessageCircle} title={t.noConnected} />
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => openConnected(thread)}
                className={threadRowClass}
              >
                <div className="flex items-start gap-3">
                  {thread.lawyer_avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thread.lawyer_avatar} alt="" className="h-12 w-12 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50 font-bold text-[#00634B]">
                      {(thread.lawyer_name || "A").charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-semibold text-slate-900">{thread.lawyer_name || "Advocate"}</p>
                      <span className="shrink-0 text-[10px] text-slate-400">
                        {thread.last_message_at
                          ? new Date(thread.last_message_at).toLocaleDateString()
                          : ""}
                      </span>
                    </div>
                    <p className="truncate text-xs font-semibold text-[#00634B]">
                      {thread.lawyer_headline || thread.lawyer_specialization || "Connected"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                      {thread.last_message || "No messages yet — tap to open chat."}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      <LawyerProfileSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          if (tab === "connected" && isVictimSession) loadThreads();
        }}
        lawyer={selected}
        accessToken={isVictimSession ? accessToken : null}
        currentUserId={isVictimSession ? user?.uid : undefined}
        initialMode={isVictimSession ? sheetMode : "profile"}
        initialThreadId={isVictimSession ? threadId : null}
        showConnect={isVictimSession || (!user && !isLawyerAccount && !isSahayakAccount)}
        onConnected={() => {
          if (tab === "connected" && isVictimSession) loadThreads();
        }}
      />

      <SahayakProfileSheet
        key={sahayakThreadId ? `sahayak-thread-${sahayakThreadId}` : "sahayak-sheet"}
        open={sahayakSheetOpen}
        onClose={() => {
          setSahayakSheetOpen(false);
          if (isVictimSession) loadSahayakThreads();
        }}
        sahayak={selectedSahayak}
        accessToken={isVictimSession ? accessToken : null}
        currentUserId={isVictimSession ? user?.uid : undefined}
        initialMode={sahayakThreadId ? "chat" : "profile"}
        initialThreadId={sahayakThreadId}
        showConnect={!sahayakThreadId}
      />
    </OperateLayout>
  );
}
