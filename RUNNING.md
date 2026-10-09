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

The local default `VITE_API_URL` is `http://127.0.0.1:8000/api/v1`. The variable must include `/api/v1` in production as well. The Vite dev server shows the local URL in its terminal.

## Vercel

Choose `frontend` as Vercel's Root Directory and set `VITE_API_URL` to the production backend host plus `/api/v1`. `frontend/vercel.json` handles SPA deep links. The backend CORS allow-list must include the deployed frontend origin.

## Backend/frontend data boundary

The frontend consumes the supplied OpenAPI contract. Empty or unavailable endpoint responses remain visible as empty/error states; they are not replaced by browser-side claims of live traffic, air quality, transit arrivals, weather, or physical signal-control connectivity.

## Traffic Vision (YOLO11)

The Traffic AI page is available at `/citizen/traffic-vision`. Camera access requires `localhost` or HTTPS and explicit browser permission. If camera access is unavailable, use image upload. The backend's `GET /api/v1/traffic-detection/status` endpoint shows whether the weights and inference package are present. If deploying to Render, install the updated `backend/requirements.txt`, keep `backend/models/best.pt` in the deployed source, set `TRAFFIC_MODEL_PATH` only if the weights are stored elsewhere, and verify a real image inference request. PyTorch/Ultralytics may exceed the memory budget of a small free instance; the frontend shows a clearly labelled sample preview if the model endpoint fails.
