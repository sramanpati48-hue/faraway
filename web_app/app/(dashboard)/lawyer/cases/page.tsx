"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Briefcase, Loader2, ArrowRight, User, CheckCircle, Clock, 
  AlertTriangle, FileText, RefreshCw, Scale, Gavel, MessageCircle,
  FileDown, ExternalLink
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LawyerChatPane } from '@/components/lawyer/LawyerChatPane';
import { connectLawyerThread } from '@/lib/lawyerChatApi';

interface StructuredReport {
  incident_type?: string;
  risk_level?: string;
  cognizable?: boolean;
  is_complex_mlat?: boolean;
  summary?: string;
  statutory_sections?: string[];
  checklist?: string[];
  primary_ipc_sections?: string[];
  key_evidence?: string[];
  immediate_steps?: string[];
  pdf_url?: string | null;
}

interface LawyerCase {
  id: string;
  user_id: string;
  user_name: string;
  structured_report: StructuredReport;
  status: 'pending' | 'accepted' | 'closed';
  created_at: string;
  assigned_lawyer_id?: string;
  pdf_url?: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function LawyerCasesPage() {
  const { user, loading: authLoading, accessToken } = useAuth();
  const router = useRouter();

  const [cases, setCases] = useState<LawyerCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<LawyerCase | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acceptedCaseIds, setAcceptedCaseIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'pending' | 'accepted'>('pending');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  /** On smaller screens, toggle between full case brief and chat while keeping both available. */
  const [mobilePane, setMobilePane] = useState<"case" | "chat">("case");

  const fetchCases = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/lawyer/cases/${user.uid}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      const allCases: LawyerCase[] = (data.cases || []).map((c: LawyerCase) => ({
        ...c,
        pdf_url: c.pdf_url || c.structured_report?.pdf_url || null,
      }));
      setCases(allCases);
      // Restore selectedCase if still present
      setSelectedCase(prev => prev ? (allCases.find(c => c.id === prev.id) || null) : null);
    } catch (err: any) {
      setError(err.message || "Failed to load cases.");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    fetchCases();
  }, [user, authLoading, router, fetchCases]);

  const handleAcceptCase = async () => {
    if (!selectedCase || !user) return;
    setIsAccepting(true);
    try {
      const res = await fetch(`${API_URL}/api/lawyer/cases/${selectedCase.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lawyer_id: user.uid })
      });
      if (!res.ok) throw new Error('Failed to accept');
      setAcceptedCaseIds(prev => new Set([...prev, selectedCase.id]));
      await fetchCases();
      if (accessToken) {
        try {
          const { thread } = await connectLawyerThread(accessToken, {
            lawyerUserId: user.uid,
            lawyerCaseId: selectedCase.id,
            victimUserId: selectedCase.user_id,
            initialMessage: "Hello — I’ve accepted your case and I’m here to help. Please share any urgent details.",
          });
          setThreadId(String(thread.id));
          setChatOpen(true);
          setMobilePane("chat");
        } catch (e) {
          console.warn("Thread create after accept failed", e);
        }
      }
    } catch (err) {
      console.error("Error accepting case:", err);
      alert("Failed to accept case. Please try again.");
    } finally {
      setIsAccepting(false);
    }
  };

  const openClientChat = async () => {
    if (!selectedCase || !user || !accessToken) return;
    setChatLoading(true);
    try {
      const { thread } = await connectLawyerThread(accessToken, {
        lawyerUserId: user.uid,
        lawyerCaseId: selectedCase.id,
        victimUserId: selectedCase.user_id,
      });
      setThreadId(String(thread.id));
      setChatOpen(true);
      setMobilePane("chat");
    } catch (e: any) {
      alert(e.message || "Could not open chat");
    } finally {
      setChatLoading(false);
    }
  };

  const openCasePdf = (caseItem: LawyerCase) => {
    const direct = caseItem.pdf_url || caseItem.structured_report?.pdf_url;
    const url = direct || `${API_URL}/api/cases/${encodeURIComponent(caseItem.id)}/pdf`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    setThreadId(null);
    setChatOpen(false);
    setMobilePane("case");
  }, [selectedCase?.id]);

  // Header notification deep-link: /lawyer/cases?thread=&case=
  useEffect(() => {
    if (!cases.length || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const qThread = params.get("thread");
    const qCase = params.get("case");
    if (!qThread && !qCase) return;
    const target =
      (qCase ? cases.find((c) => c.id === qCase) : null) ||
      cases.find((c) => c.status === "accepted" && c.assigned_lawyer_id === user?.uid) ||
      null;
    if (target) {
      setActiveTab(target.status === "accepted" ? "accepted" : "pending");
      setSelectedCase(target);
    }
    if (qThread) {
      queueMicrotask(() => {
        setThreadId(qThread);
        setChatOpen(true);
        setMobilePane("chat");
      });
    }
  }, [cases, user?.uid]);

  const filteredCases = cases.filter(c => 
    activeTab === 'pending' ? c.status === 'pending' : c.status === 'accepted'
  );

  const getRiskColor = (level?: string) => {
    if (!level) return 'text-gray-500 bg-gray-50 border-gray-100';
    switch (level.toLowerCase()) {
      case 'high': return 'text-red-700 bg-red-50 border-red-100';
      case 'medium': return 'text-orange-700 bg-orange-50 border-orange-100';
      case 'low': return 'text-blue-700 bg-blue-50 border-blue-100';
      default: return 'text-gray-700 bg-gray-50 border-gray-100';
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#00634B] animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex flex-col md:flex-row h-auto md:h-[calc(100vh-80px)] min-h-[70vh] bg-gray-50/50 font-sans border border-gray-200 rounded-2xl sm:rounded-3xl overflow-hidden mt-4 sm:mt-6 mx-0 sm:mx-4 shadow-xl shadow-gray-200/30">
      
      {/* Left: Case Queue */}
      <div className={cn(
        "w-full md:w-[340px] flex-shrink-0 bg-white border-r border-gray-100 flex-col",
        selectedCase ? "hidden md:flex" : "flex"
      )}>
        {/* Header */}
        <div className="p-5 border-b border-gray-100 bg-gradient-to-br from-[#00634B] to-[#004D3C] text-white flex-shrink-0">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight">Case Dashboard</h1>
              <p className="text-emerald-200 text-xs">{cases.filter(c => c.status === 'pending').length} awaiting your review</p>
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex mt-4 bg-white/10 rounded-xl p-1 gap-1">
            {['pending', 'accepted'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as 'pending' | 'accepted')}
                className={cn(
                  "flex-1 py-1.5 text-xs font-bold rounded-lg capitalize transition-all",
                  activeTab === tab ? "bg-white text-[#00634B]" : "text-white/70 hover:text-white"
                )}
              >
                {tab} ({cases.filter(c => c.status === tab).length})
              </button>
            ))}
          </div>
        </div>

        {/* Case List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 text-[#00634B] animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-32 gap-3 px-4">
              <AlertTriangle size={24} className="text-red-400" />
              <p className="text-xs text-red-500 text-center font-semibold">{error}</p>
              <button onClick={fetchCases} className="text-xs text-[#00634B] font-bold flex items-center gap-1 hover:underline">
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          ) : filteredCases.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
              <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                <Briefcase size={24} className="text-gray-300" />
              </div>
              <p className="text-sm font-bold text-gray-400">No {activeTab} cases</p>
              <p className="text-xs text-gray-400 text-center px-6">
                {activeTab === 'pending' 
                  ? "Clients looking for a lawyer will appear here."
                  : "Cases you've accepted will appear here."
                }
              </p>
            </div>
          ) : (
            filteredCases.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedCase(c)}
                className={cn(
                  "w-full text-left p-4 rounded-2xl border transition-all",
                  selectedCase?.id === c.id
                    ? "border-[#00634B] bg-[#E6F0ED]/50 ring-1 ring-[#00634B]/20"
                    : "border-gray-100 bg-white hover:border-[#00634B]/30 hover:shadow-sm"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-bold text-gray-900 text-sm leading-tight line-clamp-1">
                    {c.structured_report?.incident_type || "Legal Request"}
                  </span>
                  <span className={cn(
                    "text-[10px] font-black px-2 py-0.5 rounded-full border flex-shrink-0 uppercase tracking-wider",
                    c.structured_report?.risk_level === 'High' ? 'text-red-600 bg-red-50 border-red-100' :
                    c.structured_report?.risk_level === 'Medium' ? 'text-orange-600 bg-orange-50 border-orange-100' :
                    'text-blue-600 bg-blue-50 border-blue-100'
                  )}>
                    {c.structured_report?.risk_level || '—'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                  {c.structured_report?.summary || "No summary available."}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <User size={11} className="text-gray-400" />
                  <span className="text-xs font-bold text-gray-500">{c.user_name || "Client"}</span>
                  <span className="ml-auto text-[10px] text-gray-400">
                    {new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Refresh button */}
        <div className="p-3 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={fetchCases}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 text-xs font-bold text-gray-500 hover:text-[#00634B] py-2 rounded-xl hover:bg-[#E6F0ED]/50 transition-all"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Right: Case Detail + optional chat */}
      <div className={cn("flex-1 min-w-0 flex flex-col lg:flex-row", !selectedCase && "hidden md:flex")}>
        {selectedCase ? (
          <>
          {chatOpen && threadId && (
            <div className="lg:hidden flex gap-1 p-2 border-b border-gray-100 bg-white flex-shrink-0">
              <button
                type="button"
                onClick={() => setMobilePane("case")}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-xl transition-all",
                  mobilePane === "case" ? "bg-[#E6F0ED] text-[#00634B]" : "text-gray-500 hover:bg-gray-50"
                )}
              >
                Case brief
              </button>
              <button
                type="button"
                onClick={() => setMobilePane("chat")}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-xl transition-all",
                  mobilePane === "chat" ? "bg-[#E6F0ED] text-[#00634B]" : "text-gray-500 hover:bg-gray-50"
                )}
              >
                Client chat
              </button>
            </div>
          )}

          <div className={cn(
            "flex-1 overflow-y-auto min-w-0",
            chatOpen && mobilePane === "chat" && "hidden lg:block"
          )}>
          <div className="p-4 sm:p-8 space-y-6">
            <button
              type="button"
              onClick={() => setSelectedCase(null)}
              className="md:hidden text-sm font-bold text-[#00634B]"
            >
              ← Back to cases
            </button>
            {/* Case Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-2xl bg-[#E6F0ED] flex items-center justify-center flex-shrink-0">
                    <Gavel size={20} className="text-[#00634B]" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl sm:text-2xl font-black text-gray-900">
                      {selectedCase.structured_report?.incident_type || "Legal Request"}
                    </h2>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">
                      Case #{selectedCase.id.substring(0, 8).toUpperCase()}
                    </p>
                  </div>
                </div>
              </div>
              <span className={cn(
                "text-xs sm:text-sm font-black px-3 sm:px-4 py-1.5 sm:py-2 rounded-2xl border uppercase tracking-wider flex-shrink-0",
                getRiskColor(selectedCase.structured_report?.risk_level)
              )}>
                {selectedCase.structured_report?.risk_level || "Unknown"} Risk
              </span>
            </div>

            {/* Client & Status Info */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <InfoCard icon={User} label="Client" value={selectedCase.user_name || "Anonymous"} />
              <InfoCard 
                icon={Clock} 
                label="Received" 
                value={new Date(selectedCase.created_at).toLocaleDateString('en-IN', { 
                  day: 'numeric', month: 'short', year: 'numeric'
                })} 
              />
              <InfoCard 
                icon={selectedCase.status === 'accepted' ? CheckCircle : Clock} 
                label="Status" 
                value={selectedCase.status.charAt(0).toUpperCase() + selectedCase.status.slice(1)}
                accent={selectedCase.status === 'accepted' ? 'green' : 'gray'}
              />
            </div>

            {/* Case Report PDF */}
            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                  <FileDown size={12} /> Case report PDF
                </h3>
                <p className="text-sm text-gray-600">
                  Open the full structured report while you advise the client.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openCasePdf(selectedCase)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold px-4 py-2.5 text-sm flex-shrink-0"
              >
                <ExternalLink size={15} />
                View PDF
              </button>
            </div>

            {/* Case Summary */}
            {selectedCase.structured_report?.summary && (
              <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <FileText size={12} /> Case Summary
                </h3>
                <p className="text-sm text-gray-700 leading-relaxed font-medium">
                  {selectedCase.structured_report.summary}
                </p>
              </div>
            )}

            {/* Statutory Sections */}
            {(selectedCase.structured_report?.statutory_sections?.length ?? 0) > 0 && (
              <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Scale size={12} /> Applicable Sections
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selectedCase.structured_report!.statutory_sections!.map((section, idx) => (
                    <span key={idx} className="bg-blue-50 text-blue-700 border border-blue-100 rounded-xl px-3 py-1.5 text-xs font-bold">
                      {section}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Checklist */}
            {(selectedCase.structured_report?.checklist?.length ?? 0) > 0 && (
              <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <CheckCircle size={12} /> Key Checklist Items
                </h3>
                <ul className="space-y-2">
                  {selectedCase.structured_report!.checklist!.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-sm text-gray-700">
                      <div className="w-4 h-4 rounded-full bg-[#E6F0ED] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#00634B]" />
                      </div>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Accept/Status Bar */}
            <div className="pt-2 space-y-3">
              {selectedCase.status === 'pending' && !acceptedCaseIds.has(selectedCase.id) ? (
                <button
                  onClick={handleAcceptCase}
                  disabled={isAccepting}
                  className="w-full bg-[#00634B] hover:bg-[#004D3C] disabled:opacity-50 text-white font-black py-4 sm:py-5 rounded-2xl sm:rounded-3xl transition-all shadow-xl shadow-[#00634B]/20 flex items-center justify-center gap-3 text-sm sm:text-[15px]"
                >
                  {isAccepting ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Accepting brief…</>
                  ) : (
                    <><Gavel size={20} /> Accept & take this case <ArrowRight size={20} /></>
                  )}
                </button>
              ) : (
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl sm:rounded-3xl px-4 sm:px-6 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 flex-1">
                    <CheckCircle size={24} className="text-emerald-600 flex-shrink-0" />
                    <div>
                      <p className="font-black text-emerald-800">Case accepted</p>
                      <p className="text-sm text-emerald-600/70 mt-0.5">
                        Message the client — case summary and PDF stay available while you chat.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (chatOpen && threadId) {
                        setMobilePane("chat");
                        return;
                      }
                      void openClientChat();
                    }}
                    disabled={chatLoading || !accessToken}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold px-4 py-2.5 text-sm disabled:opacity-50"
                  >
                    {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                    {chatOpen ? "Focus chat" : "Message client"}
                  </button>
                </div>
              )}
            </div>
          </div>
          </div>
          {chatOpen && threadId && accessToken && user && (
            <div className={cn(
              "w-full lg:w-[380px] xl:w-[420px] border-t lg:border-t-0 lg:border-l border-gray-200 flex flex-col min-h-[50vh] lg:min-h-0 bg-white",
              mobilePane === "case" && "hidden lg:flex"
            )}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-[#F8F9FA]">
                <div>
                  <p className="text-sm font-black text-gray-900">Client chat</p>
                  <p className="text-xs text-gray-500">{selectedCase.user_name || "Client"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setChatOpen(false);
                    setMobilePane("case");
                  }}
                  className="text-xs font-bold text-gray-500 hover:text-[#00634B]"
                >
                  Hide
                </button>
              </div>

              {/* Sticky case context while messaging */}
              <div className="px-3 py-3 border-b border-emerald-100 bg-emerald-50/60 space-y-2 flex-shrink-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700/80">
                      Case on file
                    </p>
                    <p className="text-xs font-bold text-gray-900 line-clamp-1">
                      {selectedCase.structured_report?.incident_type || "Legal Request"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCasePdf(selectedCase)}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-50 flex-shrink-0"
                  >
                    <FileDown size={12} />
                    PDF
                  </button>
                </div>
                {selectedCase.structured_report?.summary && (
                  <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">
                    {selectedCase.structured_report.summary}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setMobilePane("case")}
                  className="lg:hidden text-[11px] font-bold text-[#00634B] hover:underline"
                >
                  View full case brief →
                </button>
              </div>

              <LawyerChatPane
                threadId={threadId}
                accessToken={accessToken}
                currentUserId={user.uid}
                peerLabel={selectedCase.user_name || "Client"}
                className="flex-1"
              />
            </div>
          )}
          </>
        ) : (
          <div className="h-full flex-1 flex flex-col items-center justify-center gap-4">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
              <Scale className="w-10 h-10 text-gray-200" />
            </div>
            <div className="text-center">
              <p className="text-xl font-black text-gray-400">Select a case</p>
              <p className="text-sm text-gray-400 mt-1">Click a case from the list to review its details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value, accent = 'gray' }: {
  icon: any; label: string; value: string; accent?: 'gray' | 'green';
}) {
  return (
    <div className={cn(
      "bg-white rounded-2xl border p-4 shadow-sm",
      accent === 'green' ? "border-emerald-100" : "border-gray-100"
    )}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={13} className={accent === 'green' ? "text-emerald-500" : "text-gray-400"} />
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{label}</p>
      </div>
      <p className={cn(
        "text-sm font-bold",
        accent === 'green' ? "text-emerald-700" : "text-gray-900"
      )}>{value}</p>
    </div>
  );
}
