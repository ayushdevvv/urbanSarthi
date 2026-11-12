# Live system setup

This is a short pointer for the current public hackathon release. Human login has been removed and native SUMO is packaged inside the Render backend Docker image.

Follow [`PUBLIC_HACKATHON_NO_AUTH_AND_RENDER.md`](PUBLIC_HACKATHON_NO_AUTH_AND_RENDER.md) for the authoritative no-login behavior, required environment variables, Render service settings, Vercel API URL and post-deploy checks.

The production backend still requires PostgreSQL, an exact frontend origin in `CORS_ORIGINS`, and a high-entropy server-side `INGESTION_API_KEY` for camera/IoT edge ingestion. Optional provider credentials belong on Render only.
