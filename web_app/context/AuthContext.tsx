"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { queueLoginSplashForRole } from "@/lib/auth/loginSplash";

export type AuthUser = {
    uid: string;
    id: string;
    email?: string | null;
    mobile?: string | null;
    display_name?: string | null;
};

interface AuthContextType {
    user: AuthUser | null;
    loading: boolean;
    role: string | null;
    accessToken: string | null;
    logout: () => Promise<void>;
    signInWithPassword: (identifier: string, password: string) => Promise<void>;
    registerWithPassword: (args: {
        email?: string;
        mobile?: string;
        password: string;
        role?: string;
        display_name?: string;
    }) => Promise<void>;
    resetPasswordWithCode: (identifier: string, resetCode: string, newPassword: string) => Promise<void>;
    /** @deprecated Firebase Google sign-in removed */
    signInWithGoogle: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    role: null,
    accessToken: null,
    logout: async () => {},
    signInWithPassword: async () => {},
    registerWithPassword: async () => {},
    resetPasswordWithCode: async () => {},
    signInWithGoogle: async () => {},
});

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ACCESS_KEY = "nyaya_access_token";
const REFRESH_KEY = "nyaya_refresh_token";
const USER_KEY = "nyaya_user";
const ROLE_KEY = "nyaya_role";

function normalizeRole(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "guide" || normalized === "nyay_guide" || normalized === "nyay guide") {
        return "sahayak";
    }
    return normalized;
}

function persistSession(data: any) {
    if (typeof window === "undefined") return;
    localStorage.setItem(ACCESS_KEY, data.access_token);
    localStorage.setItem(REFRESH_KEY, data.refresh_token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    const role = normalizeRole(data.user?.role);
    if (role && role !== "victim") localStorage.setItem(ROLE_KEY, role);
    else localStorage.removeItem(ROLE_KEY);
}

function clearSession() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROLE_KEY);
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [role, setRole] = useState<string | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);

    const applyAuthPayload = (data: any) => {
        const publicUser = data.user || {};
        const mapped: AuthUser = {
            uid: String(publicUser.uid || publicUser.id),
            id: String(publicUser.id || publicUser.uid),
            email: publicUser.email,
            mobile: publicUser.mobile,
            display_name: publicUser.display_name,
        };
        setUser(mapped);
        setRole(normalizeRole(publicUser.role));
        setAccessToken(data.access_token);
        persistSession({ ...data, user: { ...publicUser, uid: mapped.uid } });
    };

    useEffect(() => {
        const bootstrap = async () => {
            try {
                const storedAccess = localStorage.getItem(ACCESS_KEY);
                const storedRefresh = localStorage.getItem(REFRESH_KEY);
                const storedUser = localStorage.getItem(USER_KEY);
                const storedRole = localStorage.getItem(ROLE_KEY);
                if (storedUser) {
                    const parsed = JSON.parse(storedUser);
                    setUser({
                        uid: String(parsed.uid || parsed.id),
                        id: String(parsed.id || parsed.uid),
                        email: parsed.email,
                        mobile: parsed.mobile,
                        display_name: parsed.display_name,
                    });
                    setRole(normalizeRole(storedRole || parsed.role));
                    setAccessToken(storedAccess);
                }
                if (storedAccess) {
                    const me = await fetch(`${API_URL}/api/auth/me`, {
                        headers: { Authorization: `Bearer ${storedAccess}` },
                    });
                    if (me.ok) {
                        const data = await me.json();
                        setUser({
                            uid: String(data.uid || data.id),
                            id: String(data.id || data.uid),
                            email: data.email,
                            mobile: data.mobile,
                            display_name: data.display_name,
                        });
                        setRole(normalizeRole(data.role));
                        setLoading(false);
                        return;
                    }
                }
                if (storedRefresh) {
                    const refreshed = await fetch(`${API_URL}/api/auth/refresh`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ refresh_token: storedRefresh }),
                    });
                    if (refreshed.ok) {
                        const data = await refreshed.json();
                        applyAuthPayload(data);
                        setLoading(false);
                        return;
                    }
                }
                clearSession();
                setUser(null);
                setRole(null);
                setAccessToken(null);
            } catch (err) {
                console.error("Auth bootstrap failed:", err);
            } finally {
                setLoading(false);
            }
        };
        bootstrap();
    }, []);

    const signInWithPassword = async (identifier: string, password: string) => {
        const res = await fetch(`${API_URL}/api/auth/jwt-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || "Login failed");
        applyAuthPayload(data);
        queueLoginSplashForRole(normalizeRole(data.user?.role));
    };

    const registerWithPassword = async (args: {
        email?: string;
        mobile?: string;
        password: string;
        role?: string;
        display_name?: string;
    }) => {
        const res = await fetch(`${API_URL}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || "Registration failed");
        applyAuthPayload(data);
        queueLoginSplashForRole(normalizeRole(data.user?.role));
    };

    const resetPasswordWithCode = async (identifier: string, resetCode: string, newPassword: string) => {
        const res = await fetch(`${API_URL}/api/auth/reset-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                identifier,
                reset_code: resetCode,
                new_password: newPassword,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || "Password reset failed");
        applyAuthPayload(data);
        queueLoginSplashForRole(normalizeRole(data.user?.role));
    };

    const logout = async () => {
        const refresh = localStorage.getItem(REFRESH_KEY);
        try {
            if (refresh) {
                await fetch(`${API_URL}/api/auth/logout`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ refresh_token: refresh }),
                });
            }
        } catch {
            // ignore
        }
        clearSession();
        setUser(null);
        setRole(null);
        setAccessToken(null);
    };

    const signInWithGoogle = async () => {
        throw new Error("Google/Firebase sign-in has been removed. Use email or mobile + password.");
    };

    const value = useMemo(
        () => ({
            user,
            loading,
            role,
            accessToken,
            logout,
            signInWithPassword,
            registerWithPassword,
            resetPasswordWithCode,
            signInWithGoogle,
        }),
        [user, loading, role, accessToken]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
