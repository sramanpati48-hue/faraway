"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { LocationPermissionModal } from "./LocationPermissionModal";
import { shouldPlayLoginSplash, markLoginSplashSeen } from "@/lib/auth/loginSplash";

function ConnectingHands({ reduceMotion }: { reduceMotion: boolean }) {
  // Hands slide in and meet, then cross-fade into the joined handshake.
  const converge = reduceMotion ? 0.01 : 0.85;
  const meetAt = reduceMotion ? 0 : 0.75;

  return (
    <div className="relative mx-auto h-24 w-[min(92vw,360px)] sm:h-28">
      {/* Glow at the meeting point */}
      <motion.div
        className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(255,90,31,0.5), transparent 65%)" }}
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{
          opacity: reduceMotion ? 0.4 : [0, 0.7, 0.3],
          scale: reduceMotion ? 1 : [0.4, 1.25, 1],
        }}
        transition={{ delay: meetAt, duration: reduceMotion ? 0.2 : 0.9, ease: "easeOut" }}
      />

      {/* Left hand reaching in */}
      <motion.div
        className="absolute left-0 top-1/2 h-full w-1/2 -translate-y-1/2"
        initial={reduceMotion ? { opacity: 0 } : { x: "-70%", opacity: 0 }}
        animate={{ x: "0%", opacity: [1, 1, 0] }}
        transition={{
          x: { duration: converge, ease: [0.22, 1, 0.36, 1] },
          opacity: { times: [0, 0.7, 1], duration: converge + 0.4, ease: "easeInOut" },
        }}
      >
        <Image
          src="/left-hand.png"
          alt=""
          fill
          priority
          unoptimized
          sizes="180px"
          className="object-contain object-right drop-shadow-[0_6px_18px_rgba(0,0,0,0.4)]"
        />
      </motion.div>

      {/* Right hand reaching in */}
      <motion.div
        className="absolute right-0 top-1/2 h-full w-1/2 -translate-y-1/2"
        initial={reduceMotion ? { opacity: 0 } : { x: "70%", opacity: 0 }}
        animate={{ x: "0%", opacity: [1, 1, 0] }}
        transition={{
          x: { duration: converge, ease: [0.22, 1, 0.36, 1] },
          opacity: { times: [0, 0.7, 1], duration: converge + 0.4, ease: "easeInOut" },
        }}
      >
        <Image
          src="/right-hand.png"
          alt=""
          fill
          priority
          unoptimized
          sizes="180px"
          className="object-contain object-left drop-shadow-[0_6px_18px_rgba(0,0,0,0.4)]"
        />
      </motion.div>

      {/* Joined handshake fades in as the hands meet */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          delay: reduceMotion ? 0 : converge + 0.05,
          duration: reduceMotion ? 0.01 : 0.5,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <Image
          src="/handshake.png"
          alt="Two hands joining as a sahayak"
          fill
          priority
          unoptimized
          sizes="360px"
          className="object-contain drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        />
      </motion.div>
    </div>
  );
}

export function HomeSplashIntro() {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!shouldPlayLoginSplash()) return;
    setVisible(true);

    const holdMs = reduceMotion ? 900 : 2600;
    const fadeMs = reduceMotion ? 280 : 550;
    const hold = window.setTimeout(() => setExiting(true), holdMs);
    const done = window.setTimeout(() => {
      setVisible(false);
      markLoginSplashSeen();
    }, holdMs + fadeMs);

    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, [reduceMotion]);

  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [visible]);

  return (
    <>
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#141414]"
          role="dialog"
          aria-label="Nyay Sahayak welcome"
          aria-live="polite"
          initial={{ opacity: 1 }}
          animate={{ opacity: exiting ? 0 : 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.25 : 0.5, ease: "easeInOut" }}
        >
          {/* Soft atmosphere — not flat black */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 70% 50% at 50% 38%, rgba(255,90,31,0.14), transparent 55%), radial-gradient(ellipse 90% 70% at 50% 100%, rgba(242,235,227,0.06), transparent 50%)",
            }}
          />

          <div className="relative z-10 flex w-full max-w-md flex-col items-center px-6">
            <motion.div
              className="relative w-[min(72vw,280px)] sm:w-[300px]"
              initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <Image
                src="/1.png"
                alt="Nyay Sahayak"
                width={600}
                height={600}
                priority
                unoptimized
                className="h-auto w-full object-contain drop-shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
              />
            </motion.div>

            <motion.div
              className="mt-2 sm:mt-3"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reduceMotion ? 0 : 0.35, duration: reduceMotion ? 0.01 : 0.4 }}
            >
              <ConnectingHands reduceMotion={!!reduceMotion} />
            </motion.div>

            <motion.p
              className="mt-1 text-center text-[11px] font-medium tracking-[0.22em] text-[#F2EBE3]/70 sm:text-xs"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduceMotion ? 0 : 1.35, duration: reduceMotion ? 0.01 : 0.4 }}
            >
              YOUR LEGAL <span className="text-[#FF5A1F]">SAHAYAK</span>
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Location permission — fires only after splash exits */}
    <LocationPermissionModal />
    </>
  );
}
