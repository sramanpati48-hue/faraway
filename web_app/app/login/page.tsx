"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Loader2, ChevronRight } from "lucide-react";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { useAuth } from "@/context/AuthContext";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { dmSans, instrumentSerif } from "@/lib/fonts";
import {
  authFieldPlainClass,
  authFieldWithIconClass,
  authLinkButtonClass,
  authSubmitClass,
} from "@/lib/auth/formStyles";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, signInWithPassword, resetPasswordWithCode } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const reason = searchParams.get("reason");
  const nextPath = searchParams.get("next") || "";
  const sessionNotice =
    reason === "session_expired"
      ? "Your session expired. Please sign in again to continue."
      : reason === "insufficient_role"
        ? "That account does not have admin access. Sign in with an admin account."
        : "";

  React.useEffect(() => {
    if (!user) return;
    const dest =
      nextPath.startsWith("/") && nextPath !== "/login" && nextPath !== "/signup"
        ? nextPath
        : "/home";
    router.push(dest);
  }, [user, router, nextPath]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      if (resetMode) {
        await resetPasswordWithCode(identifier, resetCode, password);
      } else {
        await signInWithPassword(identifier, password);
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn(dmSans.className, "flex min-h-screen flex-col bg-[#F8F9FA] md:flex-row antialiased")}>
      <div className="relative hidden items-center justify-center overflow-hidden bg-[#00634B] p-12 md:flex md:w-1/2">
        <div className="absolute inset-0 opacity-20">
          <Image src="/4.png" alt="" fill className="object-cover" />
        </div>
        <div className="relative z-10 max-w-lg text-white">
          <div className="mb-8 w-fit rounded-3xl border border-white/20 bg-white/10 p-4 backdrop-blur-md">
            <Image src="/3.png" alt="NyaySahayak" width={64} height={64} />
          </div>
          <h1
            className={cn(
              instrumentSerif.className,
              "mb-6 text-4xl leading-[1.12] tracking-normal lg:text-5xl"
            )}
          >
            Your trusted
            <br />
            AI legal partner
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-emerald-50/90">
            Sign in with email or mobile number and password. Admins can issue one-time reset codes.
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-12">
        <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xl sm:p-8">
          <div className="mb-6 flex items-center gap-3 md:hidden">
            <div className="rounded-2xl bg-[#00634B] p-2.5">
              <Image src="/3.png" alt="NyaySahayak" width={36} height={36} />
            </div>
            <div>
              <p className={cn(instrumentSerif.className, "text-lg leading-tight text-[#00634B]")}>
                Nyay<span className="text-slate-900">Sahayak</span>
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Legal help for all
              </p>
            </div>
          </div>

          <Link
            href="/"
            className={cn(
              "mb-6 inline-flex items-center text-sm font-semibold text-emerald-700 hover:text-emerald-800",
              authLinkButtonClass
            )}
          >
            ← Back to home
          </Link>

          <h2 className={cn(instrumentSerif.className, "mb-2 text-2xl text-slate-900 sm:text-3xl")}>
            {resetMode ? "Reset password" : "Welcome back"}
          </h2>
          <p className={cn("text-sm leading-relaxed text-slate-500", sessionNotice ? "mb-4" : "mb-8")}>
            {resetMode
              ? "Enter the admin-issued reset code and choose a new password."
              : "Use your email or mobile number."}
          </p>

          {sessionNotice ? (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
              {sessionNotice}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                Email or mobile
              </span>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className={authFieldWithIconClass}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                />
              </div>
            </label>

            {resetMode && (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  Reset code
                </span>
                <input
                  className={cn("mt-1", authFieldPlainClass)}
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  required
                />
              </label>
            )}

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                {resetMode ? "New password" : "Password"}
              </span>
              <PasswordInput
                variant="auth"
                wrapperClassName="mt-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={resetMode ? "new-password" : "current-password"}
              />
            </label>

            {error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-600">{error}</p>
            )}

            <button type="submit" disabled={isLoading} className={authSubmitClass}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
              {resetMode ? "Set new password" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between text-sm">
            <button type="button" className={authLinkButtonClass} onClick={() => setResetMode((v) => !v)}>
              {resetMode ? "Back to login" : "Have a reset code?"}
            </button>
            <Link
              href="/signup"
              className={cn("font-semibold text-slate-600 hover:text-emerald-700", authLinkButtonClass)}
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className={cn(dmSans.className, "flex min-h-screen items-center justify-center bg-[#F8F9FA]")}>
          <Loader2 className="h-6 w-6 animate-spin text-emerald-700" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
