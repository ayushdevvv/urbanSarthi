# UrbanSaarthi

**City mobility and environmental intelligence for citizens and operations teams.**

UrbanSaarthi combines citizen mobility services with an authority operations workspace: route planning, traffic and camera intelligence, AQI monitoring/forecasting, a Traffic Agent, signal-plan review, scenario simulation, public transit, source health and city analytics.

This repository is built to distinguish real observations from forecasts, model scenarios and unavailable integrations. Empty live dashboards are intentional until real providers/devices are connected; demo data is never silently substituted for missing live data.

## Product areas

### Citizen workspace
The citizen navigation intentionally contains five destinations:

- **Home:** route planning begins only after the user submits origin and destination; location is requested only after an explicit action.
- **AQI Forecast:** search any city, neighbourhood or address for current air-quality conditions, pollutant cards and a 24-hour forecast.
- **Traffic Conditions:** explicitly use device location or search an area to map nearby roads, show provider-backed speed/incidents where available, and read nearby traffic news.
- **Bus & Train:** discover mapped stops/routes, search recent service updates and show timetable/realtime arrivals only when agency data is connected.
- **My Trips:** save journeys and review personal trip history.

### Authority workspace

- **City Overview:** mapped registered junctions, AQI stations, source freshness, alerts and city reports.
- **Traffic Lab:** OpenCV/YOLO image and video analysis, annotated evidence, vehicle-class reports and authorized RTSP edge-camera ingestion.
- **Traffic Simulation:** native SUMO baseline vs. signal intervention, using actual SUMO FCD vehicle coordinates/headings for playback and edge interval metrics for road reports.
- **Traffic Agent:** evidence review, forecasting, emissions estimates and signal-plan recommendations with operator approval.
- **AQI:** air-quality observations, forecasts and hotspots.
- **Carbon Emissions:** vehicle-class and distance-based pollutant estimates.
- **IoT Sensors:** device observations protected by a separate ingestion key and ESP32/PMS5003 integration starter.

The platform separates observations, forecasts, news, model scenarios and unavailable integrations. Missing live data is shown as unavailable rather than replaced with invented metrics. Physical traffic-signal writes are intentionally disabled.

## Architecture

- `frontend/`: React + Vite SPA, citizen and authority surfaces, responsive shared design system.
- `backend/`: FastAPI, SQLAlchemy, Alembic, forecasting, YOLO and integration adapters.
- `backend/scripts/edge_camera_worker.py`: separate RTSP/YOLO edge worker for authorized cameras.
- `hardware/`: ESP32 + PMS5003 HTTP telemetry starter.
- `docs/FEATURE_READINESS.md`: capability-by-capability implementation and live-data truth table.
- `docs/LIVE_SYSTEM_SETUP.md`: production, provider, camera, SUMO, transit and IoT setup instructions.

## Local development

### Backend

Python 3.11+ recommended.

```bash
cd backend
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env   # on Windows, copy .env.example .env
alembic upgrade heads
python scripts/seed_demo.py
uvicorn app.main:app --reload
```

The hackathon build is intentionally public: citizen and authority pages require no human login. Each browser receives an anonymous visitor identity for its own trip history; device ingestion still requires a server-side key. See the root `.env.example`, `backend/.env.example` and `frontend/.env.example` for configuration templates. The default seed registers provider sources only. To explicitly generate a synthetic lab network or synthetic telemetry, use `--demo-network` or `--demo-telemetry`; never enable those in production.

API docs: `http://127.0.0.1:8000/docs`  
Health: `http://127.0.0.1:8000/healthz` and `/readyz`.

### Frontend

In another terminal:

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev
```

`VITE_API_URL` must include `/api/v1` for local development overrides. Production always uses a same-origin `/api/v1` Vercel rewrite to the existing Render service. Provider credentials, database passwords and device-ingestion keys must never be placed in frontend variables.

## Live deployment

For the hackathon deployment, use PostgreSQL, an explicit non-wildcard `CORS_ORIGINS`, and a separate 32+ character `INGESTION_API_KEY`. There is no human login in this public demo. For a real city-authority production rollout, re-enable proper identity and role-based access controls before exposing administrative actions.

See **[Public hackathon mode and Render settings](./docs/PUBLIC_HACKATHON_NO_AUTH_AND_RENDER.md)** for no-login behavior, exact native Python Render configuration, environment variables and deployment checks. See **[Feature readiness](./docs/FEATURE_READINESS.md)** for what runs now versus what requires external access, feeds, devices or calibration. For the latest latency fixes, production API URL and native SUMO deployment option, see **[Traffic, AQI and simulation fixes](./docs/TRAFFIC_AQI_SIMULATION_FIX.md)**. The root `render.yaml` targets the existing native Python service `urbansarthi`, installs the official `eclipse-sumo` Linux wheel through pip, pins Python 3.12.16, and keeps the existing Alembic migration and Uvicorn start command; no `apt-get`, Docker runtime or second service is needed. See [native SUMO wheel setup](./RENDER_NATIVE_SUMO_PIP_SETUP.md) for the corrected Render build command and verification steps.

## Data-source truth and limitations

- Open-Meteo/CAMS are atmospheric model forecasts, not official CPCB station measurements.
- OpenAQ supplies pollutant concentration observations; the connector does not invent an official CPCB AQI value.
- OpenWeather AQI is a distinct 1–5 scale and is shown separately from US AQI/CPCB AQI.
- TomTom integration returns a current road-flow snapshot for a queried coordinate; it is not a complete live traffic-aware routing engine.
- YOLO camera worker events are sampled-frame vehicle counts. Queue, speed and wait metrics remain unknown unless calibrated measurement logic supplies them.
- Transit schedules require an operator-imported GTFS feed; live arrivals require a separate provider/GTFS-RT adapter.
- The bundled SUMO network is synthetic. Real-city simulation requires network conversion, junction/edge mapping, demand calibration and validation against observations.
- Signal dispatch is a preview only. No command is sent to physical controllers.
- Carbon values are estimates based on vehicle counts and assumptions, not direct exhaust measurements.

## Quality checks

```bash
cd backend
python -m pytest -q
python -m compileall -q app scripts
```

Frontend smoke tests:

```bash
cd frontend
node test-agent-frontend.js
node test-public-routing.js
```

Run `npm ci && npm run build` in a network-enabled CI/deployment environment before release. This project workspace previously could not complete npm installation because DNS resolution for the npm registry failed, so a production Vite build was not verified in that environment.
