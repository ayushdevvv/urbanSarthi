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
for (const endpoint of ['/aqi/location-forecast', '/aqi/nearby', '/air-intelligence/hotspots']) assert(aqi.includes(endpoint), `AQI overview must use ${endpoint}`);
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


const traffic = read('src/pages/citizen/TrafficVisionPage.jsx');
assert(traffic.includes('/traffic-detection/analyze-video'), 'Traffic Lab must call the video-analysis API');
assert(traffic.includes('/traffic-detection/ops-workflow'), 'Traffic Lab must call the operations workflow');
assert(traffic.includes('approach_rois'), 'Traffic Lab must support camera ROI calibration');
assert(traffic.includes('saveLatestVisionEvidence'), 'Traffic Lab must hand vehicle counts to the emissions estimator');
const evidenceStore = read('src/services/visionEvidence.js');
assert(evidenceStore.includes('airtraffic.latestVisionEvidence') && evidenceStore.includes('LEGACY_STORAGE_KEY'), 'Video evidence storage must use the neutral key and preserve existing saved evidence');
console.log('✓ Existing traffic video and operations workflow preserved');
const html = read('index.html');
assert(html.includes('href="/favicon.png"') && !html.includes('href="/favicon.svg"'), 'PNG favicon must be linked in the browser shell');
assert(fs.existsSync(path.join(root, 'public/favicon.png')), 'Linked PNG favicon must exist in the public assets');
const routePlanner = read('src/pages/citizen/RoutePlannerPage.jsx');
assert(routePlanner.includes('buildGoogleMapsUrl') && routePlanner.includes('routeOptions'), 'Route planner must link each mapped route to Google Maps and draw alternatives');
assert(routePlanner.includes('slice(0, 3)') && routePlanner.includes('3 road routes mapped'), 'Route planner must expose a three-route comparison state');
assert(routePlanner.includes('String.fromCharCode(65 + index)') || routePlanner.includes('Route A'), 'Route planner should label distinct road alternatives');
assert(routePlanner.includes('route-carbon-grid') && routePlanner.includes('route-emission-card'), 'Each route alternative must have a dedicated premium carbon card');
assert(routePlanner.includes('Lowest CO₂') && routePlanner.includes('vs lowest') && routePlanner.includes('formatCO2'), 'Route cards must compare route-specific CO2 estimates');
const routeStyles = read('src/styles/citizen.css');
assert(routeStyles.includes('.route-carbon-grid') && routeStyles.includes('.route-emission-card') && routeStyles.includes('@media(max-width:700px){.route-carbon-grid{grid-template-columns:1fr'), 'Route carbon cards must have responsive premium styling');
const cityMap = read('src/components/maps/CityMap.jsx');
assert(cityMap.includes('routeOptions') && cityMap.includes('Polyline'), 'Map must render road-network route geometries');
console.log('✓ PNG favicon, multi-route map and Google Maps handoff verified');
console.log('--- ALL URBANSARTHI SMOKE TESTS PASSED ---');
