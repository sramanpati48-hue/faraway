"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PublicAboutView } from "@/components/about/PublicAboutView";
import { useAuth } from "@/context/AuthContext";

export default function PublicAboutPage() {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    const r = (role || "").toLowerCase();
    if (!r || r === "victim") router.replace("/help");
  }, [user, role, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-[#00634B]">
        <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (user) {
    const r = (role || "").toLowerCase();
    if (!r || r === "victim") {
      return (
        <div className="flex min-h-screen items-center justify-center bg-white text-[#00634B]">
          <Loader2 className="h-8 w-8 animate-spin" aria-label="Redirecting" />
        </div>
      );
    }
  }

  return <PublicAboutView />;
}
