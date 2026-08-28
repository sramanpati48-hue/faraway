"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  Scale,
  Shield,
  AlertTriangle,
  Users,
  Briefcase,
  FileText,
  ArrowRight,
  Loader2,
  BookOpen,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useGlobalChat } from "@/context/ChatContext";
import {
  MotionListItem,
  OperateHeader,
  OperateLayout,
  OperateSkeletonGrid,
  staggerChildren,
} from "@/components/operate/OperatePrimitives";
import { instrumentSerif } from "@/lib/fonts";
import { cn } from "@/lib/utils";

interface LegalRight {
  id: string;
  title: string;
  description: string;
  action_prompt: string;
}

const FALLBACK_RIGHTS: LegalRight[] = [
  {
    id: "police-fir-rights",
    title: "Police & FIR Rights",
    description:
      "You can file an FIR for cognizable offences. Police cannot refuse registration for lack of jurisdiction alone.",
    action_prompt: "Explain my rights when filing an FIR in India",
  },
  {
    id: "cyber-fraud-rights",
    title: "Cyber Fraud Rights",
    description:
      "Report UPI/banking fraud quickly via cybercrime.gov.in and your bank to improve recovery chances.",
    action_prompt: "Someone stole money from my UPI. What should I do?",
  },
  {
    id: "women-legal-rights",
    title: "Women Legal Rights",
    description:
      "Protections exist under domestic violence, workplace harassment, and criminal law frameworks.",
    action_prompt: "Explain legal protections available for women facing harassment",
  },
  {
    id: "consumer-rights",
    title: "Consumer Rights",
    description: "Defective goods and unfair trade practices can be taken to consumer forums.",
    action_prompt: "How do I file a consumer complaint in India?",
  },
  {
    id: "employee-rights",
    title: "Employee Rights",
    description:
      "Wage, workplace safety, and harassment protections apply across many employment contexts.",
    action_prompt: "What are my rights if my employer is withholding salary?",
  },
  {
    id: "property-land-rights",
    title: "Property & Land Rights",
    description:
      "Title disputes, possession issues, and inheritance claims have civil and revenue remedies.",
    action_prompt: "Help me understand options for a land possession dispute",
  },
  {
    id: "free-legal-aid",
    title: "Free Legal Aid",
    description: "Eligible persons can seek free legal services through NALSA / SLSA / DLSA networks.",
    action_prompt: "How can I get free legal aid near me?",
  },
];

const iconMap: Record<string, React.ReactNode> = {
  "police-fir-rights": <Shield className="h-5 w-5 text-[#00634B]" />,
  "cyber-fraud-rights": <AlertTriangle className="h-5 w-5 text-[#00634B]" />,
  "women-legal-rights": <Users className="h-5 w-5 text-[#00634B]" />,
  "consumer-rights": <Briefcase className="h-5 w-5 text-[#00634B]" />,
  "employee-rights": <FileText className="h-5 w-5 text-[#00634B]" />,
  "property-land-rights": <BookOpen className="h-5 w-5 text-[#00634B]" />,
  "free-legal-aid": <Scale className="h-5 w-5 text-[#00634B]" />,
};

export default function LegalRightsPage() {
  const [rights, setRights] = useState<LegalRight[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const router = useRouter();
  const { openChatWithQuery } = useGlobalChat();
  const reduce = useReducedMotion();

  const startGuidance = (prompt: string) => {
    if (!user) {
      router.push(`/signup?next=${encodeURIComponent("/cases")}`);
      return;
    }
    openChatWithQuery?.(prompt);
  };
  useEffect(() => {
    let cancelled = false;
    const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/legal-rights`);
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const data = await res.json();
        const rows = Array.isArray(data.rights) ? data.rights : [];
        if (cancelled) return;
        setRights(rows.length > 0 ? rows : FALLBACK_RIGHTS);
      } catch {
        if (!cancelled) setRights(FALLBACK_RIGHTS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <OperateLayout wide>
        <OperateHeader
          kicker="Legal library"
          title="Know your rights"
          description="Explore key rights and start a guided chat for your situation."
        />
        <OperateSkeletonGrid count={6} />
      </OperateLayout>
    );
  }

  return (
    <OperateLayout wide>
      <OperateHeader
        kicker="Legal library"
        title="Know your rights"
        description="Explore key rights and start a guided chat for your situation."
      />

      <motion.ul
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        variants={staggerChildren}
        initial={reduce ? false : "hidden"}
        animate="visible"
      >
        {rights.map((right, i) => (
          <MotionListItem key={right.id} index={i}>
            <button
              type="button"
              onClick={() => startGuidance(right.action_prompt)}
              className="group flex h-full w-full flex-col rounded-lg border border-slate-200/80 bg-white p-5 text-left shadow-sm transition-[transform,box-shadow,border-color] duration-200 ease-out hover:border-emerald-200 hover:shadow-md active:scale-[0.99]"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50">
                {iconMap[right.id] || <Scale className="h-5 w-5 text-[#00634B]" />}
              </div>
              <h3 className={cn(instrumentSerif.className, "mb-2 text-lg text-slate-900")}>{right.title}</h3>
              <p className="mb-4 flex-1 text-sm leading-relaxed text-slate-500">{right.description}</p>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#00634B]">
                Ask NyaySahayak
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
              </span>
            </button>
          </MotionListItem>
        ))}
      </motion.ul>

      <p className="mt-8 text-center text-xs text-slate-500">
        Need something specific?{" "}
        <Link
          href={user ? "/cases" : "/signup?next=%2Fcases"}
          className="font-semibold text-[#00634B] hover:underline"
        >
          {user ? "Start a case in chat" : "Create a free account to start a case"}
        </Link>
      </p>
    </OperateLayout>
  );
}
