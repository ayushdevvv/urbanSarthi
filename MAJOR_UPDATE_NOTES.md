# UrbanSaarthi major update

## Citizen portal
- The home page now hosts the full trip planner. The separate Plan a trip navigation item is removed, and `/citizen/plan` redirects to Home.
- Place suggestions are requested as users type in the trip-planner origin and destination fields.
- Citizen traffic supports searching a single place or a start-to-destination route. It displays the selected point/route on the map, route details when the routing service returns geometry, and a congestion-ranked road activity table.
- The 60-minute what-if controls and playback are now in the authority workspace under **Traffic Simulation** rather than the citizen traffic page.
- Citizen road activity uses the scenario published by authority-side simulation or by applying a signal plan.
- Citizen-side desktop typography is larger at laptop widths.
- AQI remains populated when the live feed is empty or unavailable. The built-in city values are explicitly marked as illustrative reference estimates, not live or official observations. Live provider data replaces the reference view when available.

## Authority traffic scenario behavior
- Baseline, higher-demand, and signal-priority scenarios are stored in browser local storage and broadcast to any open citizen traffic view.
- Applying a signal plan publishes its related scenario: transit-priority/adaptive plans publish the signal-priority sensitivity scenario; off-peak plans publish the baseline scenario.
- The simulation remains analytical only and does not control physical traffic lights.

## Validation notes
- All 26 JavaScript/JSX source files passed TypeScript parser/transpile syntax checks, and all relative imports resolved.
- A full `npm run build` could not be completed in this environment because frontend dependencies were not installed; `npm install` timed out. Run `cd frontend && npm install && npm run build` in the deployment/build environment to perform the bundler build.
- The user traffic road-segment list is based on the configured network scenario. Route geometry is provided by the routing API where available; individual model road labels are not guaranteed to correspond one-to-one with streets on the searched route.


## Follow-up: OpenWeather + visible simulation scene

- Backend server setting `weather_api_key` is now supported. It is used server-side by the OpenWeather Air Pollution current and forecast endpoints; keyless Open-Meteo/CAMS remains the fallback.
- The AQI pages display OpenWeather's own 1–5 AQI index as a different scale from US AQI 0–500. Pollutants and provider attribution are shown alongside it.
- Authority Traffic Simulation includes a persistent animated road-network scene during playback: lane markings, zebra crossings, queued vehicles, pedestrian waiting zones, four large signal heads, scenario/status labels and live frame counts. The displayed signal phase is illustrative and does not control real traffic lights.
- Validation should include setting the backend host variable exactly to `weather_api_key`, then checking `/api/v1/aqi/location-forecast?latitude=28.6139&longitude=77.2090` and running `npm run build` in `frontend`.
