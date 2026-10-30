# UrbanSaarthi requirement-to-backend matrix

This matrix is the backend implementation checklist derived from the 14-page Navkalp project proposal. Its user-facing pages emphasize integrated mobility, pollution-aware routing, public transit, junction prediction, a digital twin/what-if simulator and a live command centre.

**Status key:** `Implemented` = API/schema path is in the repo and covered by tests or direct endpoint logic. `Integration required` = endpoint/adapter contract exists but depends on a city feed, credentials or deployment-specific provider. `Prototype boundary` = represented transparently, not misrepresented as a production-grade capability.

| Proposal requirement | Backend support | Status / caveat |
|---|---|---|
| Citizen + commuter journey | Demo identity, route planning, shared trip history, route selection, start/complete/cancel lifecycle | Implemented |
| One place for traffic, transit, AQI and routes | Route planner combines available observations, routing and GTFS data and returns provider/data-quality/freshness metadata | Implemented; values depend on ingested sources |
| Starting point and destination / GPS coordinates | Coordinate-validated route-planning request with labels and optional departure time | Implemented; geocoding/search is a frontend/provider integration |
| Fastest route | Preference sorting by estimated/provider route duration | Implemented; heuristic time is labelled as estimated without OSRM |
| Cleanest route | Sample recent AQI near route points, compare pollutant-aware route scores | Implemented when an actual, recent AQI value exists; otherwise pollution score is omitted instead of fabricated |
| Balanced route | Time/pollution weighted ordering | Implemented; falls back transparently when AQI unavailable |
| Road-network route alternatives | OSRM-compatible optional integration | Integration required via `OSRM_BASE_URL`; standard OSRM does not imply live traffic |
| Real-time traffic monitoring | Junction registry, time-stamped observation history, volume, queue, speed, wait, density, congestion and lane-demand values | Implemented as storage/query; real telemetry requires authorized feed |
| Reuse of existing CCTV | Uploaded video is sampled by OpenCV and processed with the bundled YOLO checkpoint; ByteTrack IDs and operator-defined camera ROIs are supported | Implemented for upload/analysis; direct RTSP/live CCTV ingest and map-matched lanes still require integration |
| Vehicle count / queue length / density | YOLO image/video detection, sampled-frame and track counts, ROI approach counts, annotated frame and observation persistence | Vehicle counts implemented for upload; queue length/density/speed are not inferred from video unless separately calibrated/ingested |
| Junction-level 60-minute traffic forecast | Forecast rows at NOW, +15, +30, +45, +60 minutes and model-version/feature snapshots | Implemented; bounded heuristic by default; optional trained queue estimator via `MODEL_PATH` |
| Queue, vehicle volume, wait and congestion prediction | Queue estimator plus transparent calculations for associated metrics | Prototype boundary until calibrated with historical/validated SUMO/city data |
| AQI / PM2.5 / PM10 / NO2 / O3 / CO | Observation schema, nearby-station API, timestamps/freshness filters, OpenAQ v3 pull endpoint | Implemented for ingestion/query; official CPCB AQI feed needs provider approval/credentials |
| AQI-aware routing | Recent station values sampled near route coordinates, pollution score included only when support exists | Implemented with available station data; estimated exposure is a route-level proxy, not personal exposure measurement |
| Traffic-related emissions engine | Class-specific CO2, NOx, PM and CO estimates with vehicle-km, factor version, source URLs and explicit assumptions | Implemented as a transparent prototype estimator; factors and fuel-use assumptions are not Kanpur fleet-calibrated |
| Pollution hotspot ranking | Latest junction observation ranked with congestion/volume, estimated NOx+PM and nearest recent ambient AQI where available | Implemented as a relative shortlist score, not a regulatory AQI or health-risk scale |
| Emissions-aware signal optimization | Candidate green split combines approach volume (70%) and relative NOx+PM+CO class proxy (30%) under minimum-green and 45% caps | Implemented only with four canonical camera ROIs; otherwise equal-split draft with `optimized=false` |
| Baseline vs intervention comparison | Native SUMO baseline and candidate runs with identical deterministic multi-class generated demand, fixed seed, traffic metrics and estimated pollutant deltas | Implemented when SUMO is installed; no comparison fallback is claimed when SUMO is missing |
| Environmental impact report | Saved JSON report with scenario, metrics, emissions factors, caveats and candidate phases | Implemented; PDF export and locally validated emission inventory are future work |
| Live public transport routes | GTFS static route/stop/trip/stop-time/calendar importer and route/stop endpoints | Implemented for GTFS static files |
| Live arrivals/frequency | GTFS timetable + optional `frequencies.txt` headway calculations; push endpoint for real-time ETAs/delays | Implemented contract; live ETA feed required; `exact_times=0` frequencies are estimates |
| Multi-modal journey | Transit direct and one-transfer options plus driving/walking/cycling route options | Partial: journeys requiring two or more transfers are not computed; provider routing is still required for road geometry/live traffic |
| Smart ticketing | Authenticated ticket-request history, status, cancellation, provider-status contract | Prototype boundary: not a confirmed booking, valid ticket, QR admission credential or payment transaction until an official operator is integrated |
| Service disruptions | Transit alerts and city traffic/AQI/roadwork/incident/system alerts with severity and lifecycle | Implemented |
| Live Urban Command Centre | Network and cluster summaries, online/degraded statuses, current congestion, queue/vehicle metrics, AQI coverage, alerts, latest forecasts and source freshness | Implemented; only data actually received by API is shown |
| 24 connected clusters | Seed command creates 24 clearly synthetic clusters with 48 placeholder junctions | Implemented seed baseline; replace synthetic coordinates and labels before real pilot |
| Adaptive signal planning | Camera-ROI approach counts plus 70% approach-volume and 30% NOx+PM+CO intensity proxy; min-green and 45% green-budget cap; draft/simulated/approved/rejected lifecycle | Implemented as advisory candidate generation; requires all four canonical ROIs for directional optimization and field safety validation before deployment |
| Dynamic green split | Four canonical camera ROIs; approach demand and relative local-pollutant intensity contribute to proposed green-time allocation | Prototype boundary: camera calibration is operator-defined; equal-split fallback when calibration is incomplete; not certified for field control |
| Human-authorized control | Role checks, audit entries, approval/rejection and dispatch-preview payload | Implemented; physical ATCS dispatch is disabled and no controller command is sent |
| Digital twin / what-if comparison | Optional native SUMO CLI executes 3,600-second baseline and intervention scenarios on the same deterministic generated demand and fixed seed; compares waiting, queue, throughput and estimated pollutant totals | Implemented for the bundled synthetic network when SUMO is installed; not a real mapped-city simulation and not a field impact claim |
| SUMO integration | Native CLI runner, bundled synthetic `grid.net.xml`, generated multi-class routes, patched signal cycles, summary/tripinfo parsing and pollutant estimator | Implemented for synthetic what-if scenarios when SUMO is installed; real city network/demand and signal mapping remain integration work |
| City alerts / operational actions | Create, list, filter, resolve, severity and resolution note | Implemented |
| Continuous improvement | Retains telemetry, route choices, selected options, trip lifecycle and actual-metric JSON; training script produces MAE/RMSE | Implemented data pipeline surface; automated retraining/model registry/drift alerts still need deployment jobs |
| City/mobility analytics | Personal usage metrics and operator city summary | Implemented; only registered-user trips are stored, not anonymous route queries |
| Source health | Data-source registry, heartbeat endpoint, status/freshness and error fields | Implemented |
| Security and accountability | Unauthenticated demo endpoints, shared demo identity, audit logs, environment secrets, non-actuating traffic design | Demo-only; authentication and role checks must be restored before production |
| Schema versioning without drift | SQLAlchemy 2.x metadata, Alembic migration history (base + GTFS frequency) and no startup `create_all` | Implemented; new changes must use new reviewed Alembic revisions |

