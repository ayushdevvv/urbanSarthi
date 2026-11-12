# UrbanSaarthi: deploy native SUMO on Render

This deployment runs SUMO inside the existing Render API service's Docker container. Installing SUMO on a developer laptop is not required, and judges can trigger the simulation from the deployed site.

## What changes

- `render.yaml` changes the existing `urbansaarthi-api` service from the Python runtime to Docker.
- `backend/Dockerfile.sumo` installs `sumo` and `sumo-tools` into the Render image.
- `SUMO_BINARY=/usr/bin/sumo` and `SUMO_HOME=/usr/share/sumo` are set in the service environment.
- The API service name and URL remain `urbansaarthi-api`, so the Vercel `VITE_API_URL` should not need changing.
- The Blueprint uses the `1c-2g` plan (1 CPU, 2 GB RAM) as a minimum starting point. For YOLO camera inference and simulation at the same time, use `2c-4g` if available and within budget.

## Deploy

1. Start from the full UrbanSaarthi source ZIP. Copy the supplied `render.yaml` to the repository root, replacing the existing root `render.yaml`.
2. Copy `backend/Dockerfile.sumo` into the repository's `backend/` folder, replacing the existing file.
3. Commit and push both files to the branch connected to Render. Also confirm `backend/requirements.txt`, `backend/scripts/start.sh`, the SUMO grid network and model files are committed.
4. In Render, open the existing `urbansaarthi-api` service. If it is managed by the root Blueprint, sync/apply the updated Blueprint. If it is not Blueprint-managed, configure the service to build with Docker using `backend/Dockerfile.sumo` and Docker build context `backend`, or create a new Docker Web Service from the same repo with those paths.
5. Select at least `1c-2g`. Avoid the Free plan for the live demo; it has 512 MB RAM, spins down after 15 minutes idle, and may take about a minute to wake.
6. Preserve the existing production values for `DATABASE_URL`, `CORS_ORIGINS`, `JWT_SECRET`, `INGESTION_API_KEY`, `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD`. Do not rotate JWT or ingestion secrets during the migration. Set `CORS_ORIGINS` to include the exact production Vercel origin, e.g. `https://urbansaarthi.vercel.app`.
7. Keep any already-configured provider credentials on the service: `TOMTOM_API_KEY`, `TAVILY_API_KEY`, `GROQ_API_KEY`, `OPENAQ_API_KEY`, and `WEATHER_API_KEY` as applicable.
8. Deploy and wait for the Docker build to finish. Check logs for the startup migration/seed messages and successful Uvicorn startup.
9. Open `https://<your-api-host>/healthz`. It must return a healthy response.
10. Open the deployed Vercel app, go to Admin > Traffic Simulation, change signal timings, and click Run simulation.
11. Confirm the result badge says **Native SUMO result** / **EXECUTED IN SUMO**. If it says **XGBoost forecast**, native SUMO was not detected; inspect the Render logs and confirm `/usr/bin/sumo` exists and the `SUMO_BINARY` environment variable is correct.

## Frontend API URL

The current frontend API client already defaults to:

`https://urbansaarthi-api.onrender.com/api/v1`

Because this deployment keeps the service name `urbansaarthi-api`, no Vercel variable change is needed if the Render URL remains the same. If you deploy under a different service name, set the Vercel environment variable `VITE_API_URL` to:

`https://<new-api-host>/api/v1`

Then redeploy the Vercel frontend.

## Simulation behavior

The page submits its native SUMO request with a 10-minute browser timeout. The backend runs a 3,600-second (60 simulated minute) baseline and intervention experiment, with up to 240 seconds allowed for each SUMO subprocess. SUMO FCD snapshots are sampled every 30 simulated seconds; edge metrics are sampled every 5 minutes. Render currently documents HTTP responses up to 100 minutes, so the platform request limit is not the expected bottleneck for this job.

The 60 minutes are simulated time, not one hour of wall-clock time. Runtime depends on CPU, demand and network size.

## Important limits for the hackathon demo

- This runs on the bundled synthetic 80-edge reference network. It is a valid SUMO execution demo, but not a geographically calibrated model of a real city.
- Native SUMO produces individual simulated vehicle trajectories and edge telemetry. It does not connect to physical traffic lights.
- The XGBoost fallback remains available if SUMO cannot start. It produces model forecasts, not microscopic vehicle trajectories.
- Render's Free web service has only 512 MB RAM, sleeps after 15 minutes without inbound traffic and can take about one minute to wake. Do not rely on Free for a judge-facing live simulation.
- The `1c-2g` plan is the minimum suggested starting point. Upgrade to `2c-4g` if the service runs out of memory or if camera YOLO inference and SUMO simulation need to run concurrently.
