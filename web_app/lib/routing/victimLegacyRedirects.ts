/** Legacy (dashboard) paths → canonical victim app-shell destinations. */

export const VICTIM_LEGACY_PATH_REDIRECTS: Record<string, string> = {
  "/about": "/help",
  "/file-case": "/cases",
  "/lawyers": "/find-help",
  "/resources": "/legal-rights",
};

export function isVictimUser(role: string | null | undefined, pathname: string): boolean {
  const r = (role || "").toLowerCase();
  if (r && r !== "victim") return false;
  if (pathname.startsWith("/lawyer")) return false;
  if (pathname.startsWith("/sahayak")) return false;
  return true;
}

export function resolveVictimLegacyRedirect(pathname: string): string {
  const exact = VICTIM_LEGACY_PATH_REDIRECTS[pathname];
  if (exact) return exact;
  if (pathname.startsWith("/blogs/")) return "/legal-rights";
  return "/home";
}
