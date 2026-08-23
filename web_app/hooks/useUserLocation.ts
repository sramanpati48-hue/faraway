"use client";

import { useEffect, useState } from "react";
import {
  fetchNearbyScams,
  formatDistanceLabel,
  pickAreaScamAlerts,
  scamHeatmapHref,
} from "@/lib/scamsApi";
import {
  getUserLocationQuietly,
  subscribeToLocationDenied,
  subscribeToUserLocation,
  type UserLocation,
} from "@/lib/userLocation";

export type QuietLocationStatus = "loading" | "ready" | "idle" | "denied" | "unavailable";

export function useQuietUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [status, setStatus] = useState<QuietLocationStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }

    void (async () => {
      const loc = await getUserLocationQuietly();
      if (cancelled) return;
      if (loc) {
        setLocation(loc);
        setStatus("ready");
      } else {
        setStatus("idle");
      }
    })();

    const unsubGranted = subscribeToUserLocation((loc) => {
      setLocation(loc);
      setStatus("ready");
    });
    const unsubDenied = subscribeToLocationDenied(() => {
      setStatus((prev) => (prev === "ready" ? prev : "denied"));
    });

    return () => {
      cancelled = true;
      unsubGranted();
      unsubDenied();
    };
  }, []);

  return { location, status };
}

export type NearbyScamAlert = {
  id: string;
  title: string;
  message: string;
  time: string;
  type: "scam" | "location";
  read: boolean;
  href?: string;
  payload?: string;
};

export function useNearbyScamAlerts() {
  const { location, status: locationStatus } = useQuietUserLocation();
  const [scamNotifications, setScamNotifications] = useState<NearbyScamAlert[]>([]);
  const [areaLabel, setAreaLabel] = useState<string | null>(null);

  useEffect(() => {
    if (locationStatus === "unavailable") {
      setScamNotifications([
        {
          id: "location-unavailable",
          title: "Location unavailable",
          message: "Open the scam heatmap to browse active scams across India.",
          time: "Just now",
          type: "location",
          read: false,
          href: "/scam-heatmap",
        },
      ]);
      return;
    }

    if (locationStatus === "denied") {
      setScamNotifications([
        {
          id: "location-denied",
          title: "Allow location for local scam alerts",
          message:
            "Enable location access to see scams around you, or browse the national heatmap.",
          time: "Just now",
          type: "location",
          read: false,
          href: "/scam-heatmap",
        },
      ]);
      return;
    }

    if (locationStatus === "loading" || locationStatus === "idle" || !location) {
      setScamNotifications([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchNearbyScams(location.lat, location.lng);
        if (cancelled) return;
        const area =
          data.city && data.city !== "Unknown"
            ? data.city
            : data.location_string || data.state || null;
        setAreaLabel(area);

        const alerts = pickAreaScamAlerts(data.scams || [], location.lat, location.lng, {
          radiusKm: 75,
          limit: 5,
        });

        if (alerts.length === 0) {
          setScamNotifications([
            {
              id: "scam-empty",
              title: area ? `No scams near ${area}` : "No nearby scam alerts",
              message: "Open the heatmap to explore tracked scams nationwide.",
              time: "Just now",
              type: "scam",
              read: true,
              href: "/scam-heatmap",
            },
          ]);
          return;
        }

        setScamNotifications(
          alerts.map((scam, index) => {
            const city = scam.city || area || "your area";
            const titleText =
              scam.title.length > 90 ? `${scam.title.slice(0, 90)}…` : scam.title;
            return {
              id: `scam-${scam.id ?? index}-${scam.lat}-${scam.lon}`,
              title: `Scam near ${city}`,
              message: `${titleText} · ${formatDistanceLabel(scam.distanceKm)}${
                scam.risk_level ? ` · ${scam.risk_level} risk` : ""
              }`,
              time: formatDistanceLabel(scam.distanceKm),
              type: "scam" as const,
              read: false,
              href: scamHeatmapHref(scam),
              payload: JSON.stringify({
                lat: scam.lat,
                lon: scam.lon,
                title: scam.title,
              }),
            };
          })
        );
      } catch {
        if (cancelled) return;
        setScamNotifications([
          {
            id: "scam-fetch-error",
            title: "Could not load scam alerts",
            message: "Open the scam heatmap to browse alerts manually.",
            time: "Just now",
            type: "scam",
            read: false,
            href: "/scam-heatmap",
          },
        ]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location, locationStatus]);

  return { scamNotifications, setScamNotifications, areaLabel, locationStatus };
}
