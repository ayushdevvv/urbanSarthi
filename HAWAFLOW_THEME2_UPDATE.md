# UrbanSaarthi · InnovateX Theme 2 update

## What is now in the workspace

- City-selectable ambient AQI outlook for Kanpur, Lucknow, Delhi and Mumbai, with provider scale, last-update time and source caveat.
- Current PM2.5, PM10, NO2 and ozone pollutant tiles plus an animated 24-hour PM2.5 chart.
- UrbanSaarthi response-loop visualisation linking YOLO/OpenCV vehicle evidence, the emissions engine, hotspot ranking and human-reviewed signal intervention.
- Ranked pollution hotspots based on the existing traffic observations, estimated tailpipe emissions and nearby AQI records.
- Carbon and pollutant estimator for CO2, NOx, PM and CO, including class-level breakdown.
- One-click import of the latest video-derived class counts from Traffic Lab into the UrbanSaarthi emissions estimator.
- Emissions-aware candidate signal plan, baseline/intervention SUMO comparison and downloadable impact report.
- Animated KPI cards, AQI gauge, pollutant bars, pipeline steps and responsive layout.

## OpenCV/video reliability update

The video reader now tries OpenCV `VideoCapture` first. When a cloud codec build cannot decode a MOV/MP4/WebM file, `imageio-ffmpeg` supplies decoded BGR frames to the same OpenCV resize + YOLO tracking/inference and annotation pipeline. `/api/v1/traffic-detection/video-status` now exposes:

- `opencv_available` and `opencv_version`
- `opencv_ffmpeg_enabled`
- `ffmpeg_fallback_available`
- `decoder_ready`
- `video_analysis_ready`
- `readiness_note`

The backend must be redeployed after installing the updated `backend/requirements.txt` so `imageio-ffmpeg` is available on Render. Check the status endpoint before the demo. Video analysis is ready only when YOLO weights, Ultralytics, OpenCV and a compatible decoder are available.

## Verification

- `python -m compileall -q backend/app backend/tests` passed.
- Backend test suite: **38 passed**.
- Frontend smoke tests: passed.
- TypeScript JSX parse check for the modified frontend pages: passed.
- FFmpeg fallback exercised against a generated H.264 clip with OpenCV's `VideoCapture` deliberately unavailable; the frame decoder returned frames and the mocked YOLO video-report path completed.
- Full Vite production build was not verified because `npm ci` timed out in this environment. Run `npm ci && npm run build` from `frontend` before deployment.
- This environment did not have Ultralytics installed, so model inference with the bundled `best.pt` was not run end-to-end here. Install the backend requirements and confirm `inference_dependency_available: true` and `video_analysis_ready: true` in the status endpoint.
- Native SUMO execution and external provider connectivity require validation in the deployment environment. The app keeps forecast/impact caveats visible and does not claim a real mapped city simulation.

## Demo sequence

1. Open **Authority → Traffic Lab** and upload a short H.264 road clip.
2. Confirm the status strip reports YOLO + OpenCV ready (or OpenCV with FFmpeg fallback).
3. Run YOLO analysis and check the annotated frame and vehicle-class counts.
4. Open **UrbanSaarthi** and import the latest YOLO evidence.
5. Calculate CO2, NOx, PM and CO estimates using the corridor-distance assumption.
6. Review hotspot ranking, create an emissions-aware signal draft and, when native SUMO is configured, run the baseline/intervention comparison.
7. Download the environmental impact report. Explain that tailpipe estimates, ambient AQI forecasts and simulation outputs are separate evidence types.
