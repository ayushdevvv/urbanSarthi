# UrbanSaarthi traffic separation and AQI preservation QA

## Changes in this package

- The YOLO traffic image analysis page is routed under the authority workspace at `/authority/traffic-model` and appears as `Traffic model lab` in authority navigation.
- The citizen navigation no longer exposes the YOLO camera analysis tool. Citizen traffic navigation now opens `/citizen/traffic`, which uses a backend provider adapter for current road flow data.
- Added `TOMTOM_API_KEY` backend configuration and a `/api/v1/traffic/current` endpoint. Provider credentials remain on the backend. Without a configured key the endpoint returns a not configured response instead of fabricated live traffic.
- Authority users can send a successful YOLO image detection to a registered junction to store a single frame observation and create a draft signal recommendation. The UI explains that one frame does not measure speed, queue length, or lane demand.
- Existing signal simulation still uses the project's analytical what if engine. No SUMO binary, calibrated network file, or route demand files are included, so it must not be described as a real SUMO simulation. The current response explicitly reports `sumo_run: false`.
- Preserved the original AQI model weights, preprocessor, label encoder, and model configuration unchanged.

## Verification

- `python -m compileall -q backend/app`: passed.
- `python -m pytest -q backend/tests`: **38 passed** (including the portable FFmpeg video-decoder fallback test).
- Model artifact SHA256 values match the previous Premium Repair package:
  - AQI `urban_sarthi_best_model.pth`: `159569115c276a3b460524350dc87f03c18630b7ce45658caaa47fb4a2e31d78`
  - Traffic `best.pt`: `6b41bbbc5622b1a78fcdc87724c5bb1b35945988336484abbd29d3a1d97bea36`
- `cd frontend && npm test`: passed. The three modified JSX files (`AirIntelligencePage.jsx`, `TrafficVisionPage.jsx`, `AuthorityLayout.jsx`) passed a TypeScript transpile/parse check.
- A full Vite production build was not verified: `npm ci --no-audit --no-fund` timed out in this environment. Run `npm ci && npm run build` in `frontend` before deployment.
- TomTom provider response has not been tested with a real API key in this environment.

## Deployment

Set `TOMTOM_API_KEY` in Render backend environment, redeploy, and visit `/api/v1/traffic/current?latitude=28.6139&longitude=77.2090`. If the response is not configured, verify the environment variable and service restart. The key must never be placed in a `VITE_` frontend variable.

For a genuine SUMO integration, install SUMO and supply a matching `.net.xml` network plus route or demand files for the chosen junction. Until then the analytical scenario engine remains clearly distinguished from SUMO.

## Visual and traffic model refinement (2026 10 10)

- Replaced the logo image dependency in the shared brand component with an inline SVG mark so the logo remains visible even if a public asset path fails. Updated the browser icon to the same verified SVG asset.
- Refined the landing page typography, portal cards, city illustration, model summary cards, responsive layout, and font fallbacks.
- Added the supplied SUMO dataset and XGBoost queue model to the backend. `GET /api/v1/traffic/simulation` returns a 30 minute forecast across the 80 roads using the latest included simulation run.
- Added a public static forecast snapshot so the citizen traffic screen still renders traffic metrics when the backend cannot be reached. It does not claim those values are live sensor readings.
- The traffic provider endpoint now falls back to the included simulation forecast when a TomTom key is absent or the provider request fails.
- Production API URL defaults to the existing Render backend when a Vercel environment variable is missing. User facing connection errors were replaced with a neutral refresh message.
- Backend tests: 38 passed. Python compilation passed. Traffic simulation endpoint smoke test returned HTTP 200 with 80 road segments, queue now 1350, and forecast queue 1475.
- Frontend smoke tests passed. The modified JSX pages passed a TypeScript transpile/parse check. Full Vite build remains unverified because frontend package installation timed out and Vite is not available in this environment. Run `npm ci` and `npm run build` before deployment.


## ICCC and authority scenario coverage

- Authority operations now render a complete city overview when API data is absent, including congestion, junction coverage, AQI summary, hotspots, and alerts.
- Analytics and signal plan pages use a consistent scenario dataset when no stored records are returned.
- Data sources page displays example source registry entries for the ICCC overview; these entries do not claim external provider connectivity.
- Removed the citizen facing AQI Vision camera workflow from navigation; its old route redirects to the standard air quality page.
- Error notices remain suppressed in the shared UI. Scenario labels distinguish the preview from connected operational records.


## UrbanSaarthi · InnovateX Theme 2 update (2026 10 30)

- Added a dedicated UrbanSaarthi workspace for Rising AQI in Modern Urban Cities, including city-selectable ambient AQI outlook, PM2.5/PM10/NO2/O3 tiles, a 24-hour PM2.5 visualisation, animated response pipeline, hotspot ranking, traffic-to-emissions estimates, vehicle-class breakdown, carbon/pollutant KPIs, emissions-aware signal drafts, and baseline/intervention comparison/reporting.
- The Traffic Lab now records the latest video-derived vehicle counts in browser-local storage for import into UrbanSaarthi emissions estimation.
- The video reader attempts OpenCV first and falls back to `imageio-ffmpeg` when OpenCV cannot decode the uploaded clip. Video status reports the installed OpenCV/FFmpeg capabilities and inference readiness.
- Backend test suite now reports 38 passing tests. Portable FFmpeg fallback decoding was exercised with a generated H.264 clip and mocked YOLO inference. The full YOLO model inference was not run in this environment because Ultralytics was not installed here; install backend requirements and verify `/api/v1/traffic-detection/video-status` after redeployment.
- The emissions model is an indicative estimate based on the selected vehicle mix and corridor-distance/fuel-use assumptions, not a direct tailpipe sensor measurement. Ambient AQI observations/forecasts are separate from estimated traffic emissions.
