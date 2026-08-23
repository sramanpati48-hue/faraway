"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Compass, Shield, User, Clock, MapPin, CheckCircle2,
  AlertCircle, ChevronRight, Navigation, Phone, ExternalLink,
  Loader2, RefreshCw, XCircle, HeartHandshake, Star
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type NyayGuideConsoleStatus,
  type NyayGuideConsoleOffer,
  type NyayGuideRequest,
  fetchNyayGuideConsoleStatus,
  updateNyayGuideAvailability,
  acceptOffer,
  rejectOffer,
  markRequestEnRoute,
  markRequestArrived,
  startRequestAssistance,
  completeRequestAssistance,
} from "@/lib/nyayguideApi";

export default function NyayGuideConsolePage() {
  const [consoleData, setConsoleData] = useState<NyayGuideConsoleStatus | null>(null);
  const [selectedGuideId, setSelectedGuideId] = useState<string>("demo_nyayguide_priya");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const loadStatus = async (guideId = selectedGuideId) => {
    try {
      const data = await fetchNyayGuideConsoleStatus(guideId);
      setConsoleData(data);
    } catch (err: any) {
      console.warn("Console status fetch failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadStatus(selectedGuideId);
    pollRef.current = setInterval(() => loadStatus(selectedGuideId), 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedGuideId]);

  const handleAvailabilityChange = async (newStatus: string) => {
    setActionLoading(true);
    try {
      await updateNyayGuideAvailability(newStatus, selectedGuideId);
      setStatusNotice(`Availability set to ${newStatus}`);
      await loadStatus(selectedGuideId);
    } catch (err: any) {
      setStatusNotice(`Error: ${err?.message || "Failed to update availability"}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAcceptOffer = async (offerId: string) => {
    setActionLoading(true);
    setStatusNotice(null);
    try {
      await acceptOffer(offerId);
      setStatusNotice("Offer ACCEPTED! Assignment locked.");
      await loadStatus(selectedGuideId);
    } catch (err: any) {
      setStatusNotice(`Failed to accept offer: ${err?.message || "Conflict / Expired"}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectOffer = async (offerId: string) => {
    setActionLoading(true);
    setStatusNotice(null);
    try {
      await rejectOffer(offerId);
      setStatusNotice("Offer declined. Request returned to matching pool.");
      await loadStatus(selectedGuideId);
    } catch (err: any) {
      setStatusNotice(`Failed to decline: ${err?.message || "Error"}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleProgress = async (action: "en-route" | "arrived" | "start" | "complete", reqId: string) => {
    setActionLoading(true);
    setStatusNotice(null);
    try {
      if (action === "en-route") await markRequestEnRoute(reqId);
      if (action === "arrived") await markRequestArrived(reqId);
      if (action === "start") await startRequestAssistance(reqId);
      if (action === "complete") {
        await completeRequestAssistance(reqId, completionNotes || "Assistance successfully provided.");
        setCompletionNotes("");
      }
      setStatusNotice(`Status successfully updated: ${action}`);
      await loadStatus(selectedGuideId);
    } catch (err: any) {
      setStatusNotice(`Action error: ${err?.message || "Failed to update"}`);
    } finally {
      setActionLoading(false);
    }
  };

  const guide = consoleData?.guide;
  const pendingOffers = consoleData?.pending_offers || [];
  const activeReq = consoleData?.active_request;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/30 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between dark:border-emerald-900/50 dark:bg-slate-900">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-[#00634B] px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
                Demo / Development NyayGuide Console
              </span>
            </div>
            <h1 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              NyayGuide Dispatch &amp; Field Assistance
            </h1>
            <p className="text-xs text-slate-500">
              Simulate physical on-ground provider actions in real-time.
            </p>
          </div>

          {/* Guide Selector (Demo Mode) */}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Active Guide Profile:
            </label>
            <select
              value={selectedGuideId}
              onChange={(e) => setSelectedGuideId(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-[#00634B] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="demo_nyayguide_priya">[DEMO] Priya Sharma (Female / Chandigarh)</option>
              <option value="demo_nyayguide_sunita">[DEMO] Sunita Kaur (Female / Mohali)</option>
              <option value="demo_nyayguide_rajesh">[DEMO] Rajesh Kumar (Male / Chandigarh)</option>
              <option value="demo_nyayguide_gurpreet">[DEMO] Gurpreet Singh (Male / Punjab)</option>
              <option value="demo_nyayguide_ananya">[DEMO] Ananya Sen (Female / Delhi)</option>
            </select>
          </div>
        </div>

        {statusNotice && (
          <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
            <span>{statusNotice}</span>
            <button onClick={() => setStatusNotice(null)}>
              <XCircle className="size-4" />
            </button>
          </div>
        )}

        {/* Profile & Availability Card */}
        {guide && (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:col-span-1">
              <div className="flex items-center gap-3">
                <img
                  src={guide.profile_photo_url || "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100"}
                  alt={guide.display_name}
                  className="size-12 rounded-full object-cover border border-slate-200"
                />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{guide.display_name}</h3>
                  <div className="flex items-center gap-1 text-xs text-amber-600 font-semibold">
                    <Star className="size-3 fill-amber-500 text-amber-500" />
                    <span>{guide.rating} rating</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400 space-y-1">
                <p>Languages: {(guide.languages || []).join(", ")}</p>
                <p>Status: <span className="font-semibold text-slate-900 dark:text-white">{guide.verification_status}</span></p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:col-span-2 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Availability Controller
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  When set to AVAILABLE, the matching engine can route incoming citizen requests to this provider.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-3">
                {["OFFLINE", "AVAILABLE", "PAUSED"].map((st) => (
                  <button
                    key={st}
                    disabled={actionLoading}
                    onClick={() => handleAvailabilityChange(st)}
                    className={cn(
                      "flex-1 rounded-xl py-2 text-xs font-bold transition-colors",
                      guide.availability_status === st
                        ? st === "AVAILABLE"
                          ? "bg-emerald-600 text-white shadow"
                          : st === "PAUSED"
                          ? "bg-amber-600 text-white shadow"
                          : "bg-slate-700 text-white shadow"
                        : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    )}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Section 1: Incoming Offers */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Clock className="size-4 text-amber-600" /> Incoming Offers ({pendingOffers.length})
          </h2>

          {pendingOffers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900">
              No active offers at this moment. Create a citizen request from the chat to see real-time dispatching.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingOffers.map((offer) => (
                <div
                  key={offer.id}
                  className="rounded-2xl border border-amber-300 bg-amber-50/50 p-4 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-900 dark:text-amber-200">
                        OFFER RECEIVED
                      </span>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                        {offer.assistance_type.replace("_", " ").toUpperCase()}
                      </h4>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                        {offer.safe_task_summary}
                      </p>
                    </div>

                    <div className="text-right text-xs">
                      <p className="font-bold text-slate-900 dark:text-white">
                        ~{offer.distance_km || 2.5} km away
                      </p>
                      <p className="text-[11px] text-slate-500">Est. {offer.estimated_minutes || 10} mins</p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      disabled={actionLoading}
                      onClick={() => handleAcceptOffer(offer.id)}
                      className="flex-1 rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Accept Assignment
                    </button>
                    <button
                      disabled={actionLoading}
                      onClick={() => handleRejectOffer(offer.id)}
                      className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: Active Assigned Request */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Navigation className="size-4 text-[#00634B]" /> Active Assignment
          </h2>

          {!activeReq ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900">
              No active physical assistance session currently in progress.
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-300 bg-white p-5 shadow-sm dark:border-emerald-900/60 dark:bg-slate-900 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                    STATUS: {activeReq.status}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                    Case ID: {activeReq.case_id}
                  </h3>
                </div>
                <div className="text-right text-xs text-slate-500">
                  Assistance: {activeReq.assistance_type.replace("_", " ")}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300 space-y-1">
                <p className="font-semibold text-slate-900 dark:text-white">Safe Task Summary:</p>
                <p>{activeReq.safe_task_summary}</p>
                {activeReq.location_consented && activeReq.user_latitude && (
                  <p className="text-emerald-700 dark:text-emerald-400 font-semibold pt-1">
                    📍 Citizen GPS: {activeReq.user_latitude}, {activeReq.user_longitude} (Consented)
                  </p>
                )}
              </div>

              {/* Progressive action controllers */}
              <div className="space-y-3 pt-1">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Progress Lifecycle State:
                </h4>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <button
                    disabled={actionLoading || activeReq.status !== "MATCHED"}
                    onClick={() => handleProgress("en-route", activeReq.id)}
                    className={cn(
                      "rounded-xl py-2.5 text-xs font-bold transition-all",
                      activeReq.status === "MATCHED"
                        ? "bg-[#00634B] text-white shadow-md hover:bg-[#004D3C]"
                        : "border border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-800 dark:bg-slate-800"
                    )}
                  >
                    1. Mark En Route
                  </button>

                  <button
                    disabled={actionLoading || activeReq.status !== "NYAYGUIDE_EN_ROUTE"}
                    onClick={() => handleProgress("arrived", activeReq.id)}
                    className={cn(
                      "rounded-xl py-2.5 text-xs font-bold transition-all",
                      activeReq.status === "NYAYGUIDE_EN_ROUTE"
                        ? "bg-[#00634B] text-white shadow-md hover:bg-[#004D3C]"
                        : "border border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-800 dark:bg-slate-800"
                    )}
                  >
                    2. Mark Arrived
                  </button>

                  <button
                    disabled={actionLoading || activeReq.status !== "NYAYGUIDE_ARRIVED"}
                    onClick={() => handleProgress("start", activeReq.id)}
                    className={cn(
                      "rounded-xl py-2.5 text-xs font-bold transition-all",
                      activeReq.status === "NYAYGUIDE_ARRIVED"
                        ? "bg-[#00634B] text-white shadow-md hover:bg-[#004D3C]"
                        : "border border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-800 dark:bg-slate-800"
                    )}
                  >
                    3. Start Assistance
                  </button>

                  <button
                    disabled={actionLoading || activeReq.status !== "ASSISTANCE_ACTIVE"}
                    onClick={() => handleProgress("complete", activeReq.id)}
                    className={cn(
                      "rounded-xl py-2.5 text-xs font-bold transition-all",
                      activeReq.status === "ASSISTANCE_ACTIVE"
                        ? "bg-emerald-600 text-white shadow-md hover:bg-emerald-700"
                        : "border border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-800 dark:bg-slate-800"
                    )}
                  >
                    4. Complete Session
                  </button>
                </div>

                {activeReq.status === "ASSISTANCE_ACTIVE" && (
                  <div className="pt-2">
                    <input
                      type="text"
                      value={completionNotes}
                      onChange={(e) => setCompletionNotes(e.target.value)}
                      placeholder="Optional completion notes (e.g. Complaint draft handed to duty officer at Phase-7 station)..."
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-[#00634B] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
