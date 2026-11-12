# UrbanSaarthi — Route, UI and Outage Recovery Update

## Product and navigation

- Kept UrbanSaarthi's forest-green / sage / lime palette across the Traffic Lab and traffic simulation experience.
- Increased typography and refined shared page, card, navigation, spacing, focus and responsive treatments.
- Authority navigation order is AQI overview, AQI forecast, Traffic Video Lab, Traffic Simulation, then IoT Sensor Network (with carbon, traffic conditions, signal plans and insights retained in their sections).
- AQI forecasting is available in both authority and citizen portals through the shared AQI Forecast page.
- Confirmed there are no drone references in the frontend routes, navigation or page source.
- Browser favicon, Apple touch icon and shared BrandMark all use `/favicon.png`. Inline SVG charts and map graphics remain inline visualizations; they are not branding assets.

## Route alternatives and carbon impact

- Driving route discovery combines two independent OSRM/OpenStreetMap router endpoints and Valhalla/OpenStreetMap.
- When primary results contain fewer than three distinct paths, a bounded second search wave varies route cost profiles and asks Valhalla to pass through alternate coordinates snapped to its road graph.
- The route comparison rejects near-duplicate road corridors, draws each returned GeoJSON LineString in a separate colour, and highlights the selected path when a route card is selected.
- Each option has its own distance, duration, estimated tailpipe CO₂ card, footprint bar, and CO₂ downside against the lowest-emission option. Fastest and Lowest CO₂ distinctions are shown where applicable.
- Every mapped route can be opened in Google Maps with intermediate coordinates sampled from that route. Google Maps recalculates directions on its own network, so its final line can differ from the in-app geometry.
- Driving CO₂ is a comparison estimate using the project's petrol-car proxy: 6.5 L/100 km multiplied by 2,296.35 g CO₂/L (about 149.3 g/km). It is not measured vehicle telemetry. Actual emissions vary by vehicle, fuel, speed, load and congestion. Walking/cycling are zero direct tailpipe emissions; transit emissions remain unavailable without a known occupancy/fuel mix.
- Three distinct routes are actively sought, but no public routing engine guarantees three alternatives for every origin/destination. If a road network or provider cannot return a genuinely different mapped path, the app shows fewer mapped paths and an explanatory warning. It never fabricates a straight-line route as a road.

## Outage behaviour and data provenance

- Successful JSON GET responses are cached in the browser for up to 7 days (maximum 45 entries, 420 KB per entry). The same-origin view can restore a last-successful response if the API later times out or returns an error.
- Sensitive endpoints such as authentication, personal trips, profile, private mobility, agent records and geocoding are excluded from automatic GET caching.
- The read-only route-plan POST and emissions-estimate POST can restore results for the exact same request body. Mutating operations are not replayed or faked while offline.
- AQI forecasting first uses the UrbanSaarthi API, then queries Open-Meteo directly. Open-Meteo values are identified as forecast-grid estimates, not ground-station measurements. If both providers fail, the last saved location forecast can be restored with its original timestamp.
- Traffic simulation restores only the last successful result for the same selected scenario. It does not replace a failed call with synthetic reference roads.
- Traffic Lab keeps compact evidence from the last successful YOLO analysis. Annotated base64 frames are not stored in localStorage. A restored report is visibly labelled as a historical result; a failed new analysis does not erase it.
- Connection notices are session-scoped and are not restored from the previous browser session. A notice appears only after a request in the current session fails or a direct provider fallback is used. Saved data records expire after 7 days.
- A first-time offline visit with no saved data cannot display genuine fallback readings. In that case the app shows an unavailable/retry state instead of inventing values. Service-dependent write actions remain unavailable while the backend is down.

## Verification performed

- `node frontend/test-agent-frontend.js` — passed.
- `python -m compileall -q backend/app backend/tests` — passed.
- `pytest -q backend/tests` — 42 passed.
- TypeScript parser check — 39 frontend `.js` / `.jsx` files parsed without syntax errors.
- Checked all frontend brand references: no `favicon.svg` or SVG logo reference remains; `frontend/public/favicon.png` exists.
- Checked frontend source and navigation: no drone reference remains.

## Verification not performed

- A full Vite production build/browser end-to-end run was not possible because `frontend/node_modules/.bin/vite` is not installed in this workspace. Run `npm install` in `frontend`, then `npm run build` before deployment.
- Public OSRM/Valhalla availability and live alternative-route counts were not verified from this offline build environment. Route-provider calls use bounded timeouts, and real availability still depends on those public services.
