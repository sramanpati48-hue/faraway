import { NextRequest, NextResponse } from "next/server";
import { getClashBackendUrl } from "@/lib/clashBackend";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  try {
    const body = await req.json();
    const res = await fetch(
      `${getClashBackendUrl()}/api/clash/sessions/${sessionId}/case`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Clash attach case proxy error:", error);
    return NextResponse.json({ detail: "Clash backend unavailable" }, { status: 503 });
  }
}
