# UrbanSaarthi — running the application

## Backend

From the project root, open a terminal in `backend/`:

```powershell
cd backend
uv sync
Copy-Item .env.example .env
uv run alembic upgrade heads
uv run uvicorn app.main:app --reload
```

If `uv` is not installed, install it with `python -m pip install uv`. Alternatively create and activate a venv, then install `requirements.txt` with pip. A local SQLite database is the default. Open the interactive API docs at `http://127.0.0.1:8000/docs`; health endpoints are `/healthz` and `/readyz`.

The core location services do not need paid API credentials:

- Air-quality outlook: Open-Meteo / CAMS, current + hourly forecast, no key required.
- Place search: OpenStreetMap Nominatim.
- Road, walking and cycling routes: public OpenStreetMap-derived routing profiles, with an estimate-only fallback that deliberately has no map line.
- Nearby places and mapped transit stops/routes: OpenStreetMap / Overpass.
- 60-minute network forecast: included XGBoost models trained on stored SUMO-generated data.

Optional backend variables include `TOMTOM_API_KEY` for a provider road-flow snapshot and `OSRM_BASE_URL` to override public routing servers. `OPENAQ_API_KEY` only applies to the optional legacy station-sync endpoint; it is not required for location-based AQI forecast. Never place backend keys in `frontend/.env` or `VITE_*` variables.

**Public-access warning:** authentication is disabled in this workspace. Authority write APIs are consequently accessible without sign-in. Keep private operational data and live infrastructure credentials out of this deployment until access controls are restored.

## Frontend

In a second terminal:

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

`VITE_API_URL` must include `/api/v1`. The local default is `http://127.0.0.1:8000/api/v1`. Geolocation and camera access require `localhost` or HTTPS and browser permission.

## Vercel

Choose `frontend` as the Vercel Root Directory, set `VITE_API_URL` to the deployed backend host plus `/api/v1`, and add the deployed frontend origin to backend `CORS_ORIGINS`. `frontend/vercel.json` handles client-side SPA paths.

## Forecast and provider boundaries

The 60-minute playback advances through model-generated forecast frames in five-minute increments. It is based on the included SUMO-generated dataset and does not launch a live SUMO/TraCI process or represent current camera measurements. A 60-minute held-out evaluation is shown separately from the stronger 30-minute metric.

Mapped transit stops and OSM route metadata do not imply departure times. Accurate timetables and arrivals require an operator GTFS schedule or real-time feed. A routing estimate is shown without a straight-line polyline whenever road-network geometry is unavailable.

The Traffic Vision page needs the included `backend/models/best.pt` weights and the Ultralytics/PyTorch packages declared in `backend/requirements.txt`. If inference dependencies are unavailable, the screen labels reference values separately from detections. Camera access requires HTTPS or localhost.
