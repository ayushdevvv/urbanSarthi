const ROUTING_TIMEOUT_MS = 6500;
const ROUTE_CO2_G_PER_KM = 149.26; // transparent passenger-petrol comparison proxy
const OSRM_BASES = {
  driving: ['https://routing.openstreetmap.de/routed-car', 'https://router.project-osrm.org'],
  walking: ['https://routing.openstreetmap.de/routed-foot'],
  cycling: ['https://routing.openstreetmap.de/routed-bike'],
};
const VALHALLA_BASES = ['https://valhalla1.openstreetmap.de'];
const placeCache = new Map();
let placeQueue = Promise.resolve();
let lastPlaceRequestAt = 0;

function withTimeout(fetcher, timeoutMs = ROUTING_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  return Promise.resolve().then(() => fetcher(controller.signal)).finally(() => globalThis.clearTimeout(timer));
}

function wait(ms) { return new Promise((resolve) => globalThis.setTimeout(resolve, ms)); }

/**
 * Explicit, user-submitted place lookups only. We intentionally do not call
 * Nominatim on every keystroke: its public service does not permit autocomplete
 * and asks clients to stay below one request per second.
 */
export async function searchPublicPlaces(query, limit = 5) {
  const clean = String(query || '').trim();
  if (clean.length < 2) return [];
  const cacheKey = clean.toLowerCase();
  const cached = placeCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.results;

  const task = placeQueue.then(async () => {
    const waitForSlot = Math.max(0, 1100 - (Date.now() - lastPlaceRequestAt));
    if (waitForSlot) await wait(waitForSlot);
    lastPlaceRequestAt = Date.now();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({ q: clean, format: 'jsonv2', addressdetails: '1', limit: String(Math.max(1, Math.min(5, limit))) });
    let results = [];
    try {
      const response = await withTimeout((signal) => fetch(url, {
        signal,
        headers: { Accept: 'application/json', 'Accept-Language': 'en' },
      }), 6500);
      if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
      const payload = await response.json();
      results = (Array.isArray(payload) ? payload : []).filter((item) => item.lat && item.lon).map((item) => ({
        label: item.display_name || clean,
        latitude: Number(item.lat),
        longitude: Number(item.lon),
        type: item.type,
        category: item.category,
        place_id: item.place_id,
        provider: 'OpenStreetMap Nominatim',
      }));
    } catch {
      // Try Photon only after the explicit Nominatim lookup fails.
    }
    if (!results.length) {
      const photonUrl = new URL('https://photon.komoot.io/api/');
      photonUrl.search = new URLSearchParams({ q: clean, limit: String(Math.max(1, Math.min(5, limit))) });
      const response = await withTimeout((signal) => fetch(photonUrl, {
        signal,
        headers: { Accept: 'application/json' },
      }), 6500);
      if (!response.ok) throw new Error(`Place search returned ${response.status}`);
      const payload = await response.json();
      results = (payload?.features || []).map((feature) => {
        const [longitude, latitude] = feature?.geometry?.coordinates || [];
        const props = feature?.properties || {};
        const label = [props.name, props.street, props.housenumber, props.district, props.city || props.town, props.state, props.country].filter(Boolean).join(', ');
        return { label: label || clean, latitude: Number(latitude), longitude: Number(longitude), type: props.type, category: props.osm_value, provider: 'Photon / OpenStreetMap' };
      }).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    }
    placeCache.set(cacheKey, { at: Date.now(), results });
    if (placeCache.size > 80) placeCache.delete(placeCache.keys().next().value);
    return results;
  });
  placeQueue = task.catch(() => {});
  return task;
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

/** Fallback metric only. It intentionally contains no route geometry. */
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

function decodePolyline(encoded, precision = 6) {
  if (typeof encoded !== 'string' || !encoded) return [];
  const factor = 10 ** precision;
  let index = 0, lat = 0, lon = 0;
  const points = [];
  while (index < encoded.length) {
    const deltas = [];
    for (let axis = 0; axis < 2; axis += 1) {
      let result = 0, shift = 0, byte;
      do {
        if (index >= encoded.length) return points;
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      deltas.push((result & 1) ? ~(result >> 1) : (result >> 1));
    }
    lat += deltas[0]; lon += deltas[1];
    points.push([lon / factor, lat / factor]);
  }
  return points;
}

function geometryCoordinates(geometry) {
  if (Array.isArray(geometry?.coordinates)) return geometry.coordinates;
  if (geometry?.type === 'Feature') return geometryCoordinates(geometry.geometry);
  if (typeof geometry === 'string') return decodePolyline(geometry, 6);
  return [];
}

function normalizeRoute(route, mode, provider, index) {
  const coordinates = geometryCoordinates(route?.geometry);
  const distance = Number(route?.distance);
  const duration = Number(route?.duration);
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !Number.isFinite(distance) || distance <= 0 || !Number.isFinite(duration) || duration <= 0) return null;
  const cleanCoordinates = coordinates.map((point) => [Number(point?.[0]), Number(point?.[1])])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
  if (cleanCoordinates.length < 2) return null;
  const fingerprint = cleanCoordinates.filter((_, pointIndex) => pointIndex % Math.max(1, Math.floor(cleanCoordinates.length / 8)) === 0)
    .slice(0, 8).map(([lon, lat]) => `${lon.toFixed(4)},${lat.toFixed(4)}`).join('|');
  return {
    id: `${mode}-${provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fingerprint}`,
    label: 'Mapped road alternative', mode,
    duration_seconds: Math.round(duration), distance_meters: distance,
    traffic_delay_seconds: 0, pollution_score: null, estimated_aqi: null,
    estimated_co2_grams: estimateCo2(distance, mode), transfers: 0,
    provider, data_quality: 'road-network-route',
    geometry: { type: 'LineString', coordinates: cleanCoordinates },
    itinerary: { provider_summary: 'Route geometry follows the provider’s mapped road network. Live traffic is not implied.' },
    warnings: ['Travel time is a mapped-network estimate; live traffic may not be included.'],
    provider_rank: index,
  };
}

function normalizeValhalla(payload, mode, provider) {
  const osrmRoutes = Array.isArray(payload?.routes) ? payload.routes : [];
  const normalized = osrmRoutes.map((route, index) => normalizeRoute(route, mode, provider, index)).filter(Boolean);
  if (normalized.length) return normalized;

  // Some public Valhalla deployments still return native trip JSON even when
  // OSRM-compatible format was requested. Support both response shapes.
  const trips = [];
  if (payload?.trip) trips.push(payload.trip);
  for (const alternate of payload?.alternates || []) trips.push(alternate?.trip || alternate);
  return trips.map((trip, index) => {
    const legs = Array.isArray(trip?.legs) ? trip.legs : [];
    if (!legs.length) return null;
    const coordinates = legs.flatMap((leg, legIndex) => {
      const shape = decodePolyline(leg?.shape || '', 6);
      return legIndex ? shape.slice(1) : shape;
    });
    const summary = trip.summary || {};
    const distanceKm = Number(summary.length ?? summary.distance);
    const duration = Number(summary.time ?? summary.duration);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(duration) || duration <= 0) return null;
    return normalizeRoute({ distance: distanceKm * 1000, duration, geometry: { type: 'LineString', coordinates } }, mode, provider, index);
  }).filter(Boolean);
}

