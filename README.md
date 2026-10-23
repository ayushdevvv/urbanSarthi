# UrbanSaarthi — full-stack repository

A React/Vite frontend paired with a FastAPI backend, simplified for a no-login UrbanSaarthi demo. The frontend is organized by shared components, layouts, citizen pages, authority pages and one API client.


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
│   │   │   └── authority/     # command centre, signals, analytics, sources, settings
│   │   ├── services/api/      # shared API client/endpoints
│   │   └── styles/            # authority and citizen UI styles
│   ├── .env.example
│   ├── vercel.json
│   └── vite.config.js
├── backend/                   # existing FastAPI + SQLAlchemy + Alembic app
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
alembic upgrade head
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

The interface uses the uploaded UrbanSaarthi references as the visual target: light green-tinted work surfaces, dark green navigation, lime selection accents, compact cards and Leaflet/OpenStreetMap views. The authority layouts follow the supplied dashboard structure; citizen-facing pages mirror the supplied portal, route-planning, AQI, public-transit and trips layouts. Exact rendered pixel equality must still be checked in a browser at the reference viewport sizes and with the same API data density.

## AQI Vision (multimodal model)

The `/citizen/aqi-vision` page now asks for the visitor's location and retrieves a current + 24-hour AQI outlook from Open-Meteo/CAMS without a key. It shows US AQI, pollutant concentrations and hourly forecasts, and explicitly notes that these are atmospheric model forecasts rather than official ground-station readings. The legacy image-based AQI endpoint is retained for compatibility, but it is no longer the primary location-AQI workflow.

## Final quality check

See [`FINAL_QA.md`](./FINAL_QA.md) for the AQI page render fix, model inference smoke test, responsive refinements, known verification limits, and deployment checklist.

## Traffic simulation forecast

The included SUMO-generated dataset contains 518,400 records from 36 runs across 80 road edges. The XGBoost model and separate 60-minute horizon model are available through `GET /api/v1/traffic/simulation` and `GET /api/v1/traffic/simulation/scenario`. The client can play the 60-minute model timeline at five-minute forecast steps. The 60-minute held-out evaluation is shown separately (61.5% congestion-level accuracy, MAE 3.93 vehicles, R² 0.384); this is a stored-data model scenario, not a live SUMO/TraCI process or current road sensor feed.

For production, set `VITE_API_URL=https://urbansarthi.onrender.com/api/v1` in Vercel and configure provider credentials only in the backend environment. The frontend has a production API fallback, but an explicit Vercel value is recommended.
