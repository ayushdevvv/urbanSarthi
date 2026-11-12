> **Historical snapshot:** This report predates the current live-first/auth/navigation patch set. For current truth, use [`FEATURE_READINESS.md`](./FEATURE_READINESS.md) and [`LIVE_SYSTEM_SETUP.md`](./LIVE_SYSTEM_SETUP.md); they supersede any older demo-auth, seed-data or preview claims below.

# UrbanSaarthi — Full Codebase Audit

**Audit date:** 12 November 2026  
**Source:** `UrbanSaarthi_Citizen_Admin_AQI_Forecast_Workable (2).zip`  
**Scope:** React/Vite frontend, FastAPI backend, API routes, model assets, database migrations/seeding, runtime smoke checks, automated tests, and the project's stated product requirements.

## Executive assessment

UrbanSaarthi is a substantial hackathon/prototype codebase with working citizen and authority UI flows, a trained-data traffic forecast, upload-based YOLO traffic analysis, an operational-agent workflow, AQI forecasts, sensor-observation ingestion, route planning, emissions estimates, and signal-plan review.

It is **not yet a live municipal smart-city deployment**. The difference is important:

- Forecast playback is driven by trained XGBoost models and interpolation, not a continuously running SUMO/TraCI digital twin.
- Traffic vision accepts uploaded images/videos and an HTTP push-event path; it does not connect to municipal CCTV/RTSP streams or browser webcams.
- Signal plans can be generated, simulated analytically, approved/rejected and previewed, but no physical controller is written to.
- AQI forecasting has a provider integration path, but official CPCB observations and a persistent real sensor network are not configured in this archive.
- GTFS, real-time transit, ticket payment, and several provider integrations require operator data/credentials that are not present.
- Authentication is intentionally disabled. Authority write APIs are therefore public in this build. **Do not deploy this archive with real operational data or infrastructure credentials.**

The intended product remains a two-sided platform: citizen mobility and clean-air guidance plus an authority operations workspace for traffic, air quality, cameras, IoT, forecasting, incident handling and evidence-based signal planning.

## Verification results

| Check | Result | Notes |
|---|---|---|
| Backend pytest suite | **46 passed** | Includes the added command-centre grouped-status regression test |
| Python compilation | **Passed** | `python -m compileall -q backend/app backend/tests` |
| Frontend source smoke suite | **Passed** | `node frontend/test-agent-frontend.js` |
| Public routing tests | **Passed** | `node frontend/test-public-routing.js` |
| Alembic migrations | **Passed** | Three revisions applied to a fresh SQLite database |
| Demo database seed | **Passed** | 24 synthetic clusters, 48 junctions, 7 source registry records |
| Selected API smoke requests | **Passed / partial data** | Health, readiness, command centre, junctions, source registry, agent status, traffic workflow; empty data where no observations/feeds were seeded |
| AQI Vision inference | **Passed** | Actual model inference returned `Moderate` with 59.29% confidence on a synthetic test image plus sensor values |
| Browser video model inference | **Not verified** | Ultralytics is not installed in the audit runtime, so YOLO weights could not be executed here |
| Native SUMO | **Not verified / unavailable** | SUMO executable is not available in this runtime; native compare requires it |
| External AQI provider call | **Not verified here** | Audit runtime could not reach the external provider; provider fallback code is present |
| Vite production build | **Not verified** | `npm ci` timed out; Vite dependencies were not fully installed |

### Clean-database check

A fresh local SQLite DB was migrated and seeded. This established that the database migration chain and demo seed script work from a clean state. It is not a connection to the deployed production database. No live production database URL or credentials were supplied, so the deployed UrbanSaarthi database was not inspected.

## Fixes made in this audit copy

### 1. Command-centre crash fixed

`backend/app/api/command_center.py` grouped source statuses into `(status, count)` rows but read them with SQLAlchemy's scalar-result method. When any source records existed, the overview failed with `ValueError: too many values to unpack (expected 2)`.

Changed the query to read complete rows with `db.execute(...).all()` and construct the status-count mapping from those rows. Added `test_command_center_overview_groups_data_source_statuses`, which inserts three source records across statuses and checks the returned counts.

