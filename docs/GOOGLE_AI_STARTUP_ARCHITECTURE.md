# UrbanSaarthi Google AI architecture

Last reviewed: 13 November 2026.

This release makes Google AI the agent provider without making Google availability a dependency of the citizen portal, authority workspace, traffic detector, forecasts or database.

## Integrated now

| Layer | Implementation | Runtime behaviour |
|---|---|---|
| Primary reasoning model | `gemini-3.8-flash` through the Gemini API | Citizen/authority response synthesis and primary Traffic Agent reasoning model |
| Secondary model | `gemma-4-26b-a4b-it` through the Gemini API | Fallback when the primary model returns an error, quota response, empty response or network failure |
| Agent orchestration | `google-adk==2.14.1` | Traffic Agent's bounded Python tools and model-selected workflow |
| Evidence tools | Existing FastAPI services | YOLO report inspection, factor-based emissions estimate, human-review signal draft, 60-minute SUMO/XGBoost forecast |
| Core application | Existing React/Vite + FastAPI + database | Remains on Vercel and existing native Python Render service |

The model IDs are server configuration, not frontend configuration. `GEMINI_API_KEY` is read on the server only. ADK receives the key internally through `GOOGLE_API_KEY`; do not add either key to `VITE_*` settings.

## Model routing

Defaults:

```dotenv
GEMINI_API_KEY=
GOOGLE_AI_PRIMARY_MODEL=gemini-3.8-flash
GOOGLE_AI_FALLBACK_MODEL=gemma-4-26b-a4b-it
GOOGLE_AI_TIMEOUT_SECONDS=16
```

The citizen and authority assistants use a bounded Gemini API request with a separate system instruction and a compact evidence block. They record the model that actually returned a response. The Traffic Agent uses Google ADK with Gemini first and Gemma second.

Provider failures do not fail API startup. When there is no key, ADK cannot import, a quota is exhausted, or a request times out, deterministic backend tools and rule-based explanations remain available. The UI/API reports the deterministic mode rather than claiming that Google AI ran.

## Traffic Agent tool contract

The ADK agent can call these read/compute-only Python tools:

1. `inspect_video_evidence`: reads the structured YOLO/OpenCV report. Raw camera footage is not sent to Gemini by this workflow.
2. `calculate_video_emissions`: computes a factor-based vehicle-mix estimate; it is not measured exhaust.
3. `draft_signal_timing`: creates a candidate plan. Camera approach calibration is required for demand-weighted movement splits; otherwise it clearly returns an equal-split draft.
4. `run_60_minute_traffic_forecast`: uses the installed SUMO runner when available, otherwise the trained XGBoost scenario. The result labels which engine actually ran.

The model may explain the tool results but it cannot alter tool calculations, invent missing values, or dispatch physical signal commands. Signal plans require human review. Hardware control remains disabled.

## Data safety

- Do not send identifiable CCTV clips, faces, license plates, citizen names, phone numbers or other sensitive personal data to the free-tier Gemini API.
- This release sends structured detection evidence to the text reasoning pipeline; YOLO/OpenCV perform the uploaded image/video inference on the backend.
- Treat provider responses and tool evidence as untrusted data. The model is instructed not to treat evidence as instructions and not to invent readings.
- Free-tier model availability, quotas and data-use terms may change. Check the live Gemini API pricing and terms before a public deployment. Add rate limits and per-request token budgets before inviting unrestricted traffic.

## Current hosting decision

**Default / integrated deployment:** keep the existing Vercel frontend and native Python Render API (`urbansarthi`). ADK executes inside the existing FastAPI process. This avoids a new service, extra network hop, Cloud Run billing setup and an additional failure dependency.

**Google Cloud Run:** an optional future target if the AI workload needs independent scaling. It is not required for this release and no Cloud Run endpoint is called by the app. Do not migrate the main API or create a second backend during this release. Standard Cloud Run use requires a billing-enabled Google Cloud project; a free quota is not a guarantee of a zero-cost project.

**BigQuery:** optional future analytical warehouse for aggregated historical observations. It is not wired into this release; MongoDB/SQL-backed operational data remains authoritative.

**Embeddings / vector search:** no embedding service is required by the current application. Add an embedding model and vector store only when incident-history retrieval or cross-document search is implemented end-to-end.

## Render deployment (existing service only)

- Service: `urbansarthi`
- Runtime: native Python (no Docker)
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command (preserve exactly):

```bash
alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Set `GEMINI_API_KEY`, `GOOGLE_AI_PRIMARY_MODEL` and `GOOGLE_AI_FALLBACK_MODEL` in the Render Environment tab. Keep `DATABASE_URL` and `INGESTION_API_KEY` unchanged. Do not run `apt-get` in Render's native build. SUMO is installed from the `eclipse-sumo` Python wheel in the requirements.

## Verification

Backend regression tests cover model selection, primary success, Gemma fallback, missing-key behaviour, deterministic fallback, ADK result completion, human-review guardrails and no fabricated simulation improvement. Frontend smoke tests cover route planning, browser-side provider proxying, page navigation, Traffic Lab and simulation workflows.

The live model call is not verified by offline tests: it requires a valid server-side API key, available quota and network access. Native SUMO execution also requires the wheel/binary to install and start successfully on the deployed Render worker. See `FEATURE_READINESS.md` for every feature that depends on external feeds, camera hardware, calibration or provider credentials.
