import { NextResponse } from "next/server";
import { CLASH_MOCK_CASES } from "@/lib/clashMockCases";
import { getClashBackendUrl } from "@/lib/clashBackend";

export async function GET() {
  try {
    const backend = getClashBackendUrl();
    const res = await fetch(`${backend}/api/clash/mock-cases`, {
      next: { revalidate: 0 },
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    /* use bundled cases */
  }
  return NextResponse.json({ cases: CLASH_MOCK_CASES });
}
