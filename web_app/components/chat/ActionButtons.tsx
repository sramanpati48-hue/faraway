import { ArrowRight } from "lucide-react";

interface Action {
  label: string;
  node?: string;
  action?: string;
  payload: string;
}

interface ActionButtonsProps {
  actions: Action[];
  onSelect: (action: Action) => void;
}

export function ActionButtons({ actions, onSelect }: ActionButtonsProps) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
      {actions.map((action, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(action)}
          className="group flex items-center gap-2 px-4 py-2.5 bg-slate-900/40 backdrop-blur-md border border-emerald-500/20 rounded-xl hover:bg-emerald-500/10 hover:border-emerald-500/50 transition-all duration-300 shadow-[0_0_10px_rgba(16,185,129,0.05)] hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] text-sm font-medium text-emerald-100 hover:text-white group-hover:scale-105"
        >
          <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent font-bold tracking-wide">
            {action.label}
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-emerald-400 opacity-70 group-hover:translate-x-1 group-hover:opacity-100 transition-all" />
        </button>
      ))}
    </div>
  );
}
