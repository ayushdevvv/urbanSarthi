# Public hackathon mode and existing Render deployment

## No-login behavior

- Citizen and authority pages open without a login screen.
- `/api/v1/auth/*` is not mounted in this release.
- Browser requests carry an automatic `X-Visitor-ID`; it provides per-browser convenience separation for My Trips, not authentication or account-grade privacy.
- Authority demo write APIs use a shared demo operator. This configuration is for a public hackathon demonstration only.
- Camera/IoT edge ingestion remains protected by the server-side `INGESTION_API_KEY`.

## Existing Render backend (native Python)

The backend is the existing service at `https://urbansarthi.onrender.com`. Do not create a new service and do not switch the current service to Docker.

| Render field | Value |
|---|---|
| Existing service | `urbansarthi` |
| Runtime | Python 3 (native runtime) |
| Root directory | `backend` |
| Build command | `pip install -r requirements.txt` |
| Start command | `alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check | `/healthz` |
| Database | Keep the existing Render PostgreSQL attachment |

The native runtime is Debian 12. The build command installs the Debian SUMO CLI and tools. `backend/Dockerfile.sumo` is not used by this setup.

## Render environment

```env
APP_ENV=production
DATABASE_URL=<existing Render PostgreSQL internal URL>
CORS_ORIGINS=https://urbansarthi.vercel.app
INGESTION_API_KEY=<existing random secret with at least 32 characters>
PYTHON_VERSION=3.12.16
# SUMO_BINARY and SUMO_HOME are auto-detected from eclipse-sumo; leave unset.
```

Production CORS accepts exact HTTPS origins only. Add a second origin only when you actually deploy another frontend domain. Keep the existing database and ingestion key values; optional provider secrets remain server-side on Render.

## Vercel environment

```env
VITE_API_URL=/api/v1
```

Set it in the existing Vercel project and redeploy. Do not place backend secrets in Vercel.

## Browser connectivity fixes included

- The production API default now targets `urbansarthi.onrender.com`.
- FastAPI CORS wraps the full ASGI app, including framework-generated error responses and preflight requests.
- The allowed production origin is exact; visitor and ingestion headers are explicitly allowed.
- Geocoding uses Nominatim with a Photon backend fallback. The browser does not call either provider directly.
- Route alternatives are requested from `/routing/plan` on the backend. Browser-side OSRM/Valhalla calls and their custom preflight headers are removed.
- Google Fonts network dependencies are removed.
- Map tiles use the canonical OSM hostname first, then CARTO as a fallback.

## Verify after deployment

1. `GET https://urbansarthi.onrender.com/healthz` returns HTTP 200.
2. `GET https://urbansarthi.onrender.com/readyz` reports `database: reachable`.
3. The OPTIONS request for `/api/v1/trips` with `Origin: https://urbansarthi.vercel.app` and `Access-Control-Request-Headers: x-visitor-id` returns the matching `Access-Control-Allow-Origin` and allowed header.
4. Open `/authority/control` and `/citizen` without a login prompt.
5. In DevTools, API calls target `https://urbansarthi.vercel.app/api/v1`. No browser requests should target Nominatim, Photon, OSRM or Valhalla.
6. A valid edge ingestion key succeeds; a missing/wrong key returns 401.
7. Traffic Simulation reports native SUMO execution only after the native Python build installs SUMO. If it returns 424, inspect the Render build log for the apt install step and the startup log for the SUMO version check.

## Public demo security boundary

This mode gives visitors access to authority demo operations. `X-Visitor-ID` is spoofable and is not a security boundary. Do not use it for real municipal control or private data. Restore authentication, authorization, role isolation and audit controls before operational use.
