"use client";

import { ModeratorShell } from "@/components/moderator/ModeratorShell";
import { Globe } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ModeratorMlatPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (loading || !mounted) return;
    if (!user) router.push("/login");
  }, [user, loading, mounted, router]);

  if (!mounted || loading || !user) {
    return <ModeratorShell loading />;
  }

  return (
    <ModeratorShell>
      <div className="max-w-xl rounded-2xl border border-gray-100 bg-white p-8 shadow-sm text-center">
        <Globe className="w-10 h-10 text-[#00634B] mx-auto mb-3" />
        <h1 className="text-2xl font-black text-gray-900">MLAT cases</h1>
        <p className="text-sm text-gray-500 mt-2">
          Cross-border MLAT workflow is not enabled in this release. Use the review queue for
          domestic moderator interventions.
        </p>
      </div>
    </ModeratorShell>
  );
}
