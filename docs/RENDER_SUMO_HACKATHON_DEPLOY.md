# UrbanSaarthi hackathon deployment: public portal + native SUMO on Render

This deployment runs SUMO inside the Render backend Docker container. Judges can open the citizen portal and authority workspace without signing in. IoT / edge-device ingestion remains separately protected by `INGESTION_API_KEY`.

## Render service settings

Use the existing `urbansaarthi-api` Web Service. If it is Blueprint-managed, sync the repository's root `render.yaml`. If configuring manually, use:

| Setting | Value |
|---|---|
| Service type | Web Service |
| Runtime | Docker |
| Name | `urbansaarthi-api` |
| Plan | `1c-2g` minimum starting point |
| Dockerfile path | `backend/Dockerfile.sumo` |
| Docker build context | `backend` |
| Health check path | `/healthz` |
| Region | Same region as the existing PostgreSQL database |

No separate SUMO service is needed. The Dockerfile installs `sumo` and `sumo-tools` in this API container and sets `SUMO_BINARY=/usr/bin/sumo` and `SUMO_HOME=/usr/share/sumo`.

## Required Render environment variables

| Variable | Value |
|---|---|
| `APP_ENV` | `production` |
| `DATABASE_URL` | Your managed PostgreSQL internal URL |
| `CORS_ORIGINS` | Exact Vercel origin, e.g. `https://urbansaarthi.vercel.app` |
| `INGESTION_API_KEY` | Random secret, minimum 32 characters; Render may generate it |
| `SUMO_BINARY` | `/usr/bin/sumo` |
| `SUMO_HOME` | `/usr/share/sumo` |

Do not create JWT or bootstrap-admin variables for this public demo build. Human login routes and UI have been removed from this release.

Optional provider variables (add only when you have credentials): `TOMTOM_API_KEY`, `TAVILY_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAQ_API_KEY`, `WEATHER_API_KEY`, and `OSRM_BASE_URL`. They are listed as optional variables in `render.yaml`; blank values simply leave those integrations unconfigured.

## Vercel frontend settings

In Vercel → Project → Settings → Environment Variables, set:

```env
VITE_API_URL=https://urbansaarthi-api.onrender.com/api/v1
```

Redeploy the frontend after changing the value.

## Deploy steps

1. Commit `render.yaml` and `backend/Dockerfile.sumo` to the connected Git branch.
2. Sync the Render Blueprint, or set the Dockerfile path and context exactly as shown above.
3. Attach your existing PostgreSQL database and set `CORS_ORIGINS` to the exact public Vercel URL.
4. Add optional provider keys in Render only. Do not put provider keys in Vercel.
5. Deploy and inspect Render logs for successful SUMO package installation, Alembic migrations and Uvicorn startup.
6. Verify `https://<your-api-host>/healthz` and `https://<your-api-host>/readyz`.
7. Open the public authority workspace → Traffic Simulation → change signal settings → Run native simulation. The result must identify `native_sumo_simulation` / `EXECUTED IN SUMO`, not the XGBoost fallback.

## Public demo and data isolation

No citizen or operator account is required. The browser sends an automatically generated `X-Visitor-ID`, so saved trips are associated with that browser's anonymous guest identity rather than one shared public trip list. Clearing browser storage resets that identity. This is convenience-level separation, not account-grade privacy.

All authority pages and operator actions are public in this hackathon configuration. Do not connect physical traffic-control write credentials or sensitive municipal networks to this deployment. Edge / IoT ingestion still requires the server-side `X-Ingestion-Key`. For a real authority production rollout, implement and verify a proper identity provider and role-based authorization layer before exposing administrative operations.

## Simulation expectations

The 60-minute run is 3,600 seconds of simulated time, not an hour of wall-clock time. The bundled 80-edge network is synthetic; the simulation is not a calibrated model of Lucknow or another real city until a surveyed network and calibrated demand are supplied. SUMO FCD snapshots are sampled every 30 simulated seconds and edge telemetry every five minutes.
