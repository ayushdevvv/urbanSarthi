# UrbanSaarthi — full-stack repository

A React/Vite frontend paired with the supplied FastAPI backend. The backend has been preserved, not rewritten. The frontend is organized by shared components, layouts, citizen pages, authority pages and a small API client.

## Repository structure

```text
UrbanSaarthi/
├── frontend/
│   ├── src/
│   │   ├── components/       # layouts, reusable UI and Leaflet map
│   │   ├── context/           # theme, language, session profile and toast
│   │   ├── hooks/             # API resource lifecycle
│   │   ├── pages/
│   │   │   ├── landing/       # main portal selector
│   │   │   ├── auth/          # citizen sign-in / registration
│   │   │   ├── citizen/       # home, planner, AQI, transit, trips
│   │   │   └── authority/     # command centre, signals, analytics, sources, settings
│   │   ├── services/api/      # shared authenticated API client/endpoints
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

Read `backend/README.md` first. In brief, use Python 3.11+, create a virtual environment, install `backend/requirements.txt`, copy `backend/.env.example` to `backend/.env`, set secure secrets, run migrations, then seed the database and start Uvicorn:

```bash
cd backend
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
# Copy .env.example to .env and set secrets before exposing the service.
alembic upgrade head
python scripts/seed_demo.py
uvicorn app.main:app --reload
```

API docs: `http://127.0.0.1:8000/docs`. Health checks: `/healthz` and `/readyz`.

### 2. Frontend

In a second terminal:

```bash
cd frontend
# Copy .env.example to .env and set VITE_API_BASE_URL if needed.
npm install
npm run dev
```

Open the Vite URL shown in the terminal. `VITE_API_BASE_URL` must include `/api/v1`. No API secrets belong in frontend environment variables.

## Deploy frontend to Vercel

Set the Vercel project Root Directory to `frontend`. Set `VITE_API_BASE_URL` in Vercel Environment Variables to the production backend URL including `/api/v1`. The existing `frontend/vercel.json` routes client-side paths to the Vite SPA entry point. Ensure the backend CORS configuration allows the deployed frontend origin.

## Referenced views covered

- Main portal selection
- Citizen home and map
- Route planning with fastest / balanced / cleanest preferences
- Air-quality stations and observations
- Public transport routes, stops and service alerts
- Saved trips, details, lifecycle actions and CSV export
- Authority command centre, traffic map and alert panels
- Signal plan list, create, simulate and phase preview
- Data-source health, source registration and refresh
- Operator settings and profile preferences

## API integration and data integrity

The frontend calls documented API routes from `backend/openapi.json`. For example, command overview uses `/command-center/overview`, city analytics uses `/analytics/city-summary`, signal plans use `/signals/plans`, air quality uses `/aqi/observations`, routing uses `/routing/plan`, and trip history uses `/trips`.

There is no invented weather API, fabricated transit schedule, seeded browser-side AQI, or fake live CCTV status. When an API is not configured, returns no records, or requires a role/token, the corresponding page displays an empty/unavailable/error state. Route estimates and source caveats are shown as returned by the backend. The existing backend explicitly does not issue physical traffic signal writes or valid paid travel tickets.

## Screenshots and design target

The interface uses the uploaded CityPulse references as the visual target: light green-tinted work surfaces, dark green navigation, lime selection accents, compact cards and Leaflet/OpenStreetMap views. The authority layouts follow the supplied dashboard structure; citizen-facing pages mirror the supplied portal, route-planning, AQI, public-transit and trips layouts. Exact rendered pixel equality must still be checked in a browser at the reference viewport sizes and with the same API data density.
