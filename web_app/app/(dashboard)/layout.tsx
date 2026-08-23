"use client";


import { useEffect, useState, Suspense } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { DashboardHeader } from "@/components/dashboard/Header";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { MessageCircle, X, Loader2 } from "lucide-react";
import { LanguageProvider } from "@/context/LanguageContext";
import { LawyerProvider } from "@/context/LawyerContext";
import { ChatProvider, useGlobalChat } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { isVictimUser, resolveVictimLegacyRedirect } from "@/lib/routing/victimLegacyRedirects";


function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { isChatOpen, openChat, closeChat } = useGlobalChat();
  const pathname = usePathname();
  const router = useRouter();
  const { user, role, loading: authLoading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    if (!isVictimUser(role, pathname)) return;
    const target = resolveVictimLegacyRedirect(pathname);
    if (target !== pathname) router.replace(target);
  }, [authLoading, user, role, pathname, router]);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("nyaya_sidebar_collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("nyaya_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA] text-[#00634B]">
        <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (user && isVictimUser(role, pathname)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA] text-[#00634B]">
        <Loader2 className="h-8 w-8 animate-spin" aria-label="Redirecting" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F8F9FA] relative">
      <Suspense fallback={<div className="w-64 bg-white min-h-screen border-r border-[#E5E7EB] hidden md:block" />}>
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleSidebar}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
      </Suspense>
      <main
        className={`flex-1 min-w-0 ml-0 ${collapsed ? "md:ml-20" : "md:ml-64"} p-4 sm:p-6 md:p-8 overflow-x-hidden transition-[margin] duration-300 ease-in-out pb-28 md:pb-8`}
      >
        <DashboardHeader onMenuClick={() => setMobileOpen(true)} />
        {children}
      </main>

      {/* Floating Chat Button */}
      <div className="fixed bottom-5 right-5 md:bottom-8 md:right-8 z-50 flex items-center gap-4 group">
        {!isChatOpen && (
          <div className="hidden sm:block bg-white px-4 py-2 rounded-xl shadow-lg border border-gray-100 text-[#00634B] font-bold text-sm opacity-0 group-hover:opacity-100 transition-opacity animate-in slide-in-from-right-2">
            Need Legal Help?
          </div>
        )}
        <button
          onClick={() => (isChatOpen ? closeChat() : openChat())}
          aria-label={isChatOpen ? "Close chat" : "Open chat"}
          className="w-14 h-14 md:w-16 md:h-16 bg-[#00634B] text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all ring-4 ring-white"
        >
          {isChatOpen ? <X size={28} /> : <MessageCircle size={28} />}
        </button>
      </div>

      {/* Chat Interface Overlay */}
      {isChatOpen && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-gray-900/40 backdrop-blur-md animate-in fade-in duration-500"
            onClick={closeChat}
          />
          <div className="absolute right-0 top-0 w-full max-w-4xl h-full bg-white shadow-2xl animate-in slide-in-from-right duration-500 ring-1 ring-black/5">
            <Suspense fallback={
              <div className="flex h-full items-center justify-center text-[#00634B]">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            }>
              <ChatInterface />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChatProvider>
      <LanguageProvider>
        <LawyerProvider>
          <DashboardLayoutContent>{children}</DashboardLayoutContent>
        </LawyerProvider>
      </LanguageProvider>
    </ChatProvider>
  );
}
