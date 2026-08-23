export const USER_LOCATION_KEY = "nyaya_user_location";
export const LOCATION_ASKED_KEY = "nyaya_location_asked";
export const LOCATION_GRANTED_EVENT = "nyaya:location-granted";
export const LOCATION_DENIED_EVENT = "nyaya:location-denied";

export type UserLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
};

export type GeolocationPermission = PermissionState | "unsupported";

export function readStoredUserLocation(): UserLocation | null {
  try {
    const raw = sessionStorage.getItem(USER_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserLocation>;
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number") return null;
    return {
      lat: parsed.lat,
      lng: parsed.lng,
      accuracy: typeof parsed.accuracy === "number" ? parsed.accuracy : undefined,
    };
  } catch {
    return null;
  }
}

export function persistUserLocation(location: UserLocation): void {
  try {
    sessionStorage.setItem(USER_LOCATION_KEY, JSON.stringify(location));
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOCATION_GRANTED_EVENT, { detail: location }));
  }
}

export function markLocationAsked(): void {
  try {
    sessionStorage.setItem(LOCATION_ASKED_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function wasLocationAsked(): boolean {
  try {
    return sessionStorage.getItem(LOCATION_ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

export async function getGeolocationPermissionState(): Promise<GeolocationPermission> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unsupported";
  }
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unsupported";
  }
}

function readGpsOnce(options?: PositionOptions): Promise<UserLocation> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      reject,
      options
    );
  });
}

/**
 * Returns coords without showing the browser permission prompt.
 * Uses session storage, or GPS only when the browser has already granted access.
 */
export async function getUserLocationQuietly(): Promise<UserLocation | null> {
  const stored = readStoredUserLocation();
  if (stored) return stored;
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return null;

  const state = await getGeolocationPermissionState();
  if (state !== "granted") return null;

  try {
    const loc = await readGpsOnce({
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 5 * 60 * 1000,
    });
    persistUserLocation(loc);
    return loc;
  } catch {
    return null;
  }
}

/**
 * Explicit user-gesture path — the only call that may show the native prompt.
 */
export async function requestUserLocation(): Promise<UserLocation> {
  const loc = await readGpsOnce({
    enableHighAccuracy: false,
    timeout: 10000,
    maximumAge: 0,
  });
  persistUserLocation(loc);
  return loc;
}

export function notifyLocationDenied(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LOCATION_DENIED_EVENT));
  }
}

export function subscribeToUserLocation(onGranted: (location: UserLocation) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<UserLocation>).detail;
    if (detail) onGranted(detail);
  };
  window.addEventListener(LOCATION_GRANTED_EVENT, handler);
  return () => window.removeEventListener(LOCATION_GRANTED_EVENT, handler);
}

export function subscribeToLocationDenied(onDenied: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(LOCATION_DENIED_EVENT, onDenied);
  return () => window.removeEventListener(LOCATION_DENIED_EVENT, onDenied);
}
