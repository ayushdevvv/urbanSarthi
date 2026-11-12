# Render native Python setup — SUMO via pip wheel

This is the deployment correction for the Render build failure:

`E: List directory /var/lib/apt/lists/partial is missing. - Acquire (30: Read-only file system)`

Do not run `apt-get` on this existing native Python service. The repository now installs the official Eclipse SUMO application wheel (`eclipse-sumo==1.28.0`) through `backend/requirements.txt`. The official Linux wheel contains the compiled SUMO executables and exposes its installation through `sumo.SUMO_HOME`.

## Existing Render service settings

- Service: `urbansarthi`
- Runtime: Python 3 (native)
- Root Directory: `backend`
- Python version: `3.12.16`
- Build Command: `pip install -r requirements.txt`
- Start Command: `alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health Check: `/healthz`

Do not create a second service, choose Docker, or change the existing database, region, plan, or ingestion key.

## Render dashboard actions

1. Open the existing `urbansarthi` service.
2. Keep Runtime set to Python 3 and Root Directory set to `backend`.
3. Replace the failed Build Command with exactly:

   ```bash
   pip install -r requirements.txt
   ```

4. Keep your Start Command exactly as it was:

   ```bash
   alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```

5. Set `PYTHON_VERSION=3.12.16` in Render Environment. The root `render.yaml` Blueprint also pins this version.
6. Remove old `SUMO_BINARY=/usr/bin/sumo` and `SUMO_HOME=/usr/share/sumo` overrides if they exist. The app now discovers the wheel binary automatically.
7. Keep `DATABASE_URL`, `INGESTION_API_KEY`, provider secrets and `CORS_ORIGINS` unchanged.
8. Deploy the same existing service.

## Verify in Render Shell / deploy logs

```bash
python -c "import sumo; from pathlib import Path; p=Path(sumo.SUMO_HOME)/'bin'/'sumo'; print('SUMO_HOME=', sumo.SUMO_HOME); print('SUMO_BINARY=', p); print('exists=', p.is_file()); print('executable=', p.exists() and __import__('os').access(p, __import__('os').X_OK))"
```

Then:

```bash
curl -i https://urbansarthi.onrender.com/healthz
curl -i https://urbansarthi.onrender.com/api/v1/traffic/simulation/capabilities
```

The capabilities endpoint must confirm the native engine is available before the app offers the microscopic vehicle simulation. The independent 60-minute XGBoost forecast remains available as a forecast if the executable is unavailable; it must not be described as a live SUMO execution.

## Validation performed on this release

- Backend pytest suite: 66 passed.
- Frontend agent smoke suite: passed.
- Frontend public-routing smoke suite: passed.
- Render Blueprint: parsed and checked for exactly one Python service named `urbansarthi`, no Docker runtime, no `apt-get`, and the original Alembic/Uvicorn Start Command.
- A regression test verifies that wheel discovery works even when old `/usr/bin/sumo` and `/usr/share/sumo` paths are still present but invalid.

The local environment used to prepare this release had no DNS/network access, so it could not download/install the 148 MB PyPI wheel or run a live Render deployment. The actual wheel install and endpoint response must be confirmed in Render logs after deployment.
