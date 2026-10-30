// Lightweight source-level smoke tests for the current UrbanSaarthi frontend routes.
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

console.log('--- RUNNING URBANSARTHI FRONTEND SMOKE TESTS ---');

const app = read('src/App.jsx');
assert(app.includes('path="air-intelligence" element={<AirIntelligencePage />}'), 'Authority Air Intelligence route must be registered');
assert(app.includes('path="traffic-lab" element={<TrafficVisionPage authorityLab />}'), 'Authority Traffic Lab route must be registered');
console.log('✓ Authority routes verified');

const authorityLayout = read('src/components/layout/AuthorityLayout.jsx');
assert(authorityLayout.includes('/authority/air-intelligence'), 'Authority navigation must link to Air Intelligence');
assert(authorityLayout.includes('/authority/traffic-lab'), 'Authority navigation must link to Traffic Lab');
console.log('✓ Authority navigation verified');

const airPage = read('src/pages/authority/AirIntelligencePage.jsx');
for (const endpoint of ['/air-intelligence/factors', '/air-intelligence/hotspots', '/air-intelligence/emissions/estimate', '/air-intelligence/signal-plans/optimize', '/air-intelligence/simulations/compare', '/air-intelligence/reports/']) {
  assert(airPage.includes(endpoint), `Air Intelligence page must use ${endpoint}`);
}
assert(airPage.includes('Download environmental report'), 'Air Intelligence must offer impact report export');
console.log('✓ Air Intelligence page and API calls verified');

const trafficLab = read('src/pages/citizen/TrafficVisionPage.jsx');
assert(trafficLab.includes('/traffic-detection/analyze-video'), 'Traffic Lab must call the video-analysis API');
assert(trafficLab.includes('/traffic-detection/ops-workflow'), 'Traffic Lab must call the operations workflow');
assert(trafficLab.includes('approach_rois'), 'Traffic Lab must support camera ROI calibration');
assert(trafficLab.includes('segment_distance_km'), 'Traffic Lab must pass the corridor distance assumption');
console.log('✓ Traffic Lab video, ROI and agent workflow verified');

console.log('--- ALL FRONTEND SMOKE TESTS PASSED ---');
