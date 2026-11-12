# UrbanSaarthi → UrbanSaarthi: InnovateX Theme 2 build notes

## What changed

This update adds a pollution-intelligence layer to the existing UrbanSaarthi app. It does not replace the existing portal, traffic model, route planner or database. The dedicated workspace is branded UrbanSaarthi for InnovateX Theme 2: Rising AQI in Modern Urban Cities.

### 1. Traffic-to-emissions engine

- New service: `backend/app/services/emissions.py`.
- Estimates CO2, NOx, PM and CO separately for cars, two-wheelers, buses, trucks and bicycles.
- Accepts either vehicle counts multiplied by an operator-entered corridor distance, or simulated vehicle-kilometres from SUMO trip records.
- Returns totals, per-class breakdown, units, factor version, source URLs and limitations.
- The BS-VI PM/NOx/CO values are indicative factors referenced by the Maharashtra Pollution Control Board Nashik source-apportionment report (Table 7.6). They are not measured Kanpur fleet-average factors.
- Petrol and diesel fuel-carbon factors are referenced to the AEEE Green Vehicle Rating Methodology white paper (Table 1). Vehicle fuel-use rates are editable project assumptions. The CNG carbon factor is explicitly an unsourced prototype assumption.

### 2. Pollution hotspot ranking

- New API: `GET /api/v1/air-intelligence/hotspots`.
- Uses the latest traffic observation per junction within the selected recent window.
- Combines traffic congestion/volume, estimated NOx + PM, and the nearest recent ambient AQI observation when available.
- Exposes score components, source labels, observation timestamps, AQI station distance and data completeness.
- Scores are relative to the returned junction shortlist. They are not regulatory AQI values or a validated health-risk index.

### 3. Emissions-aware signal timing

- New service: `backend/app/services/traffic_calibration.py`.
- Traffic Lab accepts operator-drawn polygons in normalized 0–1 frame coordinates.
- Four canonical IDs are required for directional optimization: `north_south_through`, `east_west_through`, `north_south_turn`, `east_west_turn`.
- Vehicle detections are assigned by bounding-box centre. Unique ByteTrack IDs are used when available; otherwise the peak simultaneous count inside each region is used.
- The candidate green split weights approach vehicle volume at 70% and a relative NOx + PM + CO class-intensity proxy at 30%. CO2 is excluded from this local-air-pollutant weighting. Minimum-green and 45% maximum-share constraints are applied.
- If any of the four ROIs is missing, the API creates an equal-split draft with `optimized=false`; it does not invent approach direction.
- The saved signal plan remains advisory and goes through the existing human review flow. Plan creation and simulation completion are also written to the existing audit log. There is no physical controller dispatch.

### 4. Baseline vs intervention and impact report

- New API: `POST /api/v1/air-intelligence/simulations/compare`.
- Requires native SUMO. Runs a baseline and candidate timing experiment for 3,600 simulated seconds using the same deterministic generated multi-class flows and fixed seed.
- YOLO vehicle mix can inform the generated vehicle-class proportions and demand scaling, but the camera footage is not map-matched to the included synthetic network.
- Parses SUMO summary and trip-info outputs to compare average waiting time, trip duration, queue, completed vehicles and estimated pollutant totals.
- SUMO emissions are estimated from trip distance by vehicle class and the versioned factor set; this prototype does not use a detailed speed/load/engine emission model.
- If SUMO is missing, this comparison endpoint returns `424`. It does not relabel the XGBoost forecast as an intervention experiment. Traffic Lab's separate 60-minute forecast still has the trained XGBoost fallback.
- `GET /api/v1/air-intelligence/reports/{simulation_id}` returns the saved environmental impact report as JSON.

## Important video fix

`backend/app/services/traffic_video.py` now initializes the sampled-frame timeline before adding points, validates camera ROIs, and emits approach-level demand. The video reader now tries OpenCV `VideoCapture` first and falls back to the portable FFmpeg binary supplied by `imageio-ffmpeg` when a phone-recorded MOV/MP4/WebM clip cannot be decoded by the server's OpenCV build. The decoded BGR frames still pass through the same OpenCV resize, YOLO inference, annotation and reporting pipeline. `/traffic-detection/video-status` now reports the OpenCV version, FFmpeg capability and fallback-decoder availability instead of relying only on package metadata. The frontend keeps the video upload workflow and shows which decoder path is ready.

The Traffic Lab also hands the latest YOLO vehicle-class counts to UrbanSaarthi Air Intelligence in the same browser session, so users can import actual analysed counts into the corridor emissions estimate rather than retyping them.

The video file is processed from a temporary location and is not retained as a media asset. Structured observation evidence is saved when the operator workflow runs.

## Main touched files

### Backend

