"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";

export interface LegalCase {
    id: string;
    title: string;
    status: string;
    statusColor?: string;
    clientId: string;
    lawyerId: string;
    lastUpdate: any;
    description: string;
    type: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export const useCases = () => {
    const { user, role, loading: authLoading, accessToken } = useAuth() as any;
    const [cases, setCases] = useState<LegalCase[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (authLoading) return;

        const normalizedRole = (role || "").trim().toLowerCase();
        const uid = user?.uid || user?.id;
        if (
            !uid ||
            normalizedRole === "moderator" ||
            normalizedRole === "guide" ||
            normalizedRole === "sahayak" ||
            normalizedRole === "nyay_guide"
        ) {
            setCases([]);
            setLoading(false);
            return;
        }

        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const headers: Record<string, string> = {};
                if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
                const res = await fetch(`${API_URL}/api/cases?uid=${encodeURIComponent(uid)}`, {
                    headers,
                });
                if (!res.ok) {
                    throw new Error(`Failed to load cases (${res.status})`);
                }
                const data = await res.json();
                const rows = Array.isArray(data) ? data : data.cases || [];
                if (cancelled) return;
                setCases(
                    rows.map((row: any) => {
                        const report = row.structured_report || {};
                        return {
                            id: String(row.case_id || row.id),
                            title: report.incident_type || report.title || "Untitled Case",
                            status: row.pending ? "Pending Review" : report.status || row.status || "Open",
                            statusColor: row.pending
                                ? "bg-amber-100 text-amber-700"
                                : "bg-gray-100 text-gray-600",
                            clientId: String(row.user_id || uid),
                            lawyerId: "",
                            lastUpdate: row.timestamp || null,
                            description: report.summary || "",
                            type: report.incident_type || "General",
                        } as LegalCase;
                    })
                );
            } catch (err: any) {
                if (!cancelled) {
                    console.error("Error fetching cases:", err);
                    setError(err.message || "Failed to load cases");
                    setCases([]);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        const timer = setInterval(load, 30000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [user, role, authLoading, accessToken]);

    return { cases, loading, error };
};
