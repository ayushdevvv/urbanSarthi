# Existing Render service — native Python deployment

Keep the existing service at `https://urbansarthi.onrender.com`. **Do not switch it to Docker and do not create another service.**

## Existing service settings

| Render setting | Value |
|---|---|
| Service | Existing `urbansarthi` |
| Runtime | Python 3 (native runtime) |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/healthz` |

The `requirements.txt` file installs the official `eclipse-sumo==1.28.0` Linux wheel, which bundles the SUMO executable. Do not use `apt-get`; the existing native build environment has a read-only apt package database.

## Environment variables

Keep the current `DATABASE_URL` and `INGESTION_API_KEY` values unchanged. Ensure these values exist:

```env
APP_ENV=production
CORS_ORIGINS=https://urbansarthi.vercel.app
PYTHON_VERSION=3.12.16
# SUMO_BINARY and SUMO_HOME are auto-detected from eclipse-sumo; leave unset.
```

Keep provider credentials (TomTom, Tavily, weather, OpenAQ and LLM keys) on Render only. Never put secrets in Vercel variables or commit real credentials.

## Vercel

Deploy to the existing Vercel project `https://urbansarthi.vercel.app`. Production API requests use the same-origin `/api/v1` path and the Vercel rewrite proxies them to the existing Render service. Set `VITE_API_URL=/api/v1` if the project expects the variable; no separate backend hostname is needed in the browser.

## Deploy safely

1. Push the updated source to the Git branch already connected to the existing Render service.
2. In Render, open the service whose URL is `https://urbansarthi.onrender.com` and confirm it is still the native **Python** runtime.
3. Set the root directory, build command, start command and health check above. Do not select Docker, do not enter a Dockerfile path, and do not change the service name.
4. Keep the existing database URL, ingestion key, plan, region and other working settings. Add/update only the variables listed above; keep your optional provider secrets.
5. Redeploy the existing Render service, then redeploy the existing Vercel project.

If the native build fails at the `apt-get` step, do not change to Docker automatically. Inspect the exact build log first. The forecast simulation remains available without the SUMO binary; native microscopic simulation is only enabled after the runtime reports the binary ready.

## Verify after deployment

```bash
curl -i https://urbansarthi.onrender.com/healthz
curl -i https://urbansarthi.onrender.com/readyz
curl -i https://urbansarthi.onrender.com/api/v1/traffic/simulation/capabilities
curl -i https://urbansarthi.onrender.com/api/v1/integrations/status
```

Expected: `/healthz` returns HTTP 200; `/readyz` reports a reachable database; capabilities report native simulation available only if the installed `eclipse-sumo` wheel exposes an executable and the bundled network is present. Otherwise the UI should use the 60-minute forecast and clearly label it as a forecast, not an individual-vehicle microscopic run.

In the browser Network panel, production app requests should use `https://urbansarthi.vercel.app/api/v1/...`; Vercel forwards those requests to the existing Render backend. This removes direct browser-to-Render CORS from the normal app path.
