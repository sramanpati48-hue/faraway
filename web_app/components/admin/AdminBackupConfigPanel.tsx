"use client";

import { useEffect, useState } from "react";
import {
  MessageSquare,
  Folder,
  Key,
  Info,
  CheckCircle2,
  AlertCircle,
  Play,
  Loader2,
  ExternalLink,
  ShieldCheck,
  User,
} from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import {
  AdminPageHeader,
  AdminSection,
  adminBtnPrimary,
  adminBtnSecondary,
  adminInput,
} from "@/components/admin/admin-ui";

type BackupConfig = {
  gdrive_folder_id?: string;
  gdrive_client_id?: string;
  gdrive_client_secret?: string;
  gdrive_refresh_token?: string;
  gdrive_service_account_json?: string | Record<string, unknown>;
  discord_webhook?: string;
  cron_secret?: string;
};

export function AdminBackupConfigPanel() {
  const [config, setConfig] = useState<BackupConfig>({
    gdrive_folder_id: "",
    gdrive_client_id: "",
    gdrive_client_secret: "",
    gdrive_refresh_token: "",
    gdrive_service_account_json: "",
    discord_webhook: "",
    cron_secret: "",
  });
  const [serviceAccountJsonStr, setServiceAccountJsonStr] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"info" | "success" | "error">("info");

  const showToast = (msg: string, type: "info" | "success" | "error" = "info") => {
    setToastMessage(msg);
    setToastType(type);
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await adminApi.systemConfig();
      const backupItem = res.config?.find((item) => item.key === "backup_config");
      if (backupItem && typeof backupItem.value === "object" && backupItem.value !== null) {
        const val = backupItem.value as BackupConfig;
        setConfig({
          gdrive_folder_id: "",
          gdrive_client_id: "",
          gdrive_client_secret: "",
          gdrive_refresh_token: "",
          discord_webhook: "",
          cron_secret: "",
          ...val,
        });
        if (val.gdrive_service_account_json) {
          if (typeof val.gdrive_service_account_json === "object") {
            setServiceAccountJsonStr(JSON.stringify(val.gdrive_service_account_json, null, 2));
          } else {
            setServiceAccountJsonStr(String(val.gdrive_service_account_json));
          }
        } else {
          setServiceAccountJsonStr("");
        }
      }
    } catch (err: any) {
      showToast(`Failed to load backup configuration: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      let parsedSaJson: any = serviceAccountJsonStr.trim();
      if (parsedSaJson.startsWith("{")) {
        try {
          parsedSaJson = JSON.parse(parsedSaJson);
        } catch {
          showToast("Service Account JSON is not valid JSON string", "error");
          setSaving(false);
          return;
        }
      } else if (!parsedSaJson) {
        parsedSaJson = "";
      }

      const updatedPayload: BackupConfig = {
        ...config,
        gdrive_service_account_json: parsedSaJson,
      };

      await adminApi.patchSystemConfig("backup_config", updatedPayload as any);
      setConfig(updatedPayload);
      showToast("Backup configuration successfully saved to PostgreSQL database!", "success");
    } catch (err: any) {
      showToast(`Error saving configuration: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleTestBackup = async () => {
    setTesting(true);
    setTestResult(null);
    showToast("Initiating database backup test...", "info");
    try {
      const secret = config.cron_secret || "6qZQAufu6voiZDc_YGpYmDr6d6XtRRi5";
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${apiUrl}/api/internal/backup?secret=${encodeURIComponent(secret)}&sync=true`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      setTestResult(data);
      if (res.ok && data.success) {
        showToast("Database backup test completed successfully!", "success");
      } else {
        showToast(`Backup test returned status ${res.status}`, "error");
      }
    } catch (err: any) {
      showToast(`Backup test failed: ${err.message}`, "error");
      setTestResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const hasOauth =
    Boolean(config.gdrive_client_id?.trim()) &&
    Boolean(config.gdrive_client_secret?.trim()) &&
    Boolean(config.gdrive_refresh_token?.trim());

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
        <span className="ml-3 text-sm text-white/70">Loading backup settings from PostgreSQL...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8">
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex max-w-md items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-md transition-all duration-300 ${
            toastType === "success"
              ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-200"
              : toastType === "error"
              ? "border-red-500/30 bg-red-950/90 text-red-200"
              : "border-emerald-500/30 bg-black/90 text-emerald-200"
          }`}
        >
          {toastType === "success" && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />}
          {toastType === "error" && <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />}
          {toastType === "info" && <Info className="h-5 w-5 shrink-0 text-emerald-400" />}
          <span className="flex-1 text-xs leading-relaxed">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-white/50 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      <AdminPageHeader
        title="Automated Backup & Storage Settings"
        description="Free personal Gmail Drive via OAuth refresh token, Discord alerts, and UptimeRobot cron secret — stored in PostgreSQL system_config."
        badge="System Configuration"
        actions={
          <div className="flex gap-2">
            <button
              onClick={handleTestBackup}
              disabled={testing}
              className={adminBtnSecondary}
            >
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4 text-emerald-400" />}
              Test Backup Now
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={adminBtnPrimary}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Save Configuration
            </button>
          </div>
        }
      />

      <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/20 p-4 text-xs text-amber-100/90">
        <p className="font-semibold text-amber-200">Free Gmail Drive (recommended)</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-white/70">
          <li>
            GCP Console → enable{" "}
            <a
              href="https://console.cloud.google.com/apis/library/drive.googleapis.com"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 underline inline-flex items-center"
            >
              Google Drive API <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </li>
          <li>
            Create an OAuth client (Desktop app). Add your Gmail as a test user on the consent screen if the app is in Testing.
          </li>
          <li>
            Locally run{" "}
            <code className="rounded bg-black/40 px-1.5 py-0.5 text-emerald-300">
              python scripts/gdrive_oauth_refresh_token.py
            </code>{" "}
            → paste Client ID, Secret, and Refresh token below.
          </li>
          <li>
            Set Folder ID to a folder you own. Leave Service Account JSON empty (SA has 0 quota on personal Drive).
          </li>
          <li>
            UptimeRobot cron:{" "}
            <code className="rounded bg-black/40 px-1.5 py-0.5 text-emerald-300">
              POST /api/internal/backup?secret=YOUR_CRON_SECRET
            </code>
          </li>
        </ol>
        {hasOauth ? (
          <p className="mt-3 flex items-center gap-1.5 text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> OAuth fields filled — backups will use your Gmail quota.
          </p>
        ) : (
          <p className="mt-3 text-amber-200/80">
            OAuth not fully configured yet. Service-account-only setups will fail with storageQuotaExceeded on @gmail.com Drive.
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AdminSection
          title="Google Drive (personal Gmail)"
          description="OAuth user credentials upload as you — uses your free Drive storage."
        >
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="flex items-center text-xs font-semibold text-white/80">
                  <Folder className="mr-1.5 h-4 w-4 text-amber-400" />
                  Google Drive Folder ID
                </label>
                <button
                  type="button"
                  onMouseEnter={() =>
                    showToast(
                      "Open the Drive folder in the browser. Copy the ID from the URL after /folders/",
                      "info"
                    )
                  }
                  className="inline-flex items-center text-[11px] text-emerald-400 hover:underline"
                >
                  <Info className="mr-1 h-3 w-3" />
                  Where to find this?
                </button>
              </div>
              <input
                type="text"
                value={config.gdrive_folder_id || ""}
                onChange={(e) => setConfig({ ...config, gdrive_folder_id: e.target.value })}
                placeholder="e.g. 1ENLehIKssgZIpn3zlHWfnA9OD_f76H5K"
                className={adminInput}
              />
              <p className="mt-1 text-[11px] text-white/40">
                Folder must be owned by the same Gmail you authorize with OAuth. No sharing with a service account needed.
              </p>
            </div>

            <div>
              <label className="mb-1.5 flex items-center text-xs font-semibold text-white/80">
                <User className="mr-1.5 h-4 w-4 text-sky-400" />
                OAuth Client ID
              </label>
              <input
                type="text"
                value={config.gdrive_client_id || ""}
                onChange={(e) => setConfig({ ...config, gdrive_client_id: e.target.value })}
                placeholder="xxxx.apps.googleusercontent.com"
                className={adminInput}
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center text-xs font-semibold text-white/80">
                <Key className="mr-1.5 h-4 w-4 text-sky-400" />
                OAuth Client Secret
              </label>
              <input
                type="password"
                autoComplete="off"
                value={config.gdrive_client_secret || ""}
                onChange={(e) => setConfig({ ...config, gdrive_client_secret: e.target.value })}
                placeholder="GOCSPX-..."
                className={adminInput}
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center text-xs font-semibold text-white/80">
                <Key className="mr-1.5 h-4 w-4 text-emerald-400" />
                OAuth Refresh Token
              </label>
              <textarea
                rows={3}
                value={config.gdrive_refresh_token || ""}
                onChange={(e) => setConfig({ ...config, gdrive_refresh_token: e.target.value })}
                placeholder="1//0..."
                className={`${adminInput} font-mono text-xs`}
              />
              <p className="mt-1 text-[11px] text-white/40">
                From{" "}
                <code className="text-emerald-300/80">python scripts/gdrive_oauth_refresh_token.py</code>. Preferred over
                service account when all three OAuth fields are set.
              </p>
            </div>

            <details className="rounded-xl border border-white/10 bg-black/30 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-white/60">
                Advanced: Service Account (Shared Drive / Workspace only)
              </summary>
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-white/45">
                  Do not use for personal @gmail.com folders — uploads fail with storageQuotaExceeded. Clear this field for
                  the free OAuth path.
                </p>
                <textarea
                  rows={5}
                  value={serviceAccountJsonStr}
                  onChange={(e) => setServiceAccountJsonStr(e.target.value)}
                  placeholder='Leave empty for personal Gmail. Only for Shared Drive / Workspace.'
                  className={`${adminInput} font-mono text-xs`}
                />
              </div>
            </details>
          </div>
        </AdminSection>

        <AdminSection
          title="Discord Alerts & Cron Security"
          description="Send backup archives to Discord and protect backup API endpoints with secret keys."
        >
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="flex items-center text-xs font-semibold text-white/80">
                  <ShieldCheck className="mr-1.5 h-4 w-4 text-emerald-400" />
                  Discord Webhook URL
                </label>
                <button
                  type="button"
                  onMouseEnter={() =>
                    showToast(
                      "Discord → channel settings → Integrations → Webhooks → New Webhook → Copy URL.",
                      "info"
                    )
                  }
                  className="inline-flex items-center text-[11px] text-emerald-400 hover:underline"
                >
                  <Info className="mr-1 h-3 w-3" />
                  Where to find this?
                </button>
              </div>
              <input
                type="text"
                value={config.discord_webhook || ""}
                onChange={(e) => setConfig({ ...config, discord_webhook: e.target.value })}
                placeholder="https://discord.com/api/webhooks/..."
                className={adminInput}
              />
              <p className="mt-1 text-[11px] text-white/40">
                Optional: compressed dumps as Discord attachments (size limits apply).
              </p>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="flex items-center text-xs font-semibold text-white/80">
                  <Key className="mr-1.5 h-4 w-4 text-purple-400" />
                  Cron Secret Key
                </label>
                <button
                  type="button"
                  onMouseEnter={() =>
                    showToast(
                      "UptimeRobot HTTP(S) monitor URL: /api/internal/backup?secret=YOUR_SECRET",
                      "info"
                    )
                  }
                  className="inline-flex items-center text-[11px] text-emerald-400 hover:underline"
                >
                  <Info className="mr-1 h-3 w-3" />
                  Where to find this?
                </button>
              </div>
              <input
                type="text"
                value={config.cron_secret || ""}
                onChange={(e) => setConfig({ ...config, cron_secret: e.target.value })}
                placeholder="your-long-random-secret"
                className={adminInput}
              />
              <p className="mt-1 text-[11px] text-white/40">
                Authenticates UptimeRobot / cron POSTs to the backup endpoint.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] text-white/55">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-white/75">
                <MessageSquare className="h-3.5 w-3.5" /> UptimeRobot tip
              </p>
              Use HTTP(S) monitor, method POST, keyword or status 200. Interval as often as your free plan allows (e.g.
              daily). Query param <code className="text-emerald-300/90">secret=</code> must match Cron Secret above.
            </div>
          </div>
        </AdminSection>
      </div>

      {testResult && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-[#0c0c0c] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Play className="h-4 w-4 text-emerald-400" />
              Latest Test Backup Result
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                testResult.success
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-red-500/20 text-red-300 border border-red-500/30"
              }`}
            >
              {testResult.success ? "Success" : "Failed"}
            </span>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-black/60 p-4 font-mono text-xs text-white/80 border border-white/[0.05]">
            {JSON.stringify(testResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
