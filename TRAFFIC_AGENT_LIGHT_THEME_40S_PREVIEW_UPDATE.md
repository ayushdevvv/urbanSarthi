> **Historical implementation note (superseded):** The 40-second illustrative preview described below has been removed. The current Traffic Lab displays real YOLO results or an empty/unavailable state only; see [`docs/FEATURE_READINESS.md`](./docs/FEATURE_READINESS.md).

# UrbanSaarthi – Traffic Lab / TrafficSaarthi Agent update

## Changes in this revision

- Kept Traffic Lab on the shared light, forest-green and sage theme used by the rest of UrbanSaarthi. Improved control, heading, result and note legibility.
- Kept the agent workflow on its own `/authority/traffic-agent` page. Traffic Lab is now evidence capture and YOLO/OpenCV reporting, with a handoff to TrafficSaarthi Agent.
- The Agent auto-starts the real `POST /traffic-detection/ops-workflow` request when a genuine saved YOLO report and a registered junction are available. It can also be rerun by the operator.
- The backend workflow calls the evidence-inspection, emissions-estimation, signal-drafting and 60-minute-forecast tools. LangGraph + Groq is used when configured; the backend's deterministic tool implementation remains available without Groq credentials.
- Added a legible execution-stage indicator. The indicator advances while the backend job is running; exact tool completion is only marked from the actual response's returned `tools` list. The page explicitly explains that the HTTP endpoint returns the chain as one job and the indicator is not tool telemetry.
- Fixed the 40-second Agent preview timer so an in-flight request no longer suppresses the local preview. A later real response can replace the preview.
- Added a page-level 40-second illustrative Traffic Lab scene state when no prior real YOLO report exists. It is local-only, never persisted, and never submitted to the Agent.
- Added a `preview_only` marker and a guard to prevent illustrative Traffic Lab values from being treated as YOLO evidence by TrafficSaarthi Agent.
- When genuine evidence exists, the Agent runs on that evidence; a local preview cannot be approved or dispatched. Human approval remains required for a real draft. No physical signal actuation is implemented.

## Data provenance

Generated example values are identified as an **Illustrative preview**. They are not actual readings or YOLO detections. They are not stored as measurements, not sent to the operations endpoint, and cannot be approved or dispatched. The application must not present generated data as real field data.

Across the rest of the application, the existing API client continues to request the live backend first with a 40-second timeout and only uses a saved response after a network/timeout or qualifying server error. If no real saved response exists, a page should show an unavailable or preview state rather than inventing live measurements.

## Verification

- Frontend source smoke tests: `npm test` – passed.
- Backend tests: `pytest -q` – 44 passed.
- A full Vite production build was not run because `frontend/node_modules` (including Vite) is not installed in this workspace.

## Run locally

```bash
cd frontend
npm install
npm test
npm run build
```
