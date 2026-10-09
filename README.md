# UrbanSaarthi — full-stack repository

A React/Vite frontend paired with a FastAPI backend for the UrbanSaarthi smart-mobility prototype. The frontend uses a consistent green design system, English/Hindi toggle, shared logo/favicon, city mobility pages, citizen tools and an authority workspace.


> **Prototype boundary:** Citizen and Authority portals open directly without login. Synthetic scenario records are used when live feeds are unavailable and are labelled as estimates/illustrations rather than live readings. Authority write endpoints remain public in this no-auth build, so use it only with non-sensitive prototype data and never connect it to physical signal controllers.

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
│   │   │   ├── citizen/       # home, planner, AQI, transit, trips, ticket requests
│   │   │   └── authority/     # command centre, signals, analytics, forecasts, sources, settings
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
- Public transport routes, stops and service alerts
- Saved trips, details, lifecycle actions and CSV export
- Public-transport ticket-request workflow (request only; no ticket/payment issued)
- Five-horizon junction forecasts (NOW, +15, +30, +45, +60 minutes)
- Authority command centre, traffic map and alert panels
- Signal plan list, create, simulate and phase preview
- Data-source health, source registration and refresh
- Authority demo settings and preferences

## API integration and demo data

The frontend calls the documented routes in `backend/openapi.json`: command overview `/command-center/overview`, city analytics `/analytics/city-summary`, signal plans `/signals/plans`, air quality `/aqi/observations`, route optimization `/routing/plan`, and saved trips `/trips`.

If the API is unreachable or returns an empty response, the frontend keeps its principal screens usable with clearly labelled scenario estimates for AQI, transit, route alternatives, trip history, analytics, traffic/junction status, signal plans and source health. Backend startup runs forward-only Alembic migrations on PostgreSQL by default, repairs the missing `transit_routes` table via a dedicated migration, and runs the idempotent seeder when core tables are empty. The seed baseline includes 24 clusters, 48 junctions, 192 AQI observations, 1,632 traffic readings, 12 transit routes, 28 transit stops, 10 signal plans, 240 forecast horizon records, 12 trips and ticket-request examples. These are synthetic scenario values—not official or live city readings. No physical traffic signal write or valid paid ticket/payment is issued.

### Render database recovery

On PostgreSQL, `AUTO_MIGRATE_ON_STARTUP=true` and `AUTO_SEED_DEMO_DATA=true` are enabled by default. On startup the backend applies `alembic upgrade head`, then seeds the shared sample workspace only if any core data table is empty. The new forward-only migration repairs a missing `transit_routes` table without rewriting previous migrations. Confirm the Render service uses this updated code and has the correct `DATABASE_URL`; watch the startup logs for `Applying database migrations` and `UrbanSaarthi scenario seed complete`. Do not manually delete or rebuild production data.

### Deployed configuration

For Vercel, set `VITE_API_URL` to the exact Render API service hostname plus `/api/v1` and redeploy the frontend. On Render, set `CORS_ORIGINS=https://urbansarthi.vercel.app` (plus any other exact frontend origins) and redeploy the backend. The project enables the Vercel preview origin pattern as well. The exact Render service hostname must be copied from your Render dashboard; it cannot be inferred from this archive.

## Screenshots and design target

The interface uses the uploaded UrbanSaarthi logo in shared navigation and as the favicon. The default palette is green with light surfaces, dark green navigation, lime selection accents, premium card/button hover and focus states, and an English/Hindi toggle. It uses Leaflet/OpenStreetMap views. The authority layouts follow the supplied dashboard structure; citizen-facing pages mirror the supplied portal, route-planning, AQI, public-transit and trips layouts. Exact rendered pixel equality must still be checked in a browser at the reference viewport sizes and with the same API data density.
