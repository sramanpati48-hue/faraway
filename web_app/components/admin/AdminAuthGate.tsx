"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { AdminTheme } from "@/components/admin/AdminTheme";
import { AdminLoading } from "@/components/admin/admin-ui";

export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent("/admin")}&reason=session_expired`);
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="admin-root flex min-h-screen flex-col items-center justify-center bg-black text-white">
        <AdminTheme />
        <AdminLoading label="Verifying session…" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="admin-root flex min-h-screen flex-col items-center justify-center bg-black text-white">
        <AdminTheme />
        <AdminLoading label="Redirecting to login…" />
      </div>
    );
  }

  return (
    <div className="admin-root min-h-screen bg-black text-white">
      <AdminTheme />
      {children}
    </div>
  );
}
