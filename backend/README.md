# UrbanSaarthi Backend

FastAPI + SQLAlchemy 2.x + Alembic + PostgreSQL backend for the Navkalp UrbanSaarthi smart-mobility prototype.

The API maps to the project proposal: route planning by travel time and pollution, real-time traffic observations, AQI, bus/metro timetable and arrival information, trip history, smart-ticket request workflow, 60-minute junction forecasting, signal-plan recommendations, what-if simulation, city command-centre operations, alerts and multi-source data ingestion.

> **Important reality boundary:** the backend does not pretend to be connected to city CCTV, CPCB, GTFS real-time, a municipal ATCS controller or a running SUMO network until the relevant feed, credentials, mapping and validation are provided. Missing data is surfaced as missing; fallback estimates are labelled. Physical traffic signal writes and ticket payments are disabled.

## 1. Stack and design choices

- **FastAPI + Pydantic v2**: validated REST contracts and interactive OpenAPI docs.
- **SQLAlchemy 2.x**: ORM models with portable JSON columns; SQLite for quick local tests and PostgreSQL for deployment.
- **Alembic**: the only production schema-versioning mechanism. The app does not call `Base.metadata.create_all()` at startup.
- **Prototype demo identity**: shared demo operator identity; authentication is disabled in this archive.
- **Provider adapters**: OSRM-compatible road routing, OpenAQ v3 pull adapter, GTFS static upload, and push-ingestion for camera-derived traffic measurements, CPCB AQI readings and transit real-time arrivals.
- **Optional scikit-learn estimator**: queue-length predictor loaded from `MODEL_PATH`; until a trained model is supplied, forecasts use a bounded trend heuristic and identify themselves as such.

## 2. Quick start (Windows, macOS or Linux)

Python 3.11+ is recommended. From this directory:

```bash
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

python -m pip install --upgrade pip
pip install -r requirements.txt
```

Copy `.env.example` to `.env`. For a quick local run, SQLite is the default:

```bash
alembic upgrade head
python scripts/seed_demo.py
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000/docs`. Health checks: `/healthz` and `/readyz`.

To create a first admin account safely, set these environment variables **before** running the seed script:

```text
BOOTSTRAP_ADMIN_EMAIL=your-admin-email
BOOTSTRAP_ADMIN_PASSWORD=a-long-unique-password
BOOTSTRAP_ADMIN_NAME=UrbanSaarthi Admin
```

Then run `python scripts/seed_demo.py` again. The public registration endpoint can create citizen accounts only; it cannot self-assign an operator/admin role.

### Optional UI demo records

```bash
python scripts/seed_demo.py --demo-telemetry
```

This explicitly creates `synthetic-demo` observations to let the frontend display populated charts. They are not real traffic/AQI readings and should never be presented as live city intelligence. The seeded 24 clusters and 48 junctions use synthetic placeholder coordinates. Replace them with surveyed/authorized coordinates before the pilot.

## 3. Docker Compose (PostgreSQL)

1. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD` to a strong random password.
2. Start the services:

```bash
docker compose up --build -d
```

The API container waits for PostgreSQL, runs `alembic upgrade head`, then starts Uvicorn on port `8000`. View logs with `docker compose logs -f api`. Seed the database with `docker compose exec api python scripts/seed_demo.py`.

The default values in `docker-compose.yml` are for local development only. Do not expose them on a public server. When `APP_ENV=production`, configuration validation rejects wildcard/empty CORS origins and SQLite. Use PostgreSQL and explicitly set the frontend origin(s).

## 4. Schema versioning rules (keep versions from breaking)

This repository is wired for Alembic's SQLAlchemy metadata/autogeneration flow.

```bash
# current database version
alembic current

# after changing app/models.py, generate a NEW migration
alembic revision --autogenerate -m "describe the schema change"

# inspect the generated file before applying it
alembic upgrade head

