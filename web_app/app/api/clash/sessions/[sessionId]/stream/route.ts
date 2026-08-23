import { NextRequest, NextResponse } from "next/server";
import { getClashBackendUrl } from "@/lib/clashBackend";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  try {
    const res = await fetch(
      `${getClashBackendUrl()}/api/clash/sessions/${sessionId}/stream`,
      { method: "POST" }
    );
    if (!res.ok) {
      const text = await res.text();
      return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new NextResponse(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/x-ndjson",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Clash stream proxy error:", error);
    return NextResponse.json({ detail: "Clash backend unavailable" }, { status: 503 });
  }
}
