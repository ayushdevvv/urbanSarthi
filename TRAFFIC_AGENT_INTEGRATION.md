# Traffic Agent integration

## Workspace placement

Traffic Agent is exposed as its own destination in the authority sidebar under Traffic. It remains a separate page at `/authority/traffic-agent`; Traffic Lab continues to capture OpenCV/YOLO evidence and links to the Agent, while Traffic Simulation and Digital Twin retain their separate responsibilities.

## Existing workflow retained

The Agent continues to use the existing `POST /traffic-detection/ops-workflow` backend workflow. It reads only a genuine saved Traffic Lab report for a live run, uses the selected registered junction, calculates the vehicle-emissions estimate, drafts a signal plan, and requests the 60-minute forecast. Human review remains required. The local example is labelled as illustrative and cannot be approved or dispatched. Approval records the operator's decision; no physical signal actuation is implemented.

The backend router is already registered in `backend/app/main.py`, and its optional analysis dependencies and deterministic fallback remain unchanged.

## Entry and fallback behaviour

On entry, the Agent shows a themed loading state. If a workflow result has not arrived within five seconds, the page reveals a local illustrative preview so the workspace does not remain blank. A later live result replaces that preview. Illustrative values are never submitted as YOLO evidence to the backend.

## Presentation

- Added Traffic Agent as a dedicated item in the Traffic sidebar group.
- Preserved the existing Traffic Lab hand-off and direct route.
- Added matching light and dark mode styling, including the authority header and controls.
- Removed internal implementation labels from the operator-facing status and results.
- Kept responsive layouts, signal-plan review safeguards, and existing backend contracts.

## Validation

- `frontend/npm test` passes, including workspace and public-routing smoke tests.
- JS/JSX syntax and CSS parse checks are included in release validation.
- A production Vite build could not be run in this environment because the `vite` executable is not installed in `frontend/node_modules`.
