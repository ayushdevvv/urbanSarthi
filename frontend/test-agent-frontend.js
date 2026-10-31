// Source-level smoke tests for the AQI-first air and traffic workspace.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
};

console.log('--- RUNNING URBANSARTHI WORKSPACE SMOKE TESTS ---');
const app = read('src/App.jsx');
for (const [route, component] of [
  ['air-intelligence', 'AirQualityOverviewPage'], ['carbon', 'CarbonImpactPage'],
  ['iot', 'IotNetworkPage'], ['traffic', 'TrafficInfoPage'],
]) assert(app.includes(`path="${route}"`) && app.includes(`<${component}`), `${route} page must be registered`);
assert(app.includes('Navigate to="air-intelligence"'), 'Authority workspace must open on AQI overview');
console.log('✓ Air-first route structure verified');

const layout = read('src/components/layout/AuthorityLayout.jsx');
for (const target of ['/authority/air-intelligence', '/authority/carbon', '/authority/traffic', '/authority/iot']) {
  assert(layout.includes(target), `Navigation must include ${target}`);
}
assert(layout.includes('AIR QUALITY') && layout.includes('TRAFFIC') && layout.includes('FIELD DATA'), 'Navigation must separate air, traffic and field data');
assert(!layout.includes('API configuration'), 'Technical API configuration label must not be shown in the main navigation');
console.log('✓ Section navigation and user-facing labels verified');

const aqi = read('src/pages/authority/AirQualityOverviewPage.jsx');
assert(aqi.includes('loadLocationAirQuality'), 'AQI overview must use the API plus direct provider fallback');
for (const endpoint of ['/aqi/nearby', '/air-intelligence/hotspots']) assert(aqi.includes(endpoint), `AQI overview must use ${endpoint}`);
for (const feature of ['AqiDial', 'AirTrend', 'PM2.5', 'Nearby sensor network', 'Priority locations']) assert(aqi.includes(feature), `AQI overview must include ${feature}`);
console.log('✓ AQI-centred overview and visualisations verified');

const carbon = read('src/pages/authority/CarbonImpactPage.jsx');
assert(carbon.includes('/air-intelligence/emissions/estimate'), 'Carbon workspace must use the emissions estimator');
assert(carbon.includes('result.by_class'), 'Carbon workspace must render vehicle-class emissions');
assert(carbon.includes('CO₂') && carbon.includes('NOx') && carbon.includes('PM'), 'Carbon workspace must report multiple pollutants');
console.log('✓ Carbon and pollutant estimator verified');

const iot = read('src/pages/authority/IotNetworkPage.jsx');
assert(iot.includes("api.get('/aqi/observations?max_age_hours=720&limit=200')"), 'IoT page must retrieve stored observations');
assert(iot.includes("api.post('/aqi/observations', payload)"), 'IoT page must submit sensor observations to backend');
assert(iot.includes("aqi: ''") && iot.includes("form.aqi !== ''"), 'IoT sensor must not invent AQI when only particulate readings are supplied');
assert(iot.includes('HTTP ingestion available') && iot.includes('does not currently run an MQTT broker'), 'IoT transport and limits must be explicit');
console.log('✓ IoT observation ingestion and device registry verified');


