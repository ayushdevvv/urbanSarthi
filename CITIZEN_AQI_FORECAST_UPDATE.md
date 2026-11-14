# Citizen AQI forecast update

## Citizen routes

- `/citizen/air-quality` keeps current conditions, pollutant readings and the 24-hour outlook together.
- `/citizen/aqi-forecast` opens the same AQI workspace with the forecast section placed first. Both destinations are available in the citizen navigation.

## Behaviour

- The default Lucknow city view loads on entry so the page does not open as an empty forecast screen.
- If public geocoding is temporarily unreachable, the initial city search can use the bundled city-centre coordinates for Lucknow, Kanpur, Delhi or Mumbai. Neighbourhood and address searches still use live geocoding.
- `Use my location` requests browser location permission; it is never requested automatically.
- Search and geolocation requests are sequenced so an older response cannot overwrite a newer location selection.
- The citizen page prefers a US AQI (0–500) forecast when the provider supplies one. OpenWeather index values (1–5) remain separately labelled, with their own categories and chart scale.
- Forecast timeline labels reflect the provider's actual sampling interval (hourly or 3-hourly). No synthetic AQI values are generated when the provider has no forecast.
- Current readings and forecasts are marked as provider/model data, not official ground-station measurements.

## Data path

The page requests `/api/v1/aqi/location-forecast` first. When the backend returns current conditions but no US AQI forecast timeline, the frontend makes a separate Open-Meteo Air Quality API request for the next 24 forecast hours. The existing OpenWeather forecast remains as a labelled backup if an hourly US AQI timeline cannot be retrieved.

The OpenWeather API key remains backend-only (`weather_api_key`). No secret is added to Vite environment variables.

## Validation

- `backend`: 45 pytest tests passed.
- `frontend`: `npm test` passed (workspace smoke checks and public routing checks).
- JS/JSX syntax: all 40 frontend source files parsed without syntax errors.
- Production Vite build was not run successfully in this workspace because npm dependency installation timed out and the local npm cache did not contain all packages. Run `npm ci && npm run build` from `frontend/` after download access is available.
