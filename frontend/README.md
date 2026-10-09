# UrbanSaarthi frontend

React 18 + Vite + React Router + Leaflet. See the repository root `README.md` for architecture, API configuration, local setup and Vercel deployment.

```bash
cp .env.example .env
npm install
npm run dev
npm run build
```

`VITE_API_BASE_URL` includes `/api/v1`, e.g. `http://127.0.0.1:8000/api/v1`. Do not place private backend secrets in Vite environment variables.
