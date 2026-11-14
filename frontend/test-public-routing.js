import assert from 'node:assert/strict';
import { estimateRouteOnly, findPublicRoadRoutes, searchPublicPlaces } from './src/services/publicRouting.js';

const originalFetch = globalThis.fetch;
const origin = { latitude: 26.8467, longitude: 80.9462 };
const destination = { latitude: 26.865, longitude: 80.97 };

function routeGeometry(offset) {
  const coordinates = [];
  for (let index = 0; index <= 24; index += 1) {
    const t = index / 24;
    const lon = origin.longitude + (destination.longitude - origin.longitude) * t;
    const lat = origin.latitude + (destination.latitude - origin.latitude) * t + offset * Math.sin(Math.PI * t);
    coordinates.push([lon, lat]);
  }
  return coordinates;
}

function routePayload(offset, distance = 4200, duration = 780) {
  return {
    code: 'Ok',
    routes: [{ distance, duration, geometry: { type: 'LineString', coordinates: routeGeometry(offset) } }],
  };
}

try {
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('routed-car')) return new Response(JSON.stringify(routePayload(0.002)), { status: 200 });
    if (url.includes('router.project-osrm.org')) return new Response(JSON.stringify(routePayload(-0.002, 4400, 840)), { status: 200 });
    if (url.includes('valhalla1.openstreetmap.de')) return new Response(JSON.stringify(routePayload(0.006, 4600, 900)), { status: 200 });
    throw new Error(`Unexpected routing request: ${url} ${options.method || 'GET'}`);
  };

  const alternatives = await findPublicRoadRoutes({ origin, destination, mode: 'driving' });
  assert.equal(alternatives.length, 3, 'Three distinct mapped routes should be combined when providers return divergent geometry.');
  assert(alternatives.every((route) => route.data_quality === 'road-network-route'), 'Every alternative must carry provider-generated road geometry.');
  assert(alternatives.every((route) => route.geometry.coordinates.length > 2), 'Every alternative must include a drawable road path.');
  assert(alternatives.every((route) => Number.isFinite(route.estimated_co2_grams)), 'Driving alternatives should have a distance-based CO2 estimate.');

  let transitRequests = 0;
  globalThis.fetch = async () => { transitRequests += 1; throw new Error('Transit should not call car/bike/foot router fallback.'); };
  const transitRoutes = await findPublicRoadRoutes({ origin, destination, mode: 'transit' });
  assert.equal(transitRoutes.length, 0, 'Transit must not be misrepresented as a car route.');
  assert.equal(transitRequests, 0, 'Unsupported transit route mode must not call the road router.');

  let geocoderCalls = [];
  globalThis.fetch = async (input) => {
    const url = String(input); geocoderCalls.push(url);
    if (url.includes('nominatim.openstreetmap.org')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('photon.komoot.io')) return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [80.9462, 26.8467] }, properties: { name: 'Lucknow', state: 'Uttar Pradesh', country: 'India' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`Unexpected geocoder request: ${url}`);
  };
  const geocoded = await searchPublicPlaces('Lucknow fallback check', 3);
  assert.equal(geocoded.length, 1, 'Photon should provide geocoding when Nominatim returns an empty result.');
  assert.equal(geocoded[0].latitude, 26.8467, 'Geocoder fallback must preserve latitude.');
  assert(geocoderCalls.some((url) => url.includes('photon.komoot.io')), 'Photon fallback endpoint must be queried after an empty Nominatim response.');

  const estimate = estimateRouteOnly(origin, destination, 'driving', 'Provider unavailable');
  assert.equal(estimate.data_quality, 'estimated', 'Last-resort route result must be labelled as an estimate.');
  assert.deepEqual(estimate.geometry.coordinates, [], 'Last-resort estimate must not draw a fabricated straight-line path.');
  assert(estimate.distance_meters > 0 && estimate.duration_seconds > 0, 'Last-resort estimate must still provide usable distance and time.');

  console.log('✓ Public routing combines distinct OSM road geometries, refuses fake transit paths, and returns a clearly labelled estimate when no router responds.');
} finally {
  globalThis.fetch = originalFetch;
}
