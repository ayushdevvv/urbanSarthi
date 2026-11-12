# UrbanSaarthi Traffic Lab setup

This guide configures the uploaded project locally. Use Python 3.11 or 3.12 and Node.js 18+ (Node 20 LTS is a safe choice). Python 3.13 may work with current wheels, but 3.11/3.12 is the safer baseline for vision dependencies.

## What's included

- `backend/models/best.pt`: the project's YOLO traffic checkpoint.
- `backend/app/ml/traffic_simulation/models/`: trained 30/60-minute XGBoost artifacts and evaluation metrics.
- `backend/app/ml/traffic_simulation/data/raw.csv`: the existing SUMO-generated training data.
- OpenCV video decoding, YOLO inference and tracking, structured report, agent tool workflow, signal-plan review, forecast timeline and report download.
- **Air Intelligence**: pollutant-specific tailpipe emissions estimation, relative pollution-hotspot ranking, camera-ROI approach calibration, emissions-aware signal-plan drafts, SUMO baseline/intervention comparison and JSON environmental impact reports.

## 1. Backend on Windows PowerShell

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
alembic upgrade heads
python scripts/seed_demo.py
# Optional local-only fixture for testing without real junctions:
# python scripts/seed_demo.py --demo-network --demo-telemetry
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

If your Python launcher does not expose `py -3.12`, replace that line with the full path to your Python 3.12 executable. If PowerShell blocks venv activation, run `Set-ExecutionPolicy -Scope Process Bypass` in that terminal, then activate again. The default seed registers provider connectors only. It does not create junctions or telemetry. Synthetic junctions/telemetry are strictly opt-in via `--demo-network --demo-telemetry`; use these only in a separate local test database, never as real city infrastructure.

The backend `.env` uses SQLite by default for local development. Keep all API keys server-side. `/docs` at `http://127.0.0.1:8000/docs` exposes the FastAPI routes.

## 2. Frontend

Open a second terminal from the repository root:

```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`. `VITE_API_URL` should be `http://127.0.0.1:8000/api/v1`. Never add a Groq or other secret key to `VITE_*` variables.

## 3. External downloads / API keys

| Item | Required? | Cost / purpose |
|---|---|---|
| YOLO checkpoint `best.pt` | Included | Local object detection; no model-hosting API key.
| OpenCV + Ultralytics + PyTorch | Install from backend requirements | Local video/frame decoding, vehicle inference and tracking. CPU inference works but can be slow. A compatible NVIDIA CUDA setup is optional, not required.
| Groq developer API key | Optional | Enables actual LLM reasoning/tool selection with LangGraph and a Groq-hosted model. Create one at <https://console.groq.com/keys>. Provider quotas and pricing depend on your account and can change; check the current model/pricing page before relying on it as free. This key is optional.
| SUMO traffic simulator | Optional | Enables native 3,600-second simulations for baseline and proposed signal timing on the included synthetic grid. No API key. Official downloads: <https://eclipse.dev/sumo/docs/Downloads.html>.
| TomTom / OpenWeather / OpenAQ / mapping keys | Not required for this Traffic Lab flow | Other features may use these providers if configured; they are not required for YOLO reports, the local XGBoost fallback or deterministic agent tools.

### Turn on the LLM tool-calling agent (optional)

Open `backend/.env` and set:

```dotenv
GROQ_API_KEY=your_groq_key_here
GROQ_MODEL=openai/gpt-oss-120b
```

Restart Uvicorn after changing the file. When configured and the installed LangGraph/LangChain-Groq packages plus provider endpoint are available, the agent calls three bounded tools: inspect video evidence, draft signal timings, and run the 60-minute scenario. If the key is absent or the LLM stack fails, the workflow transparently switches to deterministic local tools and shows the reason. No external LLM is needed for vehicle detection itself.

The key is secret: do not commit `.env`, paste it into screenshots, or put it in frontend environment variables.

### Turn on native SUMO (optional)

Install SUMO using the official download page, then ensure `sumo` is resolvable in a new terminal. Alternatively configure the full executable path in `backend/.env`:

```dotenv
SUMO_BINARY=C:\Program Files (x86)\Eclipse\Sumo\bin\sumo.exe
```

