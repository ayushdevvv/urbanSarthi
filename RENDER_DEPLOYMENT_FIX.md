# Render deployment fix: Alembic multiple heads

The failing log shows Render is still running this manually configured command:

```sh
alembic upgrade head && python scripts/seed_demo.py && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

That command does not use the `render.yaml` start command. In the existing Render service, open **Settings → Build & Deploy → Start Command** and replace it with:

```sh
sh scripts/start.sh
```

Set **Root Directory** to `backend` (the script path is relative to that directory). Then save and trigger a **Clear build cache & deploy** if the service still appears to use stale files. The included `render.yaml` uses the same start command, and the Dockerfile now calls the same script.

The script prints `alembic heads` in logs and runs `alembic upgrade heads`, which can apply all current branch heads. If migration branches create conflicting DDL, a proper Alembic merge migration is still required; do not stamp the production database or delete migration files to hide the conflict.

Important: the ZIP's migration folder currently contains a single linear chain. If Render continues to report multiple heads after deploying this archive and setting the command above, Render is building a different Git commit/branch or using a different root directory. Check the deployed commit and the files under `backend/alembic/versions/`.
