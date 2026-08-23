"use client";

import React, { useState } from "react";
import { Mail, Loader2, X, Lock } from "lucide-react";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { useAuth } from "@/context/AuthContext";

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onSuccess?: (user: any, role: string) => void;
  defaultRole?: "victim" | "lawyer";
  title?: string;
  description?: string;
}

export function AuthModal({
  isOpen,
  onClose,
  onSuccess,
  defaultRole = "victim",
  title = "Authentication Required",
  description = "Please sign in to save your chat history and continue.",
}: AuthModalProps) {
  const { user, signInWithPassword, registerWithPassword } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState<"victim" | "lawyer">(defaultRole);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const enableGoogleAuth = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "true";

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError("");
    try {
      const { auth } = await import("@/lib/firebase");
      if (!auth) {
        throw new Error("Google authentication is currently unavailable.");
      }
      const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uid: result.user.uid,
            email: result.user.email || "unknown",
            ...(isLogin ? {} : { role: selectedRole }),
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      const role = data?.role || "victim";
      onSuccess?.(result.user, role);
    } catch (err: any) {
      setError(err?.message || "Failed to sign in with Google.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    const trimmedEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      setIsLoading(false);
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      setIsLoading(false);
      return;
    }

    try {
      if (isLogin) {
        await signInWithPassword(trimmedEmail, password);
        onSuccess?.(user, "victim");
      } else {
        await registerWithPassword({
          email: trimmedEmail,
          password,
          role: selectedRole,
        });
        onSuccess?.(user, selectedRole);
      }
    } catch (err: any) {
      const msg = String(err?.message || "").toLowerCase();
      if (
        msg.includes("invalid-credential") ||
        msg.includes("invalid credentials") ||
        msg.includes("user not found") ||
        msg.includes("incorrect password") ||
        msg.includes("invalid password") ||
        msg.includes("invalid or expired token")
      ) {
        setError("Invalid email or password. Please check your credentials and try again.");
      } else if (msg.includes("already registered") || msg.includes("already exists")) {
        setError("An account with this email already exists. Please sign in.");
      } else if (msg.includes("failed to fetch") || msg.includes("networkerror")) {
        setError("Unable to connect to the authentication server. Please check your connection and retry.");
      } else {
        setError(err?.message || "Authentication failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden relative animate-in zoom-in-95 duration-200 dark:bg-slate-900 dark:border-slate-800">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 bg-gray-50 rounded-full transition-colors dark:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="p-8">
          <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center mb-6 border border-emerald-200 shadow-sm dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-400">
            <Lock className="w-6 h-6" />
          </div>

          <h2 className="text-2xl font-black text-gray-900 mb-2 tracking-tight dark:text-white">{title}</h2>
          <p className="text-gray-500 text-sm mb-8 leading-relaxed dark:text-slate-400">{description}</p>

          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg font-medium dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {enableGoogleAuth && (
              <>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-200 rounded-xl text-gray-700 font-semibold hover:bg-gray-50 focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-sm group disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <svg className="w-5 h-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Continue with Google
                </button>

                <div className="relative flex items-center py-4">
                  <div className="flex-grow border-t border-gray-100 dark:border-slate-800"></div>
                  <span className="flex-shrink-0 mx-4 text-gray-400 text-xs font-medium uppercase tracking-widest">
                    or email
                  </span>
                  <div className="flex-grow border-t border-gray-100 dark:border-slate-800"></div>
                </div>
              </>
            )}

            <form onSubmit={handleEmailAuth} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5 line-clamp-1 dark:text-slate-300">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5 dark:text-slate-300">Password</label>
                <PasswordInput
                  variant="plain"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete={isLogin ? "current-password" : "new-password"}
                />
              </div>

              {!isLogin && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5 dark:text-slate-300">
                    Register As
                  </label>
                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value as any)}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-gray-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                  >
                    <option value="victim">Citizen / Victim</option>
                    <option value="lawyer">Lawyer / Law student</option>
                  </select>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#00634B] hover:bg-[#004D3C] text-white font-bold py-3 rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 group disabled:opacity-70"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : isLogin ? (
                  "Sign In"
                ) : (
                  "Create Account"
                )}
              </button>
            </form>
          </div>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setError("");
              }}
              className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 transition-colors dark:text-emerald-400"
            >
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