**Result:** fresh seeded `GET /api/v1/command-center/overview` returns HTTP 200; backend suite is now 46/46 passing.

### 2. Authority navigation completed

The routes for Carbon & Emissions, Data Sources, City Analytics and Settings already existed, but were absent from the authority sidebar. Added them to the corresponding navigation groups. The alert-bell action previously navigated to the AQI page; it now opens the command centre where active operational notices are displayed.

Updated the frontend smoke test to assert that these existing feature pages stay reachable. Both frontend smoke suites pass.

## Page-by-page audit

### Public landing

**Route:** `/`  
**Component:** `frontend/src/pages/landing/PortalLanding.jsx`

- Opens the citizen portal and provides the authority entry point.
- The landing KPI strip includes fixed snapshot/reference metrics. They are not fetched live from a municipal API. Treat the values as a product/demo snapshot, not current traffic telemetry.
- Some labels describe a Delhi/NCR-style view while the bundled network/model is synthetic; it should not be presented as a fully mapped live city network.

### Citizen workspace

| Route/page | Main behaviour | Status / caveat |
|---|---|---|
| `/citizen` — Citizen home | Embeds the route planner and citizen workspace entry point | Implemented; depends on public geocoding/routing services for map geometry |
| `/citizen/air-quality` — Air Quality | Location search, browser geolocation, current pollutants, 24-hour AQI timeline, AQI category and map marker | Implemented; provider forecast is not an official ground-station measurement |
| `/citizen/aqi-forecast` — AQI Forecast | Reuses Air Quality page in forecast-focused mode | Implemented |
| `/citizen/traffic` — Traffic | Traffic conditions and scenario/forecast view | Implemented; fallback/snapshot states must not be interpreted as live camera observations |
| `/citizen/transit` — Public Transport | Stops, routes, nearby transit and journey planning | Partial; real timetable/arrival data requires GTFS/GTFS-RT or operator feed |
| `/citizen/trips` — My Trips | Reads trips, selects route, starts/completes/cancels trip, mobility summary/export | Implemented as a prototype flow; shared demo identity means account privacy is not production-ready |
| `/citizen/aqi-vision` | Redirects to `/citizen/air-quality` | Intentional compatibility redirect; it is not the multimodal AQI model UI |
| `/citizen/traffic-vision` | Redirects to authority Camera System | Intentional; camera operations are not a separate citizen camera page |
| `/agent` | Redirects to citizen portal | Generic `AgentPage.jsx` is retained in source but not independently routed; floating agent widget uses `/agent` API endpoints |

#### Citizen route planner functions

- Geocodes origin and destination using public OpenStreetMap-derived services.
- Searches alternative road routes and renders route geometry on the map.
- Offers fastest/cleanest/balanced preference sorting and distance-based CO₂ estimate cards.
- Cancels stale lookups and avoids replacing current data with stale requests.
- Can hand selected routes to Google Maps.
- Transit mode does not pretend a car route is a transit route.
- When a routing provider cannot return geometry, the last-resort estimate is labelled and does not draw a fabricated straight line.

**Dependency:** public Nominatim/Photon and OSRM/Valhalla services, availability/rate limits and internet connectivity.

#### Citizen AQI functions

- Location geocoding and geolocation.
- Backend forecast request with browser-side Open-Meteo/CAMS fallback.
- Pollutant details and 24-hour time series.
- Keeps US AQI 0–500 and OpenWeather's 1–5 scale separate.

**Limitation:** Open-Meteo/CAMS is a location-based atmospheric model output. It must not be displayed as an official CPCB station observation. The audit runtime could not make the external provider call due to network restrictions, so real provider availability was not validated from this environment.

#### Transit functions

- Route, stop, nearby stop, arrival, alerts and journey-plan API contracts exist.
- Without an operator GTFS feed, the database contains no timetable-backed routes/stops/alerts and those screens correctly return empty states.
- Frequency-based service (`exact_times=0`) is estimated, not a guaranteed departure.
- Current planner supports a direct trip and limited one-transfer journey logic, not a full multimodal routing engine.
- Ticketing API contracts exist but payment/provider status reports ticket issuance and payment disabled.

