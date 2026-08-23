"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { AdminShell, type AdminTabId } from "@/components/admin/AdminShell";
import { AdminOverviewTab } from "@/components/admin/AdminOverviewTab";
import { AdminAiModelsSection } from "@/components/admin/AdminAiModelsSection";
import { AdminPolicyStudio } from "@/components/admin/policy/AdminPolicyStudio";
import { AdminBackupConfigPanel } from "@/components/admin/AdminBackupConfigPanel";
import { LangGraphTester } from "@/components/admin/LangGraphTester";
import { AdminRagFunnelPanel } from "@/components/admin/AdminRagFunnelPanel";
import { AdminRagRetrievalPanel } from "@/components/admin/AdminRagRetrievalPanel";
import { AdminAuditTab } from "@/components/admin/AdminAuditTab";
import { AdminTablesPanel } from "@/components/admin/AdminTablesPanel";
import { AdminSqlPanel } from "@/components/admin/AdminSqlPanel";
import { AdminUsersPanel } from "@/components/admin/AdminUsersPanel";
import { AdminCasesPanel } from "@/components/admin/AdminCasesPanel";
import { AdminModeratorRevisionsPanel } from "@/components/admin/AdminModeratorRevisionsPanel";
import { AdminCmsPanel } from "@/components/admin/AdminCmsPanel";
import { AdminSeoTab } from "@/components/admin/AdminSeoTab";
import { AdminArticlesPanel } from "@/components/admin/AdminArticlesPanel";
import { AdminPaymentsPanel } from "@/components/admin/AdminPaymentsPanel";

export function AdminDashboard() {
  const { user, role, logout } = useAuth();
  const [tab, setTab] = useState<AdminTabId>("overview");

  return (
    <AdminShell
      tab={tab}
      onTabChange={setTab}
      userName={user?.email || user?.mobile || user?.uid}
      role={role}
      onSignOut={() => void logout()}
    >
      {tab === "overview" && <AdminOverviewTab onNavigate={setTab} />}
      {tab === "ai" && <AdminAiModelsSection />}
      {tab === "policies" && <AdminPolicyStudio />}
      {tab === "backup-config" && <AdminBackupConfigPanel />}
      {tab === "rag-retrieval" && <AdminRagRetrievalPanel />}
      {tab === "langgraph" && <LangGraphTester />}
      {tab === "rag" && <AdminRagFunnelPanel />}
      {tab === "cases" && <AdminCasesPanel />}
      {tab === "moderator-audit" && <AdminModeratorRevisionsPanel />}
      {tab === "cms" && <AdminCmsPanel />}
      {tab === "seo" && <AdminSeoTab />}
      {tab === "articles" && <AdminArticlesPanel />}
      {tab === "audit" && <AdminAuditTab />}
      {tab === "tables" && <AdminTablesPanel />}
      {tab === "sql" && <AdminSqlPanel />}
      {tab === "users" && <AdminUsersPanel />}
      {tab === "payments" && <AdminPaymentsPanel />}
    </AdminShell>
  );
}
