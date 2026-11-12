# UrbanSaarthi feature readiness

Last reviewed: 12 November 2026. This document distinguishes code shipped in this repository from live integrations that require operator setup. A page or API route is not proof that a provider is connected or that a live city feed is healthy.

## Product surfaces

| Surface | Current implementation | What is genuinely live | Remaining requirement |
|---|---|---|---|
| Citizen home and route planner | Location-aware pages, route alternatives, route quality labels | Geocoding/routing only when the configured public or custom provider responds | Configure a maintained `OSRM_BASE_URL` for dependable routing. Live congestion-aware rerouting needs a traffic-aware routing provider; a TomTom flow snapshot alone is not a full routing engine. |
| Citizen AQI and AQI Vision | Location consent/search, current + hourly forecast, pollutant detail and clear source labels | Open-Meteo/CAMS model forecasts; OpenWeather current air pollution if configured | Official CPCB readings need an authorized CPCB/CAAQMS source adapter and station mapping. Browser location permission is required for GPS mode. |
| Citizen Traffic and Traffic Vision | Location-scoped traffic, camera/video analysis and source labels | TomTom current flow at queried coordinates if key and coverage exist; uploaded clip analysis on a configured YOLO runtime | Continuous city CCTV requires the edge worker, network access and registered cameras/junctions. |
| Citizen transit | GTFS routes/stops/timetables, direct/one-transfer planning, arrival endpoint | Imported feed timetable; pushed real-time arrivals only when a transit provider sends them | Agency GTFS Static ZIP and a GTFS-Realtime/partner adapter. No live vehicle positions are fabricated. |
| Citizen trips/account | Citizen-only public registration, login, private trip lifecycle | Database-backed after PostgreSQL and auth are configured | Email verification, abuse controls and password reset delivery are not implemented. Add a mail/SMS identity provider before unrestricted public sign-up. |
| Authority command centre | Network KPIs, junction freshness, incident/alert surfaces | Only records arriving from real registered providers/devices | Register real junctions and data sources; synthetic seed network/telemetry is opt-in only. |
| Traffic Agent | Tool-calling operations workflow, forecasts, emissions estimate, draft signal plan and approval | Deterministic operations workflow; Groq/LangGraph reasoning when credentials/dependencies are available | Configure Groq for LLM reasoning. Physical controller write is intentionally disabled. |
| Traffic simulation | Forecast timeline and scenario comparison; native SUMO baseline/intervention runner | XGBoost model forecast now; native SUMO when installed | Bundled SUMO network is a synthetic reference grid. Replace it and map camera/detector observations to real edges before claiming city-specific simulation. |
| Traffic camera intelligence | YOLO image/video analysis, RTSP edge worker, authenticated observation ingestion and camera heartbeat | Edge detections when worker is running and posting successfully | Authorized RTSP endpoint, camera-network host, model weights/dependencies, source/junction registration and calibration. A detection sample is not calibrated speed/queue measurement. |
| AQI sensors / IoT | Authenticated HTTP ingestion, data-source health and ESP32/PMS5003 starter example | Sensor readings after a configured device posts observations | Hardware, Wi-Fi, API key, station metadata and calibration/QA. MQTT broker integration is not included; current device path is HTTP. |
| Carbon intelligence | Pollutant estimation from detected vehicle classes and corridor assumptions | Calculated estimate from measured counts and configured assumptions | Vehicle class mix, local fleet emission factors, segment distance and calibration. Do not describe estimates as direct emissions measurements. |
| Signal plans | Demand-based draft, simulation, operator approval/rejection, dispatch preview and audit trail | Workflow and auditable approval state | Vendor-specific ATCS integration and safety certification are absent. Dispatch preview never changes physical lights. |
| Analytics and data sources | Source registry, freshness, city and personal analytics | Database-backed observations and trips | Real feeds and history accumulation. Empty states are expected until data is ingested. |

## Page and route inventory

| Experience | Route | Primary capability |
|---|---|---|
| Portal selector | `/` | Enter citizen or authority workspace |
| Citizen home | `/citizen` | Nearby mobility and air-quality overview |
| Citizen air quality | `/citizen/air-quality` | Current AQI/station readings with provenance |
| Citizen AQI forecast | `/citizen/aqi-forecast` | Location-based hourly AQI outlook |
| Citizen AQI Vision | `/citizen/aqi-vision` | Air-quality forecast and pollutant intelligence |
| Citizen traffic | `/citizen/traffic` | Explicit-location traffic conditions and provider snapshots |
| Citizen transit | `/citizen/transit` | GTFS-backed routes, stop and arrival information |
| Citizen trips | `/citizen/trips` | Saved journey lifecycle and personal history |
| Citizen account | `/citizen/account` | Citizen registration/login when enabled |
| Authority command centre | `/authority/control` | Junction, source health and operational overview |
| Authority AQI | `/authority/air-intelligence` | Station observations, forecast and hotspots |
| Authority carbon | `/authority/carbon` | Vehicle/emissions estimates and comparisons |
| Authority IoT network | `/authority/iot` | Sensor registry and measurement ingestion status |
| Authority camera system | `/authority/traffic-lab` | YOLO image/video inference and agent handoff |
| Authority Traffic Agent | `/authority/traffic-agent` | Recent edge evidence, operations workflow and signal review |
| Authority simulation | `/authority/traffic-simulation` | Traffic horizon/scenario exploration |
| Authority analytics | `/authority/analytics` | City and source-derived analytics |
| Authority data sources | `/authority/sources` | Provider registry, freshness and OpenAQ sync |
| Authority settings | `/authority/settings` | Runtime integration status and preferences |

The legacy `/citizen/traffic-vision` URL now redirects within the citizen workspace to `/citizen/traffic`; it no longer sends a citizen to the authority camera lab.

## Data integrity rules in this build

- Synthetic network and telemetry seeding is opt-in (`--demo-network`, `--demo-telemetry`). Default seeding registers provider sources but does not invent city junctions or observations.
- Synthetic junctions and observations are excluded from operational lists by default.
- Dashboard online counts require recent observations/heartbeats. A stale source is not reported as online just because an old status field says so.
- Provider forecasts, provider observations, trained model forecasts and simulation scenarios are labelled as different data modes.
- No fallback metrics are generated to make empty dashboards look populated.
- Physical signal writes and payment/ticket issuance are not implemented.

## Security posture

- Local development can use the demo identity while `APP_ENV=development` and `AUTH_ENABLED=false`.
- Production configuration fails closed unless PostgreSQL, explicit CORS origins, `AUTH_ENABLED=true`, a 32+ character `JWT_SECRET`, and a separate 32+ character `INGESTION_API_KEY` are configured.
- Human API access uses bearer tokens and database-backed roles. Edge devices use the separate ingestion key.
- Public registration can only create the `citizen` role. It currently has no email verification or signup rate limit; add an identity/verification provider or keep sign-up closed until this is implemented.
- Camera image/video inference endpoints are operator/admin-only.

## Verification status

Latest local verification on 12 November 2026: backend test suite **48 passed**; Python compilation passed; frontend source smoke tests passed (`node test-agent-frontend.js` and `node test-public-routing.js`); clean PostgreSQL-compatible migration flow and Alembic schema check passed on an isolated SQLite validation database. A production Vite build could not be verified in the current environment because npm registry DNS resolution failed (`EAI_AGAIN`) during dependency installation and the Vite executable was unavailable; no claim of a successful production build should be made until `npm ci` and `npm run build` complete in a network-enabled environment. The animated intersection is explicitly a reference-model visualization; its vehicle motion and phase lights are not live CCTV or physical controller state.
