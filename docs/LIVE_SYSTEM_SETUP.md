# UrbanSaarthi live-system setup

This is the deployment checklist for connecting the application to real city infrastructure. Do not put provider secrets in frontend variables, source code, `safe_config`, screenshots, or Git. Use your hosting provider's secret/environment-variable store.

## 1. Production backend and database

Provision a managed PostgreSQL database and a backend host that can reach it. The included Render blueprint now defaults to production mode, requires the database URL/CORS/admin bootstrap values, and generates independent JWT and ingestion secrets. For other hosts, configure these backend environment variables:

```dotenv
APP_ENV=production
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME
CORS_ORIGINS=https://YOUR-FRONTEND-DOMAIN
AUTH_ENABLED=true
JWT_SECRET=<random-secret-at-least-32-characters>
JWT_TTL_MINUTES=720
INGESTION_API_KEY=<different-random-secret-at-least-32-characters>
TIMEZONE=Asia/Kolkata
```

Generate independent high-entropy secrets, e.g. with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Do not reuse the JWT key as the ingestion key. Restrict CORS to the exact deployed frontend origins; do not use `*`.

The deployment start script applies migrations and runs the idempotent source-registry seed automatically. For manual/local setup, from `backend/` run:

```bash
alembic upgrade heads
python scripts/seed_demo.py
```

Default seed mode registers provider-source records only. Do not pass `--demo-network` or `--demo-telemetry` in a real deployment. The admin bootstrap can be supplied to the seeding process with `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`; keep these as one-time secrets, then rotate/remove them after confirming access. Create operator accounts through a controlled admin workflow; never promote a public self-registered account by trusting client input.

Frontend build-time environment:

```dotenv
VITE_API_URL=https://YOUR-BACKEND-DOMAIN/api/v1
VITE_REQUIRE_AUTH=true
```

Rebuild/redeploy the frontend after changing Vite variables. The browser only receives the API base URL and auth-required toggle, never database/provider/ingestion/JWT secrets. Use HTTPS for both surfaces.

## 2. Provider credentials and live data

### TomTom road flow (optional, recommended for current road snapshots)

Set backend `TOMTOM_API_KEY`. The API queries a road flow segment at the selected latitude/longitude. Provider coverage varies by city and coordinate. This is a current segment snapshot, not a complete traffic-aware navigation or routing service.

### OpenAQ station observations (optional)

Set backend `OPENAQ_API_KEY`. The Data Sources page can run a location-radius sync through `POST /api/v1/integrations/openaq/sync?latitude=...&longitude=...&radius_km=...`. Browser location permission is required when the operator uses current location. OpenAQ data are pollutant concentrations and station metadata; this integration deliberately does not convert them into an official CPCB AQI number.

### OpenWeather air pollution (optional)

Set backend `WEATHER_API_KEY` and restart the API. Location AQI forecast prefers OpenWeather when configured and falls back to Open-Meteo/CAMS if that request fails. OpenWeather's index is 1–5 and is displayed separately; it is not the same scale as US AQI 0–500 or CPCB AQI.

### Open-Meteo / CAMS forecast (no API key in current integration)

The current location forecast path uses atmospheric model data from Open-Meteo/CAMS. It is a modeled forecast, not a local sensor or official CPCB station reading. Internet egress from the backend is required.

### CPCB / CAAQMS official measurements

There is no generic public CPCB credential that can be assumed. Obtain authorized access to the relevant station/API/partner feed and build or configure an adapter for its published format. Normalize timestamp, station ID, coordinates, AQI, pollutant values, and source attribution; then send authenticated records to `POST /api/v1/aqi/observations` using `X-Ingestion-Key`. Register a source of type `cpcb` first. Preserve the source's AQI method and averaging period. Never relabel OpenAQ concentration or atmospheric model forecast as official CPCB AQI.

### Road routing

Set `OSRM_BASE_URL` to a trusted maintained OSRM-compatible endpoint. Without a working road router, route alternatives can fall back to transparent distance/time estimates; those are not live navigation instructions. OSRM road geometry by itself is not live congestion. To offer live-traffic-aware route optimization, integrate a routing provider that returns travel-time-with-traffic and document its coverage/licensing.

## 3. Live CCTV and edge-camera worker

Camera inference should run on a machine that can reach the authorized camera VLAN/RTSP endpoint and the public backend API. Do not run a large YOLO/OpenCV loop inside the ordinary web request process.

1. Register the real junction in the Authority workspace with its external ID and accurate coordinates.
2. Register a `camera` data source with an external ID, linked junction, and freshness target. Record non-secret camera metadata only.
3. On the edge host, install Python 3.11+ and the worker dependencies:

```bash
cd backend
python -m venv .venv-edge
# activate the environment, then:
pip install -r scripts/requirements-edge.txt
```

4. Supply secrets through that host's environment/secret manager:

```dotenv
CAMERA_RTSP_URL=rtsp://USER:PASSWORD@CAMERA-HOST:554/STREAM
CAMERA_ID=intersection-01-north
URBANSAARTHI_API_URL=https://YOUR-BACKEND-DOMAIN/api/v1
INGESTION_API_KEY=<same-secret-as-backend-INGESTION_API_KEY>
TRAFFIC_MODEL_PATH=/absolute/path/to/best.pt
YOLO_DEVICE=cpu
```

5. Run the worker from the backend directory (adjust the registered external IDs):

```bash
python scripts/edge_camera_worker.py \
  --junction-id JUNCTION_EXTERNAL_ID \
  --source-id CAMERA_SOURCE_EXTERNAL_ID \
  --camera-id intersection-01-north
```

