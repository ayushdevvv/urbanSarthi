# UrbanSaarthi requirement-to-backend matrix

This matrix is the backend implementation checklist derived from the 14-page Navkalp project proposal. Its user-facing pages emphasize integrated mobility, pollution-aware routing, public transit, junction prediction, a digital twin/what-if simulator and a live command centre.

**Status key:** `Implemented` = API/schema path is in the repo and covered by tests or direct endpoint logic. `Integration required` = endpoint/adapter contract exists but depends on a city feed, credentials or deployment-specific provider. `Prototype boundary` = represented transparently, not misrepresented as a production-grade capability.

| Proposal requirement | Backend support | Status / caveat |
|---|---|---|
| Citizen + commuter journey | No-login route planning, shared demo trip history, route selection, start/complete/cancel lifecycle | Implemented |
| One place for traffic, transit, AQI and routes | Route planner combines available observations, routing and GTFS data and returns provider/data-quality/freshness metadata | Implemented; values depend on ingested sources |
| Starting point and destination / GPS coordinates | Coordinate-validated route-planning request with labels and optional departure time | Implemented; geocoding/search is a frontend/provider integration |
| Fastest route | Preference sorting by estimated/provider route duration | Implemented; heuristic time is labelled as estimated without OSRM |
| Cleanest route | Sample recent AQI near route points, compare pollutant-aware route scores | Implemented when an actual, recent AQI value exists; otherwise pollution score is omitted instead of fabricated |
| Balanced route | Time/pollution weighted ordering | Implemented; falls back transparently when AQI unavailable |
| Road-network route alternatives | OSRM-compatible optional integration | Integration required via `OSRM_BASE_URL`; standard OSRM does not imply live traffic |
| Real-time traffic monitoring | Junction registry, time-stamped observation history, volume, queue, speed, wait, density, congestion and lane-demand values | Implemented as storage/query; real telemetry requires authorized feed |
| Reuse of existing CCTV | Edge-computed JSON event ingestion endpoint, external-junction mapping and source labels | Integration required: no raw RTSP reader/YOLO worker is bundled |
| Vehicle count / queue length / density | Traffic observation schema and vision-event payload; supports detection-summary JSON | Implemented as API; CV inference runs externally |
| Junction-level 60-minute traffic forecast | Forecast rows at NOW, +15, +30, +45, +60 minutes and model-version/feature snapshots | Implemented; bounded heuristic by default; optional trained queue estimator via `MODEL_PATH` |
| Queue, vehicle volume, wait and congestion prediction | Queue estimator plus transparent calculations for associated metrics | Prototype boundary until calibrated with historical/validated SUMO/city data |
| AQI / PM2.5 / PM10 / NO2 / O3 / CO | Observation schema, nearby-station API, timestamps/freshness filters, OpenAQ v3 pull endpoint | Implemented for ingestion/query; official CPCB AQI feed needs provider approval/credentials |
| AQI-aware routing | Recent station values sampled near route coordinates, pollution score included only when support exists | Implemented with available station data; estimated exposure is a route-level proxy, not personal exposure measurement |
| Live public transport routes | GTFS static route/stop/trip/stop-time/calendar importer and route/stop endpoints | Implemented for GTFS static files |
| Live arrivals/frequency | GTFS timetable + optional `frequencies.txt` headway calculations; push endpoint for real-time ETAs/delays | Implemented contract; live ETA feed required; `exact_times=0` frequencies are estimates |
| Multi-modal journey | Transit direct and one-transfer options plus driving/walking/cycling route options | Partial: journeys requiring two or more transfers are not computed; provider routing is still required for road geometry/live traffic |
| Smart ticketing | Shared demo ticket-request history, status, cancellation, provider-status contract | Prototype boundary: not a confirmed booking, valid ticket, QR admission credential or payment transaction until an official operator is integrated |
| Service disruptions | Transit alerts and city traffic/AQI/roadwork/incident/system alerts with severity and lifecycle | Implemented |
| Live Urban Command Centre | Network and cluster summaries, online/degraded statuses, current congestion, queue/vehicle metrics, AQI coverage, alerts, latest forecasts and source freshness | Implemented; only data actually received by API is shown |
| 24 connected clusters | Seed command creates 24 clearly synthetic clusters with 48 placeholder junctions | Implemented seed baseline; replace synthetic coordinates and labels before real pilot |
| Adaptive signal planning | Demand-weighted signal-phase recommendation; configurable green/yellow/all-red timings; draft/simulated/approved/rejected lifecycle | Implemented as recommendation and review workflow |
| Dynamic green split | Uses incoming lane-demand weights to create a draft phase allocation under cycle limits | Prototype boundary: not validated for field control |
| Demo signal review | Audit entries, approval/rejection and dispatch-preview payload | Public demo API; physical ATCS dispatch is disabled and no controller command is sent |
| Digital twin / what-if comparison | Records current observation baseline, proposed phases, queue/wait/throughput estimates and caveats | Prototype boundary: analytical model now; no SUMO execution in this build |
| SUMO integration | Data-source registry and simulation engine boundary | Integration required: calibrated `.net.xml`, routes/demand, TLS mapping and a dedicated runner must be configured |
| City alerts / operational actions | Create, list, filter, resolve, severity and resolution note | Implemented |
| Continuous improvement | Retains telemetry, route choices, selected options, trip lifecycle and actual-metric JSON; training script produces MAE/RMSE | Implemented data pipeline surface; automated retraining/model registry/drift alerts still need deployment jobs |
| City/mobility analytics | Personal usage metrics and operator city summary | Implemented for the shared demo workspace; records are not private or user-isolated |
| Source health | Data-source registry, heartbeat endpoint, status/freshness and error fields | Implemented |
| Security and accountability | Public unauthenticated demo endpoints, shared workspace, audit logs, environment secrets, non-actuating traffic design | Demo-only; authentication and role checks must be restored before production |
| Schema versioning without drift | SQLAlchemy 2.x metadata, Alembic migration history (base + GTFS frequency) and no startup `create_all` | Implemented; new changes must use new reviewed Alembic revisions |

## Database domains

- **Legacy workspace reference:** `users` table remains for existing foreign-key compatibility; no login or role APIs consume it.
- **Road network/traffic:** `city_clusters`, `junctions`, `traffic_observations`, `traffic_forecasts`.
- **Air quality:** `aqi_observations`, with original-source and timestamp metadata.
- **Mobility:** `trips`, `route_options`, per-user selected-route/lifecycle records.
- **Transit:** `transit_routes`, `transit_stops`, `transit_trips`, `transit_stop_times`, `transit_frequencies`, `transit_calendars`, `transit_calendar_dates`, `transit_realtime_arrivals`, `transit_alerts`.
- **Authority operations:** `signal_plans`, `simulation_runs`, `city_alerts`, `data_sources`, `audit_logs`.
- **Ticket requests:** `ticket_orders` with an explicit `requested` state until a provider confirms it.

## Core safety/validity decisions

1. Missing live data returns null/unavailable state and a warning rather than invented values.
2. Every heuristic/model forecast contains a model version and a snapshot of the inputs used.
3. Ticket requests do not collect card details or claim to issue valid tickets.
4. Signal proposals are advisory and auditable in this public demo mode. A preview is never sent to physical equipment.
5. Simulation output explicitly says whether SUMO was executed. The current analytical engine never claims it ran SUMO.
6. Demo seed data is tagged `synthetic-demo`, and synthetic coordinates are marked unverified.
7. Schema changes are controlled through Alembic so development and deployed databases can be upgraded in sequence.