- `backend/app/services/emissions.py` — vehicle-class emissions factors and calculations.
- `backend/app/services/traffic_calibration.py` — ROI validation, polygon membership and timing allocation.
- `backend/app/services/traffic_video.py` — OpenCV/YOLO video and ROI report, including timeline bug fix.
- `backend/app/services/traffic_ops_agent.py` — bounded emissions tool and signal draft integration for LangGraph and deterministic fallback.
- `backend/app/services/sumo_runner.py` — same-demand native SUMO baseline/candidate runs, multi-class routes and trip-distance emissions.
- `backend/app/api/air_intelligence.py` — factors, estimate, hotspots, plan optimization, comparison and report endpoints.
- `backend/app/api/traffic_detection.py` — video report persistence, corridor distance and truthful forecast/plan status.
- `backend/app/main.py` — registers the Air Intelligence router.
- `backend/tests/test_air_intelligence.py` — emissions, ROI, optimizer, video, route-builder, signal-patch and API smoke tests.

### Frontend

- `frontend/src/pages/authority/AirIntelligencePage.jsx` — new Air Intelligence workspace.
- `frontend/src/pages/authority/air-intelligence.css` — page styling.
- `frontend/src/pages/citizen/TrafficVisionPage.jsx` and `traffic-lab-premium.css` — camera ROI configuration and video emissions evidence.
- `frontend/src/App.jsx` and `frontend/src/components/layout/AuthorityLayout.jsx` — route and navigation.
- `frontend/test-agent-frontend.js` — updated stale smoke test expectations to match the actual current route layout and newly added pages.

## API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/air-intelligence/factors` | Factor catalogue and source provenance |
| POST | `/api/v1/air-intelligence/emissions/estimate` | Estimate emissions from a vehicle mix and corridor distance |
| GET | `/api/v1/air-intelligence/hotspots` | Rank recent junction observations |
| POST | `/api/v1/air-intelligence/signal-plans/optimize` | Save emissions-aware draft or equal-split fallback |
| POST | `/api/v1/air-intelligence/simulations/compare` | Run native SUMO baseline/intervention comparison |
| GET | `/api/v1/air-intelligence/reports/{simulation_id}` | Download stored JSON impact report |
| POST | `/api/v1/traffic-detection/analyze-video` | OpenCV/YOLO clip analysis; optional `approach_rois` JSON query |
| POST | `/api/v1/traffic-detection/ops-workflow` | Persist video evidence, run agent tools, save a signal plan and run a 60-minute forecast |

## External setup

- YOLO `backend/models/best.pt` and the traffic XGBoost artifacts are bundled.
- OpenCV, `imageio-ffmpeg`, Ultralytics and PyTorch are installed through `backend/requirements.txt`. CPU inference works but can be slow. Redeploy the backend after installing the updated requirements so the FFmpeg video-decoder fallback becomes available.
- Groq is optional. Set `GROQ_API_KEY` and `GROQ_MODEL` in backend `.env` for hosted LLM reasoning and tool calling. Without a key, deterministic local tools still run.
- SUMO is free but optional for the dedicated baseline/intervention comparison. Configure `SUMO_BINARY` or add `sumo` to PATH. Without SUMO, the app keeps the independent XGBoost forecast but cannot run the comparative experiment.
- No paid API key is required for the core local emissions calculation, hotspot ranking, ROI validation or deterministic tool workflow.

## Verification performed in this environment

- `python -m compileall -q backend/app backend/tests` — passed.
- `cd backend && pytest -q` — **38 passed**.
- `cd frontend && npm test` — passed (route/API/source smoke tests).
- Frontend smoke tests passed. The modified JSX files (`AirIntelligencePage.jsx`, `TrafficVisionPage.jsx`, `AuthorityLayout.jsx`) passed a TypeScript transpile/parse check.
- FastAPI app import and route registration — six Air Intelligence routes registered.

## Not verified here / remaining limitations

- `npm ci` timed out; therefore `npm run build` could not run because Vite dependencies were not fully installed in this environment. Run `npm ci` and `npm run build` locally.
- SUMO is not installed in this environment, so the native 3,600-second execution could not be run end-to-end here. Install SUMO locally and test the two-scenario run before presenting simulation output.
- Camera ROIs are manually calibrated by an operator and need to be drawn for the selected camera view. They are not automatically discovered lanes.
- The bundled SUMO road grid is synthetic. It is not a surveyed Kanpur network, and CCTV footage is not geospatially map-matched to it.
- The emissions factor profile is illustrative and should be replaced with suitable local fleet factors and validated fuel-use assumptions before field reporting.
- AQI remains ambient observation data and is not derived from estimated tailpipe emissions.
- No real CCTV/RTSP streaming or physical traffic-controller integration is included. The human approval process saves an operator decision; it does not actuate a signal.
- The repository remains in demo identity mode with authority writes available through a shared demo identity. Do not deploy with real CCTV, personal data or live traffic-control equipment before restoring authentication/RBAC and reviewing retention, audit and safety controls.
