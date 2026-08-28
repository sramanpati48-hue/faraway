"use client";

import { useState, useRef, useEffect } from "react";
import { Send, CheckCircle, Sparkles, MessageSquare, Plus, ChevronDown, Menu, MapPin, X, Paperclip, Phone, Volume2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

// import { AgentLog } from "./AgentLog";
import { VoiceInput, VoiceInputRef } from "./VoiceInput";
import { PDFDownloadPanel } from "./PDFDownloadPanel";
import { AuthModal } from "@/components/auth/AuthModal";
import { CaseHomeLanding } from "@/components/home/CaseHomeLanding";
import { CaseChatMessageList, type ForwardedQueueState } from "@/components/chat/CaseChatMessageList";
import { useAuth } from "@/context/AuthContext";
import { useGlobalChat } from "@/context/ChatContext";
import { cn } from "@/lib/utils";
import { panelMotion, touchIconButton, touchIconButtonCompact } from "@/lib/motion";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { LawyerBrowserPanel, LawyerProfile } from "./LawyerBrowserPanel";
import { CaseSuggestionsRail, type SuggestionLink, type ScamMatch } from "./CaseSuggestionsRail";
import { SahayakBrowserPanel } from "./SahayakBrowserPanel";
import { NodalGuideBrowserPanel } from "./NodalGuideBrowserPanel";
import { FemaleNyayGuidePanel } from "./FemaleCounsellorPanel";
import { RoutingConsentModal } from "./RoutingConsentModal";
import { SahayakChatPane } from "@/components/sahayak/SahayakChatPane";
import { openRazorpayCheckout } from "@/lib/clashBillingApi";
import {
  createNyaySahayakOrder,
  fetchNodalGuides,
  verifyNyaySahayakPayment,
  type LocalForum,
} from "@/lib/nyaysahayakApi";
import {
  fetchActiveCaseRequest,
  type NyayGuideRequest,
} from "@/lib/nyayguideApi";
import { useQuietUserLocation } from "@/hooks/useUserLocation";
import { COMPOSER_FILE_ACCEPT, filesToChatAttachments } from "@/lib/chatAttachments";
import {
  mergeSuggestionActions,
  mergeSuggestionLinks,
  sessionUiFromState,
  stripSessionUi,
  withSessionUi,
  type CaseSessionUi,
} from "@/lib/chat/sessionUi";
import {
  NYAYGUIDE_PERMITTING_STATES,
  applyResolutionActions,
  isNewerResolutionVersion,
} from "@/lib/chat/resolutionSnapshot";
import { hasSidebarCaseContent } from "@/lib/home/sessionHelpers";
import { scamHeatmapHref, type MockScam } from "@/lib/scamsApi";
import { cleanTextForSpeech, synthesizeWithSarvam } from "@/lib/speechProxy";
interface Message {
  role: "user" | "assistant";
  content: string;
  agent?: string; // Add agent field
  streamKey?: string;
  attachments?: { name: string; content_type?: string }[];
  options?: any[];
}

interface LogEntry {
  type: string;
  agent?: string;
  content: string;
  timestamp: string;
}

const SUGGESTED_QUESTIONS = [
  { icon: MessageSquare, text: "How do I file a property dispute case?", payload: "I want to file a property dispute case. What is the procedure?" },
  { icon: Sparkles, text: "Check my consumer rights", payload: "What are my basic consumer rights in India?" },
  { icon: CheckCircle, text: "Verify a legal document", payload: "How can I verify if a property document is authentic?" },
];

function actionKindMatchesNyayguideSuggestion(kind: string, id: string): boolean {
  if (kind === "nyayguide_suggestion" || kind === "connect_nyay_guide") return true;
  return id.startsWith("nyayguide_suggestion");
}

function isCaseVerifiedForNextStep(report: any): boolean {
  const status = String(report?.ai_verification_status || "pending").toLowerCase();
  return status === "verified" || status === "verified_for_next_step";
}

export function ChatInterface() {
  const pathname = usePathname();
  const router = useRouter();
  const isCasesPage = pathname === "/cases";
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [structuredReport, setStructuredReport] = useState<any>(null);
  const [suggestedActions, setSuggestedActions] = useState<any[]>([]);
  const [suggestedLinks, setSuggestedLinks] = useState<SuggestionLink[]>([]);
  const [showSuggestionsRail, setShowSuggestionsRail] = useState(false);
  const [suggestionsPulse, setSuggestionsPulse] = useState(false);
  const [lawyerNeeded, setLawyerNeeded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(null);
  const [currentCasePending, setCurrentCasePending] = useState(false);
  const [forwardedQueue, setForwardedQueue] = useState<ForwardedQueueState | null>(null);
  const [questionFlowActive, setQuestionFlowActive] = useState(false);
  
  // Lawyer browser panel state
  const [recommendedLawyers, setRecommendedLawyers] = useState<LawyerProfile[]>([]);
  const [lawyerCaseId, setLawyerCaseId] = useState<string | null>(null);
  const [showLawyerPanel, setShowLawyerPanel] = useState(false);
  const [lawyerCategory, setLawyerCategory] = useState<string | null>(null);
  const [lawyerBrowseLoading, setLawyerBrowseLoading] = useState(false);
  const [lawyerNeedReason, setLawyerNeedReason] = useState<string | null>(null);

  // Sahayak browser panel state
  const [recommendedSahayaks, setRecommendedSahayaks] = useState<any[]>([]);
  const [sahayakCaseId, setSahayakCaseId] = useState<string | null>(null);
  const [showSahayakPanel, setShowSahayakPanel] = useState(false);
  const [acceptedSahayakId, setAcceptedSahayakId] = useState<string | null>(null);

  // Nodal Guide modal panel state
  const [nodalGuideProfiles, setNodalGuideProfiles] = useState<any[]>([]);
  const [showNodalGuidePanel, setShowNodalGuidePanel] = useState(false);
  const [localForum, setLocalForum] = useState<LocalForum | null>(null);
  const [matchedScamTrends, setMatchedScamTrends] = useState<ScamMatch[]>([]);
  const [scamSimilarityNote, setScamSimilarityNote] = useState("");
  const [nyaySahayakChat, setNyaySahayakChat] = useState<{
    threadId: string;
    name: string;
    area: string;
  } | null>(null);
  const [routingRecommendation, setRoutingRecommendation] = useState<any | null>(null);
  const [showRoutingConsentModal, setShowRoutingConsentModal] = useState(false);
  const [femaleNyayGuideProfiles, setFemaleNyayGuideProfiles] = useState<any[]>([]);
  const [showFemaleNyayGuidePanel, setShowFemaleNyayGuidePanel] = useState(false);
  const [soCallPending, setSoCallPending] = useState(false);
  const [composerFiles, setComposerFiles] = useState<File[]>([]);
  const composerFileRef = useRef<HTMLInputElement>(null);

  const addComposerFiles = (list: FileList | File[] | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setComposerFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}-${f.size}-${f.lastModified}`));
      const extra = files.filter((f) => !seen.has(`${f.name}-${f.size}-${f.lastModified}`));
      return extra.length ? [...prev, ...extra] : prev;
    });
  };

  const restoreSessionUi = (ui: CaseSessionUi | null | undefined) => {
    setSuggestedActions(Array.isArray(ui?.suggested_actions) ? ui!.suggested_actions! : []);
    setSuggestedLinks(Array.isArray(ui?.suggested_links) ? ui!.suggested_links! : []);
    setLawyerNeeded(Boolean(ui?.lawyer_needed));
    setLocalForum(ui?.local_forum ?? null);
    setMatchedScamTrends(Array.isArray(ui?.matched_scam_trends) ? ui!.matched_scam_trends! : []);
    setScamSimilarityNote(ui?.scam_similarity_note ? String(ui.scam_similarity_note) : "");
    if (ui?.case_id) setCurrentCaseId(String(ui.case_id));
    if (ui?.pdf_url) setCurrentPdfUrl(String(ui.pdf_url));
    const hasChrome =
      Boolean(ui?.show_suggestions) ||
      (ui?.suggested_actions || []).length > 0 ||
      (ui?.suggested_links || []).length > 0 ||
      Boolean(ui?.lawyer_needed) ||
      Boolean(ui?.local_forum?.institution_name) ||
      (ui?.matched_scam_trends || []).length > 0;
    if (hasChrome) {
      const isDesktop =
        typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
      if (isDesktop) setShowSuggestionsRail(true);
    } else {
      setShowSuggestionsRail(false);
    }
  };

  const applySessionUi = (ui: CaseSessionUi | null | undefined) => {
    if (!ui) return;
    if (Array.isArray(ui.suggested_actions) && ui.suggested_actions.length) {
      setSuggestedActions((prev) => mergeSuggestionActions(prev, ui.suggested_actions));
    }
    if (Array.isArray(ui.suggested_links) && ui.suggested_links.length) {
      setSuggestedLinks((prev) => mergeSuggestionLinks(prev, ui.suggested_links));
    }
    if (ui.lawyer_needed) setLawyerNeeded(true);
    if (ui.local_forum) setLocalForum(ui.local_forum);
    if (Array.isArray(ui.matched_scam_trends) && ui.matched_scam_trends.length) {
      setMatchedScamTrends(ui.matched_scam_trends);
    }
    if (ui.scam_similarity_note) setScamSimilarityNote(String(ui.scam_similarity_note));
    if (ui.case_id) setCurrentCaseId(String(ui.case_id));
    if (ui.pdf_url) setCurrentPdfUrl(String(ui.pdf_url));
    const hasChrome =
      Boolean(ui.show_suggestions) ||
      (ui.suggested_actions || []).length > 0 ||
      (ui.suggested_links || []).length > 0 ||
      Boolean(ui.lawyer_needed) ||
      Boolean(ui.local_forum?.institution_name) ||
      (ui.matched_scam_trends || []).length > 0;
    if (hasChrome) {
      const isDesktop =
        typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
      if (isDesktop) setShowSuggestionsRail(true);
    }
  };

  const buildPersistedSessionData = (history: Message[]) =>
    withSessionUi(
      history,
      sessionUiFromState({
        suggestedActions,
        suggestedLinks,
        lawyerNeeded,
        localForum,
        matchedScamTrends,
        scamSimilarityNote,
        caseId: currentCaseId,
        pdfUrl: currentPdfUrl,
        showSuggestions:
          suggestedActions.length > 0 ||
          suggestedLinks.length > 0 ||
          lawyerNeeded ||
          Boolean(localForum?.institution_name) ||
          matchedScamTrends.length > 0,
      })
    );
  
  // PDF download state - automatically populated when pdf_ready event received
  const [currentPdfUrl, setCurrentPdfUrl] = useState<string | null>(null);
  
  // Global Chat Context
  const { 
    activeQuery, activeSession, activeSessionId, clearActiveQuery, clearActiveSession,
    setActiveSessionId, historyCache, updateHistoryCache, sessionCache, upsertSessionInCache,
    chatResetNonce,
  } = useGlobalChat();

  // Local Session ID — seed from context so My Cases resume is not wiped by a fresh UUID
  const [localSessionId, setLocalSessionId] = useState<string>(() => activeSessionId || "");

  // Input collapse state: collapses after each submit, expands on click
  const [isInputCollapsed, setIsInputCollapsed] = useState(false);

  // TTS playback state
  const [isPlayingTTS, setIsPlayingTTS] = useState(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [handsFreeActive, setHandsFreeActive] = useState(false);
  const [talkBackEnabled, setTalkBackEnabled] = useState(false);
  const [showTalkBackPrompt, setShowTalkBackPrompt] = useState(false);
  const [sendCountdown, setSendCountdown] = useState<number | null>(null);
  const pendingVoiceTextRef = useRef("");
  const lastVoiceLangRef = useRef("en-IN");
  const sendCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const talkBackEnabledRef = useRef(false);
  const handsFreeActiveRef = useRef(false);
  const streamingRef = useRef(false);

  const clearSendCountdown = () => {
    if (sendCountdownTimerRef.current) {
      clearInterval(sendCountdownTimerRef.current);
      sendCountdownTimerRef.current = null;
    }
    setSendCountdown(null);
    pendingVoiceTextRef.current = "";
  };

  const stopTTS = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
    setIsPlayingTTS(false);
  };

  const resumeHandsFreeListening = () => {
    if (!handsFreeActiveRef.current || isConversationActive.current === false) return;
    if (pendingVoiceTextRef.current || sendCountdownTimerRef.current) return;
    window.setTimeout(() => {
      if (!handsFreeActiveRef.current) return;
      if (document.activeElement === textareaRef.current && (textareaRef.current?.value || "").trim()) return;
      voiceInputRef.current?.setMode("conversation");
      voiceInputRef.current?.startRecording();
    }, 400);
  };

  const playTalkBack = async (rawText: string) => {
    if (!talkBackEnabledRef.current) {
      resumeHandsFreeListening();
      return;
    }
    const ttsText = cleanTextForSpeech(rawText);
    if (!ttsText) {
      resumeHandsFreeListening();
      return;
    }
    try {
      setIsPlayingTTS(true);
      const audioBlob = await synthesizeWithSarvam(ttsText, lastVoiceLangRef.current);
      if (audioBlob.size === 0) throw new Error("Empty TTS audio");
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.volume = 1;
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = "";
      }
      currentAudioRef.current = audio;
      setIsPlayingTTS(true);
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        setIsPlayingTTS(false);
        resumeHandsFreeListening();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        setIsPlayingTTS(false);
        resumeHandsFreeListening();
      };
      await audio.play();
    } catch (e) {
      console.error("Frontend Sarvam TTS failed:", e);
      setIsPlayingTTS(false);
      currentAudioRef.current = null;
      resumeHandsFreeListening();
    }
  };

  const beginHandsFree = () => {
    setHandsFreeActive(true);
    handsFreeActiveRef.current = true;
    isConversationActive.current = true;
    setIsInputCollapsed(false);
    voiceInputRef.current?.setMode("conversation");
    setShowTalkBackPrompt(true);
  };

  const answerTalkBackPrompt = (enable: boolean) => {
    setTalkBackEnabled(enable);
    talkBackEnabledRef.current = enable;
    setShowTalkBackPrompt(false);
    voiceInputRef.current?.setMode("conversation");
    window.setTimeout(() => voiceInputRef.current?.startRecording(), 250);
  };

  useEffect(() => {
    return () => {
      if (sendCountdownTimerRef.current) clearInterval(sendCountdownTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    if (activeSessionId === localSessionId) return;
    // Follow context session (My Cases / sidebar). Never mint a replacement UUID here.
    setLocalSessionId(activeSessionId);
    lastFetchedSessionRef.current = "";
    prevActiveSessionRef.current = null;
  }, [activeSessionId, localSessionId]);
  
  // Real-time Intervention State
  const [interventionCaseId, setInterventionCaseId] = useState<string | null>(null);
  const [interventionCollection, setInterventionCollection] = useState<string>("moderator");
  const [manualVoiceModeratorTrigger, setManualVoiceModeratorTrigger] = useState(false);

  // NyayGuide Dispatch State
  const [showNyayGuideCard, setShowNyayGuideCard] = useState(false);
  const [nyayGuideRequest, setNyayGuideRequest] = useState<NyayGuideRequest | null>(null);

  useEffect(() => {
    if (!currentCaseId) {
      setNyayGuideRequest(null);
      return;
    }
    let isMounted = true;
    fetchActiveCaseRequest(currentCaseId)
      .then((req) => {
        if (isMounted) setNyayGuideRequest(req);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [currentCaseId]);

  // Auth state
  const { user, role, loading: authLoading, accessToken } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const MESSAGE_LIMIT = 10;

  const buildUserWebSocketUrl = (uid: string) => {
    const rawApiUrl = (process.env.NEXT_PUBLIC_API_URL || "").trim();

    if (rawApiUrl) {
      try {
        const parsed = new URL(rawApiUrl);
        const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
        const cleanedPath = parsed.pathname.replace(/\/$/, "");
        return `${wsProtocol}//${parsed.host}${cleanedPath}/ws/user/${uid}`;
      } catch {
        // fallback to relative host below
      }
    }

    if (typeof window !== "undefined") {
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${wsProtocol}//${window.location.host}/ws/user/${uid}`;
    }

    return `ws://127.0.0.1:8000/ws/user/${uid}`;
  };

  // Session ID
  const userIdRef = useRef(user?.uid || `anon_${Math.floor(Math.random() * 1000)}`);
  const lastScrollTime = useRef(0);
  // Stable refs for WS handler — avoids closing/reopening WS on state changes
  const interventionCaseIdRef = useRef<string | null>(null);
  const resolutionVersionRef = useRef<Map<string, string>>(new Map());
  const localSessionIdRef = useRef<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  // Track which session we've already fetched so we don't hit the API more than once per session
  const lastFetchedSessionRef = useRef<string>("");
  const prevActiveSessionRef = useRef<string | null>(null);
  const lastChatResetNonceRef = useRef(0);
  const messagesSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (chatResetNonce === lastChatResetNonceRef.current) return;
    lastChatResetNonceRef.current = chatResetNonce;

    messagesSessionIdRef.current = null;
    setMessages([]);
    setStructuredReport(null);
    setSuggestedActions([]);
    setLogs([]);
    setQuery("");
    currentAgentRef.current = null;
    displayAgentRef.current = null;
    clearActiveSession();
    clearActiveQuery();
    lastFetchedSessionRef.current = "";
    prevActiveSessionRef.current = null;
    setIsInputCollapsed(false);
    setRecommendedLawyers([]);
    setShowLawyerPanel(false);
    setLawyerCaseId(null);
    setLawyerCategory(null);
    setLawyerBrowseLoading(false);
    setLawyerNeedReason(null);
    setCurrentPdfUrl(null);
    setQuestionFlowActive(false);
    setForwardedQueue(null);
    setRoutingRecommendation(null);
    setShowRoutingConsentModal(false);
    setFemaleNyayGuideProfiles([]);
    setShowFemaleNyayGuidePanel(false);
    setSoCallPending(false);
    setComposerFiles([]);
    setLocalForum(null);
    setMatchedScamTrends([]);
    setScamSimilarityNote("");
    setNyaySahayakChat(null);
    setShowNodalGuidePanel(false);
    setNodalGuideProfiles([]);

    if (activeSessionId) {
      setLocalSessionId(activeSessionId);
      localSessionIdRef.current = activeSessionId;
    }
  }, [chatResetNonce, activeSessionId, clearActiveSession, clearActiveQuery]);

  // Auto-submit from context — wait until session id is ready
  useEffect(() => {
    const sid = localSessionId || activeSessionId;
    if (!activeQuery || isLoading || !sid) return;
    if (!localSessionId && activeSessionId) setLocalSessionId(activeSessionId);
    const q = activeQuery;
    clearActiveQuery();
    void handleSubmit(undefined, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, isLoading, localSessionId, activeSessionId]);

  // Load Active Session from Context (e.g. from My Cases / sidebar)
  useEffect(() => {
    if (activeSession && Array.isArray(activeSession) && activeSession.length > 0) {
      messagesSessionIdRef.current = activeSessionId ?? localSessionId;
      const { messages: rows, ui } = stripSessionUi(activeSession as Array<{ role?: string; content?: string }>);
      setMessages(rows as Message[]);
      restoreSessionUi(ui);
      clearActiveSession();
      return;
    }
    // Empty array from openCaseThread means "opened, no transcript yet" — keep id, don't treat as wipe signal.
    if (activeSession && Array.isArray(activeSession) && activeSession.length === 0) {
      clearActiveSession();
    }
  }, [activeSession]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId !== localSessionId) return;
    if (prevActiveSessionRef.current === activeSessionId) return;
    prevActiveSessionRef.current = activeSessionId;

    if (activeQuery) return;
    // Let the activeSession hydrate effect own transcript restore — never wipe it here.
    if (activeSession && activeSession.length > 0) return;

    const hist = historyCache[activeSessionId];
    const fromCache = sessionCache?.find((s: { id: string; session_data?: unknown[] }) => s.id === activeSessionId);
    const cachedRows = Array.isArray(fromCache?.session_data) ? fromCache.session_data : [];
    const histRows = Array.isArray(hist) ? hist : [];
    const source = histRows.length > 0 ? histRows : cachedRows;

    if (source.length > 0) {
      if (streamingRef.current) return;
      const { messages: rows, ui } = stripSessionUi(source as Array<{ role?: string; content?: string }>);
      messagesSessionIdRef.current = activeSessionId;
      setMessages(rows as Message[]);
      restoreSessionUi(ui);
      return;
    }

    // Do not clear an already-visible transcript while history fetch is in flight.
    if (messagesSessionIdRef.current === activeSessionId) return;

    // Truly empty thread (new case) — clear chrome only.
    if (streamingRef.current) return;
    setMessages([]);
    setStructuredReport(null);
    setSuggestedActions([]);
    setForwardedQueue(null);
    setCurrentCasePending(false);
    setIsInputCollapsed(false);
  }, [activeSessionId, localSessionId, activeQuery, activeSession, historyCache, sessionCache]);

  useEffect(() => {
    if (user && localSessionId) {
      setCurrentCaseId(null);
      setCurrentPdfUrl(null);
      setCurrentCasePending(false);
      setForwardedQueue(null);
      userIdRef.current = user.uid;
      if (lastFetchedSessionRef.current !== localSessionId) {
        lastFetchedSessionRef.current = localSessionId;
        loadChatFromFirestore(user.uid, localSessionId);
        restoreSahayakPanel(localSessionId);
      }
    }
  }, [user?.uid, localSessionId]);

  // Keep refs in sync with state so the WS handler always reads fresh values without re-mounting
  useEffect(() => { interventionCaseIdRef.current = interventionCaseId; }, [interventionCaseId]);
  useEffect(() => { localSessionIdRef.current = localSessionId; }, [localSessionId]);

  // Real-time WebSocket Listener for Moderator Intervention
    // 🔌 WebSocket Management for Real-time Updates (Intervention Status)
    // IMPORTANT: depends ONLY on user.uid so it never tears down mid-session unexpectedly
    useEffect(() => {
        if (!user || authLoading) return;

        let destroyed = false;
        let reconnectTimeout: NodeJS.Timeout;
        let wsWarned = false;

        const connect = () => {
            if (destroyed) return;

          const wsUrl = buildUserWebSocketUrl(user.uid);
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                wsWarned = false;
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log("📩 WebSocket message received:", data.type);
          // Read from refs so we never need stale closure values
          const currentCaseId = interventionCaseIdRef.current;
          const currentSessionId = localSessionIdRef.current;

          if (data.type === "intervention_resolved") {
            const matchesByCase = currentCaseId && data.case_id === currentCaseId;
            const matchesBySession = currentSessionId && data.session_id === currentSessionId;
            if (matchesByCase || matchesBySession) {
              // Version guard: stale/duplicate resolution events must never
              // overwrite newer local case state. Events without a version
              // (legacy backend) are applied unguarded.
              const eventKey = String(data.case_id || currentCaseId || currentSessionId || "");
              const incomingVersion = data.version ? String(data.version) : null;
              if (incomingVersion && eventKey) {
                const storedVersion = resolutionVersionRef.current.get(eventKey) || null;
                if (!isNewerResolutionVersion(incomingVersion, storedVersion)) {
                  return;
                }
                resolutionVersionRef.current.set(eventKey, incomingVersion);
              }
              // Break the loading lock and present the moderator's response
              setIsLoading(false);
              let nextHistory: Message[] | null = null;
              const moderatorText = data.moderator_response || "A moderator has reviewed your case.";

              setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.agent === "legal_moderator" && lastMsg.content === moderatorText) {
                  return prev;
                }
                const newHistory: Message[] = [...prev, {
                  role: "assistant",
                  content: moderatorText,
                  agent: "legal_moderator"
                }];
                nextHistory = newHistory;
                return newHistory;
              });

              if (currentSessionId && nextHistory) {
                setTimeout(() => updateHistoryCache(currentSessionId, nextHistory as Message[]), 0);
              }

              const opts = data.moderator_options;
              let routingFromModerator: any = data.routing_recommendation || null;
              if (Array.isArray(opts) && opts.length > 0) {
                const cleanOpts = opts.filter((opt: any) => {
                  if (!opt || typeof opt !== "object") return true;
                  if (opt.type === "routing_bundle" && opt.routing_recommendation && !routingFromModerator) {
                    routingFromModerator = opt.routing_recommendation;
                    return false;
                  }
                  return opt.type !== "routing_bundle";
                });
                setSuggestedActions((prev) => mergeSuggestionActions(prev, cleanOpts));
              } else if (typeof opts === 'string') {
                try {
                  const parsed = JSON.parse(opts);
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    const cleanParsed = parsed.filter((opt: any) => {
                      if (!opt || typeof opt !== "object") return true;
                      if (opt.type === "routing_bundle" && opt.routing_recommendation && !routingFromModerator) {
                        routingFromModerator = opt.routing_recommendation;
                        return false;
                      }
                      return opt.type !== "routing_bundle";
                    });
                    setSuggestedActions((prev) => mergeSuggestionActions(prev, cleanParsed));
                  }
                } catch (_) { /* ignore */ }
              }
              // Server-authoritative snapshot: replace the in-memory case
              // state instead of deriving eligibility from stale fields.
              if (data.structured_report && typeof data.structured_report === "object") {
                setStructuredReport(data.structured_report);
              }
              const snapshotActions = data.suggested_actions;
              if (Array.isArray(snapshotActions)) {
                // Fresh typed action replaces any stale nyayguide suggestion
                // that arrived via moderator_options.
                setSuggestedActions((prev) => applyResolutionActions(prev, snapshotActions));
                if (snapshotActions.length > 0) {
                  const isDesktop =
                    typeof window !== "undefined" &&
                    window.matchMedia("(min-width: 768px)").matches;
                  if (isDesktop) setShowSuggestionsRail(true);
                }
              }
              if (routingFromModerator) {
                setRoutingRecommendation(routingFromModerator);
                setShowRoutingConsentModal(true);
              }
              setInterventionCaseId(null);
              setCurrentCasePending(false);
              setForwardedQueue(null);
            }
          }
        } catch (e) {
          console.error("Error parsing websocket message in chat interface:", e);
        }
      };

            ws.onerror = () => {
                if (!wsWarned) {
                    wsWarned = true;
                    console.debug(
                      "Realtime updates unavailable (WebSocket). Chat still works; start the backend for live moderator push."
                    );
                }
            };

            ws.onclose = (event) => {
                if (!destroyed && event.code !== 1000) {
                    reconnectTimeout = setTimeout(connect, 5000);
                }
            };
        };

        connect();

        return () => {
            destroyed = true;
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
                wsRef.current.close(1000, "Component unmounting");
            }
        };
    }, [user?.uid, authLoading]);

  const loadChatFromFirestore = async (uid: string, sessionId?: string) => {
    // Check Cache First
    if (sessionId && historyCache[sessionId] && historyCache[sessionId].length > 0) {
      if (streamingRef.current) return;
      messagesSessionIdRef.current = sessionId;
      const { messages: rows, ui } = stripSessionUi(historyCache[sessionId] as Array<{ role?: string; content?: string }>);
      setMessages(rows as Message[]);
      const cachedSession = sessionCache?.find((s) => s.id === sessionId);
      const cachedUi = (cachedSession?.case_ui as CaseSessionUi | undefined) || ui;
      if (cachedUi) {
        restoreSessionUi(cachedUi);
      } else {
        const lastMsg = rows[rows.length - 1] as Message | undefined;
        if (lastMsg?.options && Array.isArray(lastMsg.options)) {
          restoreSessionUi({ role: "session_ui", suggested_actions: lastMsg.options as any[] });
        } else {
          restoreSessionUi(null);
        }
      }
      if (sessionId) {
        restoreSahayakPanel(sessionId);
        restoreCasePdf(sessionId, uid);
        restoreForwardQueue(sessionId);
      }
      return;
    }

    try {
      let url = `${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/chat/history?uid=${uid}`;
      if (sessionId) {
        url += `&session_id=${sessionId}`;
      }
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.history) {
          if (streamingRef.current) return;
          if (sessionId) messagesSessionIdRef.current = sessionId;
          const { messages: rows, ui } = stripSessionUi(data.history as Array<{ role?: string; content?: string }>);
          // Never clobber a transcript already hydrated from My Cases / bootstrap with an empty API history.
          if (rows.length === 0) {
            setMessages((prev) => (prev.length > 0 ? prev : rows as Message[]));
          } else {
            setMessages(rows as Message[]);
          }
          const persisted = withSessionUi(rows as Message[], ui);
          if (sessionId && hasSidebarCaseContent({ id: sessionId, session_data: persisted as any })) {
            updateHistoryCache(sessionId, persisted as any);
            upsertSessionInCache({
              id: sessionId,
              session_data: persisted as any,
              case_ui: ui,
            });
          } else if (sessionId && rows.length > 0) {
            updateHistoryCache(sessionId, rows as any);
          }
          if (ui) {
            restoreSessionUi(ui);
          } else if (rows.length > 0) {
            const lastMsg = rows[rows.length - 1] as Message;
            if (lastMsg.options && Array.isArray(lastMsg.options)) {
              restoreSessionUi({ role: "session_ui", suggested_actions: lastMsg.options as any[] });
            }
          }
        } else {
          if (streamingRef.current) return;
          // Keep existing messages if this session was seeded from a formalised case.
          setMessages((prev) => prev);
        }
        if (sessionId) {
          restoreSahayakPanel(sessionId);
          restoreCasePdf(sessionId, uid);
          restoreForwardQueue(sessionId);
        }
      }
    } catch (err) {
      console.error("Error loading chat history:", err);
    }
  };

  const restoreCasePdf = async (sessionId: string, uid: string) => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
      const res = await fetch(`${API_URL}/api/cases?uid=${encodeURIComponent(uid)}`);
      if (!res.ok) return;

      const data = await res.json();
      if (data.status !== "success" || !Array.isArray(data.cases)) return;

      // Bind pending/forward state only to this session's case — never borrow another chat's moderator banner.
      const sessionCases = data.cases.filter((c: any) => c?.session_id === sessionId);
      const latestSessionCase = sessionCases.length > 0 ? sessionCases[0] : null;

      if (!latestSessionCase) {
        // Do not borrow pending/forward/PDF state from a different chat session.
        return;
      }

      if (latestSessionCase.case_id) {
        setCurrentCaseId(latestSessionCase.case_id);
      }
      if (latestSessionCase.pdf_url) {
        setCurrentPdfUrl(latestSessionCase.pdf_url);
      }
      setCurrentCasePending(Boolean(latestSessionCase.pending));
    } catch (err) {
      console.error("Error restoring case PDF:", err);
    }
  };

  const restoreForwardQueue = async (sessionId: string) => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
      const res = await fetch(
        `${API_URL}/api/cases/session-forward?session_id=${encodeURIComponent(sessionId)}`
      );
      if (!res.ok) {
        setForwardedQueue(null);
        setCurrentCasePending(false);
        return;
      }
      const data = await res.json();
      const fwd = data.forward;
      if (!fwd?.role) {
        setForwardedQueue(null);
        setCurrentCasePending(false);
        return;
      }
      const status = String(fwd.queue_status || "queued").toLowerCase();
      // Resolved forwards should not keep the amber banner in chat.
      if (status === "resolved" || status === "reviewed") {
        setForwardedQueue(null);
        setCurrentCasePending(false);
        if (fwd.case_id) setCurrentCaseId(fwd.case_id);
        if (fwd.pdf_url) setCurrentPdfUrl(fwd.pdf_url);
        return;
      }
      setForwardedQueue({
        role: fwd.role,
        roleLabel: fwd.role_label || "Reviewer",
        targetId: fwd.target_id || fwd.case_id || "",
        caseId: fwd.case_id,
        queueStatus: fwd.queue_status || "queued",
        followUps: Array.isArray(fwd.follow_ups) ? fwd.follow_ups : [],
      });
      if (fwd.case_id) setCurrentCaseId(fwd.case_id);
      if (fwd.pdf_url) setCurrentPdfUrl(fwd.pdf_url);
      setCurrentCasePending(fwd.role === "moderator" && status === "queued");
    } catch (err) {
      console.error("Error restoring forwarded queue:", err);
    }
  };

  /**
   * Checks Supabase for a sahayak case linked to this session.
   * - If case is "accepted": shows the assigned guide's profile card (read-only).
   * - If case is "pending":  shows the browsing panel so user can still pick a guide.
   */
  const restoreSahayakPanel = async (sessionId: string) => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
      const res = await fetch(`${API_URL}/api/sahayak/session-case?session_id=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status !== "success" || !data.case) return;

      const sc = data.case;
      setSahayakCaseId(sc.id);

      if (sc.status === "accepted" && sc.assigned_sahayak_profile) {
        // Convert db profile → panel format and show as single-item list (the assigned guide)
        const p = sc.assigned_sahayak_profile;
        setRecommendedSahayaks([{
          uid: p.uid || sc.assigned_sahayak_id,
          name: p.name || sc.assigned_sahayak_name || "Nyay Guide",
          location: p.location || "",
          occupation: p.occupation || "Community Legal Aid",
          bio: p.bio || "",
          avatar: p.avatar || "",
          contact_number: p.contact_number || "",
          email: p.email || "",
          availability: p.availability || "Available",
          rating: p.rating || 4.5,
          cases_resolved: p.cases_resolved || 0,
          languages: p.languages || [],
          isAssigned: true, // flag so panel can show "Already connected" state
        }]);
        setAcceptedSahayakId(sc.assigned_sahayak_id || null);
        setShowSahayakPanel(true);
      } else if (sc.status === "pending") {
        // Fetch all profiles for browsing (user hasn't picked yet)
        const profRes = await fetch(`${API_URL}/api/sahayak/profiles`);
        if (profRes.ok) {
          const profData = await profRes.json();
          if (profData.profiles && profData.profiles.length > 0) {
            setRecommendedSahayaks(profData.profiles.map((p: any) => ({
              uid: p.uid, name: p.name, location: p.location, occupation: p.occupation,
              bio: p.bio, avatar: p.avatar, contact_number: p.contact_number,
              email: p.email, availability: p.availability,
              rating: p.rating || 4.5, cases_resolved: p.cases_resolved || 0,
              languages: p.languages || [],
            })));
            setShowSahayakPanel(true);
          }
        }
      }
    } catch (err) {
      console.error("Error restoring sahayak panel:", err);
    }
  };

  // Validation state (reset on new query)
  const [validationComplete, setValidationComplete] = useState(false);

  // Handle Copy
  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Reset validation state on new query
  useEffect(() => {
    if (isLoading) {
      setValidationComplete(false);
    }
  }, [isLoading]);

  const currentAgentRef = useRef<string | null>(null);
  const displayAgentRef = useRef<string | null>(null);
  const [selectedContexts, setSelectedContexts] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceInputRef = useRef<VoiceInputRef>(null);
  const isConversationActive = useRef<boolean>(false);
  const savedCaseIdsRef = useRef<Set<string>>(new Set());
  const completedCaseIdsRef = useRef<Set<string>>(new Set());

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [query]);

  const { location: quietLocation, status: locationStatus } = useQuietUserLocation();
  const userLocation = quietLocation
    ? { lat: quietLocation.lat, lon: quietLocation.lng }
    : null;
  const locationDenied = locationStatus === "denied" || locationStatus === "unavailable";
  const [resolvedLocation, setResolvedLocation] = useState<{
    city?: string;
    state?: string;
    source?: string;
  } | null>(null);

  // Unified Stream Processor
  const processStream = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const decoder = new TextDecoder();
    let assistantMessage = "";
    let finalCleanContent = "";
    let ndjsonBuffer = "";
    let wrapUpText = "";
    let sawStreamError = false;

    const stripAnswerPrefix = (raw: string) => {
      let cleanContent = raw;
      const stripPatterns = [
        /^Output:\s*(?:civil|cyber|criminal|domestic|scam|document|sahayak|legal_moderator|lawyer_forwarder)\s*/i,
        /^(?:civil|cyber|criminal|domestic|scam|document|sahayak|supervisor|assistant)\s*:\s*/i,
        /^(?:civil|cyber|criminal|domestic|scam|document|sahayak|legal\s*moderator|lawyer\s*forwarder|supervisor)\s*agent\s*:\s*/i,
        /^I'm\s+the\s+(?:civil|cyber|criminal|domestic|scam|document|sahayak)\s+agent[.,!\s]*/i,
        /^I\s+am\s+the\s+(?:civil|cyber|criminal|domestic|scam|document|sahayak)\s+agent[.,!\s]*/i,
        /^AI\s*(?:Legal\s*)?Assistant\s*:\s*/i,
        /^Legal\s*Moderator\s*:\s*/i,
      ];
      stripPatterns.forEach((regex) => {
        cleanContent = cleanContent.replace(regex, "");
      });
      if (currentAgentRef.current) {
        const agentName = currentAgentRef.current.replace(/_/g, "[_ ]?");
        cleanContent = cleanContent
          .replace(new RegExp(`^${agentName}[\\s_]?agent:\\s*`, "i"), "")
          .replace(new RegExp(`^${agentName}:\\s*`, "i"), "");
      }
      return cleanContent.trimStart();
    };

    let lastAnswerPaintAt = 0;
    let answerPaintTimer: ReturnType<typeof setTimeout> | null = null;
    const streamKey = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const upsertStreamAssistant = (content: string, extra?: Partial<Message>) => {
      const nextContent = String(content || "");
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.streamKey === streamKey);
        if (idx >= 0) {
          const cur = prev[idx];
          const newMsgs = [...prev];
          newMsgs[idx] = {
            ...cur,
            ...extra,
            content: nextContent,
            agent: extra?.agent || cur.agent || displayAgentRef.current || currentAgentRef.current || undefined,
          };
          return newMsgs;
        }
        const lastIdx = prev.length - 1;
        const lastMsg = prev[lastIdx];
        if (lastMsg && lastMsg.role === "assistant" && !String(lastMsg.content || "").trim()) {
          const newMsgs = [...prev];
          newMsgs[lastIdx] = {
            ...lastMsg,
            ...extra,
            content: nextContent,
            streamKey,
            agent: extra?.agent || lastMsg.agent || displayAgentRef.current || currentAgentRef.current || undefined,
          };
          return newMsgs;
        }
        return [...prev, {
          role: "assistant",
          content: nextContent,
          streamKey,
          agent: extra?.agent || displayAgentRef.current || currentAgentRef.current || undefined,
        }];
      });
    };

    const paintAssistantMessage = () => {
      const painted = String(finalCleanContent || "").trim();
      if (!painted) return;
      upsertStreamAssistant(finalCleanContent);
    };

    const applyAnswerToken = (token: string) => {
      assistantMessage += token;
      finalCleanContent = stripAnswerPrefix(assistantMessage);

      const now = performance.now();
      if (now - lastAnswerPaintAt >= 48) {
        lastAnswerPaintAt = now;
        paintAssistantMessage();
        return;
      }

      if (answerPaintTimer) return;
      answerPaintTimer = setTimeout(() => {
        answerPaintTimer = null;
        lastAnswerPaintAt = performance.now();
        paintAssistantMessage();
      }, 48);
    };

    const flushAnswerToUi = () => {
      if (answerPaintTimer) {
        clearTimeout(answerPaintTimer);
        answerPaintTimer = null;
      }
      if (finalCleanContent) paintAssistantMessage();
    };

    const nextFrame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    // Add temporary empty assistant message to stream into
    setMessages((prev) => [...prev, { role: "assistant", content: "", streamKey }]);

    const handleStreamEvent = (data: any) => {
      if (data.type === "agent_start") {
        currentAgentRef.current = data.agent;
        const excludedDisplayAgents = ["question_processor", "report_generator", "legal_moderator", "supervisor", "agent"];
        if (!displayAgentRef.current && !excludedDisplayAgents.includes(String(data.agent).toLowerCase())) {
          displayAgentRef.current = data.agent;
        }
        setMessages(prev => {
          const lastIdx = prev.findIndex((m) => m.streamKey === streamKey);
          const idx = lastIdx >= 0 ? lastIdx : prev.length - 1;
          const lastMsg = prev[idx];
          if (lastMsg && lastMsg.role === "assistant" && !lastMsg.agent) {
            const newMsgs = [...prev];
            newMsgs[idx] = { ...lastMsg, agent: displayAgentRef.current || data.agent, streamKey };
            return newMsgs;
          }
          return prev;
        });
      } else if (data.type === "log") {
        setLogs(prev => [...prev, {
          type: "log",
          agent: data.agent,
          content: data.content,
          timestamp: new Date().toLocaleTimeString()
        }]);

        if (data.content.startsWith("Transcription: ")) {
          const text = data.content.replace("Transcription: ", "").replace(/^'|'$/g, "");
          setMessages(prev => {
            const newMsgs = [...prev];
            for (let i = newMsgs.length - 1; i >= 0; i--) {
              if (newMsgs[i].role === "user") {
                newMsgs[i] = { ...newMsgs[i], content: "🎤 " + text };
                break;
              }
            }
            return newMsgs;
          });
        }
      } else if (data.type === "case_forwarded") {
        setForwardedQueue({
          role: data.role,
          roleLabel: data.role_label || "Reviewer",
          targetId: data.target_id || data.case_id || "",
          caseId: data.case_id,
          queueStatus: data.queue_status || "queued",
          followUps: [],
        });
        if (data.case_id) setCurrentCaseId(data.case_id);
        if (data.pdf_url) setCurrentPdfUrl(data.pdf_url);
        setCurrentCasePending(data.role === "moderator");
        if (data.role === "sahayak" && data.target_id) setSahayakCaseId(data.target_id);
        if (data.role === "lawyer" && data.target_id) setLawyerCaseId(data.target_id);
      } else if (data.type === "lawyer_recommendations") {
        if (data.lawyer_category) setLawyerCategory(String(data.lawyer_category));
        if (data.lawyers && data.lawyers.length > 0) {
          setRecommendedLawyers(data.lawyers);
          setLawyerCaseId(data.lawyer_case_id || null);
          setLawyerBrowseLoading(false);
          setShowLawyerPanel(true);
        } else {
          setLawyerBrowseLoading(false);
        }
      } else if (data.type === "sahayak_recommendations") {
        setRecommendedSahayaks(data.sahayaks || []);
        setSahayakCaseId(data.sahayak_case_id || null);
        setShowSahayakPanel(true);
      } else if (data.type === "nodal_guide_panel") {
        setNodalGuideProfiles(data.profiles || []);
        setShowNodalGuidePanel(true);
        if (data.sahayak_case_id) setSahayakCaseId(data.sahayak_case_id);
      } else if (data.type === "so_call_pending") {
        setSoCallPending(true);
        setShowFemaleNyayGuidePanel(false);
        setCurrentCasePending(true);
        if (data.case_id) setCurrentCaseId(data.case_id);
      } else if (data.type === "female_nyayguide_panel") {
        setFemaleNyayGuideProfiles(data.profiles || []);
        setShowFemaleNyayGuidePanel(true);
      } else if (data.type === "routing_consent_modal") {
        setRoutingRecommendation(data.routing || null);
        setShowRoutingConsentModal(Boolean(data.routing));
      } else if (data.type === "pending_questions") {
        setQuestionFlowActive(true);
        setStructuredReport(null);
        setCurrentPdfUrl(null);
        setLogs(prev => [...prev, {
          type: "log",
          agent: "question_processor",
          content: `Question ${Number(data.current_index || 0) + 1} of ${Array.isArray(data.questions) ? data.questions.length : 0} ready`,
          timestamp: new Date().toLocaleTimeString()
        }]);
      } else if (data.type === "wrap_up") {
        const text = String(data.content || "").trim();
        if (!text) return;
        wrapUpText = text;
        if (!String(finalCleanContent || "").trim()) {
          assistantMessage = text;
          finalCleanContent = text;
        }
        upsertStreamAssistant(String(finalCleanContent || text), { agent: displayAgentRef.current || currentAgentRef.current || undefined });
      } else if (data.type === "suggestions") {
        if ((data.suggested_actions || []).length) {
          setSuggestedActions((prev) => mergeSuggestionActions(prev, data.suggested_actions));
        }
        if ((data.suggested_links || []).length) {
          setSuggestedLinks((prev) => mergeSuggestionLinks(prev, data.suggested_links));
        }
        setLawyerNeeded((prev) => Boolean(data.lawyer_needed) || prev);
        if (data.lawyer_category) setLawyerCategory(String(data.lawyer_category));
        if (data.lawyer_need_reason) setLawyerNeedReason(String(data.lawyer_need_reason));
        if (data.local_forum) setLocalForum(data.local_forum);
        if (Array.isArray(data.matched_scam_trends) && data.matched_scam_trends.length) {
          setMatchedScamTrends((prev) => {
            const seen = new Set(prev.map((m) => String(m.id || m.title || "")));
            const extra = data.matched_scam_trends.filter(
              (m: ScamMatch) => !seen.has(String(m.id || m.title || ""))
            );
            return extra.length ? [...prev, ...extra] : prev;
          });
        }
        if (data.scam_similarity_note) {
          setScamSimilarityNote(String(data.scam_similarity_note));
        }
        if (Array.isArray(data.nodal_guide_profiles) && data.nodal_guide_profiles.length) {
          setNodalGuideProfiles(data.nodal_guide_profiles);
        }
        if ((data.suggested_actions || []).length || (data.suggested_links || []).length) {
          const isDesktop =
            typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
          if (isDesktop) {
            setShowSuggestionsRail(true);
          } else {
            setSuggestionsPulse(true);
            window.setTimeout(() => setSuggestionsPulse(false), 2200);
          }
        }
      } else if (data.type === "pdf_ready") {
        console.log("📄 PDF is ready:", data.pdf_url);
        setQuestionFlowActive(false);
        if (data.case_id) setCurrentCaseId(data.case_id);
        if (data.pdf_url) setCurrentPdfUrl(data.pdf_url);

        if (user && data.case_id && !completedCaseIdsRef.current.has(data.case_id)) {
          completedCaseIdsRef.current.add(data.case_id);
          const completePayload = {
            uid: user.uid,
            case_id: data.case_id,
            session_id: localSessionId,
            structured_report: data.structured_report || structuredReport || {},
            situation_summary: data.situation_summary || {},
            collected_answers: data.collected_answers || {},
            session_data: messages,
            user_language: data.user_language || "english",
            pdf_url: data.pdf_url || null,
            generate_pdf: false
          };
          fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/cases/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(completePayload)
          }).catch((err) => {
            console.error("Failed to persist completed case:", err);
            completedCaseIdsRef.current.delete(data.case_id);
          });
        }

        // Append completion notice gracefully without creating a new message that disrupts the stream
        const msg = "\n\n✅ **Case document completed and ready!** Your comprehensive case report with all information has been generated and is ready for download from your case history.";
        upsertStreamAssistant(String(finalCleanContent || "") + msg, { agent: displayAgentRef.current || currentAgentRef.current || "system" });
      } else if (data.type === "data") {
        const locFromReport = data.structured_report?.location || data.location || data.situation_summary?.location;
        if (locFromReport && typeof locFromReport === "object") {
          setResolvedLocation({
            city: locFromReport.city,
            state: locFromReport.state,
            source: locFromReport.source,
          });
        }
        const hasPendingQuestions = Array.isArray(data.pending_questions) && data.pending_questions.length > 0;
        if (hasPendingQuestions) {
          setQuestionFlowActive(true);
          setStructuredReport(null);
          setCurrentPdfUrl(null);
        } else {
          setQuestionFlowActive(false);
          setStructuredReport(data.structured_report || null);
          if ((data.suggested_actions || []).length) {
            setSuggestedActions((prev) => mergeSuggestionActions(prev, data.suggested_actions));
          }
          if (Array.isArray(data.suggested_links) && data.suggested_links.length) {
            setSuggestedLinks((prev) => mergeSuggestionLinks(prev, data.suggested_links));
          }
          if ((data.suggested_actions || []).length) {
            const isDesktop =
              typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
            if (isDesktop) setShowSuggestionsRail(true);
            else {
              setSuggestionsPulse(true);
              window.setTimeout(() => setSuggestionsPulse(false), 2200);
            }
          }
          if (data.routing_recommendation) setRoutingRecommendation(data.routing_recommendation);
          if (data.show_routing_consent && data.routing_recommendation) setShowRoutingConsentModal(true);
          if (data.show_female_nyayguide_panel && !soCallPending) {
            setFemaleNyayGuideProfiles(data.female_nyayguide_profiles || []);
            setShowFemaleNyayGuidePanel(true);
          }
        }
        if (data.case_id) setCurrentCaseId(data.case_id);
        if (data.intervention_required) {
          setInterventionCaseId(data.case_id);
          setInterventionCollection(data.intervention_collection || "moderator");
          setCurrentCasePending(true);
        }

        if (data.structured_report && data.case_id && user && !savedCaseIdsRef.current.has(data.case_id) && !data.case_completed) {
          savedCaseIdsRef.current.add(data.case_id);
          try {
            setMessages(prev => {
              const payload = {
                uid: user.uid,
                case_id: data.case_id,
                structured_report: data.structured_report,
                session_data: prev
              };
              fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/cases`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              }).catch(console.error);
              return prev;
            });
          } catch (e) {
            console.error("Failed to save formalized case:", e);
          }
        }
      } else if (data.type === "error") {
        console.error("Stream error:", data.content);
        sawStreamError = true;
        const errText =
          typeof data.content === "string" && data.content.trim()
            ? data.content.trim()
            : "Something went wrong while generating a reply. Please try again.";
        if (!String(finalCleanContent || "").trim()) {
          assistantMessage = errText;
          finalCleanContent = errText;
        }
        upsertStreamAssistant(String(finalCleanContent || errText));
      }
    };

    const dispatchStreamEvent = async (data: any) => {
      if (data.type === "answer") {
        let token = data.content;
        if (typeof token !== "string") {
          token = typeof token?.text === "string" ? token.text : JSON.stringify(token);
        }
        applyAnswerToken(token);
        await nextFrame();
        return;
      }
      handleStreamEvent(data);
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Keep a carry-over buffer so JSON lines split across TCP chunks are not dropped.
        ndjsonBuffer += decoder.decode(value, { stream: true });
        const lines = ndjsonBuffer.split("\n");
        ndjsonBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            await dispatchStreamEvent(JSON.parse(trimmed));
          } catch (e) {
            console.error("Error parsing NDJSON line:", e);
          }
        }
      }

      if (ndjsonBuffer.trim()) {
        try {
          await dispatchStreamEvent(JSON.parse(ndjsonBuffer.trim()));
        } catch {
          /* ignore trailing partial */
        }
      }
    } catch (err) {
      console.error("Stream reading error:", err);
    }

    flushAnswerToUi();

    if (!String(finalCleanContent || "").trim() && wrapUpText) {
      finalCleanContent = wrapUpText;
      paintAssistantMessage();
    }

    // Only fill a still-empty bubble. Never overwrite wrap-up, specialist text, or a stream error.
    if (!String(finalCleanContent || "").trim() && !wrapUpText && !sawStreamError) {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.streamKey === streamKey);
        if (idx < 0) return prev;
        const last = prev[idx];
        if (last?.role === "assistant" && !String(last.content || "").trim()) {
          const next = [...prev];
          next[idx] = {
            ...last,
            content:
              "No reply arrived from the API. Start a new chat and send your last message again.",
          };
          return next;
        }
        return prev;
      });
    }

    return finalCleanContent;
  };

  const handleNewChat = () => {
    const newId = crypto.randomUUID();
    messagesSessionIdRef.current = null;
    setMessages([]);
    setStructuredReport(null);
    setSuggestedActions([]);
    setSuggestedLinks([]);
    setShowSuggestionsRail(false);
    setLawyerNeeded(false);
    setLogs([]);
    setQuery("");
    currentAgentRef.current = null;
    displayAgentRef.current = null;
    clearActiveSession();
    clearActiveQuery();
    setLocalSessionId(newId);
    setActiveSessionId(newId);
    lastFetchedSessionRef.current = "";
    setIsInputCollapsed(false);
    setRecommendedLawyers([]);
    setShowLawyerPanel(false);
    setLawyerCaseId(null);
    setLawyerCategory(null);
    setLawyerBrowseLoading(false);
    setLawyerNeedReason(null);
    setCurrentPdfUrl(null); // Reset PDF URL for new chat
    setQuestionFlowActive(false);
    setForwardedQueue(null);
    setRoutingRecommendation(null);
    setShowRoutingConsentModal(false);
    setFemaleNyayGuideProfiles([]);
    setShowFemaleNyayGuidePanel(false);
    setSoCallPending(false);
    setComposerFiles([]);
    setLocalForum(null);
    setMatchedScamTrends([]);
    setScamSimilarityNote("");
    setNyaySahayakChat(null);
    setShowNodalGuidePanel(false);
    setNodalGuideProfiles([]);
    stopTTS();
    clearSendCountdown();
    setHandsFreeActive(false);
    handsFreeActiveRef.current = false;
    isConversationActive.current = false;
    setShowTalkBackPrompt(false);
  };

  const handleLawyerAccept = async (lawyer: LawyerProfile) => {
    const lawyerUid = lawyer.user_id || (lawyer as any).id;
    if (!lawyerCaseId || !lawyerUid) return;
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/lawyer/cases/${lawyerCaseId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lawyer_id: lawyerUid })
      });
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `✅ **Connected with ${lawyer.name}!** You can continue the conversation in the chat window. Case ID: \`${lawyerCaseId}\`.`,
        agent: "lawyer_forwarder"
      }]);
    } catch (e) {
      console.error("Failed to accept lawyer case:", e);
    }
  };

  const handleLawyerReject = (lawyer: LawyerProfile) => {
    // Just update UI — no backend action needed for rejection
    console.log("Rejected lawyer:", lawyer.name);
  };

  const handleSubmit = async (
    e?: React.FormEvent,
    overrideQuery?: string,
    attachments?: { name: string; text?: string; content_type?: string }[]
  ): Promise<string | void> => {
    e?.preventDefault();
    stopTTS();
    clearSendCountdown();
    voiceInputRef.current?.stopRecording();
    
    // Manual submit terminates continuous conversation loop
    if (!overrideQuery) {
      isConversationActive.current = false;
    }

    let sessionId = localSessionId || activeSessionId || "";
    if (!sessionId && forwardedQueue?.caseId) {
      sessionId = String(forwardedQueue.caseId);
      setLocalSessionId(sessionId);
      setActiveSessionId(sessionId);
      localSessionIdRef.current = sessionId;
    }
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      setLocalSessionId(sessionId);
      setActiveSessionId(sessionId);
      localSessionIdRef.current = sessionId;
    }
    
    let text = overrideQuery || query;
    if ((!text.trim() && selectedContexts.length === 0 && !attachments?.length && composerFiles.length === 0) || isLoading) return;
    if (!text.trim() && (attachments?.length || composerFiles.length)) {
      const names = (attachments || []).map((a) => a.name).concat(composerFiles.map((f) => f.name));
      text = `Please review the attached file${names.length > 1 ? "s" : ""}: ${names.join(", ")}`;
    }

    if (selectedContexts.length > 0 && !overrideQuery) {
      text = `[Context: ${selectedContexts.join(", ")}] ${text}`;
    }

    const trimmed = text.trim().toLowerCase();
    if (
      trimmed === "request a nyayguide" ||
      trimmed === "request nyayguide" ||
      trimmed === "connect me to a new guide" ||
      trimmed === "request a nyay guide" ||
      trimmed === "request on-ground help"
    ) {
      if (nyayGuideSuppressed) {
        setQuery("");
        return;
      }
      setShowNyayGuideCard(true);
      setShowSuggestionsRail(false);
      setQuery("");
      return;
    }

    if (
      trimmed === "connect to nyay guide" ||
      trimmed === "talk to voice moderator" ||
      trimmed === "open voice moderator" ||
      trimmed === "talk to ai moderator" ||
      trimmed === "clarify with voice moderator"
    ) {
      setManualVoiceModeratorTrigger(true);
      setShowSuggestionsRail(false);
      setQuery("");
      return;
    }

    if (forwardedQueue?.role) {
      setQuery("");
      setSelectedContexts([]);
      setIsLoading(true);
      setIsInputCollapsed(true);
      const userMessage = { role: "user" as const, content: text };
      const nextMessages = [...messages, userMessage];
      messagesSessionIdRef.current = sessionId;
      setMessages(nextMessages);
      setActiveSessionId(sessionId);
      upsertSessionInCache({
        id: sessionId,
        session_data: nextMessages,
        updated_at: new Date().toISOString(),
      });
      updateHistoryCache(sessionId, nextMessages);
      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
        const res = await fetch(`${API_URL}/api/cases/follow-up`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            statement: text,
            session_id: sessionId,
            role: forwardedQueue.role,
            target_id: forwardedQueue.targetId,
            case_id: forwardedQueue.caseId || currentCaseId,
            user_id: userIdRef.current,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = data.detail;
          const msg =
            typeof detail === "string"
              ? detail
              : Array.isArray(detail)
                ? detail.map((d: any) => d?.msg || d).filter(Boolean).join("; ")
                : "Could not add follow-up";
          throw new Error(msg);
        }
        const fwd = data.forward || {};
        setForwardedQueue({
          role: fwd.role || forwardedQueue.role,
          roleLabel: fwd.role_label || forwardedQueue.roleLabel,
          targetId: fwd.target_id || forwardedQueue.targetId,
          caseId: fwd.case_id || forwardedQueue.caseId,
          queueStatus: fwd.queue_status || forwardedQueue.queueStatus,
          followUps: Array.isArray(fwd.follow_ups) ? fwd.follow_ups : forwardedQueue.followUps || [],
        });
        const ack = {
          role: "assistant" as const,
          content: `Your statement was added as a follow-up to the case summary in the **${fwd.role_label || forwardedQueue.roleLabel}** queue.`,
          agent: "queue",
        };
        const withAck = [...nextMessages, ack];
        setMessages(withAck);
        updateHistoryCache(sessionId, withAck);
        upsertSessionInCache({
          id: sessionId,
          session_data: withAck,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Follow-up Error:", err);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Sorry — I couldn’t add that follow-up to the forwarded case. Please try again.",
          },
        ]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setQuery("");
    setSelectedContexts([]);
    setStructuredReport(null);
    // Keep suggestions across follow-up turns; merge new batches instead of wiping.
    setQuestionFlowActive(false);
    setShowRoutingConsentModal(false);
    setIsLoading(true);
    streamingRef.current = true;
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      setIsInputCollapsed(true);
    }
    currentAgentRef.current = null;
    displayAgentRef.current = null;

    if (messages.length >= MESSAGE_LIMIT * 2 && !user) {
      streamingRef.current = false;
      setIsLoading(false);
      setShowAuthModal(true);
      return;
    }

    const visibleAtts = (attachments?.length ? attachments : composerFiles).map((f) => ({
      name: f.name,
      content_type: "content_type" in f ? String(f.content_type || "") : (f as File).type,
    }));
    const userMessage = {
      role: "user" as const,
      content: text,
      ...(visibleAtts.length ? { attachments: visibleAtts } : {}),
    };
    const nextMessages = [...messages, userMessage];
    messagesSessionIdRef.current = sessionId;
    setMessages(nextMessages);
    setActiveSessionId(sessionId);
    upsertSessionInCache({
      id: sessionId,
      session_data: nextMessages,
      updated_at: new Date().toISOString(),
    });
    updateHistoryCache(sessionId, nextMessages);

    try {
      const packedAttachments =
        attachments && attachments.length
          ? attachments
          : await filesToChatAttachments(composerFiles);
      setComposerFiles([]);
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: text || (packedAttachments.length ? `Please review the attached file${packedAttachments.length > 1 ? "s" : ""}.` : ""),
          user_id: userIdRef.current,
          user_name: user?.display_name || user?.email?.split("@")[0] || "User",
          location: userLocation,
          session_id: sessionId,
          attachments: packedAttachments,
          session_history: messages.slice(-6).map(m => ({ role: m.role, content: m.content }))
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Chat stream failed: ${response.status} ${errText.slice(0, 200)}`);
      }
      if (!response.body) throw new Error("No response body");
      return await processStream(response.body.getReader());
    } catch (err) {
      console.error("Chat Error:", err);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.content) {
          const next = [...prev];
          next[next.length - 1] = {
            ...last,
            content: "Sorry — I couldn’t get a response. Please try again.",
          };
          return next;
        }
        return [...prev, {
          role: "assistant",
          content: "Sorry — I couldn’t get a response. Please try again.",
        }];
      });
    } finally {
      streamingRef.current = false;
      setIsLoading(false);
      setLawyerBrowseLoading(false);
    }
  };

  const openLawyerBrowser = async (opts?: { category?: string | null; prompt?: string }) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    const cat = opts?.category || lawyerCategory || "Criminal Law";
    setLawyerCategory(cat);
    setShowSuggestionsRail(false);
    setLawyerBrowseLoading(true);
    setShowLawyerPanel(true);

    // Fast pre-population: fetch matched lawyers immediately from /api/lawyers so panel is never empty
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/lawyers`);
      if (res.ok) {
        const data = await res.json();
        const all = data.lawyers || [];
        const catLower = cat.toLowerCase();
        const matched = all.filter((l: any) => {
          const spec = (l.specialization || "").toLowerCase();
          const areas = (l.practice_areas || []).map((a: string) => (a || "").toLowerCase());
          if (catLower.includes("criminal") && (spec.includes("criminal") || areas.some((a: string) => a.includes("criminal")))) return true;
          if (catLower.includes("cyber") && (spec.includes("cyber") || areas.some((a: string) => a.includes("cyber")))) return true;
          if (catLower.includes("family") && (spec.includes("family") || areas.some((a: string) => a.includes("family")))) return true;
          if (catLower.includes("property") && (spec.includes("property") || spec.includes("real estate") || areas.some((a: string) => a.includes("property") || a.includes("real estate")))) return true;
          if (catLower.includes("civil") && (spec.includes("civil") || areas.some((a: string) => a.includes("civil")))) return true;
          return spec.includes(catLower) || areas.some((a: string) => a.includes(catLower));
        });
        if (matched.length > 0) {
          setRecommendedLawyers(matched);
          setLawyerBrowseLoading(false);
        }
      }
    } catch (err) {
      console.warn("Fast lawyer pre-fetch failed:", err);
    }

    const prompt =
      opts?.prompt ||
      (opts?.category
        ? `Please recommend lawyers specializing in ${opts.category} for my case`
        : lawyerCategory
          ? `Please recommend lawyers specializing in ${lawyerCategory} for my case`
          : "Please recommend a lawyer for my case");
    void handleSubmit(undefined, prompt);
  };

  const reportWorkflowState = String(structuredReport?.workflow_state || "").toUpperCase();
  const emergencyEscalationActive =
    Boolean(structuredReport?.emergency_escalation_active) ||
    reportWorkflowState === "EMERGENCY_ESCALATION";
  const humanReviewActive =
    String(structuredReport?.ai_verification_status || "pending").toLowerCase() === "flagged" ||
    Boolean(structuredReport?.manual_review_required) ||
    Boolean(structuredReport?.human_takeover_required) ||
    reportWorkflowState === "HIGH_RISK_HUMAN_REVIEW";
  const nyayGuideSuppressed =
    emergencyEscalationActive || humanReviewActive || !isCaseVerifiedForNextStep(structuredReport);

  const caseSuggestionsRailProps = {
    open: showSuggestionsRail,
    actions: suggestedActions,
    links: suggestedLinks,
    lawyerNeeded,
    lawyerCategory,
    lawyerNeedReason,
    localForum,
    scamMatches: matchedScamTrends,
    scamSimilarityNote,
    isAdmin: role?.toLowerCase() === "admin" || (user as any)?.role?.toLowerCase() === "admin",
    aiVerificationStatus: structuredReport?.ai_verification_status || "pending",
    aiVerificationReason: structuredReport?.ai_verification_reason,
    onClose: () => setShowSuggestionsRail(false),
    onOpenLawyers: () => {
      openLawyerBrowser({ category: lawyerCategory });
    },
  };
  const handleAction = (action: any) => {
    const kind = String(action?.kind || action?.action || action?.payload || "");
    const actionId = String(action?.id || "");
    if (
      (actionKindMatchesNyayguideSuggestion(kind, actionId)) &&
      action?.enabled !== false &&
      NYAYGUIDE_PERMITTING_STATES.has(String(action?.workflow_state || "").toUpperCase())
    ) {
      setManualVoiceModeratorTrigger(true);
      setShowSuggestionsRail(false);
      return;
    }
    if (
      (actionKindMatchesNyayguideSuggestion(kind, actionId)) ||
      nyayGuideSuppressed
    ) {
      return;
    }
    if (kind === "browse_lawyers" || kind === "show_lawyers") {
      openLawyerBrowser({
        category: action?.category || lawyerCategory,
        prompt: action?.payload || action?.label,
      });
      return;
    }
    if (kind === "open_nodal_guide" || kind === "request_nyayguide" || kind === "nyayguide") {
      if (!user) {
        setShowAuthModal(true);
        return;
      }
      setShowNyayGuideCard(true);
      return;
    }
    if (kind === "satisfied") {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Glad this guidance was enough. You can still open Suggestions later if you want the local nodal guide or on-ground NyaySahayak help.",
        },
      ]);
      return;
    }
    if (kind === "open_scam_heatmap") {
      const hit = matchedScamTrends.find((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lon)));
      if (hit && Number.isFinite(Number(hit.lat)) && Number.isFinite(Number(hit.lon))) {
        router.push(
          scamHeatmapHref({
            lat: Number(hit.lat),
            lon: Number(hit.lon),
            title: hit.title || "Scam alert",
          } as MockScam)
        );
      } else {
        router.push("/scam-heatmap");
      }
      return;
    }
    if (kind === "book_nyaysahayak") {
      void bookNyaySahayak();
      return;
    }
    handleSubmit(undefined, action.label || action.payload);
  };

  const areaState = localForum?.state || resolvedLocation?.state || "";

  const openNodalGuideModal = async () => {
    let profiles = nodalGuideProfiles;
    if (!profiles.length) {
      try {
        const data = await fetchNodalGuides({
          state: areaState,
          lat: userLocation?.lat,
          lon: userLocation?.lon,
        });
        profiles = data.guides || [];
        if (data.forum) setLocalForum(data.forum);
        setNodalGuideProfiles(profiles);
      } catch (err) {
        console.error("Nodal guides fetch failed:", err);
      }
    }
    setShowNodalGuidePanel(true);
  };

  const bookNyaySahayak = async () => {
    if (!user || !accessToken) {
      setShowAuthModal(true);
      return;
    }

    if (!currentCaseId) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Please complete your case summary first before booking on-ground NyaySahayak assistance.",
        },
      ]);
      return;
    }

    const currentVerificationStatus = String(
      structuredReport?.ai_verification_status || (currentCasePending ? "pending" : "pending")
    ).toLowerCase();

    if (currentVerificationStatus !== "verified") {
      let statusMsg = "Verifying your case with AI Moderator... Booking will unlock once verification is complete.";
      if (currentVerificationStatus === "flagged") {
        statusMsg = "Your case needs priority human review. We will guide you to the next safe step.";
      } else if (currentVerificationStatus === "rejected") {
        statusMsg = "Booking is unavailable because this case could not be verified.";
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ **AI Verification Required**: ${statusMsg}`,
        },
      ]);
      return;
    }

    try {
      const order = await createNyaySahayakOrder({
        sessionId: localSessionId,
        caseId: currentCaseId,
        state: areaState,
        area: [resolvedLocation?.city, areaState].filter(Boolean).join(", ") || areaState,
      });
      await openRazorpayCheckout({
        keyId: order.key_id,
        planName: "NyaySahayak on-ground",
        name: "NyaySahayak",
        description: "On-ground assistance · ₹49",
        orderId: order.order_id,
        amount: order.amount,
        currency: order.currency,
        prefill: user.email ? { email: user.email } : undefined,
        onPaid: async (response) => {
          if (!response.razorpay_order_id || !response.razorpay_payment_id || !response.razorpay_signature) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "Payment was received but verification details were incomplete. Please try booking again." },
            ]);
            return;
          }
          try {
            const paid = await verifyNyaySahayakPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              sessionId: localSessionId,
              caseId: currentCaseId,
              state: areaState,
            });
            const name = paid.sahayak?.name || order.sahayak?.name || "NyaySahayak";
            const area = paid.area || order.area || areaState || "your area";
            const when = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `📅 **Appointment booked** with **${name}** (NyaySahayak) for **${area}** · ₹49 paid on ${when}.`,
              },
              {
                role: "assistant",
                content: `You have connected to **${name}** NyaySahayak of **${area}**. You can chat with them in the panel on the right — it is the same conversation they see in Nyay Guide chat.`,
              },
            ]);
            if (paid.sahayak_case_id) setSahayakCaseId(paid.sahayak_case_id);
            if (paid.thread_id) {
              setNyaySahayakChat({ threadId: paid.thread_id, name, area });
              setShowSuggestionsRail(false);
            }
          } catch (err: any) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: err?.message || "Could not confirm the NyaySahayak booking." },
            ]);
          }
        },
        onFailed: (message) => {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: message || "Payment failed. You can try booking NyaySahayak again from Suggestions." },
          ]);
        },
      });
    } catch (err: any) {
      if (err?.aiVerificationStatus) {
        setStructuredReport((prev: any) => ({
          ...(prev || {}),
          ai_verification_status: err.aiVerificationStatus,
          ai_verification_reason: err?.reason || prev?.ai_verification_reason,
        }));
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: err?.message || "Could not start NyaySahayak booking." },
      ]);
    }
  };


  const handleChecklistSelect = (item: string) => {
    if (!selectedContexts.includes(item)) {
      setSelectedContexts(prev => [...prev, item]);
    }
  };

  const removeContext = (item: string) => {
    setSelectedContexts(prev => prev.filter(c => c !== item));
  };

  useEffect(() => {
    if (
      !isLoading &&
      messages.length > 0 &&
      user &&
      localSessionId &&
      messagesSessionIdRef.current === localSessionId
    ) {
      const persisted = buildPersistedSessionData(messages);
      if (!hasSidebarCaseContent({ id: localSessionId, session_data: persisted as any })) {
        return;
      }
      const ui = sessionUiFromState({
        suggestedActions,
        suggestedLinks,
        lawyerNeeded,
        localForum,
        matchedScamTrends,
        scamSimilarityNote,
        caseId: currentCaseId,
        pdfUrl: currentPdfUrl,
        showSuggestions:
          suggestedActions.length > 0 ||
          suggestedLinks.length > 0 ||
          lawyerNeeded ||
          Boolean(localForum?.institution_name) ||
          matchedScamTrends.length > 0,
      });
      upsertSessionInCache({
        id: localSessionId,
        session_data: persisted as any,
        case_ui: ui,
      });
      updateHistoryCache(localSessionId, persisted as any);
      syncHistoryToBackend(user.uid, persisted as any, localSessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    messages,
    user,
    localSessionId,
    isLoading,
    suggestedActions,
    suggestedLinks,
    lawyerNeeded,
    localForum,
    matchedScamTrends,
    scamSimilarityNote,
    currentCaseId,
    currentPdfUrl,
  ]);

  const syncHistoryToBackend = async (uid: string, history: Message[], sessionId: string) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/chat/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: uid,
          session_id: sessionId,
          session_data: history
        })
      });
    } catch (e) {
      console.error("Error syncing history:", e);
    }
  };

  const startSendCountdown = (text: string) => {
    pendingVoiceTextRef.current = text;
    setQuery(text);
    setSendCountdown(5);
    if (sendCountdownTimerRef.current) clearInterval(sendCountdownTimerRef.current);
    sendCountdownTimerRef.current = setInterval(() => {
      setSendCountdown((prev) => {
        if (prev == null) return null;
        if (prev <= 1) {
          if (sendCountdownTimerRef.current) {
            clearInterval(sendCountdownTimerRef.current);
            sendCountdownTimerRef.current = null;
          }
          const toSend = pendingVoiceTextRef.current;
          pendingVoiceTextRef.current = "";
          setSendCountdown(null);
          if (toSend.trim()) {
            void (async () => {
              const spokenReply = await handleSubmit(undefined, toSend.trim());
              if (spokenReply?.trim()) await playTalkBack(spokenReply);
              else resumeHandsFreeListening();
            })();
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    setTimeout(() => textareaRef.current?.focus(), 80);
  };

  const handleTranscription = async (text: string, mode: "dictation" | "conversation", languageCode?: string) => {
    const spoken = text.trim();
    if (!spoken) {
      if (handsFreeActiveRef.current) resumeHandsFreeListening();
      return;
    }
    if (languageCode) lastVoiceLangRef.current = languageCode;

    const firstUtterance = messages.length === 0;
    const useCountdown = firstUtterance || mode === "dictation";

    if (mode === "dictation" && !handsFreeActiveRef.current) {
      isConversationActive.current = false;
      setQuery((prev) => prev + (prev.length > 0 ? " " : "") + spoken);
      setTimeout(() => textareaRef.current?.focus(), 100);
      return;
    }

    isConversationActive.current = true;
    setHandsFreeActive(true);
    handsFreeActiveRef.current = true;

    if (useCountdown) {
      startSendCountdown(spoken);
      return;
    }

    const reply = await handleSubmit(undefined, spoken);
    // Talk-back reads assistant replies only — never echo the user's transcript.
    if (reply?.trim()) await playTalkBack(reply);
    else resumeHandsFreeListening();
  };

  return (
    <div className="relative flex h-full max-h-full overflow-hidden bg-white font-sans text-slate-900 selection:bg-[#00634B]/20 dark:bg-slate-900 dark:text-slate-100">

      {/* Side Console Panel */}
      {/* <AgentLog logs={logs} isOpen={isLogOpen} onToggle={() => setIsLogOpen(!isLogOpen)} /> */}

      {/* Main Chat Area */}
      <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Chat Column */}
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!isCasesPage && (
          <Link
            href="/cases"
            title="Open Cases"
            className={cn(
              touchIconButton,
              "absolute top-4 left-4 z-50 bg-white border border-gray-100 dark:bg-slate-800 dark:border-slate-700 shadow-sm rounded-md text-gray-500 hover:text-[#00634B] hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-[color,background-color] duration-150 ease-out motion-press-subtle md:h-10 md:w-10"
            )}
          >
            <Menu size={20} />
          </Link>
        )}

        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          onSuccess={(user, role) => {
            setShowAuthModal(false);
            // Re-sync logic is handled by useEffect on user/messages
            if (query) handleSubmit();
          }}
        />

        {/* Chat Stream — absolute fill so the viewport cannot grow with message height */}
        <div
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden",
            isCasesPage && messages.length === 0 && "overflow-y-auto p-4 md:p-8 custom-scrollbar"
          )}
        >
          {isCasesPage && messages.length === 0 && !handsFreeActive ? (
            <div className="mx-auto grid h-full w-full flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <div aria-hidden />
              <div className="w-full">
                <CaseHomeLanding
                  disabled={isLoading}
                  onStartChat={(message, opts) => {
                    if (opts?.voice) {
                      if (message.trim()) setQuery(message);
                      beginHandsFree();
                      return;
                    }
                    void handleSubmit(undefined, message, opts?.attachments);
                  }}
                />
              </div>
              <div aria-hidden />
            </div>
          ) : messages.length === 0 && !handsFreeActive ? (
            <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-8 custom-scrollbar">
              <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center min-h-[60vh] animate-in fade-in zoom-in-95 duration-700">
                <div className="relative mb-8 flex h-24 w-24 items-center justify-center rounded-xl border-2 border-[#00634B]/10 bg-[#E6F0ED] p-4 shadow-xl shadow-[#00634B]/5 dark:bg-emerald-900/30">
                  <Image src="/3.png" alt="AI Assistant" fill className="object-contain p-4 dark:hidden" />
                  <Image src="/2.png" alt="AI Assistant" fill className="object-contain p-4 hidden dark:block" />
                </div>
                <h2 className="mb-4 text-center text-4xl font-black tracking-tight text-gray-900 dark:text-white">
                  How can I help you?
                </h2>
                <p className="mb-12 max-w-sm text-center text-lg text-gray-500 dark:text-gray-400">
                  Your AI Legal Expert for procedures, rights, and document assistance.
                </p>

                <div className="grid w-full grid-cols-1 gap-4 px-4 md:grid-cols-2">
                  {SUGGESTED_QUESTIONS.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSubmit(undefined, q.payload)}
                      className="group flex items-center gap-4 rounded-xl border border-gray-100 bg-white p-4 text-left shadow-sm motion-hover-card motion-press-subtle dark:border-slate-700 dark:bg-slate-800"
                    >
                      <div className="rounded-lg bg-gray-50 p-2 transition-colors group-hover:bg-[#E6F0ED] dark:bg-slate-700 dark:group-hover:bg-[#00634B]/20">
                        <q.icon className="h-5 w-5 text-gray-400 transition-colors group-hover:text-[#00634B] dark:text-gray-300 dark:group-hover:text-emerald-400" />
                      </div>
                      <span className="text-sm font-semibold text-gray-700 group-hover:text-gray-900 dark:text-gray-200 dark:group-hover:text-white">
                        {q.text}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <CaseChatMessageList
              messages={messages}
              isLoading={isLoading}
              structuredReport={structuredReport}
              suggestedActions={suggestedActions}
              copiedIndex={copiedIndex}
              currentCasePending={currentCasePending}
              caseId={currentCaseId}
              userId={userIdRef.current}
              sessionId={activeSessionId}
              manualVoiceModeratorTrigger={manualVoiceModeratorTrigger}
              onCloseVoiceModerator={() => setManualVoiceModeratorTrigger(false)}
              onContextRefined={(updated) => {
                setStructuredReport((prev: any) => ({ ...(prev || {}), ...updated }));
              }}
              showNyayGuideCard={showNyayGuideCard}
              nyayGuideRequest={nyayGuideRequest}
              onCloseNyayGuideCard={() => setShowNyayGuideCard(false)}
              onNyayGuideRequestCreated={(req) => {
                setNyayGuideRequest(req);
                setShowNyayGuideCard(false);
              }}
              onNyayGuideRequestCancelled={() => {
                setNyayGuideRequest(null);
                setShowNyayGuideCard(false);
              }}
              forwardedQueue={forwardedQueue}
              bottomPaddingClass={isInputCollapsed ? "pb-24 md:pb-20" : "pb-56 md:pb-48"}
              jumpButtonClassName={
                isInputCollapsed
                  ? "bottom-24 md:bottom-16 sm:bottom-20"
                  : "bottom-44 md:bottom-36 sm:bottom-40"
              }
              handleCopy={handleCopy}
              handleChecklistSelect={handleChecklistSelect}
              handleAction={handleAction}
              locationBanner={
                (resolvedLocation?.city || resolvedLocation?.state || userLocation || locationDenied) ? (
                  <div className="w-full">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                      <MapPin size={13} className="shrink-0" />
                      {resolvedLocation?.city || resolvedLocation?.state ? (
                        <span>
                          {[resolvedLocation.city, resolvedLocation.state].filter(Boolean).join(", ")}
                          {resolvedLocation.source === "user_area"
                            ? " · area shared"
                            : userLocation
                              ? " · GPS"
                              : ""}
                        </span>
                      ) : userLocation ? (
                        <span>Location shared (GPS)</span>
                      ) : (
                        <span>Location not shared — area may be requested in chat</span>
                      )}
                    </div>
                  </div>
                ) : undefined
              }
            />
          )}
        </div>

        {/* Floating restore button when input is collapsed */}
        {isInputCollapsed && !(isCasesPage && messages.length === 0) && (
          <div
            className={cn(
              "z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-300",
              isCasesPage
                ? "fixed left-1/2 bottom-[calc(5.1rem+env(safe-area-inset-bottom))] md:absolute md:bottom-5"
                : "absolute bottom-4 left-1/2 md:bottom-5"
            )}
          >
            <button
              onClick={() => {
                setIsInputCollapsed(false);
                setTimeout(() => textareaRef.current?.focus(), 100);
              }}
              className="flex items-center gap-2.5 bg-[#00634B] hover:bg-[#004D3C] text-white text-xs font-bold px-5 py-3 rounded-full shadow-2xl shadow-[#00634B]/30 motion-press group"
            >
              <MessageSquare size={15} className="group-hover:scale-110 transition-transform" />
              <span>{forwardedQueue ? "Add statement" : "Reply"}</span>
            </button>
          </div>
        )}

        {/* Floating Input Area */}
        <div
          className={cn(
            isCasesPage
              ? "fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 px-2 md:absolute md:bottom-8 md:px-6"
              : "absolute bottom-3 left-0 right-0 z-20 px-2 md:bottom-8 md:px-6",
            "flex justify-center",
            panelMotion,
            isInputCollapsed || (isCasesPage && messages.length === 0 && !handsFreeActive)
              ? "pointer-events-none opacity-0 translate-y-8 select-none"
              : "pointer-events-none opacity-100 translate-y-0"
          )}
          aria-hidden={isInputCollapsed || (isCasesPage && messages.length === 0 && !handsFreeActive)}
        >
          <div
            className={cn(
              "w-full max-w-4xl",
              // Only the visible composer may receive clicks — never the faded shell over Reply.
              !(isInputCollapsed || (isCasesPage && messages.length === 0 && !handsFreeActive)) &&
                "pointer-events-auto"
            )}
          >
            {composerFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                {composerFiles.map((file, idx) => (
                  <span
                    key={`${file.name}-${file.size}-${file.lastModified}-${idx}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#00634B]/20 bg-white px-2.5 py-1 text-[12px] font-medium text-[#00634B] shadow-sm"
                  >
                    <Paperclip size={12} className="shrink-0" />
                    <span className="max-w-[12rem] truncate">{file.name}</span>
                    <button
                      type="button"
                      className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#00634B]/60 hover:bg-[#E6F0ED] hover:text-[#004D3C]"
                      onClick={() => setComposerFiles((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label={`Remove ${file.name}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative flex flex-col gap-1.5 overflow-visible rounded-xl border border-gray-100 bg-white/95 p-1.5 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.15)] ring-1 ring-black/5 backdrop-blur-xl transition-[box-shadow,ring-color] duration-200 ease-out hover:ring-[#00634B]/20 dark:border-slate-700 dark:bg-slate-800/95 dark:shadow-none md:gap-2 md:p-2">
              {sendCountdown != null && (
                <div className="mx-2 mt-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-[#00634B] dark:bg-emerald-950/40 dark:text-emerald-200">
                  <span>
                    Sending in <span className="font-semibold tabular-nums">{sendCountdown}s</span>
                    . Type to edit and cancel auto-send.
                  </span>
                  <button type="button" className="shrink-0 font-semibold" onClick={clearSendCountdown}>
                    Keep editing
                  </button>
                </div>
              )}
              {handsFreeActive && sendCountdown == null && !isLoading && (
                <p className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-widest text-[#00634B]/70">
                  Hands-free · speak a follow-up, pause 2s to send
                </p>
              )}
              {soCallPending && (
                <div className="mx-2 mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
                  <p className="font-bold flex items-center gap-2">
                    <Phone size={14} /> Confirmation call pending
                  </p>
                  <p className="mt-1 text-amber-800 text-xs leading-relaxed">
                    A moderator will call you once, with no payment. After that call, a female Nyay Guide receives your case.
                  </p>
                </div>
              )}
              {/* Selected Context Badges */}
              {selectedContexts.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pt-2 pb-1">
                  {selectedContexts.map((ctx, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 bg-[#E6F0ED] text-[#00634B] border border-[#00634B]/10 px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase">
                      <span>{ctx}</span>
                      <button
                        type="button"
                        onClick={() => removeContext(ctx)}
                        aria-label={`Remove ${ctx}`}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:text-red-500 transition-colors md:min-h-0 md:min-w-0 md:h-auto md:w-auto"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex w-full min-w-0 items-end gap-1 px-1 md:gap-2 md:px-2">
                <div className="flex shrink-0 items-center gap-0.5 pb-1.5 md:gap-1.5 md:pb-2.5 md:pl-2">
                  <VoiceInput
                    ref={voiceInputRef}
                    onTranscription={handleTranscription}
                    isProcessing={isLoading}
                    compact
                  />
                  <div className="relative h-9 w-9 shrink-0 md:h-8 md:w-8">
                    <input
                      id="cases-composer-files"
                      ref={composerFileRef}
                      type="file"
                      multiple
                      accept={COMPOSER_FILE_ACCEPT}
                      title="Attach a document"
                      aria-label="Attach a document"
                      className="absolute inset-0 z-10 cursor-pointer opacity-0 file:hidden [&::-webkit-file-upload-button]:hidden"
                      onChange={(e) => {
                        addComposerFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <span
                      className={cn(
                        "pointer-events-none inline-flex h-full w-full items-center justify-center rounded-full text-gray-400",
                        composerFiles.length > 0 && "bg-[#E6F0ED] text-[#00634B]"
                      )}
                    >
                      <Paperclip size={15} />
                      {composerFiles.length > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#00634B] px-1 text-[9px] font-bold leading-none text-white">
                          {composerFiles.length}
                        </span>
                      )}
                    </span>
                  </div>
                  {isPlayingTTS && (
                    <button
                      type="button"
                      onClick={() => {
                        stopTTS();
                        resumeHandsFreeListening();
                      }}
                      title="Pause voice"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 md:h-10 md:w-10"
                    >
                      <div className="h-3 w-3 rounded bg-red-600 dark:bg-red-500" />
                    </button>
                  )}
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsInputCollapsed(true)}
                      title="Collapse input"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-[#E6F0ED] hover:text-[#00634B] md:h-8 md:w-8"
                    >
                      <ChevronDown size={16} />
                    </button>
                  )}
                </div>

                <form
                  onSubmit={(e) => handleSubmit(e)}
                  className="flex min-w-0 flex-1 items-end gap-1.5 pb-0.5 md:relative md:pb-2"
                >

                  <textarea
                    ref={textareaRef}
                    value={query}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (
                        sendCountdown != null &&
                        pendingVoiceTextRef.current &&
                        next !== pendingVoiceTextRef.current
                      ) {
                        clearSendCountdown();
                      }
                      setQuery(next);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                    placeholder={
                      isLoading
                        ? "AI is analyzing case & generating response…"
                        : forwardedQueue
                        ? `Add a follow-up for the ${forwardedQueue.roleLabel} queue…`
                        : currentCasePending
                          ? "Moderator review pending…"
                          : "Message"
                    }
                    rows={1}
                    className="composer-scroll min-h-[40px] w-full max-h-36 resize-none overflow-y-auto bg-transparent py-2.5 pl-1 pr-0 text-base leading-relaxed text-gray-800 placeholder:text-gray-400 focus:border-0 focus:outline-none focus:ring-0 focus-visible:ring-0 disabled:opacity-50 dark:text-gray-200 dark:placeholder:text-gray-500 md:min-h-[48px] md:py-3.5 md:pl-2 md:pr-14"
                    disabled={isLoading}
                  />
                  <div className="pointer-events-none absolute -bottom-1 left-2 hidden text-[9px] font-bold uppercase tracking-widest text-gray-300 md:block">
                    Shift + Enter for new line • Enter to send {!user && `(${Math.floor(messages.length / 2)}/${MESSAGE_LIMIT})`}
                  </div>
                  <button
                    type="submit"
                    disabled={(!query.trim() && composerFiles.length === 0) || isLoading}
                    aria-label="Send"
                    className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#00634B] text-white shadow-lg shadow-[#00634B]/20 hover:bg-[#004D3C] disabled:opacity-30 motion-press md:absolute md:right-1 md:bottom-2 md:h-12 md:w-12"
                  >
                    <Send className="h-4 w-4 md:h-5 md:w-5" />
                  </button>
                </form>
              </div>
            </div>
            <div className="mt-3 hidden text-center text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 opacity-60 md:block">
              Verified AI Legal Intelligence
            </div>
          </div>
        </div>

        </div>

        {(() => {
          const hasSuggestions =
            suggestedActions.length > 0 ||
            suggestedLinks.length > 0 ||
            lawyerNeeded ||
            Boolean(localForum?.institution_name) ||
            matchedScamTrends.length > 0;
          const panelsBusy = showLawyerPanel || showSahayakPanel || Boolean(nyaySahayakChat);
          if (!hasSuggestions || panelsBusy) return null;
          return (
            <>
              {!showSuggestionsRail && (
                <button
                  type="button"
                  title="Open suggestions"
                  aria-label="Open suggestions"
                  onClick={() => {
                    setShowSuggestionsRail(true);
                    setSuggestionsPulse(false);
                  }}
                  className={cn(
                    "fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#00634B] shadow-[0_12px_28px_-8px_rgba(0,99,75,0.45)] ring-2 ring-[#00634B]/25 transition-transform hover:scale-105 md:right-6",
                    currentPdfUrl ? "bottom-40 md:bottom-36" : "bottom-24 md:bottom-28",
                    suggestionsPulse && "animate-suggest-nudge"
                  )}
                >
                  <Sparkles className="h-6 w-6" />
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00634B] opacity-60" />
                    <span className="relative inline-flex h-4 w-4 rounded-full bg-[#00634B]" />
                  </span>
                </button>
              )}
              <CaseSuggestionsRail
                {...caseSuggestionsRailProps}
                presentation="modal"
                onOpenVoiceModerator={() => {
                  setShowSuggestionsRail(false);
                  setManualVoiceModeratorTrigger(true);
                }}
                onAction={(action) => {
                  setShowSuggestionsRail(false);
                  handleAction(action);
                }}
              />
              <CaseSuggestionsRail
                {...caseSuggestionsRailProps}
                presentation="rail"
                onOpenVoiceModerator={() => setManualVoiceModeratorTrigger(true)}
                onAction={(action) => handleAction(action)}
              />
            </>
          );
        })()}

        {nyaySahayakChat && accessToken && user && (
          <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-900 md:static md:inset-auto md:z-auto md:w-[min(420px,100%)] md:flex-shrink-0 md:h-full md:overflow-hidden md:border-l md:border-gray-100 dark:md:border-slate-700">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#00634B]/70">NyaySahayak</p>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{nyaySahayakChat.name}</h2>
                <p className="text-xs text-slate-500">{nyaySahayakChat.area}</p>
              </div>
              <button
                type="button"
                onClick={() => setNyaySahayakChat(null)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                aria-label="Close NyaySahayak chat"
              >
                <X className="size-4" />
              </button>
            </div>
            <SahayakChatPane
              threadId={nyaySahayakChat.threadId}
              accessToken={accessToken}
              currentUserId={user.uid}
              peerLabel={nyaySahayakChat.name}
              className="min-h-0 flex-1"
            />
          </div>
        )}

        {/* Lawyer browser — responsive modal (mobile sheet + desktop dialog) */}
        {showLawyerPanel && !showSahayakPanel && (
          <LawyerBrowserPanel
            lawyers={recommendedLawyers}
            lawyerCaseId={lawyerCaseId}
            category={lawyerCategory}
            loading={lawyerBrowseLoading}
            presentation="modal"
            onClose={() => {
              setShowLawyerPanel(false);
              setLawyerBrowseLoading(false);
            }}
            onAccept={handleLawyerAccept}
            onReject={handleLawyerReject}
          />
        )}

        {/* Sahayak Browser Split Panel — full-screen overlay on mobile */}
        {showSahayakPanel && (
          <div className="fixed inset-0 z-50 bg-white dark:bg-slate-900 md:static md:inset-auto md:z-auto md:w-[min(440px,100%)] md:flex-shrink-0 md:h-full md:overflow-hidden md:border-l md:border-gray-100 dark:md:border-slate-700 animate-in slide-in-from-right-8 duration-500">
            <SahayakBrowserPanel
              sahayaks={recommendedSahayaks}
              sahayakCaseId={sahayakCaseId}
              userId={user?.uid || ""}
              initialAcceptedId={acceptedSahayakId}
              onClose={() => { setShowSahayakPanel(false); setAcceptedSahayakId(null); }}
              onAccept={(uid, name) => {
                setAcceptedSahayakId(uid);
                setMessages(prev => [
                  ...prev,
                  { role: "assistant", content: `✅ You're now connected with **${name}**, your Nyay Guide! Open their profile to chat, or find them later under Find Help → Connected Sahayak.` }
                ]);
              }}
            />
          </div>
        )}

        {/* PDF Download Panel */}

        <PDFDownloadPanel caseId={currentCaseId ?? undefined} pdfUrl={currentPdfUrl} />

        {/* Nodal Guide Modal Panel */}
        {showNodalGuidePanel && (
          <NodalGuideBrowserPanel
            profiles={nodalGuideProfiles}
            caseId={currentCaseId}
            sessionId={localSessionId}
            userId={user?.uid || ""}
            stateName={areaState}
            forum={localForum}
            onConnect={(profile, forward) => {
              setShowNodalGuidePanel(false);
              setShowSuggestionsRail(false);
              const forumName = profile.institution_name || profile.forum_label || localForum?.institution_name || "local justice body";
              if (forward?.role || forward?.case_id || forward?.target_id) {
                setForwardedQueue({
                  role: forward.role || "nodal_guide",
                  roleLabel: forward.role_label || "Nodal Guide",
                  targetId: forward.target_id || "",
                  caseId: forward.case_id || currentCaseId,
                  queueStatus: forward.queue_status || "queued",
                  followUps: Array.isArray(forward.follow_ups) ? forward.follow_ups : [],
                });
                if (forward.case_id) setCurrentCaseId(forward.case_id);
                if (forward.pdf_url) setCurrentPdfUrl(forward.pdf_url);
              } else {
                setForwardedQueue({
                  role: "nodal_guide",
                  roleLabel: "Nodal Guide",
                  targetId: String(profile.id || profile.uid || ""),
                  caseId: currentCaseId,
                  queueStatus: "queued",
                  followUps: [],
                });
              }
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: `✅ Your case was forwarded to **${profile.name}** (${forumName}). It is **waiting for review** in the local forum queue — like a moderator handoff. Follow-ups you send now are attached to that summary.`,
                },
              ]);
            }}
            onClose={() => setShowNodalGuidePanel(false)}
          />
        )}

        {showTalkBackPrompt && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-[#00634B] dark:bg-emerald-950/50">
                <Volume2 className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Turn on talk-back?</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Replies shown in this chat can be read aloud here with Sarvam. Turn your volume up first. You can pause anytime with the square button, or by sending the next message.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => answerTalkBackPrompt(false)}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Voice in only
                </button>
                <button
                  type="button"
                  onClick={() => answerTalkBackPrompt(true)}
                  className="flex-1 rounded-xl bg-[#00634B] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#014D3C]"
                >
                  Read replies aloud
                </button>
              </div>
            </div>
          </div>
        )}

        {showRoutingConsentModal && routingRecommendation && (
          <RoutingConsentModal
            routing={routingRecommendation}
            onClose={() => setShowRoutingConsentModal(false)}
          />
        )}

        {showFemaleNyayGuidePanel && !soCallPending && (
          <FemaleNyayGuidePanel
            profiles={femaleNyayGuideProfiles}
            caseId={currentCaseId}
            userId={user?.uid || ""}
            onConnect={(profile) => {
              setShowFemaleNyayGuidePanel(false);
              setMessages(prev => [
                ...prev,
                { role: "assistant", content: `✅ You're now connected with **${profile.name}** (Female NyayGuide).` }
              ]);
            }}
            onClose={() => setShowFemaleNyayGuidePanel(false)}
          />
        )}
      </main>
    </div>
  );
}
