# UrbanSaarthi traffic, AQI and simulation fixes

This update addresses slow first loads, unavailable traffic-road data, a blank Traffic Lab route, and missing native SUMO on a standard Python deployment.

## What changed

- The production frontend API fallback now matches the Render service slug declared in `render.yaml`: `urbansaarthi-api`. The resulting default URL is `https://urbansaarthi-api.onrender.com/api/v1`. Confirm the actual URL in the Render dashboard and set `VITE_API_URL` in Vercel if your service has a different URL or a custom domain.
- Shared cached-read retry window and page fallback delay are now 5 seconds rather than 7.5 seconds; AQI and nearby traffic have slightly longer explicit per-page windows to let their bounded provider calls finish. Caller-supplied long-running POST timeouts (YOLO video and SUMO) remain respected.
- Nearby OSM road discovery has shorter provider timeouts. TomTom flow and incident reads run concurrently, with a short bounded timeout. Road geometry is cached for five minutes.
- Traffic news uses Tavily basic search when configured, a short-timeout Google News RSS fallback otherwise, and a five-minute successful-result cache. News is labelled as reporting, not live vehicle telemetry.
- AQI forecast calls use a five-minute backend cache. OpenWeather current and forecast requests run in parallel; a usable OpenWeather forecast is not delayed by a second sequential Open-Meteo request. Open-Meteo/CAMS remains the US-AQI forecast path.
- Traffic Lab has the missing `Activity` and `Bot` icon imports fixed and is wrapped in a route error boundary, so a rendering exception shows a recovery card rather than a completely blank workspace.
- Traffic Simulation tries native SUMO first. If the API says SUMO is missing (424/503), it automatically calls the trained XGBoost network forecast. That alternative returns 13 five-minute frames across the 80-edge reference network.

## Configure the live traffic API

### 1. Frontend deployment (Vercel)

In the Vercel project, open **Settings → Environment Variables** and set:

```env
VITE_API_URL=https://YOUR-ACTUAL-RENDER-SERVICE.onrender.com/api/v1
```

Use the exact service URL from Render. The code's default is based on the name in `render.yaml`, but a Vercel environment variable takes precedence. Redeploy the frontend after changing this value because Vite injects it at build time.

For local frontend development, use:

```env
VITE_API_URL=http://127.0.0.1:8000/api/v1
```

### 2. Real traffic speeds and incidents

Set this server-side in the Render API service (never in `VITE_*` frontend variables):

```env
TOMTOM_API_KEY=your_tomtom_key
```

OpenStreetMap/Overpass supplies road geometry without a key. TomTom supplies speed/flow and incident observations. Without a valid TomTom key, the map can still draw nearby mapped roads, but it will deliberately not colour them as moving/slow/heavy or invent vehicle speeds.

The first cold map lookup still depends on public Overpass availability. Once fetched, road geometry is cached for five minutes in each API process. Provider traffic readings are refreshed on each request.

### 3. Nearby traffic news

Optional:

```env
TAVILY_API_KEY=your_tavily_key
```

Without Tavily, the API uses Google News RSS. A news article is not a live traffic measurement; inspect the publication timestamp and publisher link.

## AQI provider setup

The app can request Open-Meteo/CAMS forecast data without an API key where the service is available. Optional provider keys belong on the backend:

```env
WEATHER_API_KEY=your_openweather_key
OPENAQ_API_KEY=your_openaq_key
```

OpenWeather's pollution index uses its own 1–5 scale; Open-Meteo's US AQI uses a 0–500 scale. The UI keeps these scales labelled separately. OpenAQ observations are pollutant measurements and should not be represented as official CPCB AQI. For official CPCB readings, connect an authorized CPCB/CAAQMS data feed and station mapping; no key can be fabricated for this.

## Traffic Lab setup

For image/video inference, install the backend dependencies from `backend/requirements.txt`, ensure the configured YOLO checkpoint exists (default expected model is `backend/models/best.pt` where applicable), and restart the API. Verify the endpoint:

```bash
curl https://YOUR-ACTUAL-RENDER-SERVICE.onrender.com/api/v1/traffic-detection/video-status
```

The page should report model and OpenCV readiness. If `ready` or `video_analysis_ready` is false, follow the `readiness_note` in the JSON before testing uploads. For continuous CCTV, register an authorized RTSP camera and run `backend/scripts/edge_camera_worker.py` on a machine/network that can reach that stream. Do not expose RTSP credentials in the browser or a public frontend environment variable.

