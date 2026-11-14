# UrbanSaarthi - run locally

Needs: **Python 3.11+**, **Node 18+**. No paid API keys. Internet is used only for Open-Meteo (AQI), OpenStreetMap
(places/routes) and the frontend's `npm install`.

## Quick start (macOS / Linux)

```bash
cd <project root>            # the folder that contains backend/ and frontend/
chmod +x run_local.sh
./run_local.sh check         # 1) verify the agent - needs nothing installed
./run_local.sh setup         # 2) venv + backend deps + DB migrations + npm install
./run_local.sh all           # 3) API on :8000, web app on :5173
```

Open http://localhost:5173 (app) and http://127.0.0.1:8000/docs (API docs, try `POST /api/v1/agent/analyze`).
On Windows, follow `RUNNING.md` but install `backend/requirements-core.txt` instead of `requirements.txt`.

Optional: `./run_local.sh seed --demo-telemetry` (synthetic demo data), `./run_local.sh setup-vision` (torch/YOLO for the two vision pages),
`./run_local.sh test` (backend pytest suite).

## Why `requirements-core.txt`?
The original `requirements.txt` pins `torch==2.10.0+cpu`. That `+cpu` build only exists for Linux/Windows, so on a Mac the install is
expected to fail. The core file leaves out torch/ultralytics (they are imported lazily, so the API still starts); the vision pages
then report "inference unavailable". `requirements-vision.txt` adds them back with a macOS-safe pin.
If importing `xgboost` fails on macOS with a `libomp` error: `brew install libomp`.

## The agent
`POST /api/v1/agent/analyze` - a **rule-based** tool router (no LLM). It calls up to four tools: traffic snapshot, AQI snapshot,
route advisor, signal strategy. With internet it uses live Open-Meteo AQI; without it, it labels mock data as mock.
`./run_local.sh check` = 13 must-pass checks + 7 known issues (see `backend/scripts/check_agent.py`).
The agent is **not wired into the web UI yet** - call it from `/docs` or curl:

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/agent/analyze -H 'Content-Type: application/json' \
  -d '{"query":"Is it safe to travel from CP to ITO?","latitude":28.6315,"longitude":77.2167,"dest_latitude":28.6287,"dest_longitude":77.2411}'
```
