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
assert(app.includes('Navigate to="control"'), 'Authority workspace must open on City overview');
console.log('✓ Air-first route structure verified');

const layout = read('src/components/layout/AuthorityLayout.jsx');
for (const target of ['/authority/control', '/authority/air-intelligence', '/authority/iot', '/authority/traffic-lab', '/authority/traffic-agent', '/authority/traffic-simulation']) {
  assert(layout.includes(target), `Navigation must include ${target}`);
}
assert(layout.includes('OVERVIEW') && layout.includes('AIR QUALITY') && layout.includes('FIELD NETWORK') && layout.includes('TRAFFIC'), 'Navigation must group overview, AQI, IoT and traffic');
assert(layout.indexOf("to: '/authority/control'") < layout.indexOf("to: '/authority/air-intelligence'") && layout.indexOf("to: '/authority/air-intelligence'") < layout.indexOf("to: '/authority/iot'") && layout.indexOf("to: '/authority/iot'") < layout.indexOf("to: '/authority/traffic-lab'") && layout.indexOf("to: '/authority/traffic-lab'") < layout.indexOf("to: '/authority/traffic-agent'") && layout.indexOf("to: '/authority/traffic-agent'") < layout.indexOf("to: '/authority/traffic-simulation'"), 'Admin navigation order must be Overview → AQI → IoT → Traffic');
assert(!layout.includes("to: '/authority/signals'") && !layout.includes("to: '/authority/analytics'") && !layout.includes("to: '/authority/traffic-analysis'"), 'Removed standalone Signal Plans and Traffic Analysis must not appear in navigation');
assert(!layout.includes('API configuration'), 'Technical API configuration label must not be shown in the main navigation');
console.log('✓ Section navigation and user-facing labels verified');
const shellCss = read('src/styles/app-shell-refinement.css');
assert(shellCss.includes('.authority-app .sidebar') && shellCss.includes('.citizen-app .citizen-header') && shellCss.includes('.citizen-app .citizen-nav-item.active'), 'Shared authority sidebar and citizen navigation must receive the app-wide responsive theme');
assert(layout.includes('aria-expanded={mobileOpen}') && layout.includes('aria-controls=\"authority-sidebar\"') && layout.includes('useEffect(() => { setMobileOpen(false); }, [location.pathname])'), 'Authority mobile navigation must be accessible and close after route navigation');
const citizenLayout = read('src/components/layout/CitizenLayout.jsx');
assert(citizenLayout.includes('aria-label=\"Citizen navigation\"') && citizenLayout.includes('aria-label={dark ?'), 'Citizen navigation and utility controls must be accessible');
const appContext = read('src/context/AppContext.jsx');
assert(appContext.includes('useState(false)') && !appContext.includes("getItem('us_theme')"), 'The green light theme must be the default after refresh, not an old persisted dark preference');
assert(app.includes('RouteScrollReset') && app.includes('window.scrollTo'), 'Navigation between pages must reset scroll position');

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
assert(traffic.includes('/authority/traffic-agent') && !traffic.includes('/traffic-detection/ops-workflow'), 'Traffic Lab must hand the workflow to a separate Traffic Agent page');
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
assert(routePlanner.includes("lastAutoKey.current = '';") && routePlanner.includes('planRunRef.current += 1;') && !routePlanner.includes('destination.resolved, mode, preference]'), 'Editing or swapping locations must cancel stale route requests; sorting preferences must not refetch the route network.');
assert(routePlanner.includes('setResult(null); setSelectedRouteId(null);') && routePlanner.includes('Checking live road-routing providers'), 'Old route data must be hidden while fresh route providers are queried');
assert(routePlanner.includes('Promise.all([') && routePlanner.includes('resolveMappedPlace(originQuery)') && routePlanner.includes('resolveMappedPlace(destinationQuery)'), 'Route submit must resolve both typed endpoints together instead of stopping after the first unresolved place');
assert(routePlanner.includes('estimateRouteOnly(') && routePlanner.includes('No road path is available for this estimate'), 'If road routing is unavailable, return an honest estimate without drawing a fake path');
assert(routePlanner.includes('Lowest CO₂') && routePlanner.includes('vs lowest') && routePlanner.includes('formatCO2'), 'Route cards must compare route-specific CO2 estimates');
const routeStyles = read('src/styles/citizen.css');
assert(routeStyles.includes('.route-carbon-grid') && routeStyles.includes('.route-emission-card') && routeStyles.includes('@media(max-width:700px){.route-carbon-grid{grid-template-columns:1fr'), 'Route carbon cards must have responsive premium styling');
const publicRouting = read('src/services/publicRouting.js');
assert(publicRouting.includes('OSRM_BASES') && publicRouting.includes('requestValhalla') && publicRouting.includes('detourWaypoints'), 'Route fallback must query multiple OSM routers and forced road-network waypoints');
assert(publicRouting.includes("data_quality: 'road-network-route'") && publicRouting.includes('coordinates'), 'Fallback alternatives must use provider-returned road geometry');
const cityMap = read('src/components/maps/CityMap.jsx');
assert(cityMap.includes('routeOptions') && cityMap.includes('Polyline'), 'Map must render road-network route geometries');
const apiClient = read('src/services/api/client.js');
assert(apiClient.includes('cacheResponse') && apiClient.includes('readApiSnapshot'), 'API client must restore saved read responses during backend outages');
assert(apiClient.includes('DEFAULT_REQUEST_TIMEOUT_MS = 70_000') && apiClient.includes('FALLBACK_GRACE_MS = 40_000') && apiClient.includes('ATTEMPT_TIMEOUT_MS = 9_000') && apiClient.includes('fallbackDeadline') && apiClient.includes('waitForFallbackGrace(requestStartedAt, fallbackGraceMs)') && apiClient.includes("type: 'pending'"), 'Live backend is retried throughout the 40-second window before any saved snapshot is restored');
const dataBanner = read('src/components/shared/DataStatusBanner.jsx');
assert(dataBanner.includes('Showing the last successful update'), 'Cached response state must be visible and timestamped');
assert(dataBanner.includes("detail.type === 'pending'") && dataBanner.includes('latestRequestByPath') && dataBanner.includes('setStatuses') && !dataBanner.includes('readDataStatusEvents'), 'Outage banner must track each endpoint separately and ignore out-of-order responses');
assert(!fs.existsSync(path.join(root, 'src/pages/shared/AqiForecastPage.jsx')), 'The duplicate standalone AQI forecast page must be removed');
const airQualitySource = read('src/pages/citizen/AirQualityPage.jsx');
assert(airQualitySource.includes('loadLocationAirQuality') && airQualitySource.includes('searchPublicPlaces'), 'Combined AQI page must include forecast data and geocoder fallback');
const trafficCss = read('src/pages/citizen/traffic-lab-premium.css');
assert(trafficCss.includes('--ul-panel:#ffffff') && trafficCss.includes('--ul-green:#6e984b') && trafficCss.includes('color-scheme:light') && trafficCss.includes('background:#f4f7f0'), 'Traffic Lab must use the same light-green theme as the app');
const trafficAgent = read('src/pages/authority/TrafficAgentPage.jsx');
assert(app.includes('path="traffic-agent"') && app.includes('<TrafficAgentPage'), 'Traffic Agent must be a separate authority route');
assert(trafficAgent.includes('/traffic-detection/ops-workflow') && trafficAgent.includes('runWorkflow'), 'Separate Traffic Agent page must execute the real operations workflow endpoint');
assert(trafficAgent.includes('autoStarted.current') && trafficAgent.includes('api.post') && trafficAgent.includes('!report.preview_only'), 'Traffic Agent must auto-start only from genuine saved YOLO evidence and never submit local preview values');
assert(trafficAgent.includes('40000') && trafficAgent.includes('makeLocalPreview') && trafficAgent.includes('preview_only: true') && trafficAgent.includes('if (!workflowRef.current)'), 'Traffic Agent must reveal a local illustrative preview after the 40-second wait even while a slow request remains pending');
assert(trafficAgent.includes('activeToolIndex') && trafficAgent.includes('tools list') && trafficAgent.includes('IN PROGRESS'), 'Traffic Agent must show an active workflow progress indicator without claiming individual tools completed before response');
assert(trafficAgent.includes('Approve draft') && trafficAgent.includes('physical_dispatch_enabled'), 'Agent must retain operator approval and no physical dispatch safeguards');
assert(trafficAgent.includes('not inferred from this progress animation'), 'Agent must distinguish real tool results from the visual progress indicator');
assert(traffic.includes('setTimeout') && traffic.includes('40000') && traffic.includes('makeIllustrativeTrafficReport') && traffic.includes('preview_only: true') && traffic.includes('not sent to the Traffic Agent'), 'Traffic Lab must reveal a 40-second illustrative scene without treating it as YOLO evidence');
assert(traffic.includes("previewReport ? 'Illustrative traffic scenario'"), 'Traffic Lab must identify the local example as an illustrative scenario, not a completed YOLO inference');
const trafficAgentCss = read('src/pages/authority/traffic-agent.css');
assert(trafficAgentCss.includes('.ta-hero') && trafficAgentCss.includes('#2f6a49') && trafficAgentCss.includes('@media(max-width:560px)') && trafficAgentCss.includes('.ta-workstream-note'), 'Traffic Agent must have a responsive premium green theme and readable execution note');
console.log('✓ PNG favicon, multi-route map, Google Maps, carbon cards and outage recovery verified');
const apiSnapshots = read('src/services/apiSnapshot.js');
assert(!apiSnapshots.includes('STATUS_KEY') && apiSnapshots.includes('MAX_API_AGE_MS') && apiSnapshots.includes('MAX_LOCAL_RECORD_AGE_MS'), 'Only data snapshots persist; connection notices are session-scoped and have bounded retention');
assert(apiSnapshots.includes('api-snapshot:v3') && apiSnapshots.includes('MAX_API_AGE_MS = 6 * 60 * 60 * 1000'), 'New release must not reuse old API fallback snapshots and limits their age to six hours');
const airQualityService = read('src/services/airQuality.js');
assert(airQualityService.includes('readApiSnapshot(apiPath)') && airQualityService.includes('savedApiSnapshot?.savedAt'), 'AQI fallback must preserve the original data timestamp');
assert(traffic.includes('compactReport(analyzedReport)') && traffic.includes('Last successful analysis') && traffic.includes('reportRestored'), 'Traffic Lab must persist compact historical evidence and clearly label restored reports');
assert(!traffic.includes("setReport(null); setWorkflow(null);"), 'Failed re-analysis must not erase the previous successful traffic report');
assert(!layout.includes("to: '/authority/aqi-forecast'"), 'Authority forecast should stay integrated in the single AQI overview');
const airQualityPage = read('src/pages/citizen/AirQualityPage.jsx');
assert(airQualityPage.includes('air-aqi-outlook') && airQualityPage.includes('AirQualityTrend'), 'Citizen AQI page must combine current readings and the 24-hour outlook');
assert(!citizenLayout.includes("to: '/citizen/aqi-forecast'"), 'Citizen navigation must not show a separate duplicate AQI forecast destination');
assert(app.includes('path="aqi-forecast" element={<Navigate to="/citizen/air-quality"'), 'The old citizen AQI forecast URL must redirect into the combined AQI page');
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
let statusSequence = 0;
const runtimeFactory = new Function('readApiSnapshot', 'storeApiSnapshot', 'publishDataStatus', 'createDataStatusContext', `${apiClientSource}\nreturn { request, ApiError };`);
const runtimeClient = runtimeFactory(
  () => { snapshotReads += 1; return { payload: { source: 'saved-snapshot' }, savedAt: Date.now() }; },
  () => {},
  () => {},
  (routePath) => ({ routePath, requestId: ++statusSequence }),
);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ source: 'live-backend' }), { status: 200, headers: { 'content-type': 'application/json' } });
  const liveResult = await runtimeClient.request('/healthz');
  assert(liveResult.source === 'live-backend' && snapshotReads === 0, 'Live backend data must be used before any saved fallback is read');

  let wakeAttempts = 0;
  globalThis.fetch = async () => {
    wakeAttempts += 1;
    if (wakeAttempts === 1) return new Response(JSON.stringify({ detail: 'cold start' }), { status: 503, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ source: 'backend-woke-up' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const wakeResult = await runtimeClient.request('/healthz/wake-check', { fallbackGraceMs: 2000 });
  assert(wakeResult.source === 'backend-woke-up' && wakeAttempts === 2 && snapshotReads === 0, 'A backend that recovers during the live-first window must be retried and beat the saved snapshot');

  let graceElapsed = false;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'warming up' }), { status: 503, headers: { 'content-type': 'application/json' } });
  const graceStart = Date.now();
  const graceResult = await runtimeClient.request('/routing/grace-check', { method: 'POST', body: '{}', cacheResponse: true, fallbackGraceMs: 20 });
  graceElapsed = Date.now() - graceStart >= 20;
  assert(graceResult.source === 'saved-snapshot' && graceElapsed, 'A quick 5xx must wait through the live-first grace window before using a snapshot');
  assert(snapshotReads === 1, 'The grace-window fallback must read one snapshot only after the delay');

  const nonCacheStart = Date.now();
  globalThis.fetch = async () => { throw new Error('offline'); };
  let actionFailedFast = false;
  try { await runtimeClient.request('/agent/analyze', { method: 'POST', body: '{}', fallbackGraceMs: 5000 }); }
  catch (error) { actionFailedFast = error.status === 0 && Date.now() - nonCacheStart < 500; }
  assert(actionFailedFast && snapshotReads === 1, 'Non-cacheable agent/actions must fail fast without showing unrelated saved page snapshots');

  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'backend unavailable' }), { status: 500, headers: { 'content-type': 'application/json' } });
  const savedResult = await runtimeClient.request('/routing/plan', { method: 'POST', body: '{}', cacheResponse: true, fallbackGraceMs: 0 });
  assert(savedResult.source === 'saved-snapshot' && snapshotReads === 2, 'A saved response must be used after a server error');

  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'invalid request' }), { status: 422, headers: { 'content-type': 'application/json' } });
  let validationRejected = false;
  try { await runtimeClient.request('/routing/plan', { method: 'POST', body: '{}', cacheResponse: true, fallbackGraceMs: 0 }); }
  catch (error) { validationRejected = error.status === 422; }
  assert(validationRejected && snapshotReads === 2, 'Validation errors must not be hidden by saved fallback data');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('✓ Runtime test confirms live-first API responses and error-only cached fallback');

console.log('--- ALL URBANSAARTHI SMOKE TESTS PASSED ---');