### Authority workspace

| Route/page | Main behaviour | Status / caveat |
|---|---|---|
| `/authority/control` — City overview | City KPIs, junction map, hotspots, source/network stats, operational alerts | Implemented; now fixed for non-empty source registry. Preview values are explicitly illustrative |
| `/authority/air-intelligence` — AQI overview | Current AQI, pollutant values, forecast trend, nearby observations, hotspots | Implemented; live sensor data needs configured feeds |
| `/authority/aqi-forecast` — AQI forecast | Focused 24-hour forecast view | Implemented; provider model forecast, not CPCB station feed |
| `/authority/carbon` — Carbon & Emissions | Vehicle-class pollutant estimates, CO₂/NOx/PM/CO, report export | Implemented as an indicative estimator; factors need local fleet calibration |
| `/authority/iot` — IoT Network | Recent sensor observations and manual HTTP observation ingestion | Partial; no MQTT broker or secure device provisioning |
| `/authority/sources` — Data Sources | Source registry, health summary and source-record creation | Registry only; adding a record does not connect/poll a provider |
| `/authority/traffic-lab` — Camera System | Upload image/video, YOLO analysis, ROI calibration, annotated frame/report export | Code implemented; inference requires compatible Ultralytics/PyTorch runtime; no RTSP/CCTV or browser webcam capture |
| `/authority/traffic-agent` — Traffic Agent | Evidence review, operational tools, signal plan draft, scenario, human review/approval/rejection and dispatch preview | Deterministic workflow verified; LangGraph/Groq synthesis optional and not configured in audit runtime; no physical signal write |
| `/authority/traffic-simulation` — Traffic Simulation | 0–60 minute model playback, road queues, scenario controls | Implemented as XGBoost forecast/sensitivity scenario, not live SUMO/TraCI |
| `/authority/analytics` — City Analytics | City mobility summary and period filter | Implemented but reads recorded trip activity, not a complete sensor-wide city-data lake; now added to sidebar |
| `/authority/settings` — Settings | Shared light/dark theme, language preference and API URL display | Basic frontend preferences only; not an operational admin configuration console; now added to sidebar |

#### Authority page details

**City overview**
- Loads command-centre overview, registered junctions, cluster status and active alerts.
- Maps only junctions returned with usable coordinates; reference markers are marked illustrative.
- Signal strategy button opens Traffic Agent.
- Alert bell now opens this page. There is an alerts API, but there is no dedicated alert-management page in the current UI.

**AQI overview / forecast**
- Current location-based AQI and pollutant details.
- 24-hour forecast trend, expected peak and average.
- Nearby registered observations and pollution hotspots.
- Data provenance and provider scale separation are explicit.
- A real observation station network is not included by default; the clean demo DB had no AQI observation rows.

**Camera System / Traffic Lab**
- Accepts one image (up to 8 MB) or a video clip (up to 150 MB, up to 10 minutes in UI).
- Uses confidence threshold, video sampling interval and optional four-approach ROI polygons.
- Samples up to 180 video frames and returns class counts/track summaries/annotated evidence where dependencies are present.
- Saves the last successful evidence in browser storage and hands evidence to the Traffic Agent/emissions workflow.
- Congestion/density is a count-based heuristic. The report does not establish calibrated speed, physical queue length or lane occupancy.
- **No browser webcam `getUserMedia` flow or continuous RTSP worker is present.** It is upload/push ingestion, not live CCTV. `RUNNING.md` still mentions HTTPS/localhost camera access, which is stale documentation for this current UI because the current camera page does not request webcam access.
- In this audit runtime, `/traffic-detection/video-status` returned not-ready because Ultralytics was not installed. The checkpoint file is present, but the detector could not be executed here.

**Traffic Agent**
- Has a backend operations workflow that accepts camera evidence, persists a traffic observation, estimates emissions, creates a signal plan, runs a scenario and returns tool output for human review.
- Deterministic fallback was exercised successfully with a sample evidence request; it created an actual backend result rather than merely rendering a local mock.
- LangGraph/Groq is an optional enhanced reasoning path. The environment tested did not have `langgraph`/`langchain_groq` or a configured `GROQ_API_KEY`, so LLM-based reasoning was not verified.
- If there is no saved report or junction context, the page may show an explicitly illustrative local preview after a delay. That is not an agent execution.
- Approve/reject are workflow state transitions. `dispatch-preview` is a preview only; it is not a traffic-signal command.

