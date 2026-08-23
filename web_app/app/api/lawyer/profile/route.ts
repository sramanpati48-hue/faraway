import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import os from "os";

// The backend URL should ideally come from env, defaulting to localhost for now
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
    const uid = req.nextUrl.searchParams.get("uid");

    if (!uid) {
        return NextResponse.json({ error: "Missing uid parameter" }, { status: 400 });
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/lawyer/profile/${uid}`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return NextResponse.json(
                { error: errorData.detail || "Failed to fetch profile from backend" },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Error fetching lawyer profile:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const formData = await req.formData();
        const payload: Record<string, any> = {};
        let avatarUrl: string | undefined;

        // uid can come from query param or FormData body
        let uid = req.nextUrl.searchParams.get("uid") || (formData.get('uid') as string | null);

        if (!uid) {
            return NextResponse.json({ error: "Missing uid" }, { status: 400 });
        }

        for (const [key, value] of formData.entries()) {
            if (key === 'uid') continue; // skip uid from payload
            if (key === "avatar" && typeof value !== "string" && (value as any).size !== undefined) {
                // It's a file
                const file = value as File;
                if (file.size > 0) {
                    const buffer = Buffer.from(await file.arrayBuffer());
                    // Save locally in public/uploads/lawyers
                    const uploadDir = path.join(process.cwd(), "public", "uploads", "lawyers");

                    try {
                        await mkdir(uploadDir, { recursive: true });
                    } catch (e) {
                        // Ignore error if it already exists
                    }

                    // Basic sanitization
                    const ext = file.name.split('.').pop() || 'png';
                    const filename = `${uid}-${Date.now()}.${ext}`;
                    const filepath = path.join(uploadDir, filename);

                    await writeFile(filepath, buffer);
                    avatarUrl = `/uploads/lawyers/${filename}`;
                }
            } else if (typeof value === "string") {
                // It's a string attribute
                if (key === 'experience' || key === 'hourlyRate') {
                    // Parse integers
                    payload[key] = parseInt(value, 10) || 0;
                } else {
                    payload[key] = value;
                }
            }
        }

        if (avatarUrl) {
            payload.avatar = avatarUrl;
        }

        // Call the Python backend
        const response = await fetch(`${BACKEND_URL}/api/lawyer/profile/${uid}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return NextResponse.json(
                { error: errorData.detail || "Failed to update profile in backend" },
                { status: response.status }
            );
        }

        const data = await response.json().catch(() => ({}));
        // Always merge avatarUrl so the frontend can read it back
        return NextResponse.json({ ...data, ...(avatarUrl ? { avatarUrl } : {}) });

    } catch (error) {
        console.error("Error updating lawyer profile:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
