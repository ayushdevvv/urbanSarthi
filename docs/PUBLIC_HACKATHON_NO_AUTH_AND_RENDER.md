# Public hackathon mode and Render settings

## No-login behavior

- Citizen portal opens directly. There is no citizen account or sign-in screen.
- Authority portal opens directly. There is no operator sign-in gate.
- `/api/v1/auth/*` is not mounted; the old login/register endpoints return 404.
- Browser requests carry an automatic `X-Visitor-ID`, isolating My Trips per browser. This is a convenience identity, not authentication or secure cross-device storage.
- Authority write APIs use a shared demo operator actor. This deployment is intentionally public and suitable only for a hackathon demo.
- Camera/IoT edge ingestion remains protected by the server-side `INGESTION_API_KEY`.

## Recommended Render service settings

Use the existing `urbansaarthi-api` service and keep the existing PostgreSQL database. If the service is Blueprint-managed, sync the repository's root `render.yaml`.

| Render field | Value |
|---|---|
| Service type | Web Service |
| Runtime | Docker |
| Service name | `urbansaarthi-api` |
| Region | Same region as the Render PostgreSQL database |
| Compute plan | `1c-2g` starting point for the SUMO hackathon demo |
| Root directory | Leave blank (repository root) |
| Dockerfile path | `backend/Dockerfile.sumo` |
| Docker context | `backend` |
| Health check path | `/healthz` |
| Start command | Leave blank; use Dockerfile `CMD` |

The Blueprint uses `runtime: docker`, `dockerfilePath: ./backend/Dockerfile.sumo`, and `dockerContext: ./backend`. Both paths are relative to the repository root. Render's Blueprint reference documents these Docker fields and the health-check path. See [Render Blueprint YAML reference](https://render.com/docs/blueprint-spec), [Docker on Render](https://render.com/docs/docker), and [health checks](https://render.com/docs/health-checks).

If configuring manually in the Render Dashboard, choose Docker as the runtime, set the Dockerfile and context paths above, and save `/healthz` as the health check path. Keep the service name unchanged so the current frontend API hostname remains unchanged.

## Render environment variables

Required for the production backend:

```env
APP_ENV=production
DATABASE_URL=<Render PostgreSQL internal database URL>
CORS_ORIGINS=https://<your-exact-vercel-domain>
INGESTION_API_KEY=<random secret with at least 32 characters>
SUMO_BINARY=/usr/bin/sumo
SUMO_HOME=/usr/share/sumo
```

The root `render.yaml` declares `INGESTION_API_KEY` with `generateValue: true`. If preserving an existing edge-worker connection, retain the current key when syncing the Blueprint and update the worker's key only when intentionally rotating it.

Optional provider credentials (leave unset until available):

```env
TOMTOM_API_KEY=
TAVILY_API_KEY=
GROQ_API_KEY=
OPENAQ_API_KEY=
WEATHER_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
OSRM_BASE_URL=
```

Do not set `DATABASE_URL`, provider keys, or `INGESTION_API_KEY` in Vercel. Do not add real secrets to `.env.example` or Git.

## Vercel environment

Set this in Vercel → Project → Settings → Environment Variables, for Production (and Preview if required):

```env
VITE_API_URL=https://urbansaarthi-api.onrender.com/api/v1
```

Use the actual Render hostname if it differs. `VITE_API_URL` must include `/api/v1`. Redeploy the frontend after changing it. Provider credentials and database credentials must never be exposed as `VITE_*` variables.

## No auth variables are needed

This release intentionally does not use `AUTH_ENABLED`, `JWT_SECRET`, bootstrap-admin variables, or `VITE_REQUIRE_AUTH`. If old values remain in the Render/Vercel dashboards they are ignored by this code; they can be removed to avoid confusion. Do not delete unrelated credentials such as the database URL or ingestion key.

## Verify after deploying

1. `GET https://<render-host>/healthz` returns `{"status":"ok"}`.
2. `GET https://<render-host>/readyz` reports `database: reachable`.
3. Open `/authority/control`; it should load without a sign-in screen.
4. Open `/citizen`; it should load without an account prompt.
5. Browser DevTools Network → preflight should allow `X-Visitor-ID`.
6. An edge ingestion heartbeat with a correct `X-Ingestion-Key` succeeds; a missing/wrong key returns 401.
7. Run Traffic Simulation and confirm the response reports native SUMO execution rather than the XGBoost fallback.

## Public demo security boundary

This mode deliberately gives every visitor access to the authority demo workspace and its demo write actions. `X-Visitor-ID` is spoofable and is not a security boundary. Do not connect this deployment to physical signal controllers, confidential municipal systems, private CCTV networks, or production device fleets. Before operational use, restore real authentication, authorization, rate limits, audit logging, and separate operator roles.
