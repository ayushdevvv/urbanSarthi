# UrbanSaarthi — Air Quality & Traffic Intelligence

A React/Vite frontend paired with a FastAPI backend, simplified for a no-login air-quality and traffic demo. The frontend is organized by shared components, layouts, citizen pages, authority pages and one API client.


> **Prototype/demo mode:** This archive has login and role checks disabled so the Citizen and Authority portals open directly. The backend creates/uses a shared demo admin identity, and authority write endpoints are unauthenticated. Use only with synthetic demo data; do not deploy this version for real users or connect it to operational systems. Re-enable authentication before production.

## Repository structure

```text
UrbanSaarthi/
├── frontend/
│   ├── src/
│   │   ├── components/       # layouts, reusable UI and Leaflet map
│   │   ├── context/           # theme, language and toast
│   │   ├── hooks/             # API resource lifecycle
│   │   ├── pages/
│   │   │   ├── landing/       # main portal selector
│   │   │   ├── citizen/       # home, planner, AQI station + AQI Vision, transit, trips
│   │   │   └── authority/     # AQI overview, carbon, traffic, IoT network and operations
│   │   ├── services/api/      # shared API client/endpoints
│   │   └── styles/            # authority and citizen UI styles
│   ├── .env.example
│   ├── vercel.json
│   └── vite.config.js
├── backend/                   # existing FastAPI + SQLAlchemy + Alembic app
├── hardware/                  # ESP32 + PMS5003 HTTP telemetry starter sketch
├── .gitignore
└── README.md
```

## Run locally

### 1. Backend

Read `backend/README.md` first. In brief, use Python 3.11+, create a virtual environment, install `backend/requirements.txt`, copy `backend/.env.example` to `backend/.env`, configure the database and CORS, run migrations, then seed the database and start Uvicorn:

```bash
cd backend
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
# Copy .env.example to .env and set the database/CORS values.
alembic upgrade heads
python scripts/seed_demo.py
uvicorn app.main:app --reload
```

API docs: `http://127.0.0.1:8000/docs`. Health checks: `/healthz` and `/readyz`.

### 2. Frontend

In a second terminal:

```bash
cd frontend
# Copy .env.example to .env and set VITE_API_URL if needed.
npm install
npm run dev
```

Open the Vite URL shown in the terminal. `VITE_API_URL` must include `/api/v1`. No API secrets belong in frontend environment variables.

## Deploy frontend to Vercel

Set the Vercel project Root Directory to `frontend`. Set `VITE_API_URL` in Vercel Environment Variables to the production backend URL including `/api/v1`. The existing `frontend/vercel.json` routes client-side paths to the Vite SPA entry point. Ensure the backend CORS configuration allows the deployed frontend origin.

## Referenced views covered

- Main portal selection
- Citizen home and map
- Route planning with fastest / balanced / cleanest preferences
- Air-quality stations and observations
- Location-based AQI outlook: current coordinates, Open-Meteo/CAMS AQI and pollutant forecasts, and map marker
- Traffic Vision: camera snapshots or upload, YOLO11 vehicle counts, annotated image, and labelled fallback
- Public transport routes, stops and service alerts
- Saved trips, details, lifecycle actions and CSV export
- Authority command centre, traffic map and alert panels
- Signal plan list, create, simulate and phase preview
- Data-source health, source registration and refresh
- Authority demo settings and preferences

## API integration and data integrity

The frontend calls documented API routes from `backend/openapi.json`. For example, command overview uses `/command-center/overview`, city analytics uses `/analytics/city-summary`, signal plans use `/signals/plans`, air quality uses `/aqi/observations`, routing uses `/routing/plan`, and trip history uses `/trips`.

Location-based AQI uses Open-Meteo/CAMS without a paid key. Routing and mapped transit discovery use public OpenStreetMap-derived services. Timetable availability is not inferred from stop locations; schedules require an operator GTFS/live feed. If road geometry is unavailable, route estimates do not draw straight-line paths. Reference fallback scenarios are explicitly distinguished from provider observations. The existing backend explicitly does not issue physical traffic signal writes or valid paid travel tickets.

## Screenshots and design target

The interface uses the supplied visual references as the visual target: light green-tinted work surfaces, dark green navigation, lime selection accents, spacious cards and Leaflet/OpenStreetMap views. The authority layouts follow the supplied dashboard structure; citizen-facing pages mirror the supplied portal, route-planning, AQI, public-transit and trips layouts. Exact rendered pixel equality must still be checked in a browser at the reference viewport sizes and with the same API data density.

