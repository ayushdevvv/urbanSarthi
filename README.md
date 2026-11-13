# UrbanSaarthi

UrbanSaarthi is an urban mobility and air-quality operations platform for citizens and city teams. It combines route planning, traffic observations, camera-based vehicle analysis, AQI context, transit information, forecasts, signal-plan studies and an optional vehicle-level digital twin.

## Product areas

### Citizen
- Route planning with fastest, balanced and cleaner preferences.
- Location-based traffic conditions and available incident updates.
- Location-search AQI observations and forecasts with source and freshness labels.
- Public transport planning when a supported timetable or live feed is available.
- Saved trip history.

### Authority
- City overview with Delhi public reference corridors, AQI snapshots and public traffic advisories.
- Traffic Lab for YOLO/OpenCV image and sampled-video analysis, including persistent reports.
- Traffic Agent for evidence review, draft recommendations and read-only corridor analysis.
- 60-minute network simulation with five-minute forecast frames and animated road playback.
- Signal Plan Studio for separate forecast-based timing what-if studies and saved comparisons.
- Digital Twin for vehicle-level SUMO playback when the native simulator is available.
- AQI monitoring, emissions estimates and IoT source/observation management.

## Data integrity

The included Delhi seed is deliberately a **public reference dataset**, not a fake live feed:
- Ten named corridor/junction references have approximate coordinates and are marked `reference_only`; they are not connected signal controllers.
- Eight public AQI station summary values are historical snapshots from 27 October 2026, 11:00 IST. They are not current station readings.
- Two Delhi Traffic Police advisories are seeded with their source and validity windows. Recheck the official notice before acting on a diversion.
- No synthetic vehicle detections or traffic observations are inserted by the seed migration.

Sources:
- Delhi AQI public dashboard: https://www.aqi.in/in/dashboard/india/delhi
- Delhi Traffic Police traffic circulation plan: https://traffic.delhipolice.gov.in/traffic-circulation-plan

The application distinguishes live observations, cached data, historical references, forecasts and simulations. Missing data should remain unavailable rather than being displayed as a measured zero.

## Local setup

Requirements: Python 3.12 and Node.js 20 or newer.

### Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade heads
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
```

The local frontend API URL should be `http://127.0.0.1:8000/api/v1`. Never put server-side provider keys in a `VITE_` variable.

## Existing production deployment

The production deployment is designed to preserve the existing services:

- Vercel frontend: `https://urbansarthi.vercel.app`
- Existing Render API: `https://urbansarthi.onrender.com`
- Render runtime: native Python, no Docker.
- Render root directory: `backend`.
- Render build command: `pip install -r requirements.txt`.
- Render health check: `/healthz`.
- Vercel frontend root directory: `frontend`; build command `npm run build`; output directory `dist`.
- Production browser API path: `/api/v1`, forwarded by Vercel to the existing Render API.

**Keep the existing Render Start Command exactly as configured:**

```bash
alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Do not create a second Render service, switch the existing service to Docker, or replace its database. Preserve the existing `DATABASE_URL` and `INGESTION_API_KEY` values.

## Environment configuration

Start from the root, `backend/.env.example` and `frontend/.env.example` templates. Configure real values in your local ignored `.env` files or hosting-provider environment settings. Never commit secrets.

Core backend variables:

- `DATABASE_URL`: existing PostgreSQL connection string in production.
- `INGESTION_API_KEY`: server-side key for device/edge ingestion.
- `CORS_ORIGINS`: include `https://urbansarthi.vercel.app` for direct API tools; the production frontend uses the same-origin Vercel rewrite.
- `GEMINI_API_KEY`: optional server-side Google AI Studio key.
- `GOOGLE_AI_PRIMARY_MODEL`: defaults to `gemini-3.8-flash`.
- `GOOGLE_AI_FALLBACK_MODEL`: defaults to `gemma-4-26b-a4b-it`.
- `TOMTOM_API_KEY`, `TAVILY_API_KEY`, `OPENAQ_API_KEY`, `WEATHER_API_KEY`: optional provider credentials.
- `SUMO_BINARY` and `SUMO_HOME`: optional overrides. Leave blank to allow discovery from the installed `eclipse-sumo` wheel.

Google AI is an enhancement, not a startup dependency. Missing keys, model quota errors or AI timeouts must not prevent core API startup or core traffic/AQI pages from working. Free-tier availability and quotas are controlled by Google and can change. Do not send identifiable CCTV footage or sensitive personal information to a free-tier model API.

## Simulation boundaries

- **60-minute Traffic Simulation**: a five-minute-step network forecast and animated reference-road playback. It is not a live measurement or a per-vehicle microscopic simulation.
- **Signal Plan Studio**: separate model-assisted timing what-if comparisons. It creates reviewable studies; it does not control physical traffic lights.
- **Digital Twin**: individual vehicle-level simulation only when SUMO is detected and successfully runs. It must not silently substitute a forecast and call it a digital twin.

## Tests

Backend:

```bash
cd backend
pytest -q
```

Frontend smoke checks:

```bash
cd frontend
node test-agent-frontend.js
node test-public-routing.js
```

A full browser production build should also be run with `npm ci && npm run build` before promoting a release. External provider behaviour must be smoke-tested with real credentials and source availability.
