import { AlertTriangle, CheckCircle, ShieldAlert, Gavel, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface StructuredReportProps {
    report: {
        incident_type?: string;
        risk_level?: string;
        summary?: string;
        statutory_sections?: string[];
        checklist?: string[];
    };
    onChecklistSelect?: (item: string) => void;
}

export function StructuredReport({ report, onChecklistSelect }: StructuredReportProps) {
    if (!report) return null;

    const isHighRisk = report.risk_level?.toLowerCase() === "high";

    return (
        <div className="mt-6 space-y-4 animate-in fade-in zoom-in-95 duration-500">
            {/* Header Badge */}
            <div className={cn(
                "flex items-center gap-2 p-3 rounded-md border",
                isHighRisk
                    ? "bg-red-950/20 border-red-800 text-red-400"
                    : "bg-blue-950/20 border-blue-800 text-blue-400"
            )}>
                {isHighRisk ? <ShieldAlert className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
                <div className="flex-1">
                    <h3 className="font-semibold text-sm uppercase tracking-wide">
                        {report.incident_type || "Incident Report"}
                    </h3>
                    <p className="text-xs opacity-70">Risk Level: <span className="font-bold">{report.risk_level}</span></p>
                </div>
            </div>

            {/* Summary */}
            <div className="bg-slate-100 dark:bg-slate-950 p-4 rounded-md border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col">
                <div className="flex justify-between items-center mb-2 border-b border-slate-300 dark:border-slate-800 pb-1 flex-shrink-0">
                    <h4 className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                        <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                        Summary
                    </h4>
                </div>
                <div className="max-h-40 overflow-y-auto pr-2 custom-scrollbar-slate">
                    <p className="text-sm text-slate-800 dark:text-slate-300 leading-relaxed">
                        {report.summary}
                    </p>
                </div>
            </div>

            {/* Grid for Laws & Checklist */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Statutory Sections */}
                {report.statutory_sections && report.statutory_sections.length > 0 && (
                    <div className="bg-slate-100 dark:bg-slate-950 p-4 rounded-md border border-slate-200 dark:border-slate-800 flex flex-col">
                        <h4 className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100 mb-3 border-b border-slate-300 dark:border-slate-800 pb-1 flex-shrink-0">
                            <Gavel className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                            Relevant Laws
                        </h4>
                        <div className="max-h-48 overflow-y-auto pr-2 custom-scrollbar-slate">
                            <ul className="space-y-2">
                                {report.statutory_sections.map((section, idx) => (
                                    <li key={idx} className="text-sm text-slate-700 dark:text-slate-400 flex items-start gap-2">
                                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                                        {section}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                {/* Immediate Checklist */}
                {report.checklist && report.checklist.length > 0 && (
                    <div className="bg-emerald-50 dark:bg-emerald-950/10 p-4 rounded-md border border-emerald-200 dark:border-emerald-900/50 flex flex-col">
                        <h4 className="flex items-center gap-2 font-medium text-emerald-800 dark:text-emerald-300 mb-3 border-b border-emerald-200 dark:border-emerald-900/30 pb-1 flex-shrink-0 text-xs">
                            <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
                            Action Checklist
                            <span className="ml-auto text-[10px] uppercase opacity-60 tracking-wider">Add</span>
                        </h4>
                        <div className="max-h-48 overflow-y-auto pr-2 custom-scrollbar-emerald">
                            <div className="space-y-2">
                                {report.checklist.map((item, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => onChecklistSelect?.(item)}
                                        className="w-full text-left text-sm text-emerald-800 dark:text-emerald-200/80 flex items-start gap-2 group hover:bg-emerald-100 dark:hover:bg-emerald-500/10 p-1.5 rounded transition-colors cursor-pointer"
                                    >
                                        <div className="mt-1 w-4 h-4 rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-500 flex items-center justify-center group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/30 transition-colors">
                                            <div className="w-2 h-2 bg-emerald-500 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                        <span className="line-clamp-2 text-xs">{item}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
