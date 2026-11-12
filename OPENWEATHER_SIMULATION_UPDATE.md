# UrbanSaarthi: OpenWeather + Traffic Simulation Visual Update

## Included

- Backend settings now recognize the environment variable `weather_api_key` (case-insensitive, and compatible with the exact lowercase name used in the hosting settings).
- `/api/v1/aqi/location-forecast` prefers the OpenWeather Air Pollution API for current conditions and forecast when a key is configured. Open-Meteo/CAMS remains the fallback if the key is absent or OpenWeather cannot be reached.
- The AQI UI distinguishes OpenWeather's 1–5 air-quality index from US AQI 0–500. It also shows pollutant concentrations, provider/source attribution, and city reference values when no live location forecast can be retrieved.
- The authority Traffic Simulation page now has a persistent animated intersection scene during playback, with roads, lane markings, zebra crossings, queue vehicles, pedestrian waiting areas, four signal heads, direction status, scenario label and frame counts.
- The signal colours in the scene are illustrative simulation state only; they do not issue commands to real traffic controllers. Pedestrian values are illustrative visual counters derived from the current scenario frame, not pedestrian sensor readings.

## Environment variable

On the **backend service** (for example, the UrbanSaarthi Render web service), set the environment variable exactly as:

```env
weather_api_key=YOUR_OPENWEATHER_API_KEY
```

The application reads this value server-side. Do not expose the secret in a `VITE_*` variable or hardcode it into React. Restart/redeploy the backend after changing host environment variables.

## Verify

```bash
# from backend/
pytest -q

# from frontend/
npm install
npm run build
```

The location forecast endpoint can be checked with a coordinate pair, for example:

`/api/v1/aqi/location-forecast?latitude=28.6139&longitude=77.2090`

## Validation in this environment

- Backend Python sources compile.
- Backend tests: 15 passed.
- Frontend syntax: 27 JS/JSX files parsed with zero parse errors; relative imports checked.
- Full Vite production build was not completed because `npm install` timed out in the environment. Re-run the commands above after dependencies install successfully.
