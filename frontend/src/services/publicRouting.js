import { api } from './api/client.js';

const ROUTE_CO2_G_PER_KM = 149.26; // transparent passenger-petrol comparison proxy

/**
 * All public map lookups are proxied through the configured UrbanSaarthi API.
 * This keeps Nominatim / Photon and road-router requests off the browser origin,
 * avoiding third-party CORS preflights and centralising provider timeouts.
 */
export async function searchPublicPlaces(query, limit = 5) {
  const clean = String(query || '').trim();
  if (clean.length < 2) return [];
  const safeLimit = Math.max(1, Math.min(8, Number(limit) || 5));
  const response = await api.get(
    `/routing/geocode?q=${encodeURIComponent(clean)}&limit=${safeLimit}`,
    { timeoutMs: 13000, fallbackGraceMs: 2500 },
  );
  return Array.isArray(response?.results) ? response.results : [];
}

function estimateCo2(distanceMeters, mode) {
  if (mode === 'walking' || mode === 'cycling') return 0;
  if (mode !== 'driving') return null;
  return Math.round((Number(distanceMeters) / 1000) * ROUTE_CO2_G_PER_KM * 10) / 10;
}

function haversineMeters(a, b) {
  const radians = (value) => value * Math.PI / 180;
  const [lon1, lat1] = a, [lon2, lat2] = b;
  const dLat = radians(lat2 - lat1), dLon = radians(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Last-resort metric only. It deliberately contains no route geometry. */
export function estimateRouteOnly(origin, destination, mode = 'driving', reason = 'Road-routing providers are unavailable.') {
  if (!origin || !destination) return null;
  const directMeters = haversineMeters(
    [Number(origin.longitude), Number(origin.latitude)],
    [Number(destination.longitude), Number(destination.latitude)],
  );
  if (!Number.isFinite(directMeters) || directMeters < 20) return null;
  const multiplier = ({ driving: 1.28, walking: 1.10, cycling: 1.16 })[mode];
  const speedKmh = ({ driving: 28, walking: 4.5, cycling: 15 })[mode];
  if (!multiplier || !speedKmh) return null;
  const distanceMeters = Math.round(directMeters * multiplier);
  const durationSeconds = Math.max(60, Math.round(distanceMeters / 1000 / speedKmh * 3600));
  return {
    id: `estimate-${mode}-${Math.round(distanceMeters)}`,
    label: 'Distance and time estimate',
    mode,
    duration_seconds: durationSeconds,
    distance_meters: distanceMeters,
    traffic_delay_seconds: 0,
    pollution_score: null,
    estimated_aqi: null,
    estimated_co2_grams: estimateCo2(distanceMeters, mode),
    transfers: 0,
    provider: 'UrbanSaarthi estimate',
    data_quality: 'estimated',
    geometry: { type: 'LineString', coordinates: [] },
    itinerary: { note: 'Approximate distance and time only. Turn-by-turn road geometry is not available.' },
    warnings: [reason, 'No route line is drawn for this estimate. Open Google Maps to calculate a mapped journey.'],
  };
}
