# UrbanSaarthi traffic separation and AQI preservation QA

## Changes in this package

- The YOLO traffic image analysis page is routed under the authority workspace at `/authority/traffic-model` and appears as `Traffic model lab` in authority navigation.
- The citizen navigation no longer exposes the YOLO camera analysis tool. Citizen traffic navigation now opens `/citizen/traffic`, which uses a backend provider adapter for current road flow data.
- Added `TOMTOM_API_KEY` backend configuration and a `/api/v1/traffic/current` endpoint. Provider credentials remain on the backend. Without a configured key the endpoint returns a not configured response instead of fabricated live traffic.
- Authority users can send a successful YOLO image detection to a registered junction to store a single frame observation and create a draft signal recommendation. The UI explains that one frame does not measure speed, queue length, or lane demand.
- Existing signal simulation still uses the project's analytical what if engine. No SUMO binary, calibrated network file, or route demand files are included, so it must not be described as a real SUMO simulation. The current response explicitly reports `sumo_run: false`.
- Preserved the original AQI model weights, preprocessor, label encoder, and model configuration unchanged.

## Verification

- `python -m compileall -q backend/app`: passed.
- `python -m pytest -q backend/tests`: 10 passed.
- Model artifact SHA256 values match the previous Premium Repair package:
  - AQI `urban_sarthi_best_model.pth`: `159569115c276a3b460524350dc87f03c18630b7ce45658caaa47fb4a2e31d78`
  - Traffic `best.pt`: `6b41bbbc5622b1a78fcdc87724c5bb1b35945988336484abbd29d3a1d97bea36`
- Frontend production build not run because `node_modules` are not installed in this environment. Run `npm ci && npm run build` in `frontend` before deployment.
- TomTom provider response has not been tested with a real API key in this environment.

## Deployment

Set `TOMTOM_API_KEY` in Render backend environment, redeploy, and visit `/api/v1/traffic/current?latitude=28.6139&longitude=77.2090`. If the response is not configured, verify the environment variable and service restart. The key must never be placed in a `VITE_` frontend variable.

For a genuine SUMO integration, install SUMO and supply a matching `.net.xml` network plus route or demand files for the chosen junction. Until then the analytical scenario engine remains clearly distinguished from SUMO.
