# 2026-11-13 — Native Render SUMO wheel correction

This update supersedes older instructions that used `apt-get` to install SUMO. The existing Render native Python build fails with `apt-get` because the apt package-list filesystem is read-only. Do not run `apt-get` in this service.

## Existing service settings

- Service: `urbansarthi` (keep the existing service)
- Runtime: Python 3 (native; no Docker)
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command (preserve exactly): `alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health check path: `/healthz`
- Python version: `3.12.16`

`backend/requirements.txt` includes `eclipse-sumo==1.28.0`. The official Eclipse SUMO package publishes Linux manylinux wheels containing the SUMO binaries. The app resolves the executable from `sumo.SUMO_HOME/bin/sumo`; no OS package manager, Dockerfile, or second service is required.

## Environment variables

Keep the existing `DATABASE_URL`, `INGESTION_API_KEY` and provider secrets unchanged. Keep `CORS_ORIGINS=https://urbansarthi.vercel.app` for direct API clients. Do not set the old paths `SUMO_BINARY=/usr/bin/sumo` or `SUMO_HOME=/usr/share/sumo`; the installed wheel is discovered automatically and exports its own SUMO home at runtime.

## Update in Render dashboard

1. Open the existing `urbansarthi` service.
2. Keep its Runtime as Python 3 and Root Directory as `backend`.
3. Change Build Command to `pip install -r requirements.txt`.
4. Preserve the existing Start Command exactly: `alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
5. Set `PYTHON_VERSION=3.12.16` in Render Environment (the Blueprint also defines it).
6. Remove obsolete `SUMO_BINARY=/usr/bin/sumo` and `SUMO_HOME=/usr/share/sumo` overrides if present.
7. Redeploy the same service.

## Verify after deploy

```bash
python -c "import sumo; from pathlib import Path; p=Path(sumo.SUMO_HOME)/'bin'/'sumo'; print(sumo.SUMO_HOME); print(p); print(p.exists())"
```

Then check:

```bash
curl -i https://urbansarthi.onrender.com/healthz
curl -i https://urbansarthi.onrender.com/api/v1/traffic/simulation/capabilities
```

The capabilities endpoint must report native SUMO available before the detailed microscopic simulation is shown. The 60-minute XGBoost reference-network forecast remains available separately and must not be labelled as a native SUMO run.

## Verification boundary

The official wheel and release metadata were checked against Eclipse SUMO's documentation and PyPI. The container used to prepare this archive has DNS/network disabled, so an actual wheel install and a live Render deploy could not be performed here. Run the verification command above in the Render service logs after redeploy.