## AQI Vision (multimodal model)

The `/citizen/aqi-vision` page now asks for the visitor's location and retrieves a current + 24-hour AQI outlook from Open-Meteo/CAMS without a key. It shows US AQI, pollutant concentrations and hourly forecasts, and explicitly notes that these are atmospheric model forecasts rather than official ground-station readings. The legacy image-based AQI endpoint is retained for compatibility, but it is no longer the primary location-AQI workflow.

## Final quality check

See [`FINAL_QA.md`](./FINAL_QA.md) for the AQI page render fix, model inference smoke test, responsive refinements, known verification limits, and deployment checklist.

## Traffic simulation forecast

The included SUMO-generated dataset contains 518,400 records from 36 runs across 80 road edges. The XGBoost model and separate 60-minute horizon model are available through `GET /api/v1/traffic/simulation` and `GET /api/v1/traffic/simulation/scenario`. The client can play the 60-minute model timeline at five-minute forecast steps. The 60-minute held-out evaluation is shown separately (61.5% congestion-level accuracy, MAE 3.93 vehicles, R² 0.384); this is a stored-data model scenario, not a live SUMO/TraCI process or current road sensor feed.

For production, set `VITE_API_URL=https://urbansarthi.onrender.com/api/v1` in Vercel and configure provider credentials only in the backend environment. The frontend has a production API fallback, but an explicit Vercel value is recommended.


## Render deployment troubleshooting

For an existing Render service that still runs an old start command, follow [`RENDER_DEPLOYMENT_FIX.md`](RENDER_DEPLOYMENT_FIX.md). The service dashboard Start Command can override `render.yaml`.


## OpenWeather AQI integration

The backend reads the secret from the environment variable `weather_api_key` (lowercase, exactly as named). Configure it on the **backend service** in your hosting provider, then redeploy/restart the backend. The key is never placed in frontend variables or sent to browsers. When configured, `/api/v1/aqi/location-forecast` prefers the OpenWeather Air Pollution API. If that provider is unreachable or its key is rejected, the endpoint falls back to Open-Meteo/CAMS.

OpenWeather's Air Quality Index is a separate 1–5 scale and is labelled separately from US AQI (0–500) in the UI; the two numbers are not mixed. See `backend/.env.example` for the variable name.

## Traffic Intelligence Lab (video, agent tools, and 60-minute scenarios)

The `/authority/traffic-lab` view now accepts uploaded traffic video or a road image. The backend samples video frames using OpenCV, runs the bundled YOLO checkpoint with tracking where IDs are available, returns measured detection metrics and an annotated peak frame, then uses a tool-calling operations workflow to draft a signal plan and run a 60-minute scenario. Operator approve/reject is required; dispatch preview never sends a command to real signal hardware.

**Simulation engines:** if a local SUMO executable is installed or `SUMO_BINARY` points to it, the workflow runs baseline and intervention simulations for 3,600 simulated seconds on the bundled synthetic grid network. Camera footage is not map-matched to this network; its vehicle density only scales generated demand. Without SUMO, the app uses the bundled trained XGBoost 60-minute scenario and labels it as that fallback. Neither is presented as a real-world traffic outcome.

**External requirements:** no paid API is needed for YOLO/OpenCV reports or deterministic tools. Install backend dependencies and keep `backend/models/best.pt` plus the supplied traffic model/data artifacts in place. `GROQ_API_KEY` is optional and enables LangGraph/Groq LLM tool-calling and written synthesis; without it, all deterministic tools still run. Groq quota/pricing depends on your account, so check the current model pricing before relying on hosted calls as free. SUMO is free and optional; install it locally for native simulation. Never put Groq credentials in Vite/frontend variables.

See [`TRAFFIC_LAB_SETUP.md`](./TRAFFIC_LAB_SETUP.md) for Windows-first setup, key requirements, SUMO installation, API routes, and known limits.


## Visual refinement

The updated typography, card system and UrbanSaarthi brand are documented in [`AIR_TRAFFIC_VISUAL_REFINEMENT.md`](./AIR_TRAFFIC_VISUAL_REFINEMENT.md) and [`URBANSARTHI_BRAND_REFRESH.md`](./URBANSARTHI_BRAND_REFRESH.md).

## UrbanSaarthi · AQI-first workspace

