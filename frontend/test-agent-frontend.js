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
  ['iot', 'IotNetworkPage'], ['traffic-lab', 'TrafficVisionPage'],
]) assert(app.includes(`path="${route}"`) && app.includes(`<${component}`), `${route} page must be registered`);
assert(app.includes('<Route path="traffic-simulation" element={<TrafficSimulationPage />} />'), 'Authority simulation must use the native SUMO workbench');
assert(app.includes('<Route path="traffic" element={<TrafficConditionsPage />} />'), 'Citizen traffic conditions must use its own nearby-traffic page');
assert(app.includes('Navigate to="control"'), 'Authority workspace must open on City overview');
console.log('✓ Air-first route structure verified');

const layout = read('src/components/layout/AuthorityLayout.jsx');
assert(!layout.includes('requireAuth') && !layout.includes('/auth/login') && !layout.includes('Securing your workspace'), 'Authority workspace must open directly without a login gate');
for (const target of ['/authority/control', '/authority/air-intelligence', '/authority/carbon', '/authority/iot', '/authority/sources', '/authority/traffic-lab', '/authority/traffic-agent', '/authority/traffic-simulation', '/authority/analytics', '/authority/settings']) {
  assert(layout.includes(target), `Navigation must include ${target}`);
}
assert(layout.includes('OVERVIEW') && layout.includes('AIR QUALITY') && layout.includes('FIELD NETWORK') && layout.includes('TRAFFIC') && layout.includes('INSIGHTS & SYSTEM'), 'Navigation must group operational, air, field, traffic and insights sections');
assert(layout.indexOf("to: '/authority/control'") < layout.indexOf("to: '/authority/air-intelligence'") && layout.indexOf("to: '/authority/air-intelligence'") < layout.indexOf("to: '/authority/iot'") && layout.indexOf("to: '/authority/iot'") < layout.indexOf("to: '/authority/traffic-lab'") && layout.indexOf("to: '/authority/traffic-lab'") < layout.indexOf("to: '/authority/traffic-agent'") && layout.indexOf("to: '/authority/traffic-agent'") < layout.indexOf("to: '/authority/traffic-simulation'"), 'Admin navigation order must be Overview → AQI → IoT → Traffic');
assert(layout.includes("to: '/authority/analytics'") && layout.includes("to: '/authority/sources'") && layout.includes("to: '/authority/settings'"), 'Implemented insights, source registry and preferences pages must be reachable from navigation');
assert(!layout.includes("to: '/authority/signals'") && !layout.includes("to: '/authority/traffic-analysis'"), 'Legacy standalone Signal Plans and Traffic Analysis must remain consolidated into the Traffic Agent and Camera System');
assert(!layout.includes('API configuration'), 'Technical API configuration label must not be shown in the main navigation');
console.log('✓ Section navigation and user-facing labels verified');
const shellCss = read('src/styles/app-shell-refinement.css');
assert(shellCss.includes('.authority-app .sidebar') && shellCss.includes('.citizen-app .citizen-header') && shellCss.includes('.citizen-app .citizen-nav-item.active'), 'Shared authority sidebar and citizen navigation must receive the app-wide responsive theme');
assert(layout.includes('aria-expanded={mobileOpen}') && layout.includes('aria-controls=\"authority-sidebar\"') && layout.includes('useEffect(() => { setMobileOpen(false); }, [location.pathname])'), 'Authority mobile navigation must be accessible and close after route navigation');
const citizenLayout = read('src/components/layout/CitizenLayout.jsx');
assert((citizenLayout.match(/to: '\/citizen(?:\/[^']*)?'/g) || []).length === 5, 'Citizen sidebar must contain exactly Home, AQI forecast, Traffic conditions, Bus & train and My trips');
assert(citizenLayout.includes('aria-label=\"Citizen navigation\"') && citizenLayout.includes('aria-label={dark ?'), 'Citizen navigation and utility controls must be accessible');
const appContext = read('src/context/AppContext.jsx');
assert(appContext.includes('useState(false)') && !appContext.includes("getItem('us_theme')"), 'The green light theme must be the default after refresh, not an old persisted dark preference');
assert(app.includes('RouteScrollReset') && app.includes('window.scrollTo'), 'Navigation between pages must reset scroll position');

const aqi = read('src/pages/authority/AirQualityOverviewPage.jsx');
assert(aqi.includes('loadLocationAirQuality'), 'AQI overview must use the API plus direct provider fallback');
for (const endpoint of ['/aqi/nearby', '/air-intelligence/hotspots']) assert(aqi.includes(endpoint), `AQI overview must use ${endpoint}`);
for (const feature of ['AqiDial', 'AqiForecastTrend', '24-hour AQI forecast', 'Expected peak', '24h average', 'Nearby sensor network', 'Priority locations']) assert(aqi.includes(feature), `AQI overview must include ${feature}`);
assert(app.includes('path="aqi-forecast" element={<AirQualityOverviewPage forecastFocus />}'), 'Authority must provide a dedicated AQI forecast view without adding another sidebar item');
const airService = read('src/services/airQuality.js');
assert(airService.includes('hasAnyForecast') && airService.includes('fetchOpenMeteoAirQuality') && airService.includes("forecast_hours: '24'") && airService.includes('Do not block a usable OpenWeather'), 'AQI service must render a usable primary forecast without waiting on a second provider');
assert(aqi.includes('US AQI · 0–500') && aqi.includes('OpenWeather AQI · 1–5') && aqi.includes('matchingCurrentValue'), 'AQI forecast must keep provider index scales separate');
console.log('✓ AQI-centred overview and visualisations verified');

const carbon = read('src/pages/authority/CarbonImpactPage.jsx');
assert(carbon.includes('/air-intelligence/emissions/estimate'), 'Carbon workspace must use the emissions estimator');
assert(carbon.includes('result.by_class'), 'Carbon workspace must render vehicle-class emissions');
assert(carbon.includes('CO₂') && carbon.includes('NOx') && carbon.includes('PM'), 'Carbon workspace must report multiple pollutants');
console.log('✓ Carbon and pollutant estimator verified');

const iot = read('src/pages/authority/IotNetworkPage.jsx');
assert(iot.includes("api.get('/aqi/observations?max_age_hours=720&limit=200')"), 'IoT page must retrieve stored observations');
assert(iot.includes("api.post('/aqi/observations', payload)"), 'IoT page must submit sensor observations to backend');
assert(iot.includes("aqi: ''") && iot.includes("filter((key) => form[key] !== '')") && iot.includes('Empty fields are not converted to zero'), 'IoT sensor must omit blank measurements and never invent AQI or zero readings');
assert(iot.includes('HTTP ingestion available') && iot.includes('device-level key provisioning and MQTT are not included') && iot.includes('plain HTTP for a trusted private LAN only') && iot.includes('HTTPS/TLS'), 'IoT transport, public-network TLS requirement and limits must be explicit');
console.log('✓ IoT observation ingestion and device registry verified');


const trafficScene = read('src/pages/authority/TrafficSimulationScene.jsx');
assert(trafficScene.includes('DETAILED ROAD SIMULATION') && trafficScene.includes('60-MINUTE ROAD NETWORK') && trafficScene.includes('vehicle_positions') && trafficScene.includes('networkGeometry') && trafficScene.includes('signalTimings') && trafficScene.includes('NativeVehicle') && trafficScene.includes('trafficMarkers'), 'Simulation scene must support tracked trajectories and clearly-labelled forecast flow markers');
const citizenTraffic = read('src/pages/citizen/TrafficConditionsPage.jsx');
assert(citizenTraffic.includes('getCurrentPosition') && citizenTraffic.includes('Use my location') && citizenTraffic.includes('/traffic/nearby') && citizenTraffic.includes('/traffic/news'), 'Citizen traffic must require explicit location and load nearby roads plus traffic news');
assert(citizenTraffic.includes('timeoutMs: 11500') && citizenTraffic.includes('fallbackGraceMs: 0') && airService.includes('fallbackGraceMs: 7000'), 'Citizen traffic must use one bounded road lookup while AQI keeps its longer cached-provider window');
const carbonPage = read('src/pages/authority/CarbonImpactPage.jsx');
assert(!carbonPage.includes('readLocalRecord(\'carbon-last-estimate\')') && carbonPage.includes('setResult(null);'), 'Old carbon results must not appear as initial fallback before the current estimate request');
const traffic = read('src/pages/citizen/TrafficVisionPage.jsx');
assert(traffic.includes('/traffic-detection/analyze-video'), 'Traffic Lab must call the video-analysis API');
assert(traffic.includes('/authority/traffic-agent') && !traffic.includes('/traffic-detection/ops-workflow'), 'Traffic Lab must hand the workflow to a separate Traffic Agent page');
assert(traffic.includes('approach_rois'), 'Traffic Lab must support camera ROI calibration');
assert(traffic.includes('saveLatestVisionEvidence'), 'Traffic Lab must hand vehicle counts to the emissions estimator');
const evidenceStore = read('src/services/visionEvidence.js');
assert(evidenceStore.includes('airtraffic.latestVisionEvidence') && evidenceStore.includes('LEGACY_STORAGE_KEY'), 'Video evidence storage must use the neutral key and preserve existing saved evidence');
const sumoPage = read('src/pages/authority/TrafficSimulationPage.jsx');
assert(sumoPage.includes("api.post('/traffic/sumo/run'") && sumoPage.includes("api.post('/traffic/simulation/model-scenario'") && sumoPage.includes("api.get('/traffic/simulation/capabilities'") && sumoPage.includes('native_simulation_available') && sumoPage.includes('north_south_green_seconds') && sumoPage.includes('east_west_green_seconds') && sumoPage.includes('ROAD NETWORK PREVIEW') && sumoPage.includes('60-minute forecast'), 'Simulation workbench must probe engine availability and avoid calling an unavailable native engine');
assert(sumoPage.includes('Forecast frames update every five minutes') && sumoPage.includes('Detailed vehicle positions, when enabled, are sampled every 30 seconds.'), 'Simulation page must disclose forecast and detailed vehicle sampling intervals');
assert(app.includes('RouteErrorBoundary') && app.includes('traffic-lab" element={<RouteErrorBoundary'), 'Traffic Lab route must show a recoverable error state instead of going blank on a render exception');
const routeBoundary = read('src/components/shared/RouteErrorBoundary.jsx');
assert(routeBoundary.includes('Traffic Lab could not load') && routeBoundary.includes('Try again') && routeBoundary.includes('/authority/control'), 'Traffic Lab render fallback must give the operator a recovery path');
assert(read('src/services/api/client.js').includes("  : DEFAULT_API_URL).replace(/\\/$/, '')"), 'Production API requests must use Vercel same-origin API routing even if old Vercel env values point elsewhere');
const vercelRouting = JSON.parse(read('vercel.json'));
const rootVercelRouting = JSON.parse(read('../vercel.json'));
assert(rootVercelRouting.rewrites[0].destination === 'https://urbansarthi.onrender.com/api/v1/:path*', 'Repository-root Vercel config must proxy to the existing Render host too');
assert(vercelRouting.rewrites[0].source === '/api/v1/:path*' && vercelRouting.rewrites[0].destination === 'https://urbansarthi.onrender.com/api/v1/:path*', 'Vercel must proxy API requests to the existing Render backend before the SPA rewrite');
assert(read('.env.production.example').includes('VITE_API_URL=/api/v1'), 'Vercel production must use the same-origin API URL');
assert(read('src/pages/authority/AirIntelligencePage.jsx').includes('detailedComparisonReady') && read('src/pages/authority/AirIntelligencePage.jsx').includes('disabled={compareBusy || !detailedComparisonReady}'), 'Air impact comparison must not call an unavailable native simulation engine');
assert(read('src/components/shared/DataStatusBanner.jsx').includes("detail.path.startsWith('/traffic-detection/')" ) && read('src/components/layout/AuthorityLayout.jsx').includes("event.key === 'Escape'"), 'Traffic workspaces must use local error states and the mobile drawer must be keyboard-dismissible');
console.log('✓ Citizen traffic, camera evidence and native SUMO workflows verified');
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
assert(routePlanner.includes('planRunRef.current += 1;') && routePlanner.includes('const swap = () =>') && !routePlanner.includes('destination.resolved, mode, preference]'), 'Editing or swapping locations must cancel stale route requests; sorting preferences must not refetch the route network.');
assert(!routePlanner.includes('useEffect(() => plan(') && !routePlanner.includes('void plan(') && routePlanner.includes('onSubmit={plan}'), 'Home must start route planning only after the journey form is submitted.');
assert(routePlanner.includes('setResult(null); setSelectedRouteId(null);') && routePlanner.includes('Checking road-routing providers'), 'Old route data must be hidden while fresh route providers are queried');
assert(routePlanner.includes('Promise.all([') && routePlanner.includes('resolveMappedPlace(originQuery)') && routePlanner.includes('resolveMappedPlace(destinationQuery)'), 'Route submit must resolve both typed endpoints together instead of stopping after the first unresolved place');
assert(routePlanner.includes('estimateRouteOnly(') && routePlanner.includes('No road path is available for this estimate'), 'If road routing is unavailable, return an honest estimate without drawing a fake path');
assert(routePlanner.includes('Lowest CO₂') && routePlanner.includes('vs lowest') && routePlanner.includes('formatCO2'), 'Route cards must compare route-specific CO2 estimates');
const routeStyles = read('src/styles/citizen.css');
assert(routeStyles.includes('.route-carbon-grid') && routeStyles.includes('.route-emission-card') && routeStyles.includes('@media(max-width:700px){.route-carbon-grid{grid-template-columns:1fr'), 'Route carbon cards must have responsive premium styling');
const publicRouting = read('src/services/publicRouting.js');
assert(publicRouting.includes('api.get') && publicRouting.includes('/routing/geocode') && !publicRouting.includes('fetch('), 'Browser geocoding must use the configured backend instead of direct third-party CORS calls');
assert(routePlanner.includes("api.post('/routing/plan'") && !routePlanner.includes('findPublicRoadRoutes'), 'Road routing must execute through the configured backend only');
const cityMap = read('src/components/maps/CityMap.jsx');
assert(cityMap.includes('routeOptions') && cityMap.includes('Polyline'), 'Map must render road-network route geometries');
assert(cityMap.includes('tile.openstreetmap.org') && cityMap.includes('tile.openstreetmap.fr/hot') && cityMap.includes('tileerror') && !cityMap.includes('basemaps.cartocdn.com'), 'Map tiles must use keyless OpenStreetMap sources and avoid key-gated basemap fallbacks');
assert(!read('index.html').includes('fonts.googleapis.com') && !read('src/styles/authority.css').includes('fonts.googleapis.com'), 'UI fonts must not depend on blocked remote Google Fonts requests');
const apiClient = read('src/services/api/client.js');
assert(read('../render.yaml').includes('name: urbansarthi') && read('../render.yaml').includes('https://urbansarthi.vercel.app') && !read('../render.yaml').includes('urbansaarthi-api'), 'Render Blueprint must target the existing urbansarthi service and exact Vercel origin');
assert(apiClient.includes('cacheResponse') && apiClient.includes('readApiSnapshot'), 'API client must restore saved read responses during backend outages');
assert(apiClient.includes('FALLBACK_GRACE_MS = 5_000') && apiClient.includes('ATTEMPT_TIMEOUT_MS = 18_000') && apiClient.includes('fallbackDeadline') && !apiClient.includes('waitForFallbackGrace') && apiClient.includes("type: 'pending'"), 'Live API calls use a short retry window, respect caller timeouts and do not force a 40-second wait before cached fallback');
const dataBanner = read('src/components/shared/DataStatusBanner.jsx');
assert(dataBanner.includes('Showing the latest saved information'), 'Cached response state must be visible and timestamped');
assert(dataBanner.includes('Live data is temporarily delayed') && dataBanner.includes("location.pathname === '/authority/aqi-forecast'"), 'Connection copy must be neutral and the AQI workspace must use its own source status');
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
assert(trafficAgent.includes('loadLatestCameraEvidence') && trafficAgent.includes('since_minutes=15') && !trafficAgent.includes('makeLocalPreview') && !trafficAgent.includes('EXAMPLE_REPORT'), 'Traffic Agent must consume fresh authenticated edge-camera evidence and never substitute a local fake result');
assert(trafficAgent.includes('activeToolIndex') && trafficAgent.includes('tools list') && trafficAgent.includes('IN PROGRESS'), 'Traffic Agent must show an active workflow progress indicator without claiming individual tools completed before response');
assert(trafficAgent.includes('Approve draft') && trafficAgent.includes('It does not operate physical lights.'), 'Agent must retain operator approval and no physical dispatch safeguards');
assert(trafficAgent.includes('not inferred from this progress animation'), 'Agent must distinguish real tool results from the visual progress indicator');
assert(!traffic.includes('makeIllustrativeTrafficReport') && !traffic.includes('previewFallbackStartedAt') && !traffic.includes('previewReport'), 'Traffic Lab must never create a local example report when no live inference exists');
assert(traffic.includes('No result was generated') && traffic.includes('Waiting for source evidence'), 'Traffic Lab must show an empty/error state until real inference evidence exists');
assert(app.includes('path="traffic-vision" element={<Navigate to="/citizen/traffic" replace />}'), 'Legacy citizen traffic-vision link must stay inside the citizen portal');
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
assert(citizenLayout.includes("to: '/citizen/aqi-forecast'") && citizenLayout.includes("label: 'AQI forecast'"), 'Citizen navigation must expose a dedicated AQI forecast destination');
assert(app.includes('path="aqi-forecast" element={<AirQualityPage forecastFocus />}'), 'Citizen AQI forecast URL must open its focused forecast workspace');
assert(!airQualityPage.includes('autoLoadStarted') && !airQualityPage.includes('void search()') && airQualityPage.includes('forecast-first'), 'Citizen AQI must require a selected city or explicit browser location rather than silently loading a guessed location');
assert(airQualityPage.includes('forecastAverage') && airQualityPage.includes('forecastIntervalLabel') && airQualityPage.includes('forecastCategory(row)'), 'Citizen forecast must show correctly scaled summary metrics and provider-aware time intervals');
const signalUi = read('src/pages/authority/SignalPlansPage.jsx');
const signalApi = fs.readFileSync(path.join(root, '../backend/app/api/signals.py'), 'utf8');
const signalService = fs.readFileSync(path.join(root, '../backend/app/services/signal_planning.py'), 'utf8');
assert(signalUi.includes('Signal plans') && signalApi.includes('/signals/plans') && signalService.includes('generate_recommendation'), 'Signal plan UI, API routes and planning service must remain in the release');
console.log('✓ Signal planning source files retained');
console.log('✓ Live-first loading, error-only fallback, route sorting, AQI provenance and workflow navigation verified');


// Runtime check: the live server response must win even when a local snapshot exists.
// The saved response is reachable only after a server/transport availability error.
const apiClientSource = read('src/services/api/client.js')
  .replace(/^import .*;\s*/gm, '')
  .replaceAll('import.meta.env.DEV', 'false')
  .replaceAll('import.meta.env.VITE_API_URL', "'https://old-api.onrender.com/api/v1'")
  .replaceAll('import.meta.env.VITE_API_BASE_URL', "'https://old-api.onrender.com/api/v1'")
  .replace(/^export /gm, '');
let snapshotReads = 0;
let statusSequence = 0;
const runtimeFactory = new Function('readApiSnapshot', 'storeApiSnapshot', 'publishDataStatus', 'createDataStatusContext', `${apiClientSource}\nreturn { request, ApiError, API_BASE_URL };`);
const runtimeClient = runtimeFactory(
  () => { snapshotReads += 1; return { payload: { source: 'saved-snapshot' }, savedAt: Date.now() }; },
  () => {},
  () => {},
  (routePath) => ({ routePath, requestId: ++statusSequence }),
);
assert(runtimeClient.API_BASE_URL === '/api/v1', 'Production runtime must ignore stale cross-origin Vercel environment values');
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

  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'warming up' }), { status: 503, headers: { 'content-type': 'application/json' } });
  const actionFallbackStart = Date.now();
  const actionFallback = await runtimeClient.request('/routing/grace-check', { method: 'POST', body: '{}', cacheResponse: true, fallbackGraceMs: 20 });
  assert(actionFallback.source === 'saved-snapshot' && Date.now() - actionFallbackStart < 100, 'A failed one-shot POST may restore its saved read snapshot without waiting through a GET retry window');
  assert(snapshotReads === 1, 'The saved fallback must read one snapshot only');

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
