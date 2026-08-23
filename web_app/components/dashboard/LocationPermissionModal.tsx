"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MapPin, X, ChevronRight, ShieldCheck } from "lucide-react";

import { LOGIN_SPLASH_SEEN_KEY } from "@/lib/auth/loginSplash";
import {
  markLocationAsked,
  notifyLocationDenied,
  requestUserLocation,
  wasLocationAsked,
} from "@/lib/userLocation";

const SPLASH_KEY = LOGIN_SPLASH_SEEN_KEY;

// Must be >= holdMs + fadeMs from HomeSplashIntro (2600 + 550 = 3150ms) + buffer
const SPLASH_TOTAL_MS = 3400;
// If splash already seen this session, still wait briefly before prompting
const POST_SPLASH_DELAY_MS = 600;

export function LocationPermissionModal() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    // Never ask twice in the same session
    if (wasLocationAsked()) return;

    // Determine delay: if splash hasn't been seen yet, wait for the full splash duration.
    // If it was already seen this session (e.g. page reload), use a short courteous delay.
    let delayMs = SPLASH_TOTAL_MS;
    try {
      if (sessionStorage.getItem(SPLASH_KEY) === "1") {
        delayMs = POST_SPLASH_DELAY_MS;
      }
    } catch {
      /* ignore */
    }

    const t = window.setTimeout(() => setOpen(true), delayMs);
    return () => window.clearTimeout(t);
  }, []);

  const handleAllow = async () => {
    if (!navigator.geolocation) {
      markLocationAsked();
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      await requestUserLocation();
      markLocationAsked();
      setOpen(false);
    } catch {
      notifyLocationDenied();
      setDenied(true);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    markLocationAsked();
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={!loading ? handleDismiss : undefined}
          />

          {/* Modal card */}
          <motion.div
            className="fixed inset-x-4 bottom-8 z-[120] mx-auto max-w-sm rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[380px]"
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.96 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Location permission request"
          >
            {/* Dismiss button */}
            <button
              onClick={handleDismiss}
              disabled={loading}
              className="absolute right-4 top-4 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-40"
              aria-label="Dismiss location request"
            >
              <X size={16} />
            </button>

            <div className="px-6 pb-6 pt-7">
              {/* Icon */}
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00634B] to-[#009E79] shadow-lg shadow-emerald-200/60">
                <MapPin size={26} className="text-white" />
              </div>

              {!denied ? (
                <>
                  <h2 className="text-center text-lg font-black text-gray-900 leading-snug">
                    Enable Location
                  </h2>
                  <p className="mt-1.5 text-center text-sm text-gray-500 leading-relaxed">
                    We use your location to show nearby lawyers, local court info, and relevant legal
                    resources in your area.
                  </p>

                  {/* Trust badge */}
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
                    <ShieldCheck size={15} className="flex-shrink-0 text-[#00634B]" />
                    <p className="text-xs text-[#00634B] font-medium">
                      Your location is never shared or stored on our servers.
                    </p>
                  </div>

                  <div className="mt-5 flex flex-col gap-2.5">
                    <button
                      type="button"
                      id="location-allow-btn"
                      onClick={handleAllow}
                      disabled={loading}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#00634B] px-5 py-3.5 text-sm font-bold text-white shadow-md shadow-emerald-200/50 transition-all hover:bg-[#004d38] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
                    >
                      {loading ? (
                        <>
                          <svg
                            className="h-4 w-4 animate-spin"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8v8H4z"
                            />
                          </svg>
                          Locating…
                        </>
                      ) : (
                        <>
                          <MapPin size={15} />
                          Allow Location Access
                          <ChevronRight size={15} className="ml-auto opacity-60" />
                        </>
                      )}
                    </button>

                    <button
                      id="location-deny-btn"
                      onClick={handleDismiss}
                      disabled={loading}
                      className="w-full rounded-2xl px-5 py-2.5 text-sm font-semibold text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600 disabled:opacity-40"
                    >
                      Not now
                    </button>
                  </div>
                </>
              ) : (
                /* Denied state */
                <>
                  <h2 className="text-center text-lg font-black text-gray-900 leading-snug">
                    Location Blocked
                  </h2>
                  <p className="mt-1.5 text-center text-sm text-gray-500 leading-relaxed">
                    It looks like location access was denied. You can enable it anytime from your
                    browser settings.
                  </p>
                  <button
                    onClick={handleDismiss}
                    className="mt-5 w-full rounded-2xl bg-gray-100 px-5 py-3 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-200"
                  >
                    Got it
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