const trafficInfo = read('src/pages/citizen/TrafficInfoPage.jsx');
assert(trafficInfo.includes('setScenarioData(null); setProvider(null); setLastUpdated(null);') && trafficInfo.includes('const isServiceFailure = !err?.status || err.status >= 500'), 'Old traffic scenario data is hidden during live refresh and local recovery is reserved for service failures');
const carbonPage = read('src/pages/authority/CarbonImpactPage.jsx');
assert(!carbonPage.includes('readLocalRecord(\'carbon-last-estimate\')') && carbonPage.includes('setResult(null);'), 'Old carbon results must not appear as initial fallback before the current estimate request');
const traffic = read('src/pages/citizen/TrafficVisionPage.jsx');
assert(traffic.includes('/traffic-detection/analyze-video'), 'Traffic Lab must call the video-analysis API');
assert(traffic.includes('/traffic-detection/ops-workflow'), 'Traffic Lab must call the operations workflow');
assert(traffic.includes('approach_rois'), 'Traffic Lab must support camera ROI calibration');
assert(traffic.includes('saveLatestVisionEvidence'), 'Traffic Lab must hand vehicle counts to the emissions estimator');
const evidenceStore = read('src/services/visionEvidence.js');
assert(evidenceStore.includes('airtraffic.latestVisionEvidence') && evidenceStore.includes('LEGACY_STORAGE_KEY'), 'Video evidence storage must use the neutral key and preserve existing saved evidence');
console.log('✓ Existing traffic video and operations workflow preserved');
const html = read('index.html');
const brand = read('src/components/shared/BrandMark.jsx');
assert(html.includes('href="/favicon.png"') && !html.includes('href="/favicon.svg"'), 'PNG favicon must be linked in the browser shell');
assert(brand.includes('src="/favicon.png"') && !brand.includes('.svg'), 'PNG favicon must be used by shared branding');
assert(fs.existsSync(path.join(root, 'public/favicon.png')), 'Linked PNG favicon must exist in the public assets');
const routePlanner = read('src/pages/citizen/RoutePlannerPage.jsx');
assert(routePlanner.includes('buildGoogleMapsUrl') && routePlanner.includes('routeOptions'), 'Route planner must link each mapped route to Google Maps and draw alternatives');
assert(routePlanner.includes('slice(0, 3)') && routePlanner.includes('3 road routes mapped'), 'Route planner must expose a three-route comparison state');
assert(routePlanner.includes('String.fromCharCode(65 + index)') || routePlanner.includes('Route A'), 'Route planner should label distinct road alternatives');
assert(routePlanner.includes('route-carbon-grid') && routePlanner.includes('route-emission-card'), 'Each route alternative must have a dedicated premium carbon card');
assert(routePlanner.includes('sortRouteOptions') && routePlanner.includes('const displayRoutes'), 'Route cards and map must use one preference-sorted route order');
assert(routePlanner.includes('setResult(null); setSelectedRouteId(null);') && routePlanner.includes('Checking live road-routing providers'), 'Old route data must be hidden while fresh route providers are queried');
assert(routePlanner.includes('Lowest CO₂') && routePlanner.includes('vs lowest') && routePlanner.includes('formatCO2'), 'Route cards must compare route-specific CO2 estimates');
const routeStyles = read('src/styles/citizen.css');
assert(routeStyles.includes('.route-carbon-grid') && routeStyles.includes('.route-emission-card') && routeStyles.includes('@media(max-width:700px){.route-carbon-grid{grid-template-columns:1fr'), 'Route carbon cards must have responsive premium styling');
const cityMap = read('src/components/maps/CityMap.jsx');
assert(cityMap.includes('routeOptions') && cityMap.includes('Polyline'), 'Map must render road-network route geometries');
const apiClient = read('src/services/api/client.js');
assert(apiClient.includes('cacheResponse') && apiClient.includes('readApiSnapshot'), 'API client must restore saved read responses during backend outages');
assert(apiClient.includes('timeoutMs = 60000') && apiClient.includes('response.status >= 500'), 'Live backend gets a startup grace period and cache is only used after a transport/server failure');
const dataBanner = read('src/components/shared/DataStatusBanner.jsx');
assert(dataBanner.includes('Showing your last saved update'), 'Cached response state must be visible and timestamped');
assert(dataBanner.includes('useState({})') && !dataBanner.includes('readDataStatusEvents'), 'Old outage banners must not appear before a request fails in the current session');
const forecast = read('src/pages/shared/AqiForecastPage.jsx');
assert(forecast.includes('loadLocationAirQuality'), 'Both portals must share the direct-provider AQI forecast fallback');
const trafficCss = read('src/pages/citizen/traffic-lab-premium.css');
assert(trafficCss.includes('--ul-panel:#101b13') && trafficCss.includes('--ul-green:#baf36b'), 'Traffic Lab must use the shared green palette');
console.log('✓ PNG favicon, multi-route map, Google Maps, carbon cards and outage recovery verified');
const apiSnapshots = read('src/services/apiSnapshot.js');
assert(!apiSnapshots.includes('STATUS_KEY') && apiSnapshots.includes('MAX_AGE_MS'), 'Only data snapshots persist; connection notices are session-scoped');
assert(apiSnapshots.includes('MAX_AGE_MS'), 'Local fallback records must expire instead of being treated as current forever');
const airQualityService = read('src/services/airQuality.js');
assert(airQualityService.includes('readApiSnapshot(apiPath)') && airQualityService.includes('savedApiSnapshot?.savedAt'), 'AQI fallback must preserve the original data timestamp');
assert(traffic.includes('compactReport(analyzedReport)') && traffic.includes('Last successful analysis') && traffic.includes('reportRestored'), 'Traffic Lab must persist compact historical evidence and clearly label restored reports');
assert(!traffic.includes("setReport(null); setWorkflow(null);"), 'Failed re-analysis must not erase the previous successful traffic report');
assert(layout.indexOf("to: '/authority/air-intelligence'") < layout.indexOf("to: '/authority/aqi-forecast'") && layout.indexOf("to: '/authority/aqi-forecast'") < layout.indexOf("to: '/authority/traffic-lab'") && layout.indexOf("to: '/authority/traffic-lab'") < layout.indexOf("to: '/authority/traffic-simulation'") && layout.indexOf("to: '/authority/traffic-simulation'") < layout.indexOf("to: '/authority/iot'"), 'Authority navigation must order AQI, forecast, Traffic Lab, simulation and IoT');
console.log('✓ Live-first loading, error-only fallback, route sorting, AQI provenance and workflow navigation verified');