Change the path to the actual location on your machine and restart the API. The Traffic Lab checks this setting automatically. If SUMO is not detected, it falls back to the bundled XGBoost 60-minute forecast. If SUMO is detected but the simulation command fails, the response includes the failure note and uses the trained fallback instead.

## 4. Use the workflow

1. Open **Authority → Traffic Lab** and upload a short road clip. MP4/H.264 tends to be the most portable format. Limits are 150 MB and 10 minutes; at most 180 frames are sampled. OpenCV is tried first; if its cloud codec build cannot decode the clip, the bundled `imageio-ffmpeg` decoder fallback supplies frames to the same OpenCV + YOLO pipeline. You can also analyze a single road image.
2. Confirm the report shows model-produced counts and whether tracking IDs were available. Counts can be repeated or missed due to camera angle, occlusion and detector limits. The congestion score is explicitly a heuristic, not a calibrated queue measurement.
3. Choose a real registered junction with recent camera/traffic observations, cycle length and forecast scenario, then run the operations workflow. For a local-only test database you may explicitly create synthetic fixtures, which remain labelled as synthetic. The agent works on the structured report and calls the bounded tools. Alternatively, load recent authenticated RTSP edge-worker evidence from the Traffic Agent page; no local example report is generated when there is no evidence.
4. Review the signal timing draft and the 60-minute output. Approve or reject the draft; approval only saves an operator decision. It does not program traffic hardware.
5. Download the JSON evidence/report as needed. The uploaded media file is written to a temporary directory and removed after inference; the structured observation/report is persisted by the workflow.

## 5. What the 60-minute result means

**With SUMO:** SUMO executes 3,600 simulation seconds using generated vehicle routes on the included `grid.net.xml`; the runner compares unchanged baseline timing with a proposed timing on the same generated demand. The footage is not geospatially mapped to the network, direction/lane movement is not inferred from class counts, and the network is synthetic. Treat results as a reproducible what-if experiment, not evidence of a real junction improvement.

**Without SUMO:** the supplied trained XGBoost 30/60-minute models and SUMO-generated data produce a 13-point timeline. This is model inference / scenario sensitivity, not a live SUMO execution. The video report is retained as evidence but is not injected into the global XGBoost feature matrix.

If the camera does not have all four canonical movement ROIs calibrated, the signal planner deliberately returns an equal-split reviewable draft. With all four operator-calibrated ROIs, it generates a candidate green split using the documented traffic-volume and NOx + PM + CO proxy. Human approval is mandatory in either case. The current app has **no physical controller/ATCS integration**, cannot apply lights to a real junction, and keeps dispatch-preview as a JSON-only safety boundary. Do not remove this guard without an authorized interface, fail-safe controls, engineering validation and field approval.


## 6. Air Intelligence: InnovateX Theme 2 features

### Traffic-to-emissions estimator

- `POST /api/v1/air-intelligence/emissions/estimate` accepts `vehicle_counts` and an operator-specified `segment_distance_km`.
- The backend reports CO2, NOx, PM and CO separately, with class breakdown, vehicle-km, factor version, source links, and assumptions.
- Indicative BS-VI PM/NOx/CO factors are referenced to the Maharashtra Pollution Control Board Nashik source-apportionment report, Table 7.6. These are not measured Kanpur fleet-average factors. Petrol and diesel fuel-carbon factors are referenced to the AEEE Green Vehicle Rating white paper. Vehicle fuel-use rates are editable prototype assumptions; the CNG carbon factor is explicitly an unsourced prototype assumption and should be replaced before field reporting.
- The emissions result is a tailpipe estimate. It is not an ambient concentration, AQI forecast, personal exposure estimate, or complete inventory; it excludes non-exhaust dust, cold starts and atmospheric chemistry.

### Pollution hotspot ranking

- `GET /api/v1/air-intelligence/hotspots` selects the latest traffic observation per junction in the configurable recent window (default 24 hours).
- It combines available congestion/traffic-volume evidence, estimated NOx + PM and the nearest recent AQI observation (default search radius 5 km).
- Scores are relative to the returned junction shortlist, not a regulatory pollution-risk scale. The UI shows the data sources, timestamps, distance assumptions and data-quality label. Missing inputs are omitted rather than fabricated.

### Camera calibration and emissions-aware timing

