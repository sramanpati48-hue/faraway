"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { Loader2, ArrowLeft, Clock, Tag, User, Calendar } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface Article {
    id: string;
    slug: string;
    title: string;
    category: string;
    summary: string;
    content: string;
    author?: string;
    tags?: string[];
    read_minutes?: number;
    published_at?: string;
}

export default function BlogDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = String(params?.id || "");

    const [article, setArticle] = useState<Article | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!id) return;
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`${API_URL}/api/articles/${encodeURIComponent(id)}`);
                if (res.status === 404) throw new Error("Article not found");
                if (!res.ok) throw new Error(`Failed to load article (${res.status})`);
                const data = await res.json();
                if (!cancelled) setArticle(data.article || null);
            } catch (err: any) {
                if (!cancelled) setError(err.message || "Failed to load article");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [id]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-12 h-12 text-[#00634B] animate-spin" />
            </div>
        );
    }

    if (error || !article) {
        return (
            <div className="max-w-2xl mx-auto text-center py-24 space-y-6">
                <h1 className="text-3xl font-black text-gray-900">{error || "Article not found"}</h1>
                <button
                    onClick={() => router.push("/search")}
                    className="inline-flex items-center gap-2 bg-[#00634B] text-white px-8 py-4 rounded-2xl font-black hover:bg-[#004D3C] transition-all"
                >
                    <ArrowLeft size={18} /> Back to Search
                </button>
            </div>
        );
    }

    const publishedDate = article.published_at
        ? new Date(article.published_at).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })
        : null;

    return (
        <article className="max-w-3xl mx-auto pb-24 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <button
                onClick={() => router.back()}
                className="inline-flex items-center gap-2 text-gray-500 hover:text-[#00634B] font-bold text-sm mb-8 transition-colors"
            >
                <ArrowLeft size={18} /> Back
            </button>

            <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-[#00634B] px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-tight mb-5">
                <Tag size={12} /> {article.category}
            </span>

            <h1 className="text-4xl md:text-5xl font-black text-gray-900 leading-tight mb-6 tracking-tight">
                {article.title}
            </h1>

            <div className="flex flex-wrap items-center gap-5 text-sm font-bold text-gray-400 mb-8 pb-8 border-b border-gray-100">
                {article.author && (
                    <span className="flex items-center gap-2"><User size={15} /> {article.author}</span>
                )}
                {publishedDate && (
                    <span className="flex items-center gap-2"><Calendar size={15} /> {publishedDate}</span>
                )}
                <span className="flex items-center gap-2"><Clock size={15} /> {article.read_minutes || 5} min read</span>
            </div>

            <div className="max-w-none text-gray-600 leading-relaxed">
                <ReactMarkdown
                    components={{
                        h1: ({ children }) => (
                            <h1 className="text-3xl font-black text-gray-900 mt-10 mb-4 tracking-tight">{children}</h1>
                        ),
                        h2: ({ children }) => (
                            <h2 className="text-2xl font-black text-gray-900 mt-8 mb-3 tracking-tight">{children}</h2>
                        ),
                        h3: ({ children }) => (
                            <h3 className="text-xl font-bold text-gray-900 mt-6 mb-2">{children}</h3>
                        ),
                        p: ({ children }) => <p className="text-gray-600 leading-relaxed mb-4">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-6 space-y-2 mb-4 text-gray-600">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-6 space-y-2 mb-4 text-gray-600">{children}</ol>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        strong: ({ children }) => <strong className="font-bold text-gray-900">{children}</strong>,
                        a: ({ children, href }) => (
                            <a href={href} className="text-[#00634B] font-semibold underline">{children}</a>
                        ),
                        blockquote: ({ children }) => (
                            <blockquote className="border-l-4 border-[#00634B] pl-4 italic text-gray-500 my-6">{children}</blockquote>
                        ),
                    }}
                >
                    {article.content}
                </ReactMarkdown>
            </div>

            {article.tags && article.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-12 pt-8 border-t border-gray-100">
                    {article.tags.map((tag) => (
                        <Link
                            key={tag}
                            href={`/search?query=${encodeURIComponent(tag)}`}
                            className="bg-gray-50 text-gray-600 px-4 py-2 rounded-xl text-xs font-semibold hover:bg-emerald-50 hover:text-[#00634B] transition-all border border-gray-100"
                        >
                            {tag}
                        </Link>
                    ))}
                </div>
            )}
        </article>
    );
}