**Traffic simulation / Digital Twin**
- Bundled model assets include the generated dataset and 30/60-minute XGBoost models.
- The forecast endpoint loads the stored data/model predictions across the synthetic road-edge set.
- The 0–60-minute timeline is constructed by interpolation between current values, the 30-minute model and the 60-minute model. Scenario controls apply declared sensitivity overlays (for example demand surge or signal-priority reduction); they are not independently trained or physically verified outcomes.
- The displayed selected area does not retrain or recalibrate the global synthetic 80-edge model. Location selection can affect provider lookups, not turn the synthetic network into a mapped municipal network.
- Separate native SUMO baseline/intervention comparison exists under `/air-intelligence/simulations/compare` and needs a SUMO executable. The audit runtime did not have SUMO, so that experiment could not be run.
- The bundled dataset is described as 518,400 rows from 36 SUMO-generated runs across 80 edges. The recorded held-out 60-minute result is materially weaker than the 30-minute result: 30-minute congestion-level accuracy about 83.4%; 60-minute level accuracy about 61.5%, MAE about 3.93 vehicles, R² about 0.384. Display the correct horizon metric, not one blended “model accuracy” claim.

**IoT Network**
- Reads stored AQI observations and supports manual HTTP observation POST.
- Includes an ESP32/PMS5003 HTTP example.
- HTTP ingestion exists. No MQTT broker, device provisioning/authentication, signed device identity, firmware management or physical device verification is included.

**Carbon & Emissions**
- Calculates class-based CO₂, NOx, PM and CO estimates, based on vehicle counts/distance assumptions and factor catalog.
- Supports report export.
- Factors are indicative assumptions and need calibration against local vehicle fleet, fuel, age, speed, road grade and emission measurement data before policy use.

**Data Sources**
- Lists configured registry records and status/freshness fields.
- “Connect source” only creates a data-source registry entry. It does not establish a provider subscription, API credentials, RTSP link, sensor heartbeat or GTFS polling job.
- In the seed DB, 7 registry entries were present as `not_configured`.

**Analytics**
- Reads trip activity (requests, completed/cancelled trips and recorded route distance).
- The preview fallback is labeled illustrative.
- It does not currently aggregate every traffic-camera, AQI and IoT time series into a full citywide data warehouse.

**Settings**
- Theme and language switches are present.
- Auth is disabled and workspace is shared. There is no user/account management, API key vault, camera credential editor, provider onboarding wizard or operational configuration management.

## Backend API and function audit

The FastAPI application registers **94 API routes** across 86 OpenAPI path entries, in addition to non-API/root health handling. The module inventory below covers the functional route groups; individual verbs and paths were enumerated from the running FastAPI app.

