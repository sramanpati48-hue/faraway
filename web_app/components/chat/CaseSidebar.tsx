"use client";

import React, { useState, useEffect } from 'react';
import { Plus, MessageSquare, ChevronLeft, Search, Menu, PanelLeftClose } from 'lucide-react';
import { useAuth } from "@/context/AuthContext";
import { useGlobalChat } from "@/context/ChatContext";
import { cn } from "@/lib/utils";

interface CaseSidebarProps {
  isCollapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
}

export function CaseSidebar({ isCollapsed, onCollapse, onExpand }: CaseSidebarProps) {
  const { user } = useAuth();
  const { activeSessionId, setActiveSessionId, setActiveSession, sessionCache, setSessionCache } = useGlobalChat();
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchSessions = async (forceRefetch = false) => {
    if (!user) return;
    
    // Check cache first
    if (!forceRefetch && sessionCache && sessionCache.length > 0) {
      setSessions(sessionCache);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/chat/sessions?uid=${user.uid}`);
      if (response.ok) {
        const data = await response.json();
        const fetchedSessions = data.sessions || [];
        setSessions(fetchedSessions);
        setSessionCache(fetchedSessions);
      }
    } catch (err) {
      console.error("Error fetching sessions:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Fetch sessions immediately on mount and when user changes
    fetchSessions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const handleNewCase = () => {
    const newId = crypto.randomUUID();
    setActiveSessionId(newId);
    setActiveSession([]);
  };

  const handleSelectSession = (session: any) => {
    setActiveSessionId(session.id);
    // Pass the full session_data array so ChatInterface can render it
    setActiveSession(Array.isArray(session.session_data) ? session.session_data : []);
    onCollapse(); // Close sidebar on mobile/small screens after selection
  };

  const filteredSessions = sessions.filter(s => {
    if (!searchQuery) return true;
    // Search across first user message preview
    const allContent = (s.session_data || []).map((m: any) => m.content || "").join(" ");
    return allContent.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <>
      {/* Expand Button — visible only when collapsed */}
      {isCollapsed && (
        <button
          onClick={onExpand}
          title="Show Cases"
          className="absolute top-3 left-3 sm:top-4 sm:left-4 z-50 bg-white border border-gray-100 dark:bg-slate-800 dark:border-slate-700 shadow-sm rounded-xl p-2.5 flex items-center justify-center text-gray-500 hover:text-[#00634B] hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-all duration-200"
        >
          <Menu size={20} />
        </button>
      )}

      {/* Mobile backdrop */}
      {!isCollapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onCollapse}
          aria-hidden
        />
      )}

      {/* Sidebar Panel — overlay on mobile, inline on md+ */}
      <div className={cn(
        "bg-gray-50 dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800 transition-all duration-300 flex flex-col flex-shrink-0 overflow-hidden",
        "fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] shadow-2xl md:relative md:inset-auto md:z-auto md:shadow-none md:h-full",
        isCollapsed
          ? "-translate-x-full md:translate-x-0 md:w-0"
          : "translate-x-0 md:w-72"
      )}>
        <div className="p-4 flex flex-col h-full min-w-0 md:min-w-[288px] w-full">
          {/* Header Row */}
          <div className="flex items-center gap-2 mb-5 flex-shrink-0">
            <button
              onClick={onCollapse}
              title="Close Sidebar"
              className="p-2.5 border border-transparent hover:bg-gray-200 dark:hover:bg-slate-800 hover:border-gray-300 dark:hover:border-slate-700 rounded-xl text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-all"
            >
              <PanelLeftClose size={20} />
            </button>
            <button
              onClick={handleNewCase}
              className="flex-1 flex items-center justify-center gap-2 bg-[#00634B] hover:bg-[#004D3C] text-white font-bold py-2.5 px-4 rounded-xl transition-all shadow-lg shadow-emerald-900/10 group"
            >
              <Plus size={18} className="group-hover:rotate-90 transition-transform duration-300" />
              <span>New Case</span>
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-4 flex-shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
            <input
              type="text"
              placeholder="Search cases..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl py-2.5 pl-9 pr-4 text-xs text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-1 focus:ring-[#00634B] focus:outline-none transition-all"
            />
          </div>

          {/* Session List */}
          <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-2 mb-2 flex-shrink-0">
              Previous Cases
            </h3>

            {isLoading && (
              <div className="flex flex-col gap-2 px-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800 animate-pulse rounded-xl" />
                ))}
              </div>
            )}

            {!isLoading && filteredSessions.length === 0 && (
              <div className="text-center py-10 text-gray-400 text-xs">
                {sessions.length === 0 ? "No previous cases yet." : "No matches found."}
              </div>
            )}

            {filteredSessions.map((session) => {
              const isActive = activeSessionId === session.id;
              // Find first user message for preview
              const firstUserMsg = (session.session_data || []).find((m: any) => m.role === "user");
              const preview = firstUserMsg?.content || "Empty conversation";
              const date = session.timestamp
                ? new Date(session.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : "";
              const msgCount = (session.session_data || []).length;

              return (
                <button
                  key={session.id}
                  onClick={() => handleSelectSession(session)}
                  className={cn(
                    "w-full flex flex-col gap-1 p-3 rounded-xl transition-all text-left border",
                    isActive
                      ? "bg-[#E6F0ED] border-[#00634B]/20 dark:bg-emerald-900/20"
                      : "bg-white dark:bg-slate-800 border-transparent hover:border-gray-200 dark:hover:border-slate-700 shadow-sm"
                  )}
                >
                  <div className="flex justify-between items-start w-full gap-2">
                    <span className={cn(
                      "text-xs font-semibold truncate flex-1 leading-snug",
                      isActive ? "text-[#00634B]" : "text-gray-700 dark:text-gray-200"
                    )}>
                      {preview}
                    </span>
                    {date && <span className="text-[9px] text-gray-400 font-medium whitespace-nowrap">{date}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 text-[9px] text-gray-400 font-bold uppercase tracking-wider">
                    <MessageSquare size={9} />
                    <span>{msgCount} msg</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
