import { NextRequest, NextResponse } from "next/server";
import { getClashBackendUrl } from "@/lib/clashBackend";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const auth = req.headers.get("authorization") || "";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth) headers.Authorization = auth;
    const res = await fetch(`${getClashBackendUrl()}/api/clash/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Clash create session proxy error:", error);
    return NextResponse.json(
      { detail: "Clash backend unavailable. Start the API with: uvicorn main:app --reload --port 8000" },
      { status: 503 }
    );
  }
}
