# UrbanSaarthi route and UI update

## What changed

- Removed the obsolete survey page, authority navigation entry, dashboard shortcut, associated copy and feature-specific styles. Ground-based road video analysis remains available.
- Updated the site favicon and Apple touch icon to `/favicon.png`; the PNG asset is present in `frontend/public`.
- The citizen route planner now requests road geometry from both OSRM and Valhalla, checks route-shape similarity, and retries Valhalla while excluding road segments from accepted paths. It supports driving, walking and cycling.
- The map draws every returned road-network geometry as a separate coloured path, fits the viewport around all routes, and provides an individual Google Maps directions link for every mapped alternative. The Google Maps handoff includes up to three intermediate coordinates sampled from the selected provider path. Google Maps recalculates the trip on its own network, so its final road choice can differ slightly from the in-app geometry.
- Route alternatives that lack real network geometry are not drawn as straight lines. When providers return fewer than three genuinely different options, the interface reports that limitation instead of fabricating a route.
- Added a global UI finishing layer for consistent card treatment, focus visibility, spacing, responsive route results and map presentation.

## Routing behaviour

OSRM is asked for up to three alternatives. Valhalla is queried independently and can be asked to avoid mapped road segments already used by accepted routes. These engines do not guarantee that three alternatives exist for every origin/destination pair; narrow streets, one-way constraints, islands, short trips and network gaps may legitimately leave fewer.

The backend needs outbound network access to the public OpenStreetMap routing services. For production-scale use, use a managed or self-hosted routing service with appropriate capacity and usage terms. Google Maps Directions URLs require `api=1` and do not require a Google Maps API key.

## Verification

- Frontend source smoke test: passed.
- Backend tests: 40 passed.
- Frontend JS/JSX syntax parse: 35 files parsed without syntax errors.
- Vite production build: not run because frontend dependencies are not installed in this workspace (`vite: not found`).


## Premium route carbon comparison update

- Replaced the compact horizontal route rows with responsive, premium comparison cards: three columns on desktop, two on medium screens, and one on mobile.
- Each route has its own route-colour marker, arrival time, distance, estimated tailpipe CO2 value, footprint bar, relative comparison against the lowest-emission alternative, and individual Google Maps action. The fastest and lowest-CO2 options receive distinct badges. Selecting a card updates the highlighted route on the map.
- Driving CO2 now uses the UrbanSaarthi passenger petrol-car proxy already documented in `backend/app/services/emissions.py`: 6.5 L/100 km multiplied by 2,296.35 g CO2/L, approximately 149.3 g/km. Route totals therefore vary with mapped route distance instead of using the former flat 120 g/km constant. Walking/cycling show zero direct tailpipe CO2; transit remains unavailable without a documented vehicle/occupancy mix.
- Cards disclose that values are estimates. This simple distance-based proxy does not model vehicle-specific fuel economy, speed, idling, load, driving style, or real-time traffic and must not be described as measured emissions or verified savings.

## Updated verification

- Backend suite: 41 passed, including distance-sensitive route CO2 calculation and zero-tailpipe walking/cycling checks.
- Frontend source smoke suite: passed, including assertions for premium route carbon cards and responsive styling.
- Full Vite production build remains unverified because dependencies are not installed in this workspace.