## SUMO: native microscopic simulation

The normal `render.yaml` service uses Render's Python runtime and does not install the SUMO CLI. It will therefore use the XGBoost forecast fallback. To run real SUMO experiments, install SUMO on the API worker and set `SUMO_BINARY` and `SUMO_HOME`.

### Windows local development

1. Install the 64-bit SUMO MSI using the official [SUMO installation guide](https://sumo.dlr.de/docs/Installing/). The installer may configure PATH automatically.
2. Find the SUMO installation directory (the one containing `bin` and `tools`). Add its `bin` folder to PATH.
3. Set Windows user environment variables to the actual install path, for example:

```powershell
[Environment]::SetEnvironmentVariable('SUMO_HOME', 'C:\Program Files\sumo-1.28.0', 'User')
[Environment]::SetEnvironmentVariable('SUMO_BINARY', 'C:\Program Files\sumo-1.28.0\bin\sumo.exe', 'User')
```

Change the path to match the installed directory. Open a new terminal, then verify:

```powershell
sumo --version
$env:SUMO_HOME
$env:SUMO_BINARY
```

Put the same values in `backend/.env` if you run FastAPI locally. Restart the backend process after setting them.

### Ubuntu / WSL

```bash
sudo apt-get update
sudo apt-get install -y sumo sumo-tools sumo-doc
export SUMO_HOME=/usr/share/sumo
export SUMO_BINARY=/usr/bin/sumo
sumo --version
```

Add the two `export` lines to `~/.bashrc` for future terminals. On Ubuntu packages, `/usr/share/sumo` is the standard tools directory documented by SUMO.

### Render native-SUMO service (Docker)

An optional `render-sumo.yaml` and `backend/Dockerfile.sumo` are included. This deployment variant installs `sumo`, `sumo-tools` and `sumo-doc` in the API container, and configures `/usr/bin/sumo` plus `/usr/share/sumo`.

1. Push this repository to GitHub.
2. In Render, create a new Blueprint and select `render-sumo.yaml` as its Blueprint file. Render supports custom Blueprint file paths.
3. Use the same production `DATABASE_URL`, `CORS_ORIGINS`, `JWT_SECRET` and `INGESTION_API_KEY` as the current API service. Keeping the same database and JWT secret preserves the existing users and token signing. Do not generate a new JWT secret for the replacement service unless you intend to invalidate existing sessions.
4. After the Docker service is healthy, set the Vercel `VITE_API_URL` to the new service's exact Render URL plus `/api/v1`, then redeploy Vercel.
5. Check the SUMO status in Traffic Lab and run a short experiment before using the full 60-minute scenario.

Render's current Blueprint reference documents `runtime: docker`, `dockerfilePath` and `dockerContext`; the optional blueprint uses those fields and the backend folder as its build context.

## How the XGBoost fallback differs from SUMO

- **Native SUMO:** microscopic simulation with individual vehicle trajectories (FCD), actual network edge telemetry and signal phases executed in SUMO.
- **XGBoost fallback:** 30/60-minute queue forecasts for the 80-edge bundled reference network. It does not create individual moving vehicles. The signal timing overlay is an explicit sensitivity assumption applied to model queue output; it is not a causal, learned signal-control policy.
- **City calibration:** the bundled `grid.net.xml` is a synthetic reference grid. For a faithful Lucknow/city twin, import a real road network (for example, with `netconvert` from an authorized OSM extract), then calibrate edge capacities, turning movements, traffic demand and observed counts. The simulation's map must not be called a measured city twin until those inputs are calibrated.

Useful official references:

- [SUMO installation](https://sumo.dlr.de/docs/Installing/)
- [SUMO command-line and SUMO_HOME setup](https://eclipse.dev/sumo/docs/Basics/Basic_Computer_Skills.html)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)

## Verification performed for this release

- Backend: 57 tests passed.
- Frontend: both source smoke suites passed.
- Python application and tests: bytecode compilation passed.
- The XGBoost fallback was exercised against the bundled model and returned 13 time frames and 80 road edges; different signal settings changed the candidate queue overlay.
- Native SUMO was not installed in this workspace, so native SUMO execution is not marked as tested.
- A Vite production bundle was not generated because frontend dependencies were not installed in this runtime. Run `npm ci && npm run build` from `frontend/` in a network-enabled environment before deployment.
