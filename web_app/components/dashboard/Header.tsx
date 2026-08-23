import React from 'react';
import Image from 'next/image';
import { Bell, Globe, Search, Mic, ChevronDown, LogIn, UserPlus, LogOut, MessageSquare, ShieldAlert, CheckCircle2, Menu, MapPin, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useGlobalChat } from '@/context/ChatContext';
import { markChatThreadRead } from '@/lib/sahayakChatApi';
import { scamHeatmapHref } from '@/lib/scamsApi';
import { useNearbyScamAlerts } from '@/hooks/useUserLocation';
import { refreshUnreadChat, unreadItemsToNotifications, useUnreadChat } from '@/hooks/useUnreadChat';

interface Notification {
    id: string;
    title: string;
    message: string;
    time: string;
    type: 'scam' | 'message' | 'case' | 'location';
    read: boolean;
    payload?: string;
    href?: string;
    channel?: 'lawyer' | 'sahayak';
    threadId?: string;
}

export const translations = {
    en: {
        morning: "Good Morning",
        afternoon: "Good Afternoon",
        evening: "Good Evening",
        searchPlaceholder: "What legal issue are you facing?",
        helpText: "How can we help you today?",
        notifMarkRead: "Mark all read",
        notifViewAll: "View All Activities",
        profileTitle: "Profile",
        logout: "Logout",
        login: "Log In",
        signup: "Sign Up",
        urgentHelp: "Need Urgent Help?",
        callNow: "Call Now",
        popularSearches: "Popular Searches:",
        langName: "English",
        searchBtn: "Search",
        aiBadge: "AI Powered Legal Intelligence",
        heroTitle: "Your Trusted AI Legal Companion",
        quickActions: "Quick Actions",
        viewAll: "View All",
        popularServices: "Popular Services",
        caseTracker: "My Case Tracker",
        chatNow: "Chat Now",
        fileCase: "File a Case",
        talkLawyer: "Talk to a Lawyer",
        knowRights: "Know Your Rights",
        trackStatus: "Track Case Status"
    },
    hi: {
        morning: "शुभ प्रभात",
        afternoon: "नमस्कार",
        evening: "शुभ संध्या",
        searchPlaceholder: "आप किस कानूनी समस्या का सामना कर रहे हैं?",
        helpText: "आज हम आपकी कैसे मदद कर सकते हैं?",
        notifMarkRead: "सभी पढ़े गए के रूप में चिह्नित करें",
        notifViewAll: "सभी गतिविधियां देखें",
        profileTitle: "प्रोफ़ाइल",
        logout: "लॉग आउट",
        login: "लॉग इन",
        signup: "साइन अप",
        urgentHelp: "क्या आपको तत्काल सहायता की आवश्यकता है?",
        callNow: "अभी कॉल करें",
        popularSearches: "लोकप्रिय खोजें:",
        langName: "हिंदी",
        searchBtn: "खोजें",
        aiBadge: "एआई संचालित कानूनी खुफिया",
        heroTitle: "आपका विश्वसनीय एआई कानूनी साथी",
        quickActions: "त्वरित कार्रवाई",
        viewAll: "सभी देखें",
        popularServices: "लोकप्रिय सेवाएं",
        caseTracker: "मेरा केस ट्रैकर",
        chatNow: "अभी चैट करें",
        fileCase: "केस दर्ज करें",
        talkLawyer: "वकील से बात करें",
        knowRights: "अपने अधिकार जानें",
        trackStatus: "केस की स्थिति ट्रैक करें"
    },
    bn: {
        morning: "সুপ্রভাত",
        afternoon: "শুভ অপরাহ্ন",
        evening: "শুভ সন্ধ্যা",
        searchPlaceholder: "আপনি কি আইনি সমস্যার সম্মুখীন হচ্ছেন?",
        helpText: "আজ আমরা আপনাকে কিভাবে সাহায্য করতে পারি?",
        notifMarkRead: "সব পড়া হয়েছে হিসেবে চিহ্নিত করুন",
        notifViewAll: "সব কার্যক্রম দেখুন",
        profileTitle: "প্রোফাইল",
        logout: "লগ আউট",
        login: "লগ ইন",
        signup: "সাইন আপ",
        urgentHelp: "জরুরি সাহায্য প্রয়োজন?",
        callNow: "এখনই কল করুন",
        popularSearches: "জনপ্রিয় অনুসন্ধান:",
        langName: "বাংলা",
        searchBtn: "অনুসন্ধান",
        aiBadge: "এআই চালিত আইনি বুদ্ধিমত্তা",
        heroTitle: "আপনার বিশ্বস্ত এআই আইনি সঙ্গী",
        quickActions: "দ্রুত পদক্ষেপ",
        viewAll: "সব দেখুন",
        popularServices: "জনপ্রিয় পরিষেবা",
        caseTracker: "আমার কেস ট্র্যাকার",
        chatNow: "এখনই চ্যাট করুন",
        fileCase: "মামলা দায়ের করুন",
        talkLawyer: "আইনজীবীর সাথে কথা বলুন",
        knowRights: "আপনার অধিকার জানুন",
        trackStatus: "মামলার স্থিতি ট্র্যাক করুন"
    }
};

