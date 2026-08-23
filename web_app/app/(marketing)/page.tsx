"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { LandingPage } from "@/components/landing/LandingPage";
import { useAuth } from "@/context/AuthContext";

export default function MarketingHomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || loading || !user) return;
    router.replace("/home");
  }, [mounted, user, loading, router]);

  if (mounted && user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-[#00634B]">
        <Loader2 className="h-8 w-8 animate-spin" aria-label="Redirecting" />
      </div>
    );
  }

  return <LandingPage />;
}
