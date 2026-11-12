# Traffic, AQI and SUMO deployment

This historical note is superseded for hackathon deployment by [`docs/RENDER_SUMO_HACKATHON_DEPLOY.md`](docs/RENDER_SUMO_HACKATHON_DEPLOY.md). The current release removes human login and uses the public no-login demo mode. Configure Render with the root `render.yaml` and `backend/Dockerfile.sumo`; keep the server-side `INGESTION_API_KEY` for device ingestion.

The supplied model and 80-edge SUMO network are synthetic reference assets. Do not present the simulation as a calibrated city twin without a real city road network and measured demand.
