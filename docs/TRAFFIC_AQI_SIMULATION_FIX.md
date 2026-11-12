# Traffic, AQI and SUMO fixes

This document records the performance and integration fixes included in the current hackathon release.

## Traffic and data latency

- Shared API requests use bounded retry windows and preserve caller-supplied timeouts for long-running video and simulation jobs.
- Nearby OpenStreetMap road geometry, TomTom flow/incident reads, and Tavily/RSS traffic news use short bounded requests and caches so one slow provider does not hold up the entire traffic page.
- AQI forecast provider requests use a short cache and parallel current/forecast calls where supported; usable provider results are not delayed by an unnecessary second lookup.
- Traffic Lab has its missing icon imports fixed and a route-level error boundary, so a rendering error produces a recoverable error view rather than a blank page.
- The frontend production API default matches the `urbansaarthi-api` Render service. Set `VITE_API_URL` in Vercel when your actual Render host differs.

## Traffic simulation behavior

- The root `render.yaml` now deploys the backend as a Docker web service using `backend/Dockerfile.sumo` and Docker context `backend`.
- That image installs native `sumo` and `sumo-tools`; the Render backend therefore runs SUMO in the cloud rather than depending on SUMO installed on a developer's laptop.
- Native SUMO is preferred. If the SUMO executable is unavailable or the native run cannot be completed, the API can return the explicitly labelled XGBoost network forecast fallback.
- Native SUMO output includes FCD vehicle positions for playback and five-minute road-edge telemetry. XGBoost is a forecast overlay and does not create individual microscopic vehicle trajectories.
- The bundled 80-edge network is synthetic. Import and calibrate a real network and traffic demand before describing it as a real-city digital twin.

## Provider configuration

Set provider credentials in Render only, never in Vercel `VITE_*` variables:

```env
TOMTOM_API_KEY=
TAVILY_API_KEY=
GROQ_API_KEY=
OPENAQ_API_KEY=
WEATHER_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
OSRM_BASE_URL=
```

TomTom enriches nearby road speeds/incidents; Tavily is an optional traffic/transit news search; OpenAQ returns pollutant observations (not official CPCB AQI); Open-Meteo/CAMS provides forecast data where available; Groq/Gemini/OpenAI enable their configured agent pathways. Empty optional keys mean the corresponding integration remains unconfigured.

## Current no-login Render setup

Human login has intentionally been removed for the public hackathon build. Do not configure `AUTH_ENABLED`, `JWT_SECRET`, bootstrap-admin variables or `VITE_REQUIRE_AUTH`. Camera/IoT ingestion remains protected by `INGESTION_API_KEY`.

For exact Render dashboard values, required environment variables, Vercel API URL, deployment steps and security limitations, follow **[Public hackathon mode and Render settings](./PUBLIC_HACKATHON_NO_AUTH_AND_RENDER.md)**. The authoritative Blueprint is the repository-root `render.yaml`; `render-sumo.yaml` is an optional separately named service definition and should not be deployed in addition to the root Blueprint unless a second API service is deliberately required.

## Verification boundaries

The automated backend and frontend smoke tests cover the application logic and routing. Actual native SUMO execution must be confirmed in the Render deploy logs and by a successful run from the deployed Traffic Simulation page. Actual live traffic, AQI, news, transit and camera observations still depend on configured providers, feed credentials, authorized cameras and real hardware.
