import React, { useState } from 'react';
import Image from 'next/image';
import {
    Home,
    Search,
    FileText,
    Briefcase,
    FolderOpen,
    Users,
    Scale,
    Info,
    Phone,
    ChevronDown,
    Globe,
    LogOut,
    ShieldAlert,
    ListChecks,
    Activity,
    Database,
    HeartHandshake,
    MessageSquare,
    Swords,
    GraduationCap,
    PanelLeftClose,
    PanelLeftOpen,
    X
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

type NavEntry = { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; href: string; hasSub?: boolean };

const victimNavItems: NavEntry[] = [
    { icon: Home, label: 'Home', href: '/home' },
    { icon: Search, label: 'Find Legal Help', href: '/find-help' },
    { icon: MessageSquare, label: 'New case (Chat)', href: '/cases' },
    { icon: Briefcase, label: 'Formalized Cases', href: '/my-cases' },
    { icon: FolderOpen, label: 'Documents', href: '/documents' },
    { icon: Scale, label: 'Legal Rights', href: '/legal-rights' },
    { icon: Info, label: 'Help', href: '/help' },
];

const moderatorNavItems: NavEntry[] = [
    { icon: Activity, label: 'Overview', href: '/moderator' },
    { icon: ListChecks, label: 'Review Queue', href: '/moderator/queue' },
    { icon: ShieldAlert, label: 'Sexual offence confirmation', href: '/moderator/sexual-offense' },
    { icon: Globe, label: 'MLAT Cases', href: '/moderator/mlat' },
    { icon: Database, label: 'Audit Logs', href: '/moderator/logs' },
];

const guideNavItems: NavEntry[] = [
    { icon: HeartHandshake, label: 'Help Queue', href: '/sahayak' },
    { icon: MessageSquare, label: 'Client Chats', href: '/sahayak?tab=chats' },
    { icon: Users, label: 'My Profile', href: '/sahayak/profile' },
];

function NavItem({ item, isActive, showLabels, onNavigate }: { item: NavEntry; isActive: boolean; showLabels: boolean; onNavigate?: () => void }) {
    return (
        <div className="mb-1">
            <Link href={item.href} title={!showLabels ? item.label : undefined} onClick={onNavigate}>
                <button
                    className={`w-full flex items-center ${!showLabels ? 'justify-center px-2' : 'justify-between px-3'} py-2.5 rounded-lg transition-all duration-200 group ${isActive
                        ? 'bg-[#00634B] text-white shadow-lg shadow-[#00634B]/20'
                        : `text-[#4B5563] hover:bg-gray-50 ${showLabels ? 'hover:pl-4' : ''} focus:ring-2 focus:ring-[#00634B]/20`
                        }`}
                >
                    <div className="flex items-center gap-3">
                        {React.createElement(item.icon, { size: 20, className: isActive ? 'text-white' : 'text-[#6B7280] group-hover:text-[#00634B]' })}
                        {showLabels && <span className={`font-medium text-sm transition-transform ${isActive ? 'scale-105' : 'group-hover:translate-x-1'}`}>{item.label}</span>}
                    </div>
                    {showLabels && item.hasSub && <ChevronDown size={14} className={isActive ? 'text-white' : 'text-gray-400 group-hover:text-[#00634B]'} />}
                </button>
            </Link>
        </div>
    );
}

function SectionLink({ href, icon: Icon, label, isActive, showLabels, onNavigate }: { href: string; icon: React.ComponentType<{ size?: number; className?: string }>; label: string; isActive: boolean; showLabels: boolean; onNavigate?: () => void }) {
    return (
        <Link href={href} title={!showLabels ? label : undefined} onClick={onNavigate}>
            <button
                className={`w-full flex items-center ${!showLabels ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 rounded-lg transition-all duration-200 group ${isActive
                    ? 'bg-[#00634B] text-white shadow-lg shadow-[#00634B]/20'
                    : `text-[#4B5563] hover:bg-emerald-50 ${showLabels ? 'hover:pl-4' : ''}`
                    }`}
            >
                <Icon size={20} className={isActive ? 'text-white' : 'text-[#6B7280] group-hover:text-[#00634B]'} />
                {showLabels && <span className="font-bold text-sm">{label}</span>}
            </button>
        </Link>
    );
}

export const Sidebar = ({
    collapsed = false,
    onToggle,
    mobileOpen = false,
    onMobileClose,
}: {
    collapsed?: boolean;
    onToggle?: () => void;
    mobileOpen?: boolean;
    onMobileClose?: () => void;
}) => {
    const { user, logout, role, loading } = useAuth();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const sahayakTab = (searchParams.get('tab') || '').toLowerCase();
    const [clashOpen, setClashOpen] = useState(
        () => pathname.startsWith('/clash')
    );

    const normalizedRole = (role || '').trim().toLowerCase();
    const isModeratorRoute = pathname.startsWith('/moderator');
    const isSahayakRoute = pathname.startsWith('/sahayak');

    const isModerator = normalizedRole === 'moderator' || (!normalizedRole && isModeratorRoute);
    const isGuide = normalizedRole === 'guide' || normalizedRole === 'sahayak' || normalizedRole === 'nyay_guide' || (!normalizedRole && isSahayakRoute);
    const isLawyer = normalizedRole === 'lawyer';
    const isAdmin = normalizedRole === 'admin' || normalizedRole === 'super_admin';
    const isVictim = normalizedRole === 'victim' || (!normalizedRole && !isModeratorRoute && !isSahayakRoute && !pathname.startsWith('/lawyer'));
    // Admins get the full set of public tabs in addition to the dedicated admin console.
    const showPublicNav = isVictim || isAdmin;

    // On mobile the drawer is always expanded; desktop respects collapse.
    const showLabels = !collapsed || mobileOpen;

    const handleNav = () => {
        onMobileClose?.();
    };

    return (
        <>
        {mobileOpen && (
            <div
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden"
                onClick={onMobileClose}
                aria-hidden
            />
        )}
        <aside
            className={`w-64 ${collapsed ? 'md:w-20' : 'md:w-64'} bg-white border-r border-[#E5E7EB] h-screen fixed left-0 top-0 flex flex-col overflow-y-auto overflow-x-hidden custom-scrollbar transition-all duration-300 ease-in-out z-50 md:z-30 ${
                mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
            } md:translate-x-0 md:shadow-none`}
        >
            <div className={`${showLabels ? 'p-6 gap-4' : 'p-4 justify-center'} flex items-center`}>
                <Link href="/" onClick={handleNav} className={`${showLabels ? 'gap-4' : 'justify-center'} flex items-center group/logo cursor-pointer flex-1 min-w-0`}>
                    <div className="w-12 h-12 relative flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-xl shadow-emerald-900/5 flex items-center justify-center transition-all duration-300 group-hover/logo:scale-110 group-hover/logo:rotate-3 group-hover/logo:border-emerald-100">
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 to-transparent rounded-2xl opacity-0 group-hover/logo:opacity-100 transition-opacity" />
                        <div className="w-8 h-8 relative z-10">
                            <Image src="/2.png" alt="Nyaysahayak Logo" fill className="object-contain" />
                        </div>
                    </div>
                    {showLabels && (
                        <div className="flex flex-col min-w-0">
                            <h1 className="text-[#00634B] font-black text-xl leading-tight tracking-tight group-hover/logo:text-[#014D3C] transition-colors whitespace-nowrap">
                                Nyay<span className="text-gray-900">Sahayak</span>
                            </h1>
                            <div className="flex items-center gap-1.5">
                                <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                                <p className="text-gray-400 text-[10px] font-bold uppercase tracking-[0.15em] whitespace-nowrap">
                                    Legal Help for All
                                </p>
                            </div>
                        </div>
                    )}
                </Link>
                {onMobileClose && (
                    <button
                        type="button"
                        onClick={onMobileClose}
                        aria-label="Close menu"
                        className="md:hidden p-2 rounded-lg text-gray-400 hover:bg-gray-50 hover:text-[#00634B] transition-all flex-shrink-0"
                    >
                        <X size={20} />
                    </button>
                )}
            </div>

            {onToggle && (
                <button
                    type="button"
                    onClick={onToggle}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    className={`hidden md:flex mx-3 mb-1 items-center ${collapsed ? 'justify-center' : 'justify-end'} rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-[#00634B] transition-all`}
                >
                    {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
                </button>
            )}

            <nav className="flex-1 px-4 py-2">
                {isModerator ? moderatorNavItems.map((item, index) => (
                    <NavItem key={index} item={item} isActive={pathname === item.href} showLabels={showLabels} onNavigate={handleNav} />
                )) : isGuide ? guideNavItems.map((item, index) => {
                    const onProfile = pathname.startsWith('/sahayak/profile');
                    const onChats = pathname.startsWith('/sahayak') && !onProfile && sahayakTab === 'chats';
                    const onQueue = pathname.startsWith('/sahayak') && !onProfile && !onChats;
                    const isActive = item.href.includes('/profile')
                        ? onProfile
                        : item.href.includes('tab=chats')
                            ? onChats
                            : onQueue;
                    return (
                        <NavItem
                            key={index}
                            item={item}
                            isActive={isActive}
                            showLabels={showLabels}
                            onNavigate={handleNav}
                        />
                    );
                }) : showPublicNav ? (
                    <>
                        {victimNavItems.map((item, index) => (
                            <NavItem key={index} item={item} isActive={pathname === item.href} showLabels={showLabels} onNavigate={handleNav} />
                        ))}
                        <div className="mb-1">
                            {!showLabels ? (
                                <Link href="/clash?mode=practice" title="Clash" onClick={handleNav}>
                                    <button
                                        className={`w-full flex items-center justify-center px-2 py-2.5 rounded-lg transition-all duration-200 group ${pathname.startsWith('/clash')
                                            ? 'bg-[#00634B] text-white shadow-lg shadow-[#00634B]/20'
                                            : 'text-[#4B5563] hover:bg-gray-50 focus:ring-2 focus:ring-[#00634B]/20'
                                            }`}
                                    >
                                        <Swords size={20} className={pathname.startsWith('/clash') ? 'text-white' : 'text-[#6B7280] group-hover:text-[#00634B]'} />
                                    </button>
                                </Link>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setClashOpen((o) => !o)}
                                        aria-expanded={clashOpen}
                                        aria-controls="clash-submenu"
                                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200 group ${pathname.startsWith('/clash')
                                            ? 'bg-[#00634B] text-white shadow-lg shadow-[#00634B]/20'
                                            : 'text-[#4B5563] hover:bg-gray-50 hover:pl-4 focus:ring-2 focus:ring-[#00634B]/20'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Swords size={20} className={pathname.startsWith('/clash') ? 'text-white' : 'text-[#6B7280] group-hover:text-[#00634B]'} />
                                            <span className="font-medium text-sm">Clash</span>
                                        </div>
                                        <ChevronDown
                                            size={14}
                                            className={`transition-transform ${clashOpen ? 'rotate-180' : ''} ${pathname.startsWith('/clash') ? 'text-white' : 'text-gray-400'}`}
                                        />
                                    </button>
                                    {clashOpen && (
                                        <div id="clash-submenu" className="ml-4 mt-1 space-y-0.5 border-l-2 border-emerald-100 pl-2">
                                            <Link href="/clash?mode=practice" onClick={handleNav}>
                                                <button
                                                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${pathname.startsWith('/clash') && !pathname.includes('real')
                                                        ? 'text-[#00634B] font-semibold bg-emerald-50'
                                                        : 'text-gray-500 hover:text-[#00634B] hover:bg-gray-50'
                                                        }`}
                                                >
                                                    <GraduationCap size={16} aria-hidden />
                                                    Practice
                                                </button>
                                            </Link>
                                            <Link href="/clash?mode=real_life" onClick={handleNav}>
                                                <button
                                                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-[#00634B] hover:bg-gray-50`}
                                                >
                                                    <Scale size={16} aria-hidden />
                                                    Real Life
                                                </button>
                                            </Link>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </>
                ) : null}

                {isAdmin && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                        <SectionLink href="/admin" icon={ShieldAlert} label="Admin Console" isActive={pathname.startsWith('/admin')} showLabels={showLabels} onNavigate={handleNav} />
                    </div>
                )}

                {isLawyer && (
                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                        <SectionLink href="/lawyer" icon={Activity} label="Dashboard Overview" isActive={pathname === '/lawyer'} showLabels={showLabels} onNavigate={handleNav} />
                        <SectionLink href="/lawyer/cases" icon={Briefcase} label="Client Cases" isActive={pathname === '/lawyer/cases'} showLabels={showLabels} onNavigate={handleNav} />
                        <SectionLink href="/lawyer/profile" icon={Users} label="Professional Profile" isActive={pathname === '/lawyer/profile'} showLabels={showLabels} onNavigate={handleNav} />
                    </div>
                )}

                {user && !loading && (
                    <div className="mt-8 pt-4 border-t border-gray-100">
                        <button
                            onClick={() => { logout(); handleNav(); }}
                            title={!showLabels ? 'Logout' : undefined}
                            className={`w-full flex items-center ${!showLabels ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 rounded-lg text-red-500 hover:bg-red-50 ${showLabels ? 'hover:pl-4' : ''} transition-all duration-200 group`}
                        >
                            <LogOut size={20} className="text-red-400 group-hover:text-red-500" />
                            {showLabels && <span className="font-bold text-sm">Logout</span>}
                        </button>
                    </div>
                )}
            </nav>

            <div className={!showLabels ? 'p-3' : 'p-4'}>
                {!showLabels ? (
                    <button
                        title="Urgent Helpline: 1800-123-4567"
                        className="w-full flex items-center justify-center bg-[#00634B] text-white py-3 rounded-xl shadow-lg shadow-[#00634B]/20"
                    >
                        <Phone size={18} fill="white" />
                    </button>
                ) : (
                    <>
                        <div className="bg-[#FFF8F1] border-2 border-dashed border-[#FFD8B1] rounded-2xl p-4 relative overflow-hidden">
                            <h3 className="text-gray-900 font-semibold text-sm mb-1">Need Urgent Help?</h3>
                            <div className="flex items-center gap-2 text-[#00634B] mt-2">
                                <div className="bg-[#E6F0ED] p-1.5 rounded-full">
                                    <Phone size={16} fill="currentColor" />
                                </div>
                                <span className="font-bold text-lg">1800-123-4567</span>
                            </div>
                            <p className="text-gray-500 text-[10px] mt-1 ml-9">24/7 Helpline</p>

                            <button className="w-full mt-4 bg-[#00634B] text-white py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-[#00634B]/20">
                                <Phone size={18} fill="white" />
                                Call Now
                            </button>
                        </div>

                        <div className="mt-4 flex items-center justify-between px-2">
                            <button className="flex items-center gap-2 text-gray-600 text-sm bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                                <Globe size={16} />
                                <span>English</span>
                                <ChevronDown size={14} />
                            </button>
                        </div>

                        <p className="text-center text-gray-400 text-[10px] mt-4">
                            © 2026 NyaySahayak
                        </p>
                    </>
                )}
            </div>
        </aside>
        </>
    );
};
