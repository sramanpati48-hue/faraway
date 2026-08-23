"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Loader2, ChevronRight, User, Phone } from "lucide-react";
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
  authSelectClass,
  authSubmitClass,
} from "@/lib/auth/formStyles";

export default function SignupPage() {
  const router = useRouter();
  const { user, registerWithPassword } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState("victim");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (!user) return;
    router.push("/home");
  }, [user, router]);

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      if (!email && !mobile) {
        throw new Error("Provide an email or mobile number");
      }
      await registerWithPassword({
        email: email || undefined,
        mobile: mobile || undefined,
        password,
        role: selectedRole,
        display_name: name || undefined,
      });
    } catch (err: any) {
      setError(err.message || "Failed to create account");
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
            From confusion
            <br />
            to clarity
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-emerald-50/90">
            Create an account with email or mobile number — no Firebase required.
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

          <h2 className={cn(instrumentSerif.className, "mb-6 text-2xl text-slate-900 sm:text-3xl")}>
            Create account
          </h2>

          <form onSubmit={handleEmailSignup} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Name</span>
              <div className="relative mt-1">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className={authFieldWithIconClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Email</span>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  className={authFieldWithIconClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Mobile</span>
              <div className="relative mt-1">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className={authFieldWithIconClass}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Password</span>
              <PasswordInput
                variant="auth"
                wrapperClassName="mt-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Role</span>
              <select
                className={cn("mt-1", authSelectClass)}
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
              >
                <option value="victim">Citizen / Victim</option>
                <option value="lawyer">Lawyer / Law student</option>
              </select>
            </label>

            {error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-600">{error}</p>
            )}

            <button type="submit" disabled={isLoading} className={authSubmitClass}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
              Create account
            </button>
          </form>

          <p className="mt-6 text-sm leading-relaxed text-slate-600">
            Already have an account?{" "}
            <Link href="/login" className={authLinkButtonClass}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
