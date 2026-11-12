# UrbanSaarthi feature readiness

Last reviewed: 12 November 2026. This document distinguishes code shipped in this repository from live integrations that require operator setup. A page or API route is not proof that a provider is connected or that a live city feed is healthy.

## Product surfaces

| Surface | Current implementation | What is genuinely live | Remaining requirement |
|---|---|---|---|
| Citizen Home | Manual origin/destination entry, route alternatives and optional current-location action | Geocoding/routing when the configured OSM/custom router responds; planning starts only after submit | Configure a maintained `OSRM_BASE_URL` for dependable routing. Congestion-aware rerouting needs a traffic-aware routing provider. |
| Citizen AQI Forecast | Any-place search, current conditions, pollutant cards and 24-hour forecast | Open-Meteo/CAMS forecast; provider-specific observations when configured and available | Official CPCB station values require an authorized CPCB/CAAQMS adapter and station mapping. |
| Citizen Traffic Conditions | Explicit “Use my location” or manual area search, nearby OSM road map, road list, incident and traffic-news panels | TomTom live flow/incidents only for covered roads and configured key; nearby road geometry from OSM; Tavily news when configured or RSS search fallback | GPS permission is needed only for the location button. No TomTom key means roads remain neutral rather than receiving guessed traffic colours. |
| Citizen Bus & Train | City/mode search, current service-news panel, GTFS routes/stops/timetables and stop map | Dated news reports from Tavily or RSS; operator schedule data after GTFS import; live arrivals only from a connected realtime provider | Agency GTFS Static ZIP and GTFS-Realtime/partner adapter. News is not labelled as live vehicle arrival telemetry. |
| Citizen My Trips | Private saved journey lifecycle and personal history | Database-backed when PostgreSQL and authentication are configured | Email verification and password-reset delivery need an identity/mail integration. |
| Authority City Overview | Registered junction map, AQI stations, alerts, source freshness and aggregate reports | Only records ingested from real registered providers/devices; stale sources age out | Register real junctions, locations and data sources. Empty states are expected before ingestion. |
| Traffic Lab | OpenCV/YOLO image/video analysis, class counts and annotated output; RTSP edge worker and authenticated observations | Camera samples only while an authorized edge worker is connected and reporting; uploads only when vision dependencies/model are present | Authorized RTSP URL, camera-network host, YOLO model/dependencies, source registration and local calibration. Unknown speed/queue values remain unavailable. |
| Traffic Simulation | Native SUMO baseline/intervention runner; FCD vehicle positions/headings every 30 simulated seconds; edge metrics every 5 minutes; signal timings alter the candidate network | Actual vehicle trajectories and road intervals after a native SUMO run completes | SUMO binary is not installed in this validation environment. Bundled network is an 80-edge synthetic reference grid, not a calibrated city. Replace it with a mapped/correctly calibrated `.net.xml` and real turning counts before city claims. |
| Traffic Agent | Evidence-backed operations workflow, forecast/emissions tools and signal-plan review | Deterministic tools run from available records; Groq/LangGraph reasoning when credentials and optional dependencies are configured | Groq key/dependencies for LLM reasoning. It drafts/recommends; physical controller writes remain disabled. |
| Authority AQI | Station observations, forecast and hotspots | Data only from configured/ingesting sources | Authorized CPCB/CAAQMS adapter for official city-station claims; OpenAQ/CAMS are distinct sources. |
| Carbon intelligence | Vehicle-class and distance-based pollutant estimates | Calculated from measured counts/trip records and explicit factors | Local fleet mix, route distance and locally validated emission factors. It is an estimate, not a direct tailpipe measurement. |
| IoT sensors | Authenticated HTTP observation ingestion and ESP32/PMS5003 starter sketch | Real device readings after authorized devices post observations | Actual hardware, Wi-Fi, device identity, ingestion key, calibration and QA. MQTT is not included. Use TLS outside a trusted LAN. |
| Signal plans | Demand-based draft, SUMO what-if simulation, operator approval/rejection and dispatch preview | Workflow state and simulated impact | ATCS vendor integration, certified safety controls and field acceptance are not implemented. No physical signal writes occur. |

## Page and route inventory

The citizen navigation contains exactly five destinations. Legacy URLs are redirects and are not additional navigation items.

| Experience | Route | Primary capability |
|---|---|---|
| Portal selector | `/` | Enter the citizen or authority workspace |
| Citizen Home | `/citizen` | Submit a route search; no automatic route or location request |
| Citizen AQI Forecast | `/citizen/aqi-forecast` | Search any place and inspect current AQI, pollutants and 24-hour forecast |
| Citizen Traffic Conditions | `/citizen/traffic` | Explicit GPS or manual area search, nearby road map, traffic flow/incidents and nearby traffic news |
| Citizen Bus & Train | `/citizen/transit` | Latest service news, GTFS routes/stops/schedules and realtime arrival slots when a feed is connected |
| Citizen My Trips | `/citizen/trips` | Saved journeys and personal trip history |
| Citizen account | `/citizen/account` | Citizen registration/login; accessed from the account icon, not a sixth main nav item |
| Authority City Overview | `/authority/control` | City reports, registered junctions, map, AQI stations, alerts and source health |
| Authority Traffic Lab | `/authority/traffic-lab` | OpenCV/YOLO upload analysis and RTSP camera observations |
| Authority Traffic Simulation | `/authority/traffic-simulation` | Native SUMO baseline vs signal intervention, vehicle playback and road metrics |
| Authority Traffic Agent | `/authority/traffic-agent` | Evidence-backed traffic operations and signal-plan review |
| Authority AQI | `/authority/air-intelligence` | AQI stations, observations, forecast and hotspots |
| Authority Carbon | `/authority/carbon` | Vehicle emissions estimates and comparisons |
| Authority IoT Sensors | `/authority/iot` | Sensor registry, actual reading ingestion and device setup |
| Authority Data Sources | `/authority/sources` | Provider registry, freshness and source ingestion |
| Authority Analytics | `/authority/analytics` | City/source-derived analytics |
| Authority Settings | `/authority/settings` | Runtime integration status and settings |

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

Latest local verification on 12 November 2026: backend test suite **53 passed**; Python compilation passed; frontend source smoke tests passed (`node test-agent-frontend.js` and `node test-public-routing.js`); frontend JS/JSX source syntax parsed with the installed TypeScript parser; clean migrations and Alembic schema check passed on an isolated SQLite validation database. A production Vite build could not be verified in the current environment because npm registry DNS resolution failed (`EAI_AGAIN`) and the offline npm cache lacked a locked dependency. Run `npm ci && npm run build` in a network-enabled CI environment. Native SUMO FCD parsing and network-geometry tests pass, but the SUMO CLI is not installed here, so a native simulation could not be executed in this environment. The included network is a synthetic reference grid, not a live city map.
