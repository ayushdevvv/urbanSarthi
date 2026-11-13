import assert from 'node:assert/strict';
import fs from 'node:fs';

const publicRouting = fs.readFileSync(new URL('./src/services/publicRouting.js', import.meta.url), 'utf8');
const routePlanner = fs.readFileSync(new URL('./src/pages/citizen/RoutePlannerPage.jsx', import.meta.url), 'utf8');
const traffic = fs.readFileSync(new URL('./src/pages/citizen/TrafficConditionsPage.jsx', import.meta.url), 'utf8');
const aqi = fs.readFileSync(new URL('./src/pages/citizen/AirQualityPage.jsx', import.meta.url), 'utf8');

assert(publicRouting.includes("import { api } from './api/client.js'"), 'The location service must share the configured API client.');
assert(publicRouting.includes('/routing/geocode'), 'Place search must call the backend geocode route.');
assert(!publicRouting.includes('fetch('), 'The browser must not call Nominatim, Photon, OSRM or Valhalla directly.');
assert(publicRouting.includes("data_quality: 'estimated'") && publicRouting.includes('coordinates: []'), 'Fallback estimates must not draw fabricated route geometry.');
assert(routePlanner.includes("api.post('/routing/plan'") && !routePlanner.includes('findPublicRoadRoutes'), 'Road route geometry must come from the configured backend.');
assert(traffic.includes('/routing/geocode') && !traffic.includes('searchPublicPlaces') && routePlanner.includes('/routing/geocode') && !routePlanner.includes('searchPublicPlaces') && aqi.includes('searchPublicPlaces'), 'Citizen route and traffic searches must use the proxied geocoder without browser-side third-party requests.');

console.log('✓ Geocoding and road routing use the configured UrbanSaarthi API; browser-side third-party CORS requests are removed.');
