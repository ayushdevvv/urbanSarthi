# UrbanSaarthi

UrbanSaarthi is an urban mobility and air-quality operations platform for citizens and city teams. It brings together traffic evidence, corridor forecasts, signal-plan studies, camera analysis, air-quality context, transit information and an evidence-led operations agent.

## Application areas

- Citizen portal: route planning, AQI forecast, nearby traffic, transit and trip history.
- Authority overview: city conditions, mapped infrastructure, alerts and source health.
- Traffic Lab: image/video vehicle analysis, saved reports and camera-source setup.
- Traffic Agent: evidence review, emissions estimates, candidate signal phases and 60-minute corridor analysis. A junction is only required to attach and approve a field-specific plan.
- Traffic Simulation: separate 60-minute network forecast with road geometry and playback.
- Signal Plan Studio: separate timing sensitivity studies with saved history.
- Traffic Digital Twin: vehicle-level simulation when the native simulation engine is available.
- Air quality, carbon impact, transit, IoT, analytics and source management.

## Google AI

The application uses Google AI only for generative-model and agent orchestration:

- Gemini API, primary model `gemini-3.8-flash`.
- Gemma API fallback, `gemma-4-26b-a4b-it`.
- Google Agent Development Kit (ADK) for the Traffic Agent tool workflow.
- Google News RSS for source-linked news discovery.

The core API and deterministic analytics continue working when the AI key is absent, rate-limited or unreachable. AI output is advisory: it does not dispatch physical traffic signals. Vehicle counts, forecasts, queue calculations and emissions estimates remain in their dedicated processing services. The UI does not expose internal model names.

## Deploy the complete application to Google Cloud Run

This repository deploys the React/Vite frontend and FastAPI backend together as one Cloud Run service. The root `Dockerfile` is built by Google Cloud Build. **You do not need Docker installed on your computer.** A Google Cloud project with billing enabled is required for Cloud Run and source builds. Usage can incur charges; set a Cloud Billing budget alert before deploying.

### Prerequisites

1. Install Google Cloud CLI (`gcloud`) and sign in with an account that can enable APIs, create secrets, create service accounts and deploy Cloud Run services.
2. Create or choose a Google Cloud project and attach billing.
3. Obtain a Gemini API key from [Google AI Studio](https://aistudio.google.com/api-keys).
4. Obtain the existing production PostgreSQL URL and `INGESTION_API_KEY` from your current deployment. Do not paste secrets into source files or commit them.

### Database migration note

Cloud Run must be able to connect to the database. If the current provider's `DATABASE_URL` contains an internal-only hostname (for example a Render private/internal host), it cannot be reached from Google Cloud. Use the provider's external TLS PostgreSQL URL or migrate/replicate the database to Google Cloud SQL. Back up the database before any migration. Do not point the new service at an empty database unless you intend to start fresh.

### One-command Windows deployment

Open PowerShell in the repository root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\deploy-cloud-run.ps1
```

The script enables required Google Cloud APIs, asks for the existing database URL, Gemini key and ingestion key without echoing them, stores them in Secret Manager, creates a runtime service account, builds the web app and deploys `urbansaarthi` to `asia-south1` by default.

You can change the region when prompted. The first deployment may take several minutes because Cloud Build installs the Python vision and simulation dependencies and builds the frontend.

### Manual deployment settings

- Build context: repository root.
- Runtime: Cloud Run, built from the root Dockerfile by Cloud Build.
- Container port: `8080` (Cloud Run injects `PORT`).
- Region: `asia-south1` (Mumbai default).
- Health check: `/healthz`; database readiness: `/readyz`.
- Runtime memory/CPU: 4 GiB / 2 vCPU; concurrency 1; max instances 2; request timeout 900 seconds.
- Secrets: `DATABASE_URL`, `GEMINI_API_KEY`, `INGESTION_API_KEY` from Secret Manager.
- Environment: `APP_ENV=production`, `API_V1_PREFIX=/api/v1`, exact `CORS_ORIGINS`, Google model IDs and 12-second model timeout.

The frontend is served from the same Cloud Run origin as `/api/v1`, avoiding browser-side CORS for the main app. The existing Vercel deployment configuration is retained as an optional previous hosting path; it is not used by the Cloud Run service.

### After deployment

1. Open the Cloud Run service URL and `/healthz`.
2. Check `/readyz` to verify PostgreSQL connectivity.
3. Check `/api/v1/traffic-detection/video-status` for vision readiness.
4. Run a small image analysis, reopen its saved report, and run the Traffic Agent without selecting a junction.
5. Run the 60-minute forecast and a separate signal-plan study.
6. Check `/api/v1/traffic/simulation/capabilities` before attempting the vehicle-level digital twin.
7. Check Cloud Run logs and billing before switching public DNS or retiring the existing Render deployment.

### Important deployment limits

- Cloud Run HTTP request body limit is 32 MiB. Traffic Lab therefore caps uploaded video at 25 MB in the Cloud Run release. Use short, compressed clips. Larger footage should be integrated through direct Cloud Storage uploads in a later release.
- Camera RTSP streams normally live on private camera networks. Run the edge worker on a machine with authorized network access and send authenticated observations to the API; do not expose camera credentials in the browser.
- Native SUMO is optional. If it cannot start, the 60-minute network forecast remains available. The forecast and the vehicle-level digital twin are intentionally separate.
- External traffic, AQI, weather and transit feeds require provider credentials or published feeds. Unavailable data remains unavailable rather than being displayed as fake live measurements.
- Free-tier model access is quota-limited and can change. Cloud Run, Cloud Build, Artifact Registry, Secret Manager and outbound network usage may incur costs. Configure a billing alert and check quotas.

## Local development

Backend:

```bash
cd backend
python -m venv .venv
# Activate the environment, then:
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend in a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Copy `backend/.env.example` to `backend/.env` for local use. Never commit `.env` files or credentials.

## Safety and data integrity

- `LIVE`, cached, modelled and simulated information are separate states. A forecast is never relabelled as a live reading.
- Signal plans are recommendations requiring human review. No physical traffic-light controller is operated by this application.
- Camera sources must be owned or explicitly authorised. Do not upload identifiable footage to third-party AI services without appropriate consent and legal basis.
- Back up the database before schema upgrades. Deployments apply Alembic heads before starting Uvicorn.