## Database domains

- **Identity:** `users`, role, preferences, active state, password hash.
- **Road network/traffic:** `city_clusters`, `junctions`, `traffic_observations`, `traffic_forecasts`.
- **Air quality:** `aqi_observations`, with original-source and timestamp metadata.
- **Mobility:** `trips`, `route_options`, per-user selected-route/lifecycle records.
- **Transit:** `transit_routes`, `transit_stops`, `transit_trips`, `transit_stop_times`, `transit_frequencies`, `transit_calendars`, `transit_calendar_dates`, `transit_realtime_arrivals`, `transit_alerts`.
- **Authority operations:** `signal_plans`, `simulation_runs`, `city_alerts`, `data_sources`, `audit_logs`.
- **Ticket requests:** `ticket_orders` with an explicit `requested` state until a provider confirms it.

## Core safety/validity decisions

1. Missing live data returns null/unavailable state and a warning rather than invented values.
2. Ambient AQI is not inferred from tailpipe emissions; pollutant estimates retain their units, factor versions and assumptions.
3. Hotspot scores are relative to the returned set, not a regulatory AQI category or health-risk index.
4. An emissions-aware directional signal split requires all four operator-calibrated camera ROIs; otherwise the plan is explicitly equal-split.
5. The comparative emissions experiment requires native SUMO. XGBoost forecast output is never presented as a baseline-versus-intervention trial.
6. Every heuristic/model forecast contains a model version and a snapshot of the inputs used.
7. Ticket requests do not collect card details or claim to issue valid tickets.
8. Signal proposals are advisory, role-gated and auditable. A preview is never sent to physical equipment.
9. SUMO execution is labelled separately from XGBoost forecasting; both remain simulated/modelled outputs, not field measurements.
10. Demo seed data is tagged `synthetic-demo`, synthetic coordinates are marked unverified, and schema changes are controlled through reviewed Alembic revisions.
