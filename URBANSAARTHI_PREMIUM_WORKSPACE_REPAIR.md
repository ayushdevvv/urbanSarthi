# UrbanSaarthi workspace repair and UI refinement

## Navigation

- Overview is the first authority sidebar item.
- Traffic is next: Traffic Lab, Traffic Simulation, and Digital Twin.
- AQI follows Traffic: AQI Forecast and CO₂ Emissions.
- Legacy traffic-model URLs continue to open Traffic Lab.
- Legacy signal-plan URLs continue to open Digital Twin.

## Traffic Lab

- Fixed the render-time crash caused by unresolved icon components.
- Added a route-level error boundary with a retry action so a rendering regression does not leave the workspace blank.
- Kept the existing video/image upload, detection, report, and evidence handoff workflow.
- Added a clearly labelled illustrative report when no saved or live report is available.
- Added the three-step workflow cards and corrected the light/dark palette variables so both appearances retain readable contrast.

## Loading and reference data

- Shared API-backed workspaces show a loading state first.
- After five seconds without a successful response, a clearly labelled seeded/reference view is shown, even if the request is still pending.
- A later successful API response replaces the reference data automatically.
- Traffic Simulation, Traffic Lab, Digital Twin, AQI Forecast, Overview, and CO₂ Emissions all have a non-empty fallback path.
- Sample values are identified as illustrative/reference data and are not presented as live sensor readings or real detections.

## Appearance

- Overview is now labelled simply as “Overview” in the sidebar.
- Signal Plans is presented as “Digital Twin” in the navigation and page heading.
- The existing UrbanSaarthi forest-green theme is retained, with larger page headings, refined card spacing, and consistent loading states.
- Light and dark theme treatments are provided for Traffic Lab, AQI Forecast, Digital Twin, and CO₂ sections.

## Validation

- `npm test` passes, including workspace route and fallback smoke tests and public routing tests.
- 42 JavaScript/JSX/TypeScript source files parsed without syntax errors.
- 16 CSS files parsed without syntax errors.
- Relative source imports checked: no missing relative imports found.
- A production Vite build was not run because dependency installation (`npm ci`) timed out in the available environment.
