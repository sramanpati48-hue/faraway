import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
    const uid = req.nextUrl.searchParams.get("uid");

    if (!uid) {
        return NextResponse.json({ error: "Missing uid parameter" }, { status: 400 });
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/lawyer/cases/${uid}`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
            next: { revalidate: 0 },
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return NextResponse.json(
                { error: errorData.detail || "Failed to fetch cases from backend" },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Error fetching lawyer cases:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { case_id, lawyer_id } = body;

        if (!case_id || !lawyer_id) {
            return NextResponse.json({ error: "Missing case_id or lawyer_id" }, { status: 400 });
        }

        const response = await fetch(`${BACKEND_URL}/api/lawyer/cases/${case_id}/accept`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ lawyer_id }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return NextResponse.json(
                { error: errorData.detail || "Failed to accept case in backend" },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error("Error accepting lawyer case:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