| API module | Key functions / endpoints | Audit finding |
|---|---|---|
| `command_center.py` | `/command-center/overview`, `/clusters`, `/clusters/{id}`, `/health/data-sources` | Implemented; grouped source-count crash fixed and regression-tested |
| `traffic.py` | current conditions, simulation/scenario, junction CRUD/read, observations, overview | Implemented; global synthetic model and provider observations must be distinguished |
| `predictions.py` | model status, refresh, per-junction forecast | Per-junction estimator can fall back to baseline heuristics; separate global XGBoost model is available |
| `traffic_detection.py` | status, image analysis, video status/analysis, operations workflow | Real upload pipeline coded; Ultralytics dependency unavailable in audit runtime; workflow deterministic path verified |
| `signals.py` | list, recommend, create, approve, reject, dispatch preview, simulation | Workflow implemented; physical dispatch disabled; plan simulation is an analytical what-if, distinct from native SUMO comparison |
| `air_intelligence.py` | factors, emissions estimate, hotspots, signal optimization, native simulation compare, report | Implemented; native compare depends on SUMO; emission factors indicative |
| `aqi.py` | observations, nearby, location forecast, observation ingestion | Implemented; external provider and actual observation feed required |
| `aqi_vision.py` | status, analyze, predict form | Model inference path exists and was exercised; no dedicated frontend page currently exposes it; citizen legacy route redirects to forecast page |
| `ingestion.py` | vision event ingestion | HTTP push interface exists; no embedded RTSP frame worker |
| `integrations.py` | integration status, OpenAQ sync | Provider config is partial; source registry status is not proof of an active external feed |
| `admin.py` | source registry, heartbeat, junction status, users/roles | Admin functions coded, but security dependencies are demo mode and not production access control |
| `transit.py` | routes, stops, nearby, arrivals, plan, GTFS import, realtime arrivals, alerts | Requires real operator feeds for useful live schedule data |
| `ticketing.py` | ticket orders, cancellation, provider status | Payment/ticket provider disabled; do not present as working purchases |
| `mobility.py` | route plan/geocode/reverse geocode/nearby, trip lifecycle | Citizen route and trip workflow coded; relies on public providers and shared demo identity |
| `analytics.py` | personal mobility and city summary | Aggregates current prototype trip records only |
| `alerts.py` | list/create/resolve alerts | Backend API exists; no dedicated authority alerts page |
| `agent.py` | citizen/authority chat, incident create/read/update, analyze, status, tools | Endpoints exist; real LLM depends on optional credentials and installed integration packages |

## Runtime endpoint observations on the clean seeded database

| Endpoint / subsystem | Observed result | Interpretation |
|---|---|---|
| `/health`, `/readyz` | HTTP 200 | Backend starts and readiness passes |
| `/command-center/overview` | Initially failed; now HTTP 200 | Regression fixed |
| `/command-center/clusters` | 24 rows | Seeded clusters available |
| `/admin/data-sources` | 7 rows | Registry data only, all not configured in clean seed |
| `/traffic/junctions` | 48 rows | Seeded synthetic junctions |
| `/signals/plans` | Empty list | No signal plans exist until an operational workflow is run |
| `/air-intelligence/factors` | HTTP 200 | Factor catalog loads |
| `/air-intelligence/hotspots` | HTTP 200, empty | No AQI observations seeded |
| `/aqi/observations`, `/aqi/nearby` | Empty | No live station feed or seeded observations |
| `/aqi-vision/status` | Ready | Dependencies/model status available; model inference separately smoke-tested |
| `/traffic-detection/status`, `/video-status` | Not ready | Ultralytics missing in audit runtime; checkpoint file is present |
| `/agent/status` | HTTP 200 | Agent endpoint operational; optional LLM dependencies not configured |
| `/transit/routes`, `/stops`, `/alerts` | Empty | No GTFS/operator feed loaded |
| `/ticketing/provider-status` | Payment/provider disabled | No real ticketing |
| `/predictions/model-status` | Baseline/heuristic mode for the per-junction predictor | Do not confuse with the separate bundled XGBoost network forecast |
| `/integrations/status` | Several integrations unconfigured | OpenAQ/TomTom/CPCB/GTFS/camera/SUMO/ATCS need real setup |

## Critical failures and gaps, prioritized

### P0 — Must fix before production or connecting real infrastructure

1. **Authentication and authorization are disabled.** `dependencies.py` supplies a shared demo admin identity; authority and ingestion writes are accessible without actual login/roles. Restore secure user auth, role checks, tenant/city boundaries, CSRF/session policy as appropriate, rate limits and audit logs before exposing to real users.
2. **No production frontend build verified.** Resolve dependency installation/build in the intended Node environment and add browser-level route testing.
3. **No secrets or operational feeds in the source archive.** Provider integrations must be configured in backend-only secrets/host environment. Never put Groq/provider keys in Vite client variables.
4. **No physical control integration.** Keep all signal operations human-approved and preview-only until a controller interface, safety interlocks, operator authorization and rollback are implemented and tested.

### P1 — Needed for the requested “all features” live platform

