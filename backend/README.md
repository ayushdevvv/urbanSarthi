# UrbanSaarthi API

FastAPI + SQLAlchemy + Alembic backend for citizen mobility and authority operations. The exact production integration matrix and environment-variable setup live in:

- [`../docs/FEATURE_READINESS.md`](../docs/FEATURE_READINESS.md)
- [`../docs/LIVE_SYSTEM_SETUP.md`](../docs/LIVE_SYSTEM_SETUP.md)

## Local setup

Python 3.11+ recommended.

```bash
python -m venv .venv
# Windows: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
alembic upgrade heads
python scripts/seed_demo.py
uvicorn app.main:app --reload
```

Local defaults use SQLite and a development-only demo identity. Default seeding registers provider sources without synthesizing a city network or traffic observations. Synthetic lab fixtures are opt-in:

```bash
python scripts/seed_demo.py --demo-network --demo-telemetry
```

Never use those flags in a production database.

## Security model

- Local development can use the demo identity when `APP_ENV=development` and `AUTH_ENABLED=false`.
- Production startup requires PostgreSQL, explicit CORS origins, `AUTH_ENABLED=true`, `JWT_SECRET` (32+ characters) and `INGESTION_API_KEY` (a different 32+ character secret).
- People authenticate with bearer tokens. The backend loads current role and active status from the database on each request.
- Device/provider ingestion uses `X-Ingestion-Key`; camera upload and operations endpoints require operator/admin role.
- Public registration only creates `citizen` users. Email verification, signup rate limiting, MFA and password-reset delivery are not implemented yet.

## Important API groups

All routes are under `/api/v1`; `/docs` exposes the precise schema and parameters.

| Domain | Main endpoints |
|---|---|
| Authentication | `/auth/register`, `/auth/login`, `/auth/me` |
| Routing and trips | `/routing/plan`, `/trips`, `/analytics/my-mobility` |
| Traffic and predictions | `/traffic/current`, `/traffic/overview`, `/traffic/junctions`, `/traffic/simulation`, `/predictions/*` |
| Camera / agent | `/traffic-detection/analyze`, `/traffic-detection/analyze-video`, `/traffic-detection/ops-workflow`, `/ingestion/vision-events`, `/ingestion/source-heartbeat` |
| AQI | `/aqi/observations`, `/aqi/nearby`, `/aqi/location-forecast`, `/integrations/openaq/sync` |
| Signals and simulation | `/signals/plans`, `/signals/recommendations/*`, `/simulations` |
| Transit | `/transit/routes`, `/transit/stops`, `/transit/plan`, `/transit/gtfs/import`, `/transit/realtime-arrivals` |
| Command centre | `/command-center/overview`, `/command-center/health/data-sources`, `/alerts`, `/analytics/city-summary` |
| Administration | `/admin/data-sources`, `/admin/junctions`, `/admin/users`, `/integrations/status` |

## Camera edge worker

The RTSP worker runs separately on an authorized camera-network host. Install its dedicated dependencies and configure `CAMERA_RTSP_URL`, `URBANSAARTHI_API_URL`, `INGESTION_API_KEY`, and `TRAFFIC_MODEL_PATH`; then run:

```bash
pip install -r scripts/requirements-edge.txt
python scripts/edge_camera_worker.py --junction-id JUNCTION_EXTERNAL_ID --source-id CAMERA_SOURCE_EXTERNAL_ID
```

It posts compact YOLO count observations and heartbeats. It does not upload raw video. Vehicle counts are sampled-frame detections; calibrated queue/speed/wait data requires additional site-specific measurement logic.

## Tests and migrations

```bash
python -m pytest -q
python -m compileall -q app scripts
alembic check
```

Do not edit already-applied migration files. Add a new migration, review it, test it against a disposable database, back up PostgreSQL and deploy additively.

## Safety boundary

Signal workflows create draft plans, scenario comparisons, approval/rejection states and dispatch previews. Physical traffic-controller writes are deliberately disabled. An authorized vendor integration, lab validation, interlocks, fail-safe design and operational safety case are prerequisites before connecting to ATCS.
