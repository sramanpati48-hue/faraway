"use client";

import React, { useEffect, useState, useRef } from "react";
import {
  Shield, MapPin, CheckCircle2, AlertCircle, Clock, Navigation,
  UserCheck, FileText, ChevronRight, X, Sparkles, RefreshCw,
  Phone, Star, ShieldAlert, HeartHandshake, Loader2, Compass, LogIn
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { AuthModal } from "@/components/auth/AuthModal";
import {
  type NyayGuideRequest,
  type NyayGuideProfile,
  createNyayGuideRequest,
  fetchNyayGuideRequest,
  fetchActiveCaseRequest,
  cancelNyayGuideRequest,
} from "@/lib/nyayguideApi";
import { readStoredUserLocation, getUserLocationQuietly } from "@/lib/userLocation";

interface NyayGuideDispatchCardProps {
  caseId: string;
  structuredReport?: any;
  initialRequest?: NyayGuideRequest | null;
  onClose?: () => void;
  onRequestCreated?: (request: NyayGuideRequest) => void;
  onRequestCancelled?: () => void;
}

export function NyayGuideDispatchCard({
  caseId,
  structuredReport,
  initialRequest,
  onClose,
  onRequestCreated,
  onRequestCancelled,
}: NyayGuideDispatchCardProps) {
  const { user, accessToken } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [request, setRequest] = useState<NyayGuideRequest | null>(initialRequest || null);
  const [showPreConfirm, setShowPreConfirm] = useState(!initialRequest);
  const [assistanceType, setAssistanceType] = useState<string>("document_support");
  const [locationConsent, setLocationConsent] = useState(true);
  const [preferredFemale, setPreferredFemale] = useState(
    Boolean(
      structuredReport?.preferred_gender === "female" ||
        String(structuredReport?.incident_type).toLowerCase().includes("sexual") ||
        String(structuredReport?.incident_type).toLowerCase().includes("harass")
    )
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rating, setRating] = useState<number>(5);
  const [feedback, setFeedback] = useState<string>("");
  const idempotencyKeyRef = useRef<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for status updates while request is active
  useEffect(() => {
    if (!request?.id) return;
    const activeStatuses = [
      "REQUESTED",
      "SEARCHING",
      "OFFER_SENT",
      "MATCHED",
      "NYAYGUIDE_EN_ROUTE",
      "NYAYGUIDE_ARRIVED",
      "ASSISTANCE_ACTIVE",
    ];

    if (!activeStatuses.includes(request.status)) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    const poll = async () => {
      try {
        const updated = await fetchNyayGuideRequest(request.id, accessToken);
        setRequest(updated);
      } catch (err) {
        console.warn("[NyayGuide] Polling error:", err);
      }
    };

    pollTimerRef.current = setInterval(poll, 3000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [request?.id, request?.status, accessToken]);

  const handleConfirmRequest = async () => {
    if (!user) {
      setShowAuthModal(true);
      setErrorMsg("Please sign in to request a NyayGuide.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const storedLoc = readStoredUserLocation();
      let lat = storedLoc?.lat || null;
      let lng = storedLoc?.lng || null;

      if (locationConsent && (!lat || !lng)) {
        const gps = await getUserLocationQuietly();
        if (gps) {
          lat = gps.lat;
          lng = gps.lng;
        }
      }

      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = `ng_req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      }

      const req = await createNyayGuideRequest(
        {
          case_id: caseId,
          assistance_type: assistanceType,
          location_consent: locationConsent,
          latitude: locationConsent ? lat : null,
          longitude: locationConsent ? lng : null,
          preferred_gender: preferredFemale ? "female" : "any",
          confirmed: true,
          idempotency_key: idempotencyKeyRef.current,
        },
        accessToken
      );

      setRequest(req);
      setShowPreConfirm(false);
      idempotencyKeyRef.current = null;
      onRequestCreated?.(req);
    } catch (err: any) {
      const status = err?.status;
      const msg = String(err?.message || "").toLowerCase();

      if (status === 401 || msg.includes("session expired") || msg.includes("sign in")) {
        setErrorMsg("Your session expired. Please sign in again.");
      } else if (status === 403 || msg.includes("not authorized")) {
        setErrorMsg("You are not authorized to request assistance for this case.");
      } else if (status === 409 || msg.includes("already active")) {
        setErrorMsg("A NyayGuide request is already active for this case.");
        void fetchActiveCaseRequest(caseId, accessToken).then((existing) => {
          if (existing) {
            setRequest(existing);
            setShowPreConfirm(false);
          }
        });
      } else if (status === 422 || status === 400 || msg.includes("confirm")) {
        setErrorMsg("Please confirm the assistance request and required details.");
      } else {
        setErrorMsg("We could not start the NyayGuide search. Please retry.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!request?.id) return;
    try {
      const updated = await cancelNyayGuideRequest(request.id, "Citizen cancelled", accessToken);
      setRequest(updated);
      onRequestCancelled?.();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to cancel request");
    }
  };

  // ── Pre-Confirmation Sheet ────────────────────────────────────────────────
  if (
    showPreConfirm &&
    (!request ||
      request.status === "CANCELLED" ||
      request.status === "COMPLETED" ||
      request.status === "NO_NYAYGUIDE_AVAILABLE")
  ) {
    return (
      <>
        <div className="rounded-2xl border border-emerald-300/80 bg-white p-4 shadow-[0_12px_32px_-12px_rgba(0,99,75,0.2)] dark:border-emerald-900/60 dark:bg-slate-900">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-xl bg-[#00634B]/10 text-[#00634B] dark:bg-[#00634B]/20 dark:text-emerald-400">
                <HeartHandshake className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Request a NyayGuide</h3>
                <p className="text-[11px] text-slate-500">Physical on-ground assistance</p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="mt-3.5 space-y-2.5 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
              <p className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Help organizing documents</span>
              </p>
              <p className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Help navigating the local office</span>
              </p>
              <p className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Help with complaint-form process</span>
              </p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/30">
              <p className="text-[11px] font-medium text-amber-900 dark:text-amber-200">
                NyayGuides provide physical assistance. They do not provide legal advice.
              </p>
            </div>

            {!user && (
              <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50/90 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                <div className="flex items-center gap-1.5">
                  <LogIn className="size-3.5" />
                  <span>Please sign in to request a NyayGuide</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAuthModal(true)}
                  className="font-bold text-[#00634B] hover:underline"
                >
                  Sign In →
                </button>
              </div>
            )}

            <div className="space-y-1.5 pt-1">
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Assistance Type:
              </label>
              <select
                value={assistanceType}
                onChange={(e) => setAssistanceType(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 focus:border-[#00634B] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="document_support">Document organization & checklist</option>
                <option value="office_navigation">Local office / Police station navigation</option>
                <option value="complaint_filing_support">Complaint filing hand-holding</option>
                <option value="digital_assistance">Digital form & portal assistance</option>
                <option value="other">General practical support</option>
              </select>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <MapPin className="size-3.5 text-slate-500" />
                <span className="text-xs text-slate-700 dark:text-slate-300">Share location for nearby matching</span>
              </div>
              <input
                type="checkbox"
                checked={locationConsent}
                onChange={(e) => setLocationConsent(e.target.checked)}
                className="size-4 accent-[#00634B]"
              />
            </div>

            {preferredFemale && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                <Shield className="size-3.5 text-rose-600 shrink-0" />
                <span>Prioritizing verified female NyayGuide for your sensitive matter.</span>
              </div>
            )}

            {errorMsg && (
              <div className="space-y-1 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                <p className="font-semibold">{errorMsg}</p>
                {(errorMsg.includes("expired") || errorMsg.includes("sign in")) && (
                  <button
                    type="button"
                    onClick={() => setShowAuthModal(true)}
                    className="font-bold text-[#00634B] hover:underline"
                  >
                    Sign in to your account →
                  </button>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmRequest}
                className="flex-1 rounded-xl bg-[#00634B] py-2.5 text-xs font-semibold text-white shadow-md hover:bg-[#004D3C] disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" /> Requesting...
                  </span>
                ) : (
                  "Request NyayGuide"
                )}
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            setErrorMsg(null);
          }}
        />
      </>
    );
  }

  if (!request) return null;

  // ── Uber/Ola Style Live Dispatch States ────────────────────────────────────
  const status = request.status;

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-lg ring-1 ring-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:ring-slate-800">
        {/* State: SEARCHING */}
        {status === "SEARCHING" && (
          <div className="text-center py-3 space-y-3">
            <div className="relative mx-auto size-16 flex items-center justify-center">
              <div className="absolute inset-0 animate-ping rounded-full bg-[#00634B]/20" />
              <div className="relative flex size-12 items-center justify-center rounded-full bg-[#00634B] text-white shadow-md">
                <Compass className="size-6 animate-spin" />
              </div>
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Searching for a nearby verified NyayGuide...</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Searching within {request.search_radius_km || 3} km
              </p>
            </div>
            <button
              onClick={handleCancelRequest}
              className="text-xs font-medium text-rose-600 hover:underline"
            >
              Cancel search
            </button>
          </div>
        )}

        {/* State: OFFER_SENT */}
        {status === "OFFER_SENT" && (
          <div className="text-center py-3 space-y-3">
            <div className="relative mx-auto size-14 flex items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              <Clock className="size-6 animate-pulse" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Contacting a nearby NyayGuide...</h4>
              <p className="text-xs text-slate-500 mt-0.5">Awaiting provider acceptance</p>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <Loader2 className="size-3 animate-spin" /> Connecting...
            </div>
            <div>
              <button
                onClick={handleCancelRequest}
                className="text-xs font-medium text-rose-600 hover:underline"
              >
                Cancel request
              </button>
            </div>
          </div>
        )}

        {/* State: MATCHED */}
        {status === "MATCHED" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
              <div className="flex items-center gap-1.5">
                <span className="flex size-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  NyayGuide Matched
                </span>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                VERIFIED
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="size-12 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 dark:bg-slate-800">
                {request.assigned_nyayguide?.profile_photo_url ? (
                  <img
                    src={request.assigned_nyayguide.profile_photo_url}
                    alt={request.assigned_nyayguide.display_name}
                    className="size-full object-cover"
                  />
                ) : (
                  <UserCheck className="size-6 text-slate-600 dark:text-slate-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {request.assigned_nyayguide?.display_name || "Assigned NyayGuide"}
                </h4>
                <p className="text-xs text-slate-500">
                  Languages: {(request.assigned_nyayguide?.languages || ["English", "Hindi"]).join(", ")}
                </p>
                <div className="flex items-center gap-1 text-xs text-amber-600 font-semibold mt-0.5">
                  <Star className="size-3 fill-amber-500 text-amber-500" />
                  <span>{request.assigned_nyayguide?.rating || 4.8} rating</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-emerald-50 p-2.5 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              <p className="font-semibold">Assistance Category: {request.assistance_type.replace("_", " ")}</p>
              <p className="mt-0.5 text-[11px] opacity-90">{request.safe_task_summary}</p>
            </div>

            <div className="flex justify-between items-center text-xs pt-1">
              <span className="text-slate-500">Preparing to depart...</span>
              <button
                onClick={handleCancelRequest}
                className="text-rose-600 hover:underline font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* State: NYAYGUIDE_EN_ROUTE */}
        {status === "NYAYGUIDE_EN_ROUTE" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
              <span className="text-xs font-bold text-[#00634B] dark:text-emerald-400 flex items-center gap-1.5">
                <Navigation className="size-3.5 animate-bounce" /> Your NyayGuide is on the way
              </span>
              <span className="text-xs text-slate-500">En Route</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="size-11 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200">
                {request.assigned_nyayguide?.profile_photo_url ? (
                  <img
                    src={request.assigned_nyayguide.profile_photo_url}
                    alt={request.assigned_nyayguide.display_name}
                    className="size-full object-cover"
                  />
                ) : (
                  <UserCheck className="size-5 text-slate-600" />
                )}
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                  {request.assigned_nyayguide?.display_name || "NyayGuide"}
                </h4>
                <p className="text-[11px] text-slate-500">Arriving shortly at your location</p>
              </div>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-[#00634B]" />
            </div>

            <p className="text-[11px] text-slate-500 text-center">
              Keep your case reference or identity documents ready.
            </p>
          </div>
        )}

        {/* State: NYAYGUIDE_ARRIVED */}
        {status === "NYAYGUIDE_ARRIVED" && (
          <div className="space-y-3 text-center py-2">
            <div className="mx-auto size-12 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center dark:bg-emerald-900/50 dark:text-emerald-200">
              <MapPin className="size-6 text-emerald-600" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Your NyayGuide has arrived</h4>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                {request.assigned_nyayguide?.display_name} is at your location.
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              Physical assistance session is ready to commence.
            </div>
          </div>
        )}

        {/* State: ASSISTANCE_ACTIVE */}
        {status === "ASSISTANCE_ACTIVE" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
              <span className="text-xs font-bold text-[#00634B] flex items-center gap-1.5">
                <Shield className="size-3.5 text-emerald-600" /> NyayGuide Assistance Active
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                IN PROGRESS
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-white">Active Task:</p>
              <p>{request.safe_task_summary}</p>
            </div>

            <div className="text-[11px] text-slate-500 space-y-1">
              <p>• NyayGuide is walking you through physical forms/process.</p>
              <p>• Remember: NyayGuides do not give legal advice.</p>
            </div>
          </div>
        )}

        {/* State: COMPLETED */}
        {status === "COMPLETED" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-5" />
              <h4 className="text-sm font-bold">Physical Assistance Completed</h4>
            </div>

            {request.completion_notes && (
              <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <p className="font-semibold text-slate-900 dark:text-white">Provider Notes:</p>
                <p className="mt-0.5">{request.completion_notes}</p>
              </div>
            )}

            <div className="border-t border-slate-100 pt-2 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Rate your NyayGuide experience:
              </p>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setRating(s)}
                    className="p-1 hover:scale-110 transition-transform"
                  >
                    <Star
                      className={cn(
                        "size-5",
                        s <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowPreConfirm(true)}
              className="text-xs text-[#00634B] hover:underline font-semibold"
            >
              Need further physical assistance? Request another NyayGuide →
            </button>
          </div>
        )}

        {/* State: NO_NYAYGUIDE_AVAILABLE */}
        {status === "NO_NYAYGUIDE_AVAILABLE" && (
          <div className="space-y-3 text-center py-2">
            <div className="mx-auto size-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center dark:bg-amber-900/40 dark:text-amber-200">
              <AlertCircle className="size-6 text-amber-600" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                No NyayGuide is currently available nearby
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                All nearby providers are currently busy or out of 10 km range.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => setShowPreConfirm(true)}
                className="rounded-xl bg-[#00634B] py-2 text-xs font-semibold text-white hover:bg-[#004D3C]"
              >
                Retry Search
              </button>
              <button
                onClick={() => onClose?.()}
                className="rounded-xl border border-slate-200 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                Continue with Digital Guidance
              </button>
            </div>
          </div>
        )}

        {/* State: CANCELLED / EXPIRED / FAILED */}
        {(status === "CANCELLED" || status === "EXPIRED" || status === "FAILED") && (
          <div className="space-y-3 text-center py-2">
            <div className="mx-auto size-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center">
              <AlertCircle className="size-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                Request {status.toLowerCase()}
              </h4>
              {request.failure_reason && (
                <p className="text-xs text-slate-500 mt-0.5">{request.failure_reason}</p>
              )}
            </div>
            <button
              onClick={() => setShowPreConfirm(true)}
              className="text-xs font-semibold text-[#00634B] hover:underline"
            >
              Create new request →
            </button>
          </div>
        )}
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={() => {
          setShowAuthModal(false);
          setErrorMsg(null);
        }}
      />
    </>
  );
}
