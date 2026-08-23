import { cn } from "@/lib/utils";
import { Terminal, ChevronRight, ChevronLeft } from "lucide-react";
import { useEffect, useRef } from "react";

interface LogEntry {
  type: string;
  agent?: string;
  content: string;
  timestamp: string;
}

interface AgentLogProps {
  logs: LogEntry[];
  isOpen: boolean;
  onToggle: () => void;
}

export function AgentLog({ logs, isOpen, onToggle }: AgentLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <>
      {/* Toggle Arrow — always visible */}
      <button
        onClick={onToggle}
        title={isOpen ? "Collapse Console" : "Expand Console"}
        className={cn(
          "fixed top-1/2 -translate-y-1/2 z-50 bg-white border border-gray-100 shadow-lg rounded-l-xl p-1.5 flex items-center justify-center text-gray-400 hover:text-[#00634B] hover:border-[#00634B]/30 transition-all duration-200",
          isOpen ? "right-[min(20rem,85vw)]" : "right-0"
        )}
      >
        {isOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      {/* Panel */}
      <div className={cn(
        "fixed right-0 top-0 h-full w-[min(20rem,85vw)] bg-white border-l border-gray-100 shadow-xl z-40 flex flex-col transition-all duration-300 transform",
        isOpen ? "translate-x-0" : "translate-x-full"
      )}>
        <div className="flex items-center gap-2 px-4 py-3 text-[#00634B] font-bold text-xs uppercase tracking-wider border-b border-gray-100 flex-shrink-0">
          <Terminal className="w-4 h-4" />
          <span>System Console</span>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-3 font-mono text-[10px] p-4 custom-scrollbar"
        >
          {logs.length === 0 && (
            <div className="text-gray-300 italic text-center mt-10 text-xs">
              Waiting for interaction...
            </div>
          )}

          {logs.map((log, idx) => (
            <div key={idx} className="bg-gray-50/50 p-2 rounded border border-gray-100 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-start mb-1 h-fit">
                <span className={cn(
                  "font-bold px-1.5 py-0.5 rounded text-[9px]",
                  log.agent === "Supervisor" ? "bg-purple-50 text-purple-600 border border-purple-100" :
                    log.agent === "Cyber" ? "bg-cyan-50 text-cyan-600 border border-cyan-100" :
                      log.agent === "Scam" ? "bg-red-50 text-red-600 border border-red-100" :
                        log.agent === "System" ? "bg-gray-100 text-gray-600 border border-gray-200" :
                          "bg-[#E6F0ED] text-[#00634B] border-[#00634B]/10"
                )}>
                  {log.agent || "SYSTEM"}
                </span>
                <span className="text-gray-400 text-[9px] whitespace-nowrap ml-2">{log.timestamp}</span>
              </div>
              <p className="text-gray-600 leading-relaxed whitespace-pre-wrap pl-1 border-l-2 border-gray-200 mt-1">{log.content}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
