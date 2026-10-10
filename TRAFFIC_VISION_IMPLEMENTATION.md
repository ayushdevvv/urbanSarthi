# UrbanSaarthi Traffic Vision — implementation and verification

## Implemented

- Added the supplied YOLO11 `best.pt` checkpoint under `backend/models/best.pt`.
- Added lazy-load inference service (`backend/app/services/traffic_detection.py`) and FastAPI routes:
  - `GET /api/v1/traffic-detection/status`
  - `POST /api/v1/traffic-detection/analyze?confidence=0.25`
- Inference uses the supplied model through Ultralytics at 640-pixel inference size. Class names are read from the checkpoint at runtime; vehicle counts normalize car, bus, motorbike/motorcycle, and bicycle. Person detections remain detections but are not counted as vehicles.
- Preserved the notebook's preliminary Low/Medium/High thresholds (up to 3, up to 8, 9+) and prominently labelled them as unvalidated image-count heuristics.
- Added browser camera access with no audio, still-frame analysis, optional repeated frame sampling, and upload fallback. The camera stream stays in the browser; only the explicit frame request is sent to the API.
- Added a labelled sample preview for API/model errors. Sample values and any image are clearly marked as not model output.
- Added mobile-responsive styling, navigation entry, confidence control, loading/error states, annotated-frame view, and source/privacy/limitations copy.
- Updated backend requirements, environment example, README/RUNNING instructions, and generated OpenAPI contract.

## Verification run

- Backend test suite: **7 passed**.
- Python compilation: passed.
- Frontend JS/JSX parser check: **23 files passed**.
- API test confirms traffic status route and unsupported-upload rejection.
- Full Vite production build and real YOLO inference were **not run in this environment**: frontend packages are not installed here, and Ultralytics is not installed here. The inference endpoint is wired to the supplied checkpoint but must be verified after dependencies are installed and on the target Render runtime.

## Deploy checklist

1. Deploy this project's backend source, including `backend/models/best.pt`, to Render.
2. Confirm the Render root directory points to `backend` and its build command installs the updated `requirements.txt`.
3. Confirm `TRAFFIC_MODEL_PATH` is unset (default checkpoint path) unless the weights were moved.
4. Check `GET /api/v1/traffic-detection/status` and submit a real JPG/PNG/WebP image to `POST /api/v1/traffic-detection/analyze`.
5. Confirm Render has enough RAM for PyTorch/Ultralytics CPU inference. A small free instance may not be sufficient; frontend sample mode is a fallback, not a substitute for verified model output.
6. Deploy frontend source to Vercel and confirm `VITE_API_URL` points to the backend base ending in `/api/v1`, and backend `CORS_ORIGINS` includes the exact Vercel origin without a trailing slash.
7. Test camera permission on HTTPS and image upload on desktop and mobile. Live scan is repeated frame sampling, not object tracking; do not describe its counts as unique vehicles or measured real-time congestion.


## Authority only traffic model and public traffic data

The YOLO image model is available in the authority workspace at `/authority/traffic-model`; it is no longer a citizen navigation item. A successful model inference can be sent to a selected registered junction to create a traffic observation and a draft signal recommendation. A single image supplies vehicle counts only. It does not measure queue length, lane demand, or speed, so those values are not invented.

Citizen traffic conditions use the backend `/api/v1/traffic/current` adapter. Configure `TOMTOM_API_KEY` in the backend environment to enable TomTom Flow Segment Data. The key is never exposed to the frontend. Without a key, the API returns a clear not configured state rather than fake live readings.

SUMO is not automatically installed or run by this project. Signal plan simulation currently uses the existing analytical what if engine and explicitly returns `sumo_run: false`. A genuine SUMO run requires a SUMO installation plus a compatible network file and route or demand inputs for the target junction. Do not present the analytical result as a SUMO result.

The supplied AQI checkpoint, label encoder, preprocessor and model configuration are preserved unchanged. No retraining was performed, so the reported model accuracy is unchanged and has not been independently improved by this integration.
