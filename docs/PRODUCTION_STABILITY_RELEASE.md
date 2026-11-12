# UrbanSaarthi production stability release

This release keeps the existing services and domains. It does not create a new Render service.

- Frontend: `https://urbansarthi.vercel.app`
- Existing API: `https://urbansarthi.onrender.com`
- Render resource: `urbansarthi`

## What this release fixes

### Browser connectivity

The production frontend now always calls the same-origin path `/api/v1`. Both `vercel.json` and `frontend/vercel.json` put the API rewrite before the SPA fallback:

```json
{
  "rewrites": [
    { "source": "/api/v1/:path*", "destination": "https://urbansarthi.onrender.com/api/v1/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

This makes the browser talk to `urbansarthi.vercel.app/api/v1/...`; Vercel proxies the request to the existing Render API. Production code deliberately ignores a stale `VITE_API_URL` that might still point directly at Render. Local development can still override the API URL in `frontend/.env`.

FastAPI CORS remains configured for direct API testing and any approved additional frontend origin. The exact public frontend origin is trusted at the ASGI boundary, including error responses and preflight requests. Public read requests no longer attach an unnecessary visitor identity header; visitor identity remains on per-browser trip and mobility operations.

### Traffic simulation

The page checks `/traffic/simulation/capabilities` before running. It only calls the detailed simulator when the deployed worker confirms that it is available. If not, it runs the existing 60-minute forecast rather than deliberately posting to the unavailable native endpoint and surfacing an expected 424.

The forecast workspace displays an 80-road reference network, road colours and queue estimates that change through the 5-minute frames, signal phase indicators, and moving representative flow markers. These markers are visual flow indicators, not tracked vehicles. The forecast is not live CCTV, not live road telemetry, and not microscopic vehicle physics. The signal/demand overlay is a documented what-if sensitivity assumption, not a causal model prediction.

When the native runner is available, the page can display the actual sampled vehicle coordinates and headings from the 60-minute reference-network run. Those are still a synthetic reference network, not a calibrated model of a real city. A successful native capability response is required before that mode is shown.

### Traffic Lab and page stability

- Traffic Lab and Traffic Agent keep their own local loading, unavailable and error states.
- Optional feed failures no longer create a generic app-wide “Live data is temporarily delayed” toast.
- The authority navigation drawer closes after navigation and on Escape, locks background scrolling while open, and keeps its scrim below the drawer.
- Existing responsive layouts have been retained and refined for smaller screens.
- User-facing camera and forecast copy avoids internal package/model names.

## Deploy to existing services

### 1. Vercel

Deploy the updated frontend source to the existing project for `urbansarthi.vercel.app`.

- Root Directory: `frontend` (the existing Vite project)
- Build command: `npm run build`
- Output directory: `dist`
- No external Render URL is required in `VITE_API_URL`; production uses `/api/v1` unconditionally.
- `frontend/.env.production.example` documents the relative path if you choose to set the variable explicitly.

If the project is configured with the repository root as its Vercel root, the root `vercel.json` contains the same rewrite. Keep whichever root configuration your current Vercel project uses; do not create a second Vercel project.

### 2. Existing Render service (native Python, no Docker)

Keep the service whose URL is `https://urbansarthi.onrender.com`. Do not change its runtime to Docker.

| Setting | Value |
|---|---|
| Service | Existing `urbansarthi` |
| Runtime | Python 3 (native) |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check | `/healthz` |

The existing native Python service installs `eclipse-sumo==1.28.0` from its official Linux wheel. Do not use `apt-get` or Docker for this service; the app resolves the bundled binary from `sumo.SUMO_HOME/bin/sumo`.

Keep `DATABASE_URL` and `INGESTION_API_KEY` unchanged. Ensure these environment variables are present:

```env
APP_ENV=production
CORS_ORIGINS=https://urbansarthi.vercel.app
PYTHON_VERSION=3.12.16
# SUMO_BINARY and SUMO_HOME are auto-detected from eclipse-sumo; leave unset.
```

Keep optional provider secrets (TomTom, Tavily, weather, OpenAQ and LLM keys) on Render only. Do not put secrets in Vercel variables or in the ZIP.

Update the existing service's settings in place. Do not create a new Web Service, do not select Docker, and do not change the existing plan, region, database or ingestion key. If the service is Blueprint-managed, the root `render.yaml` now describes the native Python runtime; sync only the already-linked Blueprint after confirming it targets the existing resource.

## Verify the deployment

After redeploying both existing projects, open these URLs:

```text
https://urbansarthi.onrender.com/healthz
https://urbansarthi.onrender.com/readyz
https://urbansarthi.onrender.com/api/v1/traffic-detection/video-status
https://urbansarthi.onrender.com/api/v1/traffic/simulation/capabilities
```

Expected:

- `/healthz` returns `{"status":"ok"}`.
- `/readyz` reports `database: reachable`.
- `/traffic-detection/video-status` reports whether camera/video processing is ready.
- `/traffic/simulation/capabilities` reports `recommended_mode: microscopic` only when the native executable and network are available. Otherwise it should report `forecast` if the forecast files and dependency are present.

In the browser Network panel, production requests should start with:

```text
https://urbansarthi.vercel.app/api/v1/
```

They should no longer go directly from the browser to `urbansarthi.onrender.com`. If you still see direct Render calls, the new Vercel build or its rewrite configuration is not the version being served.

If the capabilities endpoint reports `native_simulation_available: false`, inspect the existing Render deploy log for the `Traffic simulation runtime` section and the SUMO version check. The native Python build command installs the Debian SUMO package, but this workspace cannot verify the remote Render runtime until you redeploy it. Do not label forecast playback as a detailed microscopic simulation.

## Checks run on this source package

- Backend: `pytest -q` — **65 passed**.
- Frontend: `npm test` — both workspace and public-routing smoke suites passed.
- Python bytecode compilation: passed.
- JavaScript/JSX/TypeScript source parse: all 43 source files parsed without syntax errors.
- Both Vercel rewrite JSON files parsed and point to the existing Render hostname.
- ZIP integrity is checked in the release packaging step.

**Not verified here:** a complete Vite production bundle. The package manager had no local cache for all dependencies, and registry DNS was unavailable during installation. Run `npm ci && npm run build` from `frontend` in a network-enabled CI/build environment before production sign-off.

## Public demo boundary

This hackathon edition has no human login. Authority demo operations are public and are not suitable for real municipal control. Do not connect physical signal controllers or private municipal systems. Camera/IoT ingestion still uses the server-side ingestion key. The bundled road network is a synthetic reference network until a surveyed local network and calibrated demand are supplied.
