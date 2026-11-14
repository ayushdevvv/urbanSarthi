# UrbanSaarthi OpenWeather Portal Refresh

This refresh is based on the project bundle `UrbanSaarthi-OpenWeather-Traffic-Scene-Update.zip`. The existing backend-first OpenWeather AQI integration and its Open-Meteo fallback are preserved; the OpenWeather secret remains a backend environment variable (`weather_api_key`).

## Citizen portal

- **Route planner:** selecting an alternative updates the highlighted road geometry and the Google Maps directions handoff. Selected route waypoints are passed to Google Maps when the routing provider returns geometry.
- **Air quality:** location search and browser geolocation load the location-forecast endpoint into premium AQI, pollutant, map and hourly cards. The OpenWeather 1–5 index and US AQI are displayed separately rather than being treated as interchangeable scales.
- **Predict AQI:** supports location search/current location and shows the available index alongside US AQI, pollutants and hourly outlook.
- **Traffic conditions:** supports place and origin/destination searches, route selection, route alternatives, Google Maps handoff and a toggleable traffic-crowd layer. Map crowd markers are shown only when the configured traffic-flow endpoint returns current/free-flow speed observations.

## Authority portal

- **Traffic Simulation:** title and location-first controls, geocoded place search/current location, 60-minute playback controls and a continuously animated intersection scene. Latitude/longitude fields are not shown. The chosen area is shown in the scene heading and is used for a location-specific speed probe where the configured provider supports one.
- **Signal plans:** selecting and applying a plan changes the road-network preview and publishes the corresponding sensitivity scenario to the traffic playback view. It does not command a physical controller.
- **Air quality:** a separate authority navigation destination reuses the same location-aware OpenWeather/fallback forecast flow.
- **Traffic Lab:** device-camera/upload workflow, vehicle analysis summary and downloadable JSON report. It explicitly notes that a municipal live-CCTV network is not connected; an authorised CCTV snapshot can be uploaded for analysis.

## Data integrity and limits

- A missing traffic-flow feed is not replaced with fabricated live crowding. The UI explains when provider readings are unavailable.
- The 60-minute playback is a trained SUMO-data model scenario with visible scenario modifiers; the location selection provides context and a live-speed probe where available, but it is not a city-specific live SUMO reconstruction.
- OpenWeather's 1–5 index is not the US AQI. The UI shows the available scales independently.
- Traffic Lab output depends on the deployed image-inference service. Reference/fallback content is labelled separately from detections.

## Validation

- Backend tests: 15 passed.
- Backend Python sources compile.
- Frontend JSX/TSX syntax and relative imports checked without errors.
- Full Vite production build was not run because frontend dependencies (`node_modules`) are not installed in this working environment. Run `npm install` and `npm run build` from `frontend/` before deployment.
