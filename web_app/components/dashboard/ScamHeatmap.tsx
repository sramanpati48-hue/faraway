"use client";

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { AlertTriangle, MapPin, ShieldAlert, Loader2, X, Clock, Info } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { fetchNearbyScams, haversineKm, type MockScam } from '@/lib/scamsApi';
import { getUserLocationQuietly, subscribeToUserLocation } from '@/lib/userLocation';

interface ScamData {
  title: string;
  description: string;
  scam_type: string;
  risk_level: string;
  city: string;
  lat: number;
  lon: number;
  timestamp: string;
}

function toScamData(s: MockScam): ScamData {
  return {
    title: s.title || 'Untitled scam',
    description: s.description || '',
    scam_type: s.scam_type || 'Unknown',
    risk_level: s.risk_level || 'Medium',
    city: s.city || 'Unknown',
    lat: Number(s.lat),
    lon: Number(s.lon),
    timestamp: s.timestamp || '',
  };
}

function findDeepLinkedScam(
  scamData: ScamData[],
  targetLat: number,
  targetLon: number,
  targetTitle: string
): ScamData | undefined {
  const byDistance = scamData
    .map((s) => ({ s, km: haversineKm(targetLat, targetLon, s.lat, s.lon) }))
    .sort((a, b) => a.km - b.km)[0];
  if (byDistance && byDistance.km <= 0.5) return byDistance.s;
  const byTitle = scamData.find((s) => s.title === targetTitle);
  if (byTitle) return byTitle;
  return byDistance?.s;
}

