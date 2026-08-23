"use client";

import React, { useEffect, useState } from "react";
import { FileText, Loader2, Download, FileSignature } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface DocumentTemplate {
    id: string;
    title: string;
    category: string;
    description: string;
    body?: string;
    fields?: { key: string; label: string }[];
    format?: string;
}

export default function DocumentsPage() {
    const [docs, setDocs] = useState<DocumentTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<DocumentTemplate | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetch(`${API_URL}/api/documents`);
                if (!res.ok) throw new Error(`Failed (${res.status})`);
                const data = await res.json();
                if (!cancelled) setDocs(Array.isArray(data.documents) ? data.documents : []);
            } catch {
                if (!cancelled) setDocs([]);
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
        <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
            <div>
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-gray-900 mb-2">Legal Document Templates</h1>
                <p className="text-gray-500 text-base sm:text-lg font-medium">
                    Ready-to-use drafts for common legal needs. Select one to preview.
                </p>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="w-10 h-10 text-[#00634B] animate-spin" />
                </div>
            ) : docs.length === 0 ? (
                <div className="bg-white p-16 rounded-[40px] border border-dashed border-gray-200 text-center text-gray-400 font-medium">
                    No document templates available yet.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {docs.map((doc) => (
                        <button
                            key={doc.id}
                            onClick={() => setSelected(doc)}
                            className="text-left bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col"
                        >
                            <div className="w-12 h-12 bg-emerald-50 rounded-2xl mb-4 flex items-center justify-center text-[#00634B] group-hover:scale-110 transition-transform">
                                <FileText size={22} />
                            </div>
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{doc.category}</span>
                            <h3 className="font-black text-gray-900 mb-2 text-lg">{doc.title}</h3>
                            <p className="text-gray-500 text-sm flex-1">{doc.description}</p>
                            <span className="inline-flex items-center gap-2 text-[#00634B] font-bold text-sm mt-4">
                                <FileSignature size={15} /> Preview template
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {selected && (
                <div
                    className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
                    onClick={() => setSelected(null)}
                >
                    <div
                        className="bg-white rounded-[32px] max-w-2xl w-full max-h-[85vh] overflow-y-auto p-8 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{selected.category}</span>
                                <h2 className="text-2xl font-black text-gray-900">{selected.title}</h2>
                            </div>
                            <button
                                onClick={() => setSelected(null)}
                                className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
                            >
                                &times;
                            </button>
                        </div>
                        <p className="text-gray-500 mb-6">{selected.description}</p>
                        {selected.fields && selected.fields.length > 0 && (
                            <div className="mb-6">
                                <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Fields to fill</h4>
                                <div className="flex flex-wrap gap-2">
                                    {selected.fields.map((f) => (
                                        <span key={f.key} className="bg-emerald-50 text-[#00634B] px-3 py-1.5 rounded-lg text-xs font-bold">
                                            {f.label}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="bg-gray-50 rounded-2xl p-6 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-mono border border-gray-100">
                            {selected.body || "Template body coming soon."}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
