# UrbanSaarthi release notes — 12 November 2026

## What changed in this release

- Enforced production authentication with database-backed roles, Argon2 password hashes, JWT bearer tokens and a separate high-entropy device-ingestion key.
- Added a citizen sign-in / registration route and blocked citizen-role accounts from entering the authority workspace.
- Made the default production seeder safe: it registers provider connectors but creates no made-up junctions, cameras, AQI stations or telemetry. Synthetic demo infrastructure is opt-in and tagged.
- Added RTSP/YOLO edge-camera worker ingestion with reconnects, sampled-frame counts and source heartbeats. Unknown queue, speed and wait measurements stay null until calibrated measurement logic exists.
- Connected recent authenticated camera detections to the Traffic Agent evidence path.
- Removed automatic local/example result substitution after Traffic Agent and camera-analysis failures.
- Made junction/source health freshness-based so old `online` status values age to `stale`.
- Kept provider traffic flow, atmospheric forecasts, station pollutant measurements, trained model forecasts and SUMO scenarios visibly distinct.
- Corrected the City Command Centre grouped-query bug and added a regression test.
- Fixed authority navigation so Carbon, Data Sources, Analytics and Settings are reachable; alert navigation now opens the operational overview.
- Fixed the legacy citizen traffic-vision deep link and added a citizen AQI Vision route.
- Refined the shared responsive forest-green design system, page spacing, cards, forms, navigation, focus states and mobile layouts.
- Added an explicit warning inside animated traffic playback that the vehicle and signal animations are model visualizations, not live CCTV or controller state.
- Normalized common managed-Postgres URL schemes for the installed psycopg v3 driver.
- Added Render production defaults and an idempotent startup sequence for Alembic migrations, provider-source registration and optional first-admin bootstrap.
- Added feature readiness and live-system setup documents.

## Verification

- Backend: `python -m pytest -q` — **48 passed**.
- Backend syntax: `python -m compileall -q app scripts` — passed.
- Frontend source smoke test: `node test-agent-frontend.js` — passed.
- Frontend public routing smoke test: `node test-public-routing.js` — passed.
- Frontend syntax parse: 41 JavaScript/JSX source files parsed with the installed TypeScript parser — zero syntax errors.
- Database deployment check: clean migrations applied and Alembic reported no pending schema changes. Default seed created seven provider-source registrations, zero junctions, zero traffic observations, zero AQI observations, and one bootstrap admin when credentials were supplied.

A production Vite bundle is **not verified**: npm dependencies could not be restored because the npm registry DNS lookup failed (`EAI_AGAIN`), and the local offline npm cache did not contain every locked package. Run `npm ci && npm run build` in a network-enabled CI runner before deploying the frontend.

## Required operator setup before live pilot

1. Provision managed PostgreSQL, set exact CORS origins, production auth, JWT secret, ingestion key, and bootstrap administrator credentials.
2. Set frontend `VITE_API_URL` and `VITE_REQUIRE_AUTH=true` and rebuild it.
3. Add provider credentials as needed: `TOMTOM_API_KEY`, `OPENAQ_API_KEY`, and optionally `WEATHER_API_KEY` and `GROQ_API_KEY`.
4. Register surveyed junctions and real data sources; deploy the RTSP worker on a machine with authorized camera-network access.
5. Supply an authorized CPCB/CAAQMS adapter if official AQI is required; OpenAQ and CAMS are not CPCB station observations.
6. Supply a city-specific SUMO network, edge/junction mapping, turning counts, signal timing and calibration data before claiming a city-calibrated digital twin.
7. Import agency GTFS static data and add a real GTFS-Realtime/partner adapter for live arrivals.
8. Provision and calibrate field sensors. The current device path is authenticated HTTP, not MQTT.
9. Keep physical ATCS writes disabled until vendor integration, safety certification and field acceptance are complete.

See [Live-system setup](./LIVE_SYSTEM_SETUP.md) and [Feature readiness](./FEATURE_READINESS.md) for the complete requirements and per-feature limits.
