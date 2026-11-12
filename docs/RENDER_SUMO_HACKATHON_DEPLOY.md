# UrbanSaarthi deployment: existing Render API + Vercel frontend

This release is configured for the **existing** API at `https://urbansarthi.onrender.com`. It must update that Render service, not create a second backend.

## Existing Render Web Service

Open the existing Render service that currently serves `urbansarthi.onrender.com` and confirm it is the resource named `urbansarthi` before syncing the root Blueprint. Render documents that a Blueprint resource whose `name` matches an existing service is applied to that resource. Do not create a new Blueprint or a new Web Service for this deployment. See the [Render Blueprint reference](https://render.com/docs/blueprint-spec).

| Render setting | Value |
|---|---|
| Existing service | `urbansarthi` |
| Service type | Web Service |
| Runtime | Docker |
| Root directory | Leave blank (repository root) |
| Dockerfile path | `backend/Dockerfile.sumo` |
| Docker build context | `backend` |
| Health check path | `/healthz` |
| Start command | Leave blank; the Dockerfile runs `scripts/start.sh` |
| PostgreSQL | Keep the existing database attached |

The Blueprint deliberately omits a compute `plan`, so syncing it does not force a new billing tier. SUMO and the included ML models need sufficient memory/CPU; review the existing service's plan if native simulation exits for resource reasons.

The Dockerfile installs `sumo` and `sumo-tools` inside the API container. There is no separate SUMO service. It sets `SUMO_BINARY=/usr/bin/sumo` and `SUMO_HOME=/usr/share/sumo`.

## Render environment variables

Required values on the existing service:

```env
APP_ENV=production
DATABASE_URL=<keep the existing Render PostgreSQL internal URL>
CORS_ORIGINS=https://urbansarthi.vercel.app
INGESTION_API_KEY=<keep the existing random secret, at least 32 characters>
SUMO_BINARY=/usr/bin/sumo
SUMO_HOME=/usr/share/sumo
```

The `CORS_ORIGINS` value must be the exact scheme + hostname of the deployed Vercel frontend, with no trailing slash or path. Add any additional production/preview domains as comma-separated exact HTTPS origins. Do not use `*`.

Keep existing `DATABASE_URL` and `INGESTION_API_KEY` values. Do not rotate the ingestion key unless you also update every edge device/worker using it. Optional provider keys stay on Render only: `TOMTOM_API_KEY`, `TAVILY_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAQ_API_KEY`, `WEATHER_API_KEY`, and `OSRM_BASE_URL`.

## Vercel frontend

Set this production environment variable in the existing Vercel project and redeploy the frontend:

```env
VITE_API_URL=https://urbansarthi.onrender.com/api/v1
```

The frontend also has this as its production fallback, but setting the Vercel variable explicitly avoids ambiguity. Never put `DATABASE_URL`, `INGESTION_API_KEY`, or provider secrets in Vercel.

## Deploy safely

1. Commit the corrected source and root `render.yaml` to the Git branch connected to the existing Render service.
2. In Render, open the existing `urbansarthi` service. Confirm it is the same service whose URL is `https://urbansarthi.onrender.com`.
3. If it is already Blueprint-managed, sync the existing Blueprint. Do not choose **New Blueprint** and do not create a new Web Service. If it is not Blueprint-managed, update the existing service's Docker settings from the table above.
4. Confirm `DATABASE_URL` still points at the existing PostgreSQL database and `INGESTION_API_KEY` has not been rotated.
5. Set `CORS_ORIGINS` to `https://urbansarthi.vercel.app`, then deploy the existing service.
6. In the existing Vercel project, set `VITE_API_URL` to the value above and redeploy.

## Verify

```bash
curl -i https://urbansarthi.onrender.com/healthz
curl -i https://urbansarthi.onrender.com/readyz
curl -i -X OPTIONS \
  'https://urbansarthi.onrender.com/api/v1/trips' \
  -H 'Origin: https://urbansarthi.vercel.app' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: x-visitor-id'
```

Expected results:

- `/healthz`: HTTP 200 and `{"status":"ok"}`.
- `/readyz`: HTTP 200 and `database: reachable`.
- Preflight: HTTP 200, `Access-Control-Allow-Origin: https://urbansarthi.vercel.app`, and `x-visitor-id` included in `Access-Control-Allow-Headers`.
- Vercel browser Network requests go to `https://urbansarthi.onrender.com/api/v1/...`.
- Search/geocoding and road routing are proxied through the backend; the browser no longer calls Nominatim, Photon, OSRM or Valhalla directly.
- The map first uses the canonical OSM tile hostname and falls back to CARTO if tile requests fail.

For Traffic Simulation, the response should identify native SUMO execution. A `424` response means SUMO is not installed/detected by the running container; check the Docker build log and `SUMO_BINARY`/`SUMO_HOME`. The XGBoost forecast is not a native SUMO simulation.

## Public hackathon boundary

This version intentionally has no human login. Authority write operations are open to demo visitors, and `X-Visitor-ID` is a convenience identifier, not authentication. Do not connect it to physical signal controllers, confidential municipal systems, private CCTV networks, or production device fleets. Edge/IoT ingestion remains protected by `X-Ingestion-Key`.

The bundled 80-edge SUMO network is synthetic, not a calibrated representation of Lucknow or any other city. The 60-minute scenario represents simulated time, not an hour of wall-clock execution.
