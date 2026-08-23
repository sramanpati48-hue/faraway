const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type MockScam = {
  id?: string | number;
  title: string;
  description?: string;
  scam_type?: string;
  risk_level?: string;
  city?: string;
  lat: number;
  lon: number;
  timestamp?: string;
};

export type NearbyScamsResponse = {
  status: string;
  city?: string;
  state?: string;
  location_string?: string;
  scams: MockScam[];
};

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchNearbyScams(lat: number, lon: number): Promise<NearbyScamsResponse> {
  const res = await fetch(`${API_URL}/api/scams/nearby?lat=${lat}&lon=${lon}`);
  if (!res.ok) throw new Error("Failed to fetch nearby scams");
  const data = (await res.json()) as NearbyScamsResponse;
  return {
    ...data,
    scams: (data.scams || [])
      .map((s) => ({
        ...s,
        lat: Number(s.lat),
        lon: Number(s.lon),
      }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)),
  };
}

/** Nearest / freshest scams within radius; falls back to nearest nationally. */
export function pickAreaScamAlerts(
  scams: MockScam[],
  userLat: number,
  userLon: number,
  opts?: { radiusKm?: number; limit?: number }
): Array<MockScam & { distanceKm: number }> {
  const radiusKm = opts?.radiusKm ?? 75;
  const limit = opts?.limit ?? 5;

  const ranked = scams
    .map((s) => ({ ...s, distanceKm: haversineKm(userLat, userLon, s.lat, s.lon) }))
    .sort((a, b) => {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
      const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
      return tb - ta;
    });

  const nearby = ranked.filter((s) => s.distanceKm <= radiusKm);
  return (nearby.length > 0 ? nearby : ranked).slice(0, limit);
}

export function formatDistanceLabel(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

export function scamHeatmapHref(scam: Pick<MockScam, "lat" | "lon" | "title">): string {
  const params = new URLSearchParams({
    scamLat: String(scam.lat),
    scamLon: String(scam.lon),
    scamTitle: scam.title || "",
  });
  return `/scam-heatmap?${params.toString()}`;
}
