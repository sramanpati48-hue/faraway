"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import type { Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import type { FirebaseApp } from "firebase/app";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const isBrowser = typeof window !== "undefined";
const missingConfigKeys = Object.entries(firebaseConfig)
    .filter(([, value]) => typeof value !== "string" || value.length === 0)
    .map(([key]) => key);

const hasConfig = missingConfigKeys.length === 0;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isBrowser && hasConfig) {
    try {
        app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
        auth = app ? getAuth(app) : null;
        db = app ? getFirestore(app) : null;
    } catch {
        // Safe fallback if Firebase config is invalid in local mode
        app = null;
        auth = null;
        db = null;
    }
}

export { app, auth, db };