export function ScamHeatmap() {
  const searchParams = useSearchParams();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [scams, setScams] = useState<ScamData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScam, setSelectedScam] = useState<ScamData | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    let cancelled = false;
    const INDIA_CENTER = { lat: 20.5937, lon: 78.9629 };

    void (async () => {
      const loc = await getUserLocationQuietly();
      if (cancelled) return;
      if (loc) loadNearbyScams(loc.lat, loc.lng);
      else loadNearbyScams(INDIA_CENTER.lat, INDIA_CENTER.lon);
    })();

    const unsub = subscribeToUserLocation((loc) => {
      if (cancelled) return;
      if (map.current) {
        map.current.flyTo({ center: [loc.lng, loc.lat], zoom: 10 });
        return;
      }
      loadNearbyScams(loc.lat, loc.lng);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const loadNearbyScams = async (lat: number, lon: number) => {
    try {
      setLoading(true);
      const data = await fetchNearbyScams(lat, lon);
      const scamsList = (data.scams || []).map(toScamData);
      setScams(scamsList);
      initializeMap(lat, lon, scamsList);
    } catch (err) {
      console.error(err);
      setError("Unable to load latest scam intelligence");
    } finally {
      setLoading(false);
    }
  };

  const initializeMap = (centerLat: number, centerLon: number, scamData: ScamData[]) => {
    if (map.current || !mapContainer.current) return;

    const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    const maptilerStyle = process.env.NEXT_PUBLIC_MAPTILER_STYLE || 'streets-v2';

    const defaultRasterStyle: maplibregl.StyleSpecification = {
      version: 8,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: [
            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
      },
      layers: [
        {
          id: 'osm-tiles-layer',
          type: 'raster',
          source: 'osm-tiles',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    };

    const styleUrl: string | maplibregl.StyleSpecification = maptilerKey
      ? `https://api.maptiler.com/maps/${maptilerStyle}/style.json?key=${maptilerKey}`
      : defaultRasterStyle;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: [centerLon, centerLat],
      zoom: 4.5,
      attributionControl: false,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      if (!map.current) return;

      // Add India Boundary Outline from local geojson
      map.current.addSource('india-boundary', {
        type: 'geojson',
        data: '/assets/india-osm.geojson'
      });

      map.current.addLayer({
        id: 'india-boundary-line',
        type: 'line',
        source: 'india-boundary',
        paint: {
          'line-color': '#00634B',
          'line-width': 1.5,
          'line-opacity': 0.6
        }
      });

      map.current.addLayer({
        id: 'india-boundary-fill',
        type: 'fill',
        source: 'india-boundary',
        paint: {
          'fill-color': '#00634B',
          'fill-opacity': 0.05
        }
      });

      // Prepare GeoJSON for scams
      const features = scamData.map((scam, i) => ({
        type: 'Feature' as const,
        properties: {
          id: i,
          title: scam.title,
          description: scam.description,
          scam_type: scam.scam_type,
          risk_level: scam.risk_level,
          city: scam.city,
          timestamp: scam.timestamp,
          mag: 1 // Base weight for heatmap
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [scam.lon, scam.lat]
        }
      }));

      const geojsonData: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features
      };

      map.current.addSource('scams', {
        type: 'geojson',
        data: geojsonData
      });

      // Add Heatmap layer
      map.current.addLayer({
        id: 'scams-heat',
        type: 'heatmap',
        source: 'scams',
        maxzoom: 9,
        paint: {
          // Increase weight based on magnitude
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'mag'], 0, 0, 1, 1],
          // Increase intensity as zoom level increases
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
          // Color ramp: blue (low) -> green -> red (high)
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(33,102,172,0)',
            0.2, 'rgb(103,169,207)',
            0.4, 'rgb(209,229,240)',
            0.6, 'rgb(253,219,199)',
            0.8, 'rgb(239,138,98)',
            1, 'rgb(178,24,43)'
          ],
          // Radius scales with zoom level
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 10, 9, 30],
          // Opacity decreases as zoom increases
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 9, 0]
        }
      });

      // Add Point layer active at all zoom levels for hovering
      map.current.addLayer({
        id: 'scams-point',
        type: 'circle',
        source: 'scams',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 7, 6, 15, 12],
          'circle-color': [
            'match',
            ['get', 'risk_level'],
            'High', '#FF1744',
            'Medium', '#FF9100',
            'Low', '#FFC400',
            /* other */ '#4CAF50'
          ],
          'circle-stroke-color': 'white',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 0, 0, 7, 2],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.1, 7, 1],
          'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0, 7, 1]
        }
      });

      // Popup initialization setup
      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'scam-popup',
        maxWidth: '300px'
      });

      map.current.on('mouseenter', 'scams-point', (e) => {
        if (!map.current || !e.features || e.features.length === 0) return;
        map.current.getCanvas().style.cursor = 'pointer';

        const coordinates = (e.features[0].geometry as GeoJSON.Point).coordinates.slice();
        const { title, scam_type, risk_level, city } = e.features[0].properties;

        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
          coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        const riskColor = risk_level === 'High' ? 'text-red-600' : risk_level === 'Medium' ? 'text-orange-500' : 'text-yellow-600';

        const popupHtml = `
          <div class="p-3 bg-white rounded-lg shadow-xl shadow-red-900/10 border border-gray-100">
            <div class="flex items-center gap-2 mb-2">
              <div class="p-1.5 bg-red-50 rounded-md">
                <span class="text-red-500 font-bold text-xs uppercase tracking-wider">${scam_type}</span>
              </div>
              <span class="text-xs font-semibold ${riskColor} px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100">
                ${risk_level} Risk
              </span>
            </div>
            <h4 class="font-bold text-gray-900 text-sm mb-1 line-clamp-2">${title}</h4>
            <div class="flex items-center gap-1.5 text-gray-500 text-xs">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 15.007 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
              <span>${city}</span>
            </div>
          </div>
        `;

        popupRef.current?.setLngLat([coordinates[0], coordinates[1]]).setHTML(popupHtml).addTo(map.current);
      });

      map.current.on('mouseleave', 'scams-point', () => {
        if (!map.current) return;
        map.current.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      });

      map.current.on('click', 'scams-point', (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties;
        const coordinates = (e.features[0].geometry as GeoJSON.Point).coordinates;
        setSelectedScam({
          title: props.title,
          description: props.description,
          scam_type: props.scam_type,
          risk_level: props.risk_level,
          city: props.city,
          lat: coordinates[1],
          lon: coordinates[0],
          timestamp: props.timestamp
        });
      });

      // Handle URL Parameters to auto-focus on a scam
      const scamLatParam = searchParams.get('scamLat');
      const scamLonParam = searchParams.get('scamLon');
      const scamTitleParam = searchParams.get('scamTitle');

      if (scamLatParam && scamLonParam) {
        const targetLat = parseFloat(scamLatParam);
        const targetLon = parseFloat(scamLonParam);
        const targetScam = findDeepLinkedScam(
          scamData,
          targetLat,
          targetLon,
          scamTitleParam || ''
        );

        if (targetScam) {
          map.current?.flyTo({
            center: [targetScam.lon, targetScam.lat],
            zoom: 12,
            essential: true,
            duration: 2000
          });

          setTimeout(() => {
            setSelectedScam(targetScam);
          }, 1500);
        } else if (Number.isFinite(targetLat) && Number.isFinite(targetLon)) {
          map.current?.flyTo({
            center: [targetLon, targetLat],
            zoom: 11,
            essential: true,
            duration: 2000
          });
        }
      }
    });
  };

  return (
    <div id="scam-heatmap" className="w-full bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 overflow-hidden">
      <div className="p-6 md:p-8 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-red-50 text-red-600 rounded-xl">
              <AlertTriangle size={24} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">
              Proactive Scam Intelligence
            </h2>
          </div>
          <p className="text-slate-600 text-sm">
            Live heatmap of active civil & cyber scams tracked in your region
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium">
          <div className="flex items-center gap-2 text-gray-600 bg-gray-50 px-4 py-2 rounded-full border border-gray-100">
            <MapPin size={16} className="text-[#00634B]" />
            <span>Active Tracking</span>
          </div>
          <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-2 rounded-full border border-red-100">
            <ShieldAlert size={16} />
            <span>{scams.length} Hotspots</span>
          </div>
        </div>
      </div>

      <div className="relative w-full h-[500px] bg-gray-50">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm z-10">
            <Loader2 className="w-10 h-10 text-[#00634B] animate-spin mb-4" />
            <p className="text-gray-600 font-medium">Initializing Threat Map...</p>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 text-center px-4">
            <AlertTriangle className="w-12 h-12 text-red-400 mb-3" />
            <h3 className="text-lg font-bold text-gray-900 mb-1">Map Unavailable</h3>
            <p className="text-gray-500">{error}</p>
          </div>
        )}
        
        <div ref={mapContainer} className="w-full h-full" />
      </div>

      <div className="bg-gray-900 text-white p-4 flex flex-wrap items-center justify-between text-xs sm:text-sm">
        <div className="flex items-center gap-4">
          <span className="text-gray-400">Risk Intensity:</span>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#2166ac]"></div>
            <span>Low</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#fddbc7]"></div>
            <span>Moderate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#b2182b]"></div>
            <span>Critical</span>
          </div>
        </div>
        <div className="text-gray-400 mt-2 sm:mt-0">
          Powered by MapTiler & OpenStreetMap
        </div>
      </div>

      {selectedScam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div 
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity cursor-pointer"
            onClick={() => setSelectedScam(null)}
          ></div>
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-start justify-between p-5 border-b border-gray-100 bg-gray-50/50">
               <div>
                  <div className="flex items-center gap-2 mb-2">
                     <span className="px-2.5 py-1 bg-red-100 text-red-700 text-xs font-bold uppercase tracking-wider rounded-md">
                        {selectedScam.scam_type}
                     </span>
                     <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${selectedScam.risk_level === 'High' ? 'bg-red-50 text-red-600 border-red-100' : selectedScam.risk_level === 'Medium' ? 'bg-orange-50 text-orange-600 border-orange-100' : 'bg-yellow-50 text-yellow-600 border-yellow-100'}`}>
                        {selectedScam.risk_level} Risk
                     </span>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 leading-tight pr-4">
                     {selectedScam.title}
                  </h3>
               </div>
               <button 
                 onClick={() => setSelectedScam(null)}
                 className="p-2 -mr-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors flex-shrink-0"
               >
                 <X size={20} />
               </button>
            </div>
            <div className="p-5 overflow-y-auto">
               <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 p-3 bg-blue-50/50 rounded-xl border border-blue-100/50">
                    <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-1">Incident Report</h4>
                      <p className="text-sm text-gray-600 leading-relaxed text-justify">
                        {selectedScam.description || "Detailed reports regarding this incident are currently unavailable. Authorities advise caution for interactions matching this general profile."}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-2">
                     <div className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-100 bg-gray-50/50">
                        <MapPin className="w-4 h-4 text-gray-400" />
                        <div className="flex flex-col">
                           <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Location</span>
                           <span className="text-sm font-medium text-gray-900 line-clamp-1">{selectedScam.city}</span>
                        </div>
                     </div>
                     <div className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-100 bg-gray-50/50">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <div className="flex flex-col">
                           <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Reported Time</span>
                           <span className="text-sm font-medium text-gray-900">
                             {selectedScam.timestamp ? new Date(selectedScam.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : "Recently"}
                           </span>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .scam-popup .maplibregl-popup-content {
          padding: 0;
          background: transparent;
          box-shadow: none;
        }
        .scam-popup .maplibregl-popup-tip {
          border-top-color: white;
        }
      `}} />
    </div>
  );
}
