# UrbanSaarthi frontend

React 18 + Vite + React Router + Leaflet. See the repository root `README.md` for architecture, API configuration, local setup and Vercel deployment.

```bash
cp .env.example .env
npm install
npm run dev
npm run build
```

`VITE_API_URL` includes `/api/v1`, e.g. `http://127.0.0.1:8000/api/v1`. For the deployed site, open **Vercel → Project → Settings → Environment Variables** and set `VITE_API_URL` to the exact Render service URL ending in `/api/v1` (for example `https://<your-render-service>.onrender.com/api/v1`). Then redeploy Vercel, because Vite embeds this value at build time.

On Render, set `CORS_ORIGINS=https://urbansarthi.vercel.app` (plus any other exact frontend domains you use). The backend accepts Vercel preview URLs through `CORS_ORIGIN_REGEX`. Redeploy Render after changing its environment. No Vercel or Render environment can be changed from this source archive, and the real Render hostname must be copied from your Render dashboard.

The interface intentionally opens without login. If the API is empty or unreachable, AQI, transit, route planning, trip history, signal-plan previews, command centre and analytics show conspicuously labelled synthetic examples. This mode is for demos only and must not be exposed to real operational data. Do not place private backend secrets in Vite environment variables.
