# UrbanSaarthi — Route, AQI and Admin Navigation Repair

## Route planner

- Resolve origin and destination together when the user submits a journey.
- Keep the configured backend route request and browser-accessible OpenStreetMap route providers in parallel.
- Public route discovery queries OSRM-backed OpenStreetMap routers and Valhalla; forced road-snapped through-points are attempted when providers return fewer than three distinct paths.
- Add Photon geocoding as a second public geocoder when Nominatim fails or returns an empty result.
- Use the same ordered route collection for route cards, map polylines, selected route, and Google Maps handoff.
- Route preference changes (`Fastest`, `Balanced`, `Cleanest`) now reorder already retrieved routes locally; they do not re-query the public routing engines.
- Editing or swapping endpoints invalidates in-flight requests and clears their loading state, preventing an older journey result from replacing the newly entered one.
- If all road routers fail, show a distance/time estimate with no fabricated geometry and provide a Google Maps direction handoff. This is explicitly not a mapped route.

**Provider limitation:** OSRM and Valhalla return up to the requested number of alternatives, but public routing engines do not guarantee three distinct paths for every origin/destination pair. The application does not invent straight-line paths to fill missing alternatives.

## AQI page consolidation

- Citizen portal: current AQI, pollutant readings and the 24-hour hourly outlook are on the single Air Quality page.
- The duplicate standalone AQI forecast page source has been removed.
- `/citizen/aqi-forecast` and `/citizen/aqi-vision` redirect to `/citizen/air-quality`.
- AQI location search now falls back to public geocoding when the backend geocoder fails or returns no results.
- Authority AQI continues to include its forecast within the AQI overview; `/authority/aqi-forecast` redirects to `/authority/air-intelligence`.

## Admin navigation

The sidebar order is:

1. Overview — City overview
2. AQI — AQI overview
3. IoT — IoT sensor network
4. Traffic — Camera system, Traffic agent, Traffic simulation

Standalone Traffic Analysis and Signal Plans are not in the sidebar. Their old URLs redirect to Camera System and Traffic Agent respectively.

## Verification performed

- Frontend source smoke tests: passed.
- Public routing tests: passed (three distinct provider geometries, transit not misrepresented as a road route, estimate-only fallback has empty geometry, Nominatim-empty -> Photon geocoder fallback).
- Backend test suite: 44 passed.
- TypeScript JSX transpile/parser check: 40 JS/JSX files parsed successfully; relative imports resolve.
- The frontend Vite production build was not run because dependencies are not installed in this workspace.
- Live calls to public OSRM/Valhalla/Nominatim/Photon providers could not be exercised from this workspace because outbound DNS/network access is unavailable. The provider paths were verified with mocked responses; actual provider availability and browser CORS must be checked after deployment.

## Run locally

```bash
cd frontend
npm install
npm test
npm run build
```
