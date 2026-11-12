# UrbanSaarthi — live-first fallback and route sorting fix

## What was corrected

### 1. Backend-first loading
- The global outage banner no longer hydrates old connection notices from `localStorage` on application startup.
- Connection banners are session-scoped and appear only after a request in the current session fails or a direct provider fallback is used.
- API requests always try the configured UrbanSaarthi backend before reading a saved response.
- Safe read requests (`GET`, `HEAD`, `OPTIONS`) retry transient network/5xx failures twice before falling back. This gives hosted backends a chance to wake up.
- The default request grace period is 60 seconds.
- Saved API responses are used only after a network/timeout failure or HTTP 5xx/408/429. Client/request errors such as 400, 401, 403, 404 and 422 are not masked with cached data.
- A successful live response clears the corresponding outage notice.

### 2. No stale results while live requests are pending
- Route results are cleared while a new route request is being checked against live providers. A matching saved route may reappear only if that request actually fails and the API client restores the exact-input snapshot.
- Traffic simulation results are cleared during refresh. The last saved scenario is restored only after a service/network failure, not while a live request is still pending.
- Previous carbon calculation results are not loaded as the initial page result. The local emission calculator runs only after the current API calculation fails.
- The Traffic Lab's last successful video analysis remains available as a clearly labelled historical user artifact (`Last successful analysis`), not as a claim of a new inference.

### 3. Route ordering and matching map/card order
- Server-side sorting now uses deterministic preference comparators:
  - **Fastest:** ETA, then distance, then CO₂.
  - **Cleanest:** observed route-area pollution score where available, then estimated CO₂, then ETA. Missing pollution coverage is never treated as zero or as clean air.
  - **Balanced:** normalized weighted comparison of ETA (40%), route-area pollution score (35%, neutral only where missing), and estimated CO₂ (25%). If no pollution score exists for any route, ETA receives 70% and CO₂ 30%.
- Route labels are assigned after sorting, so `Fastest route`, `Lowest-impact route`, `Lowest CO₂ route`, and `Recommended balance` match the actual first-ranked route.
- The frontend applies the same preference sort defensively to returned/cached route payloads.
- The map lines, route legend, route cards, emission comparisons and selected route all use the same sorted list. Selecting a card still highlights that route's geometry.
- Unmapped distance estimates retain their estimate label and are not relabelled as a real road-network path.

## Files changed
- `frontend/src/components/shared/DataStatusBanner.jsx`
- `frontend/src/services/apiSnapshot.js`
- `frontend/src/services/api/client.js`
- `frontend/src/services/airQuality.js`
- `frontend/src/pages/citizen/RoutePlannerPage.jsx`
- `frontend/src/pages/citizen/TrafficInfoPage.jsx`
- `frontend/src/pages/authority/CarbonImpactPage.jsx`
- `frontend/test-agent-frontend.js`
- `backend/app/services/routing.py`
- `backend/tests/test_location_services.py`

## Verification
- `pytest -q backend/tests` — **44 passed**.
- `node frontend/test-agent-frontend.js` — **all workspace smoke tests passed**, including a runtime test proving live HTTP 200 responses win over an existing cached snapshot, HTTP 500 permits the saved response, and HTTP 422 does not.
- TypeScript parser check — **39 frontend JS/JSX files parsed with zero syntax errors**.
- Full Vite production build remains unverified because `frontend/node_modules/.bin/vite` is not installed in this workspace. Run `npm install` and `npm run build` inside `frontend` before deployment.

## Important routing constraint
Three distinct mapped alternatives are actively requested, but public road-routing services do not guarantee three paths for every origin/destination. The app keeps genuine road-network geometry and does not fabricate straight-line roads to fill the list.
