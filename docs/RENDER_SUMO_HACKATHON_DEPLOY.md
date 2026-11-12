# SUMO on the existing Render native Python service

This deployment keeps the existing `https://urbansarthi.onrender.com` Render service on its native Python runtime. It does not use Docker or `apt-get`.

## Existing service settings

| Setting | Value |
|---|---|
| Service | `urbansarthi` (existing resource) |
| Runtime | Python 3 (native) |
| Root Directory | `backend` |
| Python Version | `3.12.16` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check | `/healthz` |

`backend/requirements.txt` installs `eclipse-sumo==1.28.0`. Its official Linux wheel bundles the SUMO binaries and exposes `sumo.SUMO_HOME`; the API discovers `SUMO_HOME/bin/sumo` automatically. The native runtime's read-only apt package database means `apt-get` must not be used.

## Environment variables

Keep the existing database URL, ingestion key, and provider keys. Use:

```env
APP_ENV=production
PYTHON_VERSION=3.12.16
CORS_ORIGINS=https://urbansarthi.vercel.app
```

Remove stale overrides if they are set:

```env
SUMO_BINARY=/usr/bin/sumo
SUMO_HOME=/usr/share/sumo
```

The installed wheel determines its own paths. Do not overwrite them with Debian package paths.

## Deploy in place

1. Push the updated repository to the branch connected to the current Render service.
2. Keep Runtime `Python 3`, Root Directory `backend`, and the existing resource, plan, region and database.
3. Set Build Command to `pip install -r requirements.txt`.
4. Keep the Start Command unchanged: `alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
5. Set `PYTHON_VERSION=3.12.16` in Render Environment.
6. Remove stale SUMO_BINARY and SUMO_HOME path overrides.
7. Redeploy the existing service, then redeploy the current Vercel project if frontend changes are included.

## Smoke checks

```bash
python -c "import sumo; from pathlib import Path; p=Path(sumo.SUMO_HOME)/'bin'/'sumo'; print(sumo.SUMO_HOME); print(p); print(p.exists())"
curl -i https://urbansarthi.onrender.com/healthz
curl -i https://urbansarthi.onrender.com/api/v1/traffic/simulation/capabilities
```

The native engine is ready only when the capabilities response confirms the executable is installed and the bundled network is present. The independent 60-minute XGBoost projection is a forecast, not microscopic SUMO execution.
