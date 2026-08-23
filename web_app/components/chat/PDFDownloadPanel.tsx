"use client";

import { FileText } from "lucide-react";

interface PDFDownloadPanelProps {
    caseId?: string;
    pdfUrl?: string | null;
    onPDFReady?: (url: string) => void;
    /** Extra bottom offset when a mobile suggestions FAB sits above this control */
    stackedAboveTab?: boolean;
}

export function PDFDownloadPanel({
    caseId,
    pdfUrl: initialPdfUrl,
    stackedAboveTab = false,
}: PDFDownloadPanelProps) {
    const handleDownload = () => {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const endpointUrl = caseId ? `${API_URL}/api/cases/${encodeURIComponent(caseId)}/pdf` : null;
        const targetUrl = endpointUrl || initialPdfUrl;
        if (targetUrl) {
            window.open(targetUrl, "_blank");
        }
    };

    if (!caseId || !initialPdfUrl) return null;

    return (
        <button
            type="button"
            onClick={handleDownload}
            title="Download case report PDF"
            className={
                stackedAboveTab
                    ? "fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#00634B] text-white shadow-[0_12px_28px_-8px_rgba(0,99,75,0.55)] transition-transform hover:scale-105 md:bottom-6"
                    : "fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#00634B] text-white shadow-[0_12px_28px_-8px_rgba(0,99,75,0.55)] transition-transform hover:scale-105 md:bottom-6"
            }
            aria-label="Download PDF"
        >
            <FileText className="h-6 w-6" />
        </button>
    );
}