1. **Live traffic camera network:** RTSP/ONVIF camera registration, encrypted credentials, worker pool, reconnect handling, health monitoring, per-camera ROIs, frame sampling, retention policy, redaction/privacy controls, and stream-to-junction mapping. Current capability is upload/push only.
2. **YOLO runtime reproducibility:** install pinned Ultralytics/PyTorch dependencies in a supported deployment image, validate `best.pt`, add CPU/GPU readiness checks, and test real sample clips end to end.
3. **Native digital twin:** install SUMO, run baseline/intervention tests, map actual city links/junctions to SUMO edges, calibrate traffic demand from measured counts, run TraCI or controlled batch simulations, and store scenario reproducibility metadata. Current 80-edge grid is synthetic.
4. **Continuous data pipelines:** provider adapters + background scheduler/queue, retries/backoff, freshness/heartbeat from actual records, schema validation, deduplication and observability. A manual source registry row is not a connected source.
5. **AQI station integration:** CPCB/OpenAQ/authorized sensor ingestion, station metadata/location, calibrated PM2.5/PM10 readings, missing-data quality flags and clear separation of measured vs CAMS model output.
6. **Agent LLM path:** install/configure LangGraph and Groq server-side, use a valid model, add tool timeout/retry and structured output validation, trace each tool call, and persist reasoning/evidence provenance. Keep deterministic fallback visible and safe.
7. **GTFS and GTFS-Realtime:** import a real operator feed, validate route/stop IDs and service calendars, ingest vehicle positions/alerts/trip updates and test arrival freshness. Add payment only through a real authorized ticketing provider.

### P2 — Product completeness and usability

1. Add a dedicated operational alerts page with list, severity, acknowledge/resolve, filters and history.
2. Add a real AQI Vision UI (image upload + environmental inputs) if the legacy multimodal classifier is still a product requirement; its backend endpoint currently lacks a routed UI.
3. Extend analytics to aggregate camera counts, observations, AQI, emissions, trips, feed uptime and simulation comparisons.
4. Replace hard-coded landing snapshot KPIs with timestamped API data or clearly labelled “model snapshot” values.
5. Add actual account management and per-user trip histories once authentication is restored.
6. Add browser end-to-end testing at desktop/tablet/mobile sizes; source smoke tests do not prove layout or actual click flows.

## Recommended end-state feature architecture

1. **City data ingestion layer:** source registry backed by real connectors and scheduled workers for cameras, traffic counters, CPCB/OpenAQ, weather, GTFS/GTFS-RT and IoT.
2. **Evidence layer:** time-stamped, geospatially indexed events with source quality, confidence, camera/station identity and immutable provenance.
3. **Intelligence layer:** traffic detector/tracker, queue/speed estimation calibrated to each camera, AQI nowcast/forecast, congestion prediction, emissions estimator and LangGraph traffic operations agent.
4. **Simulation layer:** mapped road network plus SUMO/TraCI, calibrated demand, baseline/intervention experiments and scenario comparison.
5. **Decision layer:** agent-generated recommendations with evidence, confidence, predicted impact, approval, expiry, rollback plan and audit trail.
6. **Operations layer:** command centre, camera health, sensor health, alerts, incidents, signal plans, analytics, access control and full audit logs.
7. **Citizen layer:** live traffic-aware route planning, measured-vs-modelled AQI, GTFS-based transit, trip preferences and accessible alerts.

## Re-running checks

From the project root:

```bash
python -m compileall -q backend/app backend/tests
pytest -q backend/tests
node frontend/test-agent-frontend.js
node frontend/test-public-routing.js
```

For the frontend production bundle, from `frontend/` after a successful dependency install:

```bash
npm ci
npm run build
```

For backend setup, use `RUNNING.md`, `backend/README.md`, `.env.example` and `TRAFFIC_LAB_SETUP.md`. Keep the demo authentication mode restricted to local synthetic demonstrations.

## Scope note about “UrbanSaarthi memory/database”

This audit used the saved UrbanSaarthi project context from prior conversations to evaluate the uploaded source against the intended feature scope. It also created and tested a **fresh local SQLite database** using the archive's migrations and seed script. It did **not** connect to or inspect a deployed production database because no live database URL/credentials were supplied. The report must not be interpreted as proof of the state of a hosted MongoDB/PostgreSQL instance.