The authority portal opens on the AQI overview. Traffic has its own section, while emissions and IoT sensors have dedicated pages. The visual refinement keeps the existing forest-green and lime palette, with larger typography and more spacious cards.

- `/authority/air-intelligence`: ambient AQI, pollutant concentrations, forecast trend, nearby ground observations and priority locations.
- `/authority/carbon`: class-based tailpipe estimates and an exportable impact report.
- `/authority/traffic`: traffic conditions and scenario view; `/authority/traffic-lab`: video analysis and signal-plan workflow.
- `/authority/iot`: actual HTTP sensor-observation ingestion and station history. A starter ESP32/PMS5003 sketch is in [`hardware/esp32_pms5003_http.ino`](./hardware/esp32_pms5003_http.ino).

The current field-monitoring prototype uses HTTP sensor ingestion; it does not currently include an MQTT broker. Air-quality measurements must come from physical sensors or a separately labelled atmospheric forecast.

## Air Intelligence (InnovateX Theme 2 prototype)

The `/authority/air-intelligence` page adds a transparent traffic-to-emissions estimator, relative pollution-hotspot ranking, emissions-aware signal-plan drafts and an environmental impact report. It uses class-specific CO2, NOx, PM and CO estimates with versioned factor provenance. A camera ROI calibration tool can allocate detections into four movement groups; without all four calibrated regions, the system does not claim directional optimization and returns an equal-split plan.

The candidate optimizer weights approach vehicle volume (70%) and a relative NOx + PM + CO vehicle-class intensity proxy (30%), with minimum-green and maximum-share constraints. This is advisory decision support, not a certified controller. CO2 is shown separately and does not dominate the local-air-pollutant timing objective.

**Baseline vs intervention:** the dedicated comparison endpoint requires native SUMO and runs two 3,600-second experiments on the same generated demand and the included synthetic road grid. It calculates tailpipe estimates from simulated trip distances and the indicative factor catalog. The video is not map-matched to that synthetic network. When SUMO is missing, the dedicated comparison returns an unavailable response; the XGBoost forecast remains a separate forecasting feature, not a signal-plan experiment.

Factor provenance and caveats are surfaced in the page and API. The MPCB Nashik report's BS-VI values are indicative references, not measured Kanpur fleet averages. Petrol/diesel carbon factors use the AEEE white paper; vehicle fuel-use rates and the CNG carbon factor remain explicit prototype assumptions. AQI is ambient concentration data and is never derived directly from tailpipe-emissions estimates.

See [`TRAFFIC_LAB_SETUP.md`](./TRAFFIC_LAB_SETUP.md) for the setup guide and API endpoints. The `/api/v1/air-intelligence/factors` endpoint returns the factor catalogue and provenance.

## Citizen AQI forecast

The citizen portal exposes both `/citizen/air-quality` and a focused `/citizen/aqi-forecast` view. Both show current conditions and the next 24 hours of provider forecast; the focused route brings the outlook ahead of the current-condition cards. The default Lucknow view loads on entry, city lookup has a limited city-centre fallback for Lucknow, Kanpur, Delhi and Mumbai when geocoding is offline, and browser location is only requested after the visitor presses **Use my location**.

The citizen forecast prefers US AQI (0–500) when available. OpenWeather's index (1–5) is kept separate and labelled correctly, and timeline labels reflect hourly versus 3-hour provider intervals. When no AQI forecast is available, the page says so rather than fabricating forecast values. See [`CITIZEN_AQI_FORECAST_UPDATE.md`](./CITIZEN_AQI_FORECAST_UPDATE.md) for the data path and validation.

## Authority AQI forecasting and signal planning

The authority workspace includes a dedicated `AQI forecasting` view at `/authority/aqi-forecast`, with a 24-hour AQI-index outlook, expected peak, mean forecast value, and trend direction. Forecast values are marked as modelled provider outputs and remain separate from nearby ground-station observations. OpenWeather's 1–5 index and US AQI 0–500 are never combined on one scale.

Signal planning source files are retained in the release: `frontend/src/pages/authority/SignalPlansPage.jsx`, `backend/app/api/signals.py`, `backend/app/services/signal_planning.py`, plus their schemas, database models, and test coverage. The signal-plans source is preserved without adding another item to the compact authority sidebar.

See `ADMIN_AQI_FORECAST_AND_SIGNALS_UPDATE.md` for the update details and validation notes.
