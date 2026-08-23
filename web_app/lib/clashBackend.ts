/**
 * FastAPI base URL for Clash proxy routes (server-side only).
 * Prefer local backend during dev even when NEXT_PUBLIC_API_URL points at production.
 */
export function getClashBackendUrl(): string {
  return (
    process.env.CLASH_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:8000"
  ).replace(/\/$/, "");
}