// Runtime check: the live server response must win even when a local snapshot exists.
// The saved response is reachable only after a server/transport availability error.
const apiClientSource = read('src/services/api/client.js')
  .replace(/^import .*;\s*/gm, '')
  .replaceAll('import.meta.env.DEV', 'false')
  .replaceAll('import.meta.env.VITE_API_URL', 'undefined')
  .replaceAll('import.meta.env.VITE_API_BASE_URL', 'undefined')
  .replace(/^export /gm, '');
let snapshotReads = 0;
const runtimeFactory = new Function('readApiSnapshot', 'storeApiSnapshot', 'publishDataStatus', `${apiClientSource}\nreturn { request, ApiError };`);
const runtimeClient = runtimeFactory(
  () => { snapshotReads += 1; return { payload: { source: 'saved-snapshot' }, savedAt: Date.now() }; },
  () => {},
  () => {},
);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ source: 'live-backend' }), { status: 200, headers: { 'content-type': 'application/json' } });
  const liveResult = await runtimeClient.request('/healthz');
  assert(liveResult.source === 'live-backend' && snapshotReads === 0, 'Live backend data must be used before any saved fallback is read');

  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'backend unavailable' }), { status: 500, headers: { 'content-type': 'application/json' } });
  const savedResult = await runtimeClient.request('/routing/plan', { method: 'POST', body: '{}', cacheResponse: true });
  assert(savedResult.source === 'saved-snapshot' && snapshotReads === 1, 'A saved response must be used after a server error');

  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'invalid request' }), { status: 422, headers: { 'content-type': 'application/json' } });
  let validationRejected = false;
  try { await runtimeClient.request('/routing/plan', { method: 'POST', body: '{}', cacheResponse: true }); }
  catch (error) { validationRejected = error.status === 422; }
  assert(validationRejected && snapshotReads === 1, 'Validation errors must not be hidden by saved fallback data');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('✓ Runtime test confirms live-first API responses and error-only cached fallback');

console.log('--- ALL URBANSAARTHI SMOKE TESTS PASSED ---');