function sampleCoordinates(route, count = 32) {
  const coordinates = route?.geometry?.coordinates || [];
  if (coordinates.length < 2) return [];
  return Array.from({ length: count }, (_, index) => {
    const point = coordinates[Math.round(index * (coordinates.length - 1) / (count - 1))];
    return [Number(point[0]), Number(point[1])];
  }).filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
}

function isDistinct(candidate, accepted) {
  const points = sampleCoordinates(candidate);
  if (points.length < 3) return false;
  return accepted.every((route) => {
    const other = sampleCoordinates(route);
    if (other.length < 3) return true;
    const near = points.filter((point) => Math.min(...other.map((otherPoint) => haversineMeters(point, otherPoint))) <= 30).length;
    // Keep alternatives that share most main roads but diverge for a meaningful
    // segment. Reject only virtually identical paths from different providers.
    return near / points.length < 0.965;
  });
}

function detourWaypoints(origin, destination) {
  const lat1 = Number(origin.latitude), lon1 = Number(origin.longitude);
  const lat2 = Number(destination.latitude), lon2 = Number(destination.longitude);
  const midLat = (lat1 + lat2) / 2;
  const cosLat = Math.max(0.2, Math.abs(Math.cos(midLat * Math.PI / 180)));
  const dx = (lon2 - lon1) * cosLat, dy = lat2 - lat1;
  const norm = Math.hypot(dx, dy);
  if (!Number.isFinite(norm) || norm < 1e-8) return [];
  const directMeters = haversineMeters([lon1, lat1], [lon2, lat2]);
  const perpX = -dy / norm, perpY = dx / norm;
  const offsets = [Math.max(150, Math.min(700, directMeters * 0.10)), Math.max(300, Math.min(1500, directMeters * 0.22))];
  return [[0.34, 1, 0], [0.52, -1, 0], [0.67, 1, 0], [0.40, -1, 1], [0.62, 1, 1], [0.76, -1, 1]]
    .map(([fraction, side, scale]) => ({
      latitude: lat1 + (lat2 - lat1) * fraction + side * perpY * offsets[scale] / 111000,
      longitude: lon1 + (lon2 - lon1) * fraction + side * perpX * offsets[scale] / (111000 * cosLat),
    }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}

async function requestOsrm(base, coords, mode) {
  const url = `${base}/route/v1/driving/${coords}`;
  const query = new URLSearchParams({ alternatives: '3', overview: 'full', geometries: 'geojson', steps: 'false' });
  const response = await withTimeout((signal) => fetch(`${url}?${query}`, {
    signal,
    headers: { Accept: 'application/json', 'X-Client-Id': 'UrbanSaarthi' },
  }));
  if (!response.ok) throw new Error(`OSRM returned ${response.status}`);
  const payload = await response.json();
  if (payload?.code && payload.code !== 'Ok') throw new Error(payload.message || `OSRM returned ${payload.code}`);
  return (payload?.routes || []).map((route, index) => normalizeRoute(route, mode, 'OpenStreetMap OSRM', index)).filter(Boolean);
}

async function requestValhalla(origin, destination, mode, options = {}) {
  const costing = ({ driving: 'auto', walking: 'pedestrian', cycling: 'bicycle' })[mode];
  if (!costing) return [];
  const locations = [
    { lat: Number(origin.latitude), lon: Number(origin.longitude), type: 'break' },
    ...(options.via ? [{ lat: Number(options.via.latitude), lon: Number(options.via.longitude), type: 'through' }] : []),
    { lat: Number(destination.latitude), lon: Number(destination.longitude), type: 'break' },
  ];
  const requests = VALHALLA_BASES.map(async (base) => {
    const response = await withTimeout((signal) => fetch(`${base}/route`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Client-Id': 'UrbanSaarthi' },
      body: JSON.stringify({
        locations, costing, units: 'kilometers', format: 'osrm', shape_format: 'geojson', directions_type: 'none',
        alternates: options.via ? 0 : 3,
        ...(options.costingOptions ? { costing_options: { [costing]: options.costingOptions } } : {}),
      }),
    }));
    if (!response.ok) throw new Error(`Valhalla returned ${response.status}`);
    return normalizeValhalla(await response.json(), mode, 'Valhalla / OpenStreetMap');
  });
  const results = await Promise.allSettled(requests);
  return results.flatMap((item) => item.status === 'fulfilled' ? item.value : []);
}

/**
 * Find up to three distinct road-following alternatives from public OSM networks.
 * Providers may return fewer alternatives; no straight-line geometry is fabricated.
 */
export async function findPublicRoadRoutes({ origin, destination, mode = 'driving' }) {
  if (!origin || !destination || !Number.isFinite(Number(origin.latitude)) || !Number.isFinite(Number(destination.latitude)) || !Number.isFinite(Number(origin.longitude)) || !Number.isFinite(Number(destination.longitude))) {
    throw new Error('Valid origin and destination coordinates are required.');
  }
  if (!OSRM_BASES[mode]) return [];
  const coords = `${Number(origin.longitude)},${Number(origin.latitude)};${Number(destination.longitude)},${Number(destination.latitude)}`;
  const primaryRequests = [
    ...OSRM_BASES[mode].map((base) => requestOsrm(base, coords, mode)),
    requestValhalla(origin, destination, mode),
  ];
  const primaryResults = await Promise.allSettled(primaryRequests);
  const candidates = [];
  const addRoutes = (routes) => {
    for (const route of routes || []) {
      if (isDistinct(route, candidates)) candidates.push(route);
      if (candidates.length >= 3) break;
    }
  };
  for (const item of primaryResults) if (item.status === 'fulfilled') addRoutes(item.value);

  // Valhalla alternates are best-effort. Try road-snapped via-points when the
  // initial engines provide too few materially different options.
  if (candidates.length < 3) {
    const waypoints = detourWaypoints(origin, destination).slice(0, 4);
    const detourResults = await Promise.allSettled(waypoints.map((via) => requestValhalla(origin, destination, mode, { via })));
    for (const item of detourResults) if (item.status === 'fulfilled') addRoutes(item.value);
  }
  return candidates.slice(0, 3);
}
