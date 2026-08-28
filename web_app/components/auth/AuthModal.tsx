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
