> Chronological release history: the later “Public hackathon access update” section supersedes the earlier auth-enabled deployment notes. The current release has no human login.

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
- Reduced the citizen workspace navigation to exactly Home, AQI Forecast, Traffic Conditions, Bus & Train and My Trips. Legacy AQI Vision and traffic-vision URLs redirect into the relevant citizen page.
- Refined the shared responsive forest-green design system, page spacing, cards, forms, navigation, focus states and mobile layouts.
- Made the SUMO page render actual sampled vehicle coordinates/headings from Floating Car Data (FCD), on the bundled SUMO road geometry. Vehicle snapshots are 30 simulated seconds apart; road-edge performance intervals remain 5 minutes. Rendered vehicles are capped per frame while the reported total remains unfiltered.
- Normalized common managed-Postgres URL schemes for the installed psycopg v3 driver.
- Added Render production defaults and an idempotent startup sequence for Alembic migrations, provider-source registration and optional first-admin bootstrap.
- Added feature readiness and live-system setup documents.

- Shortened cached-read retry and page fallback waits from the previous long grace period to a bounded five-second window; preserved explicit long job timeouts for video analysis and SUMO.
- Corrected the frontend production API fallback to match the Render service slug declared in `render.yaml`, while preserving `VITE_API_URL` as the authoritative deployment override.
- Reduced OSM/Overpass, TomTom, Tavily and Google News request timeouts; cached successful traffic-news results and short-lived road-lookup failures to reduce repeated slow provider calls.
- Added a Traffic Lab route error boundary with a retry and return-to-overview recovery path.
- Added an optional `render-sumo.yaml` Docker Blueprint that installs the SUMO CLI on the API worker; the standard Python deployment keeps the XGBoost fallback.
- Added a full traffic/AQI/SUMO setup guide with Windows, WSL and Render instructions.

## Verification

- Backend: `python -m pytest -q` — **58 passed**.
- Backend syntax: `python -m compileall -q app scripts` — passed.
- SUMO FCD regression: verifies missing FCD output fails explicitly rather than returning an empty vehicle-playback timeline.
- Frontend source smoke test: `node test-agent-frontend.js` — passed.
- Frontend public routing smoke test: `node test-public-routing.js` — passed.
- Frontend syntax parse: JavaScript/JSX source files parsed with the installed TypeScript parser — zero syntax errors.
- Database deployment check: clean migrations applied and Alembic reported no pending schema changes. Default seed created seven provider-source registrations, zero junctions, zero traffic observations, zero AQI observations, and one bootstrap admin when credentials were supplied.

A production Vite bundle is **not verified**: npm dependencies could not be restored because the npm registry DNS lookup failed (`EAI_AGAIN`), and the local offline npm cache did not contain every locked package. Run `npm ci && npm run build` in a network-enabled CI runner before deploying the frontend.

## Required operator setup before live pilot

1. Provision managed PostgreSQL, set exact CORS origins, production auth, JWT secret, ingestion key, and bootstrap administrator credentials.
2. Set frontend `VITE_API_URL` and rebuild the public hackathon frontend; no login flag is required.
3. Add provider credentials as needed: `TOMTOM_API_KEY`, `OPENAQ_API_KEY`, and optionally `WEATHER_API_KEY` and `GROQ_API_KEY`.
4. Register surveyed junctions and real data sources; deploy the RTSP worker on a machine with authorized camera-network access.
5. Supply an authorized CPCB/CAAQMS adapter if official AQI is required; OpenAQ and CAMS are not CPCB station observations.
6. Supply a city-specific SUMO network, edge/junction mapping, turning counts, signal timing and calibration data before claiming a city-calibrated digital twin.
7. Import agency GTFS static data and add a real GTFS-Realtime/partner adapter for live arrivals.
8. Provision and calibrate field sensors. The current device path is authenticated HTTP, not MQTT.
9. Keep physical ATCS writes disabled until vendor integration, safety certification and field acceptance are complete.

See [Live-system setup](./LIVE_SYSTEM_SETUP.md), [Feature readiness](./FEATURE_READINESS.md), and [Traffic, AQI and simulation fixes](./TRAFFIC_AQI_SIMULATION_FIX.md) for the complete requirements and per-feature limits.


## Public hackathon access update

- Removed citizen account/login UI and the authority operator sign-in gate.
- Citizen and authority workspaces now open directly with no human login.
- Browser-generated `X-Visitor-ID` isolates saved trip history per browser; this is not account-grade privacy or cross-device sync.
- Authority API actions use a shared public demo operator identity. Do not use this configuration to operate real municipal control systems.
- Device and IoT ingestion remains protected by `INGESTION_API_KEY`; the browser never receives this secret.
- Production startup no longer requires a JWT secret when no human login.