type Language = 'en' | 'hi' | 'bn';

interface HeaderProps {
    onMenuClick?: () => void;
}

export const DashboardHeader = ({ onMenuClick }: HeaderProps = {}) => {
    const { user, logout, accessToken } = useAuth();
    const router = useRouter();
    const { language, setLanguage } = useLanguage();
    const { openChatWithQuery } = useGlobalChat();
    const [greeting, setGreeting] = React.useState("");
    const [isNotificationsOpen, setIsNotificationsOpen] = React.useState(false);
    const [isLanguageOpen, setIsLanguageOpen] = React.useState(false);
    const [isAuthOpen, setIsAuthOpen] = React.useState(false);
    const unread = useUnreadChat();
    const [messageNotifications, setMessageNotifications] = React.useState<Notification[]>([]);
    const { scamNotifications, setScamNotifications, areaLabel, locationStatus } = useNearbyScamAlerts();

    const notifications = React.useMemo(
        () => [...messageNotifications, ...scamNotifications],
        [messageNotifications, scamNotifications]
    );

    React.useEffect(() => {
        setMessageNotifications(unreadItemsToNotifications(unread));
    }, [unread]);

    const unreadCount = notifications.filter((n) => !n.read).length;

    const markAllRead = () => {
        setScamNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setMessageNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        if (accessToken) {
            const marks = messageNotifications
                .filter((n) => n.channel && n.threadId)
                .map((n) => markChatThreadRead(accessToken, n.channel!, n.threadId!));
            void Promise.all(marks).finally(() => refreshUnreadChat());
        }
    };

    const openNotification = (notif: Notification) => {
        if (notif.type === 'message') {
            setMessageNotifications((prev) =>
                prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
            );
            if (accessToken && notif.channel && notif.threadId) {
                void markChatThreadRead(accessToken, notif.channel, notif.threadId).finally(() =>
                    refreshUnreadChat()
                );
            }
        } else {
            setScamNotifications((prev) =>
                prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
            );
        }
        setIsNotificationsOpen(false);
        if (notif.href) {
            router.push(notif.href);
            return;
        }
        if (notif.type === 'scam' && notif.payload) {
            try {
                const payloadData = JSON.parse(notif.payload) as {
                    lat: number;
                    lon: number;
                    title: string;
                };
                router.push(scamHeatmapHref(payloadData));
                return;
            } catch {
                /* fall through */
            }
        }
        router.push('/scam-heatmap');
    };

    const displayName = user?.display_name || user?.email?.split('@')[0] || "Guest";
    const firstName = displayName.split(' ')[0];

    React.useEffect(() => {
        const hour = new Date().getHours();
        const t = translations[language];
        if (hour < 12) setGreeting(t.morning);
        else if (hour < 17) setGreeting(t.afternoon);
        else setGreeting(t.evening);
    }, [language]);

    const closeOtherMenus = (keep?: 'notifications' | 'language' | 'auth') => {
        if (keep !== 'notifications') setIsNotificationsOpen(false);
        if (keep !== 'language') setIsLanguageOpen(false);
        if (keep !== 'auth') setIsAuthOpen(false);
    };

    return (
        <header className="mb-6 flex items-center justify-between gap-2 md:mb-8">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 animate-in fade-in slide-in-from-left duration-700">
                {onMenuClick && (
                    <button
                        type="button"
                        onClick={onMenuClick}
                        aria-label="Open navigation menu"
                        className="md:hidden flex-shrink-0 rounded-xl border border-gray-200 bg-white p-2 text-gray-700 shadow-sm transition-all hover:border-[#00634B] hover:text-[#00634B] sm:p-2.5"
                    >
                        <Menu size={20} />
                    </button>
                )}
                <div className="min-w-0">
                    <h2 className="truncate text-base font-bold text-gray-900 sm:text-xl md:text-2xl">
                        {greeting}, <span className="text-[#00634B]">{firstName}!</span>
                    </h2>
                    <p className="hidden text-sm text-gray-500 sm:block">{translations[language].helpText}</p>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3 md:gap-6">
                <div className="relative group">
                    <button
                        onClick={() => {
                            closeOtherMenus('notifications');
                            setIsNotificationsOpen((open) => !open);
                        }}
                        aria-label="Notifications"
                        className={`relative rounded-full border p-2 shadow-sm transition-all sm:p-2.5 ${isNotificationsOpen ? 'bg-emerald-50 border-[#00634B] text-[#00634B]' : 'bg-white border-gray-200 text-gray-600 hover:border-[#00634B] hover:bg-gray-50'
                            }`}
                    >
                        <Bell size={20} className="transition-colors" />
                        {unreadCount > 0 && (
                            <span className="absolute -top-1 -right-1 bg-[#F57C00] text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-[#F8F9FA] group-hover:scale-110 transition-transform">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>

                    {/* Notification Dropdown — local scam alerts from mock_scams */}
                    {isNotificationsOpen && (
                        <>
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setIsNotificationsOpen(false)}
                            />
                            <div className="absolute right-0 mt-3 w-[min(20rem,calc(100vw-2rem))] bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                                <div className="p-4 border-b border-gray-50 flex items-center justify-between gap-2 bg-emerald-50/30">
                                    <div className="min-w-0">
                                        <h3 className="font-bold text-gray-900">Notifications</h3>
                                        <p className="text-[10px] text-gray-500 truncate">
                                            {messageNotifications.length > 0
                                                ? `${messageNotifications.length} chat update${messageNotifications.length === 1 ? '' : 's'}`
                                                : locationStatus === 'loading'
                                                    ? 'Finding scams near you…'
                                                    : locationStatus === 'denied'
                                                        ? 'Location access needed'
                                                        : areaLabel
                                                            ? `Scams near ${areaLabel}`
                                                            : 'Alerts & messages'}
                                        </p>
                                    </div>
                                    {unreadCount > 0 && (
                                        <button
                                            type="button"
                                            onClick={markAllRead}
                                            className="text-[10px] font-bold text-[#00634B] uppercase tracking-wider hover:underline shrink-0"
                                        >
                                            {translations[language].notifMarkRead}
                                        </button>
                                    )}
                                </div>
                                <div className="max-h-[400px] overflow-y-auto">
                                    {locationStatus === 'loading' && notifications.length === 0 ? (
                                        <div className="p-8 text-center">
                                            <Bell className="mx-auto text-gray-200 mb-2 animate-pulse" size={32} />
                                            <p className="text-sm text-gray-400">Loading local scam alerts…</p>
                                        </div>
                                    ) : notifications.length > 0 ? (
                                        notifications.map((notif) => (
                                            <div
                                                key={notif.id}
                                                role="button"
                                                tabIndex={0}
                                                className={`p-4 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer group/item ${!notif.read ? 'bg-emerald-50/20' : ''}`}
                                                onClick={() => openNotification(notif)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        openNotification(notif);
                                                    }
                                                }}
                                            >
                                                <div className="flex gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                                        notif.type === 'scam'
                                                            ? 'bg-orange-100 text-orange-600'
                                                            : notif.type === 'location'
                                                                ? 'bg-amber-100 text-amber-700'
                                                                : notif.type === 'message'
                                                                    ? 'bg-blue-100 text-blue-600'
                                                                    : 'bg-emerald-100 text-emerald-600'
                                                    }`}>
                                                        {notif.type === 'scam' ? <ShieldAlert size={20} /> :
                                                            notif.type === 'location' ? <MapPin size={20} /> :
                                                                notif.type === 'message' ? <MessageSquare size={20} /> :
                                                                    <CheckCircle2 size={20} />}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start mb-0.5">
                                                            <p className="text-sm font-bold text-gray-900 leading-tight truncate pr-4">{notif.title}</p>
                                                            {!notif.read && <div className="w-2 h-2 rounded-full bg-orange-500 shrink-0 mt-1" />}
                                                        </div>
                                                        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-1">{notif.message}</p>
                                                        <p className="text-[10px] font-medium text-gray-400">{notif.time}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="p-8 text-center">
                                            <Bell className="mx-auto text-gray-200 mb-2" size={32} />
                                            <p className="text-sm text-gray-400">No scam alerts right now</p>
                                        </div>
                                    )}
                                </div>
                                <div className="p-3 bg-gray-50/50 border-t border-gray-50 text-center">
                                    <button
                                        type="button"
                                        className="text-xs font-bold text-gray-500 hover:text-[#00634B] transition-colors"
                                        onClick={() => {
                                            setIsNotificationsOpen(false);
                                            router.push('/scam-heatmap');
                                        }}
                                    >
                                        Open scam heatmap
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="relative group">
                    <button
                        onClick={() => {
                            closeOtherMenus('language');
                            setIsLanguageOpen((open) => !open);
                        }}
                        className={`flex items-center gap-1 rounded-xl border px-2 py-2 text-sm font-bold shadow-sm transition-all sm:gap-2 sm:px-4 ${isLanguageOpen ? 'bg-emerald-50 border-[#00634B] text-[#00634B]' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                            }`}
                    >
                        <Globe size={18} className={isLanguageOpen ? 'text-[#00634B]' : 'text-gray-500'} />
                        <span className="hidden sm:inline">{translations[language].langName}</span>
                        <ChevronDown size={14} className={`transition-transform duration-200 ${isLanguageOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isLanguageOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsLanguageOpen(false)} />
                            <div className="absolute right-0 mt-2 w-40 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                                {(['en', 'hi', 'bn'] as const).map((lang) => (
                                    <button
                                        key={lang}
                                        onClick={() => {
                                            setLanguage(lang);
                                            setIsLanguageOpen(false);
                                        }}
                                        className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-emerald-50 flex items-center justify-between ${language === lang ? 'text-[#00634B] bg-emerald-50/50' : 'text-gray-700'
                                            }`}
                                    >
                                        {translations[lang].langName}
                                        {language === lang && <div className="w-1.5 h-1.5 rounded-full bg-[#00634B]" />}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {user ? (
                    <div className="flex items-center gap-1.5 border-gray-200 sm:gap-4 sm:border-l sm:pl-4">
                        <div className="flex cursor-pointer items-center gap-2 sm:gap-3 group">
                            <div className="hidden text-right sm:block">
                                <p className="max-w-[120px] truncate text-xs text-gray-500">{displayName}</p>
                                <p className="flex items-center gap-1 text-sm font-bold text-gray-900 transition-colors group-hover:text-[#00634B]">
                                    {displayName} <ChevronDown size={14} />
                                </p>
                            </div>
                            <div className="relative h-8 w-8 overflow-hidden rounded-full border-2 border-white shadow-sm ring-2 ring-[#00C853] transition-all group-hover:ring-[#00634B] sm:h-10 sm:w-10">
                                <div className="flex h-full w-full items-center justify-center bg-emerald-100 font-bold text-emerald-600">
                                    {displayName[0]}
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={logout}
                            className="rounded-xl p-2 text-gray-400 transition-all hover:bg-red-50 hover:text-red-500 sm:p-2.5"
                            title={translations[language].logout}
                        >
                            <LogOut size={20} />
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Mobile: Log In / Sign Up collapsed into one menu */}
                        <div className="relative sm:hidden">
                            <button
                                type="button"
                                onClick={() => {
                                    closeOtherMenus('auth');
                                    setIsAuthOpen((open) => !open);
                                }}
                                aria-label="Account"
                                aria-expanded={isAuthOpen}
                                className={`flex items-center gap-0.5 rounded-xl border px-2 py-2 shadow-sm transition-all ${
                                    isAuthOpen
                                        ? 'border-[#00634B] bg-emerald-50 text-[#00634B]'
                                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                <User size={18} />
                                <ChevronDown
                                    size={14}
                                    className={`transition-transform duration-200 ${isAuthOpen ? 'rotate-180' : ''}`}
                                />
                            </button>
                            {isAuthOpen && (
                                <>
                                    <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setIsAuthOpen(false)}
                                    />
                                    <div className="absolute right-0 z-50 mt-2 w-44 origin-top-right overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                                        <Link
                                            href="/login"
                                            onClick={() => setIsAuthOpen(false)}
                                            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-emerald-50 hover:text-[#00634B]"
                                        >
                                            <LogIn size={16} />
                                            {translations[language].login}
                                        </Link>
                                        <Link
                                            href="/signup"
                                            onClick={() => setIsAuthOpen(false)}
                                            className="flex w-full items-center gap-2 border-t border-gray-50 bg-[#00634B] px-4 py-3 text-left text-sm font-bold text-white transition-colors hover:bg-[#004D3C]"
                                        >
                                            <UserPlus size={16} />
                                            {translations[language].signup}
                                        </Link>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Desktop / tablet: keep separate buttons */}
                        <div className="hidden items-center gap-2 border-gray-200 sm:flex sm:gap-3 sm:border-l sm:pl-4">
                            <Link href="/login">
                                <button
                                    type="button"
                                    className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-gray-700 transition-all hover:bg-gray-100"
                                >
                                    <LogIn size={18} />
                                    <span>{translations[language].login}</span>
                                </button>
                            </Link>
                            <Link href="/signup">
                                <button
                                    type="button"
                                    className="flex items-center gap-2 rounded-xl bg-[#00634B] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-900/10 transition-all hover:bg-[#004D3C]"
                                >
                                    <UserPlus size={18} />
                                    <span>{translations[language].signup}</span>
                                </button>
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </header>
    );
};

export const HeroSearch = () => {
    const { language } = useLanguage();
    const router = useRouter();
    const [query, setQuery] = React.useState("");
    const popularTags = ["Property Dispute", "Divorce", "FIR", "Consumer Rights", "Labour Law"];
    const t = translations[language];

    const heroTitleParts = t.heroTitle.split(" AI ");
    const heroTitleFirst = heroTitleParts[0];
    const heroTitleSecond = heroTitleParts[1] || "";

    const goToSearch = (term: string) => {
        const q = term.trim();
        if (!q) return;
        router.push(`/search?query=${encodeURIComponent(q)}`);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        goToSearch(query);
    };

    return (
        <div className="relative bg-emerald-50/50 rounded-[2px] overflow-hidden mb-12 shadow-sm border border-emerald-100 group">
            {/* Decorative background gradients (low occupancy) */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 via-white to-emerald-50/30"></div>

            {/* Ambient glows */}
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-emerald-200/20 rounded-full blur-[80px]"></div>
            <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-emerald-200/20 rounded-full blur-[10px]"></div>

            {/* Hero artwork as watermark */}
            <div className="absolute inset-0 opacity-[0.4] mix-blend-multiply pointer-events-none group-hover:scale-105 transition-transform duration-1000">
                <Image src="/4.png" alt="Hero Background" fill className="object-cover" />
            </div>

            <div className="relative px-5 py-10 sm:px-8 sm:py-12 md:px-12 md:py-16 flex flex-col items-start gap-6 sm:gap-8">
                <div className="max-w-2xl space-y-3 sm:space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100/50 border border-emerald-200 text-emerald-800 text-[10px] sm:text-xs font-bold tracking-wider uppercase">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        {t.aiBadge}
                    </div>
                    <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 tracking-tight leading-tight">
                        {heroTitleFirst} <br />
                        <span className="text-[#00634B]">AI {heroTitleSecond}</span>
                    </h1>
                    <p className="text-gray-600 text-sm sm:text-base md:text-lg max-w-lg">
                        Get instant legal guidance, case analysis, and procedural support at your fingertips.
                    </p>
                </div>

                <div className="w-full max-w-2xl">
                    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row sm:items-center bg-white p-2 rounded-2xl shadow-xl shadow-emerald-900/5 gap-2 mb-6 border border-emerald-100 focus-within:ring-4 focus-within:ring-emerald-500/10 transition-all">
                        <div className="flex items-center flex-1 min-w-0 gap-2">
                            <Search className="text-emerald-700 ml-2 sm:ml-3 flex-shrink-0" size={22} />
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={t.searchPlaceholder}
                                className="flex-1 min-w-0 text-base sm:text-lg outline-none placeholder:text-gray-400 bg-transparent text-gray-900 py-3"
                            />
                            <button type="button" className="p-2.5 sm:p-3 text-gray-400 hover:text-emerald-700 hover:bg-emerald-50 transition-all rounded-xl flex-shrink-0">
                                <Mic size={22} />
                            </button>
                        </div>
                        <button type="submit" className="bg-[#00634B] text-white px-6 sm:px-10 py-3.5 sm:py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#004D3C] shadow-lg shadow-emerald-900/20 transform active:scale-95 transition-all w-full sm:w-auto">
                            <Search size={20} />
                            {t.searchBtn}
                        </button>
                    </form>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <span className="text-gray-500 text-sm font-medium flex-shrink-0">{t.popularSearches}</span>
                        <div className="flex flex-wrap gap-2">
                            {popularTags.map((tag) => (
                                <button
                                    key={tag}
                                    type="button"
                                    onClick={() => goToSearch(tag)}
                                    className="bg-emerald-50 text-emerald-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-semibold hover:bg-emerald-100 transition-all border border-emerald-100/50"
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
