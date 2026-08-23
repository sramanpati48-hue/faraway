import type { LucideIcon } from "lucide-react";
import {
  Brain,
  Briefcase,
  Database,
  FileStack,
  FileText,
  Filter,
  GitBranch,
  LayoutDashboard,
  Scale,
  ScrollText,
  Search,
  Shield,
  SlidersHorizontal,
  Table2,
  Terminal,
  Users,
  Wallet,
} from "lucide-react";

export type AdminTabId =
  | "overview"
  | "ai"
  | "policies"
  | "backup-config"
  | "langgraph"
  | "rag"
  | "rag-retrieval"
  | "cases"
  | "moderator-audit"
  | "cms"
  | "seo"
  | "articles"
  | "audit"
  | "tables"
  | "sql"
  | "users"
  | "payments";

export type AdminNavItem = {
  id: AdminTabId;
  label: string;
  icon: LucideIcon;
  group: string;
};

export const ADMIN_NAV: AdminNavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Main" },
  { id: "ai", label: "AI & models", icon: Brain, group: "Configuration" },
  { id: "policies", label: "Improvise policies", icon: ScrollText, group: "Configuration" },
  {
    id: "backup-config",
    label: "Backup & Storage",
    icon: Database,
    group: "Configuration",
  },
  {
    id: "rag-retrieval",
    label: "RAG retrieval",
    icon: SlidersHorizontal,
    group: "Configuration",
  },
  { id: "langgraph", label: "LangGraph tester", icon: GitBranch, group: "AI" },
  { id: "rag", label: "RAG funnel", icon: Filter, group: "AI" },
  { id: "cases", label: "User cases", icon: Briefcase, group: "Cases" },
  { id: "moderator-audit", label: "Moderator audit", icon: Scale, group: "Cases" },
  { id: "payments", label: "Payments", icon: Wallet, group: "Billing" },
  { id: "cms", label: "CMS", icon: FileStack, group: "Content" },
  { id: "seo", label: "SEO", icon: Search, group: "Content" },
  { id: "articles", label: "Articles", icon: FileText, group: "Content" },
  { id: "audit", label: "Audit", icon: Shield, group: "System" },
  { id: "tables", label: "Tables", icon: Table2, group: "Database" },
  { id: "sql", label: "SQL", icon: Terminal, group: "Database" },
  { id: "users", label: "Users", icon: Users, group: "Auth" },
];