The worker reconnects on stream failures, samples frames, posts vehicle-count detections, and sends a source heartbeat. Raw video is not uploaded or stored by this API. Current worker evidence is a sampled-frame vehicle count. Accurate queue length, speed, wait time and lane demand require camera calibration, ROI/movement mapping and validated tracking/measurement logic; the worker explicitly sends those fields as unknown rather than inventing them. Use only cameras and footage for which the operator has authorization.

## 4. Uploaded traffic image/video analysis

The authority upload workflow requires the backend's YOLO/Ultralytics, PyTorch and OpenCV packages plus `backend/models/best.pt` (or `TRAFFIC_MODEL_PATH`). Check `/api/v1/traffic-detection/status` and `/api/v1/traffic-detection/video-status` after deployment. Upload endpoints are protected by operator/admin roles. Heavy inference may need a dedicated CPU/GPU service and request limits at the reverse proxy.

## 5. Traffic Agent / LangGraph / Groq

The deterministic operations tools can run without an LLM API key. For LLM-native tool calling, install the optional dependencies from `backend/requirements-agent.txt` and set:

```dotenv
GROQ_API_KEY=<server-side-groq-key>
GROQ_MODEL=openai/gpt-oss-120b
```

Restart the API and verify the integration status / Traffic Lab response identifies the actual workflow path. If unavailable, the UI should show an error/unavailable state, not a fabricated successful agent run. The agent drafts and analyzes; it does not operate physical lights.

## 6. SUMO digital twin and city calibration

Install Eclipse SUMO on the backend/worker machine and set `SUMO_BINARY` to the actual executable path if it is not on `PATH`. Verify the integration status reports native SUMO available.

The included road network is a synthetic reference grid. A native run on it is a software execution test, not a calibrated simulation of Lucknow or another real city. For a city-calibrated model you must provide:

- licensed/authorized road network converted to SUMO `.net.xml`;
- stable UrbanSaarthi junction IDs mapped to SUMO edge/lane IDs;
- time-stamped turning counts/flows, lane counts, signal phases and cycle plans;
- detector/camera observations mapped to those same edges and approaches;
- realistic vehicle mix, demand profiles and local validation periods;
- baseline comparison against observed travel times/queues and calibration reports.

Until those inputs are mapped and validated, display the engine and synthetic/calibration caveat with each run. A live camera sample does not automatically become a SUMO edge flow.

## 7. Transit

Obtain the transit agency's GTFS Static ZIP and import it using an authenticated operator request to `POST /api/v1/transit/gtfs/import` (multipart field `file`). Static GTFS supplies routes, stops and scheduled service; it does not provide live vehicle location.

For live arrivals, create an authorized GTFS-Realtime or partner adapter that reads the provider feed and pushes normalized arrivals to `POST /api/v1/transit/realtime-arrivals` using `X-Ingestion-Key`. Stops/routes must already have been imported. Verify source timestamps and stale behavior. Do not label static timetable estimates as live arrivals.

## 8. IoT air-quality devices

The repository includes an ESP32/PMS5003 HTTP starter sketch. For real deployment provide the actual sensor board, correct UART wiring/power, Wi-Fi credentials, device identity, calibrated sensor and environmental metadata. Configure the API endpoint and the same ingestion key securely in device firmware or a provisioning mechanism. Test with a co-located reference monitor before publishing readings.

Current ingestion uses authenticated HTTP; an MQTT broker/consumer is not included. If the city requires MQTT, deploy a broker and implement a bridge that validates device identity and timestamps before forwarding normalized readings. Do not expose a shared ingestion key in an untrusted firmware image without a per-device credential strategy.

## 9. Signals / ATCS boundary

Signal-plan recommendation, what-if simulation, review, approval and dispatch preview are implemented. The project intentionally does not write to live traffic controllers. To connect ATCS you need the controller vendor protocol/API, authorized credentials, a lab/sandbox controller, certified integration, safety interlocks, fail-safe timing, audit, operator confirmation, emergency override and field validation. Do not bypass the dispatch guard or treat an approved plan as a physical signal command.

## 10. Public account readiness

Citizen self-registration and password login are implemented when auth is enabled. Email verification, password-reset delivery, signup throttling, MFA and recovery are not implemented. Before opening public registration, add a mail/SMS identity provider and abuse controls, or keep account creation limited to provisioned users. Admin/operator access should be provisioned through a secure administrative process.

## 11. Final live acceptance checklist

- [ ] Production configuration starts with PostgreSQL, explicit CORS, auth, JWT secret and ingestion key.
- [ ] Admin/operator login works; citizen registration cannot self-assign a privileged role.
- [ ] No demo junctions or synthetic observations are seeded in production.
- [ ] Each real junction has a stable external ID, coordinates, lanes and ownership metadata.
- [ ] Each source has a source owner, timestamps, freshness target and a heartbeat test.
- [ ] AQI tiles show provider + measured/forecast status + timestamp; CPCB data is source-authorized.
- [ ] TomTom current flow responds for the actual target junction coordinates.
- [ ] At least one authorized camera produces recent worker observations and heartbeat.
- [ ] Model output is checked for local vehicle classes and lighting/weather conditions.
- [ ] SUMO network and camera/sensor edge mapping are calibrated against observed periods.
- [ ] GTFS Static and real-time arrivals are distinguished correctly.
- [ ] Signal actions stop at human-reviewed preview until ATCS is safety-certified.
- [ ] Logs, retention, backups, key rotation, monitoring and incident response are configured.
- [ ] Frontend `npm ci` and `npm run build` succeed in the deployment CI environment.
