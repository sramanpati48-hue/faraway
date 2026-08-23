"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, FileText, CheckCircle2, Clock, Building2, ArrowRight } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface FilingTemplate {
    id: string;
    title: string;
    category: string;
    description: string;
    steps?: string[];
    required_docs?: string[];
    estimated_time?: string;
    authority?: string;
    action_prompt?: string;
}

export default function FileCasePage() {
    const [templates, setTemplates] = useState<FilingTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [active, setActive] = useState<FilingTemplate | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetch(`${API_URL}/api/file-case/templates`);
                if (!res.ok) throw new Error(`Failed (${res.status})`);
                const data = await res.json();
                const rows: FilingTemplate[] = Array.isArray(data.templates) ? data.templates : [];
                if (cancelled) return;
                setTemplates(rows);
                setActive(rows[0] || null);
            } catch {
                if (!cancelled) setTemplates([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
            <div>
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-gray-900 mb-2">File a Case</h1>
                <p className="text-gray-500 text-base sm:text-lg font-medium">
                    Step-by-step guides for filing common legal cases and complaints in India.
                </p>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="w-10 h-10 text-[#00634B] animate-spin" />
                </div>
            ) : templates.length === 0 ? (
                <div className="bg-white p-16 rounded-[40px] border border-dashed border-gray-200 text-center text-gray-400 font-medium">
                    No filing guides available yet.
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Compact option chips */}
                    <div className="flex flex-wrap gap-2">
                        {templates.map((tpl) => {
                            const selected = active?.id === tpl.id;
                            return (
                                <button
                                    key={tpl.id}
                                    type="button"
                                    onClick={() => setActive(tpl)}
                                    className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-left transition-all ${
                                        selected
                                            ? "bg-[#00634B] border-[#00634B] text-white shadow-md shadow-emerald-900/10"
                                            : "bg-white border-gray-100 text-gray-700 hover:border-emerald-200"
                                    }`}
                                >
                                    <span
                                        className={`text-[9px] font-black uppercase tracking-wider ${
                                            selected ? "text-emerald-100" : "text-gray-400"
                                        }`}
                                    >
                                        {tpl.category}
                                    </span>
                                    <span className="text-sm font-bold leading-none">{tpl.title}</span>
                                </button>
                            );
                        })}
                    </div>

                    {active && (
                        <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-6 sm:p-8">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-11 h-11 bg-emerald-50 rounded-2xl flex items-center justify-center text-[#00634B]">
                                    <FileText size={20} />
                                </div>
                                <div>
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                        {active.category}
                                    </span>
                                    <h2 className="text-xl sm:text-2xl font-black text-gray-900">{active.title}</h2>
                                </div>
                            </div>
                            <p className="text-gray-500 mb-5 text-sm sm:text-base">{active.description}</p>

                            <div className="flex flex-wrap gap-3 mb-6">
                                {active.estimated_time && (
                                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-xl text-xs font-bold text-gray-600">
                                        <Clock size={14} className="text-[#00634B]" /> {active.estimated_time}
                                    </div>
                                )}
                                {active.authority && (
                                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-xl text-xs font-bold text-gray-600">
                                        <Building2 size={14} className="text-[#00634B]" /> {active.authority}
                                    </div>
                                )}
                            </div>

                            {active.steps && active.steps.length > 0 && (
                                <div className="mb-6">
                                    <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-3">Steps</h3>
                                    <ol className="space-y-3">
                                        {active.steps.map((step, i) => (
                                            <li key={i} className="flex gap-3">
                                                <span className="w-6 h-6 shrink-0 rounded-full bg-emerald-50 text-[#00634B] font-black text-xs flex items-center justify-center">
                                                    {i + 1}
                                                </span>
                                                <p className="text-gray-600 text-sm leading-relaxed pt-0.5">{step}</p>
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            )}

                            {active.required_docs && active.required_docs.length > 0 && (
                                <div className="mb-6">
                                    <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-3">
                                        Required Documents
                                    </h3>
                                    <div className="grid sm:grid-cols-2 gap-2">
                                        {active.required_docs.map((doc, i) => (
                                            <div key={i} className="flex items-center gap-2 text-gray-600 text-sm font-medium">
                                                <CheckCircle2 size={15} className="text-[#00634B] shrink-0" /> {doc}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <Link
                                href={`/cases?guide=${encodeURIComponent(active.id)}`}
                                className="inline-flex items-center gap-2 bg-[#00634B] text-white px-6 py-3 rounded-2xl font-black text-sm hover:bg-[#004D3C] transition-all"
                            >
                                Get guided help <ArrowRight size={16} />
                            </Link>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