- In **Traffic Lab → Camera approach calibration**, enter normalized 0–1 polygons for four canonical movement IDs: `north_south_through`, `east_west_through`, `north_south_turn`, and `east_west_turn`.
- A detection is assigned by the center of its bounding box. Tracking IDs are counted uniquely inside each ROI where available; otherwise the peak simultaneous detection count is used. Calibration is camera-specific and must be checked against the actual camera framing. A generic wide-angle view cannot establish turning movements without these regions.
- `POST /api/v1/air-intelligence/signal-plans/optimize` creates a saved draft. Green allocation uses 70% approach-volume weighting and 30% relative NOx + PM + CO vehicle-class intensity proxy, with a minimum green and a 45% maximum green-budget share. CO2 is reported but excluded from this local-air-pollutant weighting.
- If any of the four canonical approach ROIs are missing, the algorithm deliberately creates an equal-split draft and sets `optimized=false`. Human review is still required; there is no physical controller dispatch.

### Baseline/intervention and report

- `POST /api/v1/air-intelligence/simulations/compare` runs the same deterministic, generated multi-class demand (class proportions informed by YOLO counts) through baseline and candidate timing for 3,600 simulated seconds, with a fixed seed, using the bundled synthetic `grid.net.xml` network.
- SUMO is required for this comparative experiment. If it is unavailable, this endpoint returns a clear `424` response; the XGBoost forecast is not substituted and mislabeled as an intervention experiment. The separate Traffic Lab 60-minute forecast can still use its trained XGBoost fallback.
- SUMO emissions are estimated from trip-info route distance by vehicle class and the versioned factors. They are not produced by a detailed speed/load/engine emissions model. The road network is synthetic, not a mapped Kanpur intersection; the video is not geospatially map-matched to it.
- `GET /api/v1/air-intelligence/reports/{simulation_id}` returns the saved JSON impact report, including both scenarios, pollutant estimates, sources and caveats.

## 7. Main endpoints

- `GET /api/v1/traffic-detection/video-status` checks YOLO/OpenCV readiness and whether native SUMO is detected.
- `GET /api/v1/air-intelligence/factors` returns the estimator factor catalog and source provenance.
- `POST /api/v1/air-intelligence/emissions/estimate` calculates pollutant-specific estimated tailpipe emissions.
- `GET /api/v1/air-intelligence/hotspots` ranks recent observed junctions using available traffic, estimated emissions and nearby AQI.
- `POST /api/v1/air-intelligence/signal-plans/optimize` saves an emissions-aware candidate or equal-split fallback for review.
- `POST /api/v1/air-intelligence/simulations/compare` runs the SUMO baseline/intervention experiment (SUMO required).
- `GET /api/v1/air-intelligence/reports/{simulation_id}` returns the saved environmental impact report as JSON.
- `POST /api/v1/traffic-detection/analyze-video` processes a multipart `file` and returns sampled-frame counts, tracking summary, timeline and annotated peak frame.
- `POST /api/v1/traffic-detection/analyze` retains the prior single-image flow.
- `POST /api/v1/traffic-detection/ops-workflow` persists the observation, runs tools/forecast, records a signal-plan draft and a 60-minute simulation record.
- `POST /api/v1/signals/plans/{id}/approve` and `/reject` save operator review. `/dispatch-preview` only emits a preview; it is not a hardware command. Check exact routes and request schemas at `/docs`.

## 8. Troubleshooting

- **YOLO unavailable:** verify `backend/models/best.pt` exists, install the backend requirements, and inspect `/api/v1/traffic-detection/video-status`.
- **Video cannot decode:** visit `/api/v1/traffic-detection/video-status`. Confirm `decoder_ready` and `ffmpeg_fallback_available` are true. Redeploy the backend after installing updated requirements; then retry with a short MP4/H.264 clip under 150 MB/10 min.
- **Agent uses deterministic tools:** this is expected without a valid `GROQ_API_KEY`. Check backend logs if a key is configured but the model endpoint fails.
- **XGBoost fallback shown:** install SUMO and set `SUMO_BINARY` if you want native simulation. Fallback is not a failure of YOLO detection.
- **Frontend dependency/build error:** remove `frontend/node_modules` if it was copied from a different operating system, then run `npm ci` again on your machine.

This package is a prototype in demo access mode. Do not use real CCTV credentials, personal data or operational traffic-control systems until authentication, RBAC, retention, authorization, audit controls, and safety case are reviewed for deployment.
