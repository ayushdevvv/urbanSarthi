# UrbanSaarthi — running the combined project

## Backend first

Read `backend/README.md`, then:

```bash
cd backend
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
# Copy .env.example to .env and set real, private secrets.
alembic upgrade head
python scripts/seed_demo.py
uvicorn app.main:app --reload
```

Backend docs: `http://127.0.0.1:8000/docs`.

## Frontend

In a second terminal:

```bash
cd frontend
# Copy .env.example to .env; change the API URL only if needed.
npm install
npm run dev
```

The local default `VITE_API_URL` is `http://127.0.0.1:8000/api/v1`. The variable must include `/api/v1` in production as well. The Vite dev server shows the local URL in its terminal. The frontend displays scenario estimates if the API is empty or unreachable, while keeping them distinct from live observations.

## Render database recovery

For PostgreSQL deployments, startup runs `alembic upgrade head` and then seeds the shared workspace only when core tables are empty. The migration chain includes a forward-only repair for a missing `transit_routes` table. Make sure Render deploys this archive and has the correct `DATABASE_URL`; after redeploy, inspect logs for migration and seed completion. No SQL shell work or manual table creation should be required. Do not wipe the database to resolve a schema error.

## Vercel

Choose `frontend` as Vercel's Root Directory and set `VITE_API_URL` to the exact Render service host plus `/api/v1`, then redeploy Vercel. On Render, set `CORS_ORIGINS=https://urbansarthi.vercel.app`, then redeploy the backend. The Vercel preview regex is enabled too. The exact Render hostname must come from your Render dashboard; this source archive cannot change cloud project settings.

## Backend/frontend data boundary

The frontend consumes the supplied OpenAPI contract. Empty or unavailable responses fall back to labelled scenario estimates, never claiming those AQI, transit or traffic values are live. Physical signal-control connectivity is not implied.
