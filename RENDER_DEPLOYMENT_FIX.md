# Existing Render host fix

The API host is `https://urbansarthi.onrender.com`. Keep the existing Render Web Service and PostgreSQL database; do not create another backend.

- Render service: `urbansarthi`
- Runtime: Docker
- Root directory: blank
- Dockerfile: `backend/Dockerfile.sumo`
- Docker context: `backend`
- Health check: `/healthz`
- Render `CORS_ORIGINS`: `https://urbansarthi.vercel.app`
- Vercel `VITE_API_URL`: `https://urbansarthi.onrender.com/api/v1`

See [`docs/RENDER_SUMO_HACKATHON_DEPLOY.md`](docs/RENDER_SUMO_HACKATHON_DEPLOY.md) for the full safe-sync and verification steps.