# compare model metadata with the current database
alembic check
```

**Do not edit an already-applied migration to change a live schema.** Add a new migration, review its `upgrade()` and `downgrade()`, test it against a disposable database, then deploy it. Keep production changes additive when possible: add nullable columns, backfill, deploy code, then enforce constraints in a follow-up migration. Back up PostgreSQL before destructive migrations. The migration history begins at `alembic/versions/58b014c0ca43_initial_urbansaarthi_schema.py`; the follow-up `e77103841fd2` migration adds GTFS frequency support. Both existing revisions should remain immutable after applying them.

The `selected_route_id` value on a trip is validated against route options belonging to that trip by the API, rather than using a circular database foreign key. This avoids migration-order/SQLite compatibility headaches while preserving the ownership rule at the service boundary.

## 5. API map

Every REST route below is under `/api/v1`.

| Domain | Endpoints | Purpose |
|---|---|---|
| Demo access | Authentication endpoints are disabled in this archive | Shared demo identity for prototype testing |
| Route planning | `POST /routing/plan` | Fastest, cleanest or balanced trip options; returns source/data-quality warnings |
| Trip history | `GET /trips`, `GET /trips/{id}`, `GET /trips/{id}/routes`, `POST /trips/{id}/select-route`, `/start`, `/complete`, `/cancel` | Private trip lifecycle and history for signed-in citizens |
| Traffic | `GET /traffic/overview`, `GET /traffic/junctions`, `GET /traffic/junctions/{id}`, `GET /traffic/junctions/{id}/observations`, `POST /traffic/observations` | Junction status, vehicle count, queue, speeds, waits, density and lane demand |
| Edge vision | `POST /ingestion/vision-events` | Accept compact JSON detections from an external CCTV/YOLO edge worker; does not upload/store video |
| AQI | `GET /aqi/observations`, `GET /aqi/nearby`, `POST /aqi/observations` | Geospatial station readings, PM2.5/PM10/NO2/O3/CO/AQI, source timestamp and freshness |
| Public transit | `GET /transit/routes`, `GET /transit/stops`, `GET /transit/stops/{external_id}/arrivals`, `GET /transit/plan`, `POST /transit/gtfs/import`, `POST /transit/realtime-arrivals`, `GET/POST /transit/alerts` | GTFS routes/stops/calendar, direct and one-transfer journeys, frequency-based arrivals, pushed live arrivals and disruptions |
| Forecasting | `GET /predictions/model-status`, `POST /predictions/refresh`, `GET /predictions/junctions/{id}` | NOW, +15, +30, +45 and +60 minute queue/congestion/wait/volume forecasts |
| Signal plans | `POST /signals/recommendations/{junction_id}`, `POST /signals/plans`, `GET /signals/plans`, `POST /signals/plans/{id}/approve`, `/reject`, `/simulate`, `/dispatch-preview` | Demand-weighted green splits with human review and auditable preview |
| Digital twin | `POST /simulations`, `GET /simulations` | Current-vs-proposed analytical what-if metrics and explicit caveats |
| Command centre | `GET /command-center/overview`, `/clusters`, `/clusters/{id}`, `/health/data-sources` | City-level congestion, AQI coverage, active alerts, source freshness and junction rollups |
| City alerts | `GET /alerts`, `POST /alerts`, `POST /alerts/{id}/resolve` | Incident, AQI, roadwork and traffic alerts |
| Ticketing | `GET /ticketing/provider-status`, `POST /ticketing/orders`, `GET /ticketing/orders`, `GET /ticketing/orders/{id}`, `POST /ticketing/orders/{id}/cancel` | Ticket request lifecycle; the returned request reference is **not** a valid travel ticket |
| Analytics | `GET /analytics/my-mobility`, `GET /analytics/city-summary` | Recorded trip, usage and operational summaries |
| Administration | `GET /admin/data-sources`, `POST /admin/data-sources`, `POST /admin/data-sources/{external_id}/heartbeat`, `PATCH /admin/junctions/{id}/status`, `GET /admin/users`, `PATCH /admin/users/{id}/role` | Source registry, health, junction status and role management |
| Integrations | `GET /integrations/status`, `POST /integrations/openaq/sync` | Provider configuration state and OpenAQ v3 station sync |

`/docs` provides the exact request/response models, query parameters and status codes for the frontend integration.

## 6. Provider setup

### Traffic cameras / YOLO

Run video ingest and CV inference in a separate, authorized edge worker. Send count/queue/speed/density summaries to `POST /api/v1/ingestion/vision-events`. In this demo archive, authentication is disabled and this endpoint is publicly accessible. Do not send unapproved public CCTV URLs or credentials in `safe_config`; secrets belong in environment/secret storage.

### CPCB / OpenAQ

CPCB/CAAQMS formats and access credentials vary by authorized integration. Normalize those readings and push to `POST /api/v1/aqi/observations`; do not assume OpenAQ PM concentration equals the official CPCB AQI index.

OpenAQ v3 pull sync is implemented at `POST /api/v1/integrations/openaq/sync?latitude=28.61&longitude=77.20&radius_km=20`. Set `OPENAQ_API_KEY`. OpenAQ documents the `X-API-Key` header and its `/v3/locations/{id}/latest` resource in its official docs: https://docs.openaq.org/using-the-api/api-key and https://docs.openaq.org/api/operations/location_latest_get_v3_locations__locations_id__latest_get. The connector stores pollutant concentrations and intentionally does not fabricate a CPCB AQI value.

### GTFS / transit arrivals

A city/operator uploads a standards-based GTFS Static zip to `POST /api/v1/transit/gtfs/import` using multipart field `file`. The importer supports routes, stops, trips, stop times, calendar and calendar-date exceptions, plus optional `frequencies.txt`. Journey planning computes direct and one-transfer journeys; journeys needing two or more transfers are not computed. GTFS frequency windows create headway-based departures and arrivals (labelled as estimates when `exact_times=0`). Push vehicle ETA updates to `/api/v1/transit/realtime-arrivals`; recent live arrivals are surfaced ahead of static timetable entries.

### Road routing

Set `OSRM_BASE_URL` to a trusted, maintained OSRM-compatible endpoint for road-network geometry/alternatives. Standard OSRM routes do **not** automatically contain live congestion. If this variable is empty or the provider fails, road/walking/cycling routes fall back to transparent distance/time estimates and the response is labelled `estimated`; do not use fallback estimates for real-time navigation safety.

### Forecast model

The forecasting service currently predicts queue length from features `[vehicle_count, queue_length_m, average_speed_kmph, average_wait_seconds, lane_density, horizon_minutes]`. To train a model, prepare a CSV with those feature columns plus `target_queue_length_m` and run:

```bash
python scripts/train_queue_model.py path/to/validated_training_rows.csv --output models/queue_length.joblib
```

Set `MODEL_PATH=models/queue_length.joblib` and restart the API. The script emits MAE/RMSE on a holdout split. For production claims, validate on different junctions and later time windows, check data leakage, compare against simple baselines, and monitor drift. Do not report performance from synthetic seed observations as real-world accuracy.

### SUMO / signal control

The API records signal phase plans and runs a deterministic **analytical what-if baseline**. The `engine` and caveat fields are explicit. SUMO execution is not turned on merely by adding a data-source record; a calibrated network, demand/routes, traffic-light IDs and a dedicated simulation runner must be integrated and validated.

Signal plans progress through `draft`, `simulated`, `approved`, `rejected`. `/dispatch-preview` only emits a JSON preview after approval. It never transmits a command to physical traffic lights. Do not remove that guard without an authorized ATCS integration, engineering safety analysis, interlocks, fail-safe design, operator controls and field validation.

### Smart ticketing

The current API creates/cancels *requests*. It does not contact a bus/metro operator, charge a card, confirm a booking, or issue a valid ticket QR. Connect an authorized provider before changing an order to confirmed or adding payments.

## 7. Roles and ingestion access

- `citizen`: profile, route planning, own trips, own ticket requests, personal analytics.
- `operator`: traffic/AQI/transit ingestion, signal plans and reviews, command centre, alerts, simulations, source heartbeat and junction status.
- `admin`: operator permissions plus data-source and role administration.

In this simplified demo archive, ingestion and authority endpoints are publicly accessible. Use only synthetic data. Re-enable authentication, role checks and trusted-producer controls before production.

## 8. Basic smoke test

```bash
python -m pytest -q
alembic check
```

The six tests cover unauthenticated demo route planning/history, traffic ingestion, all five forecast horizons, signal recommendation, analytical what-if simulation, approval/dispatch preview, GTFS frequency-feed import and routing, one-transfer journeys, no-fabricated-transit behavior, and fail-closed production configuration.

## 9. Important current boundaries

- No frontend is included; the REST/OpenAPI contract is ready for it.
- Real telemetry depends on actual provider credentials/feeds. No data is silently generated as a substitute.
- The default route fallback is not turn-by-turn navigation.
- GTFS pathfinding currently supports direct and one-transfer journeys. Journeys needing two or more transfers are not computed; frequency windows with `exact_times=0` are correctly labelled as headway estimates tied to the supplied static feed.
- Forecast heuristics and analytical signal what-if outputs are not a validated traffic model.
- No automatic online model retraining is performed; observations are retained for offline evaluation/training.
- No physical traffic signal command or ticket/payment transaction is issued.


## Prototype access mode

Authentication and role checks are disabled in this simplified demo archive. Requests share a demo administrator identity so the UI can be tested without signing in. **All authority write APIs are publicly accessible in this mode. Do not use real data or deploy this build for production.**

## YOLO11 traffic vision MVP

The supplied `best.pt` checkpoint is stored at `backend/models/best.pt`. The API lazily loads it on the first inference request (rather than blocking API startup):

- `GET /api/v1/traffic-detection/status` reports whether weights and Ultralytics are available.
- `POST /api/v1/traffic-detection/analyze?confidence=0.25` accepts a multipart `file` field containing a JPG, PNG, or WebP image (maximum 8 MB).

The backend uses Ultralytics YOLO inference at `imgsz=640`, counts the model's `car`, `bus`, `motorbike`/`motorcycle`, and `bicycle` classes, returns all detected objects, and includes a JPEG-encoded annotated image. `person` detections are returned in the detection list but are not counted as vehicles. The confidence threshold is configurable between 0.05 and 0.9. The model is loaded once per worker and inference runs on CPU unless Ultralytics selects another available device.

`TRAFFIC_MODEL_PATH` can override the checkpoint path; otherwise it resolves to `backend/models/best.pt`. The frontend supports camera snapshots and image uploads. Browser camera access requires localhost or HTTPS and camera permission. It does not request audio. Only the frame explicitly analyzed is uploaded. If the backend/model is unavailable, the frontend can show a **labelled sample preview**; sample counts must never be presented as model output.

The supplied notebook's Low/Medium/High rules (0–3, 4–8, 9+ counted vehicles) are preserved as a **preliminary heuristic**, not validated real-world congestion. This image model does not measure speed, direction, queue length, unique vehicles across time, or live road congestion. Live scan samples frames; it is not multi-object tracking and counts can repeat between frames. For production deployment, confirm that the Render instance has sufficient memory for PyTorch/Ultralytics and verify an actual inference request after deployment.


## AQI Vision multimodal inference

The `aqi-vision` API adds an image + sensor category prediction flow using the supplied `MultimodalAQIModel` architecture and saved checkpoint. The four matching artifacts are kept in `backend/models/aqi/`.

- `GET /api/v1/aqi-vision/status` — checks required artifact presence and inference dependency availability without loading the heavy model.
- `POST /api/v1/aqi-vision/analyze` — multipart fields `front_image`, `rear_image`, `pm25`, `pm10`, `temperature`, `humidity`, `season`, `day_or_night`. Each image must be JPG, PNG, or WebP up to 8 MB.

Allowed season values are `Monsoon`, `Summer`, `Winter`; time-of-day values are `Day`, `Night`. Numeric validation uses PM2.5/PM10 0–2000 µg/m³, temperature −50–70 °C, and humidity 0–100%. The fitted preprocessor must output the expected nine features; the model checkpoint is loaded with strict state-dict matching. Model output is a six-class category probability distribution. It is not an official measured numeric AQI.

The supplied notebook reports test accuracy 82.09% and macro F1 0.7226. Those are notebook-reported metrics, not independent validation by this service. PyTorch and torchvision are pinned to CPU-only wheels in `requirements.txt`; inference is lazy-loaded and cached per process. Confirm memory headroom if Traffic Vision and AQI Vision are both used on the same small Render instance.
