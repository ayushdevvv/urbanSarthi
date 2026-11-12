# Existing Render host fix

This source release keeps UrbanSaarthi on the existing Render API:

- Backend: `https://urbansarthi.onrender.com`
- API base: `https://urbansarthi.onrender.com/api/v1`
- Vercel frontend origin: `https://urbansarthi.vercel.app`

## What changed

- The frontend production API fallback and Vercel env example use the existing backend hostname.
- The root `render.yaml` declares one Docker web service named `urbansarthi`, with `backend/Dockerfile.sumo`, backend build context, and `/healthz` health check.
- The duplicate `render-sumo.yaml` Blueprint was removed to avoid proposing a second Render service.
- CORS wraps the complete ASGI application, permits the exact Vercel origin, and includes the `X-Visitor-ID` and `X-Ingestion-Key` headers used by the app.
- The browser's geocoding and road-routing requests now use the UrbanSaarthi API. The API performs provider requests server-side, avoiding browser CORS preflights against public geocoding and routing services.
- Nominatim geocoding has a Photon server-side fallback; map tiles use the canonical OSM hostname and fall back to CARTO on tile errors.
- Remote Google Fonts requests were removed in favour of a system font stack.
- Render Blueprint configuration no longer forces a compute plan or regenerates the existing ingestion secret. Existing database and key values should be preserved.

## Required deployment values

### Existing Render service

```env
APP_ENV=production
DATABASE_URL=<keep the existing Render PostgreSQL internal URL>
CORS_ORIGINS=https://urbansarthi.vercel.app
INGESTION_API_KEY=<keep the existing random secret, at least 32 characters>
SUMO_BINARY=/usr/bin/sumo
SUMO_HOME=/usr/share/sumo
```

Keep optional provider keys on Render only. Do not expose database credentials, ingestion secrets, or provider keys through Vercel.

### Existing Vercel project

```env
VITE_API_URL=https://urbansarthi.onrender.com/api/v1
```

Redeploy the existing Vercel project after updating the variable.

## Render deployment safety

1. Push this source to the Git branch already connected to the existing Render service.
2. Open the service whose URL is `https://urbansarthi.onrender.com` and confirm its Render resource name is `urbansarthi` before syncing the root Blueprint.
3. Sync the existing Blueprint only if the service is already Blueprint-managed. Do not create a New Blueprint or another Web Service. If it is dashboard-managed, update the existing service's Docker settings to match the root `render.yaml` instead.
4. Keep the existing PostgreSQL database and `INGESTION_API_KEY`. The Blueprint intentionally leaves those values unsynchronised and does not set a plan.
5. Redeploy that existing Render service, then redeploy the existing Vercel project.

If the Render resource name shown in the dashboard is not `urbansarthi`, do not sync the Blueprint until the resource identity is reconciled. Render matches Blueprint resources by their declared name; the service's public hostname alone is not a substitute for checking the dashboard resource.

## Verify after deployment

```bash
curl -i https://urbansarthi.onrender.com/healthz
curl -i https://urbansarthi.onrender.com/readyz
curl -i -X OPTIONS \
  'https://urbansarthi.onrender.com/api/v1/trips' \
  -H 'Origin: https://urbansarthi.vercel.app' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: x-visitor-id'
```

Expected: `/healthz` returns 200; `/readyz` reports a reachable database; preflight returns 200 and `Access-Control-Allow-Origin: https://urbansarthi.vercel.app`. In browser DevTools, API requests should use `https://urbansarthi.onrender.com/api/v1`. Geocoding and route-planning calls should not go directly from the browser to Nominatim, Photon, OSRM, or Valhalla.

## Verification performed on this source package

- Backend pytest: 62 passed.
- Frontend workspace smoke test: passed.
- Frontend public-routing regression test: passed.
- Python compileall and JavaScript syntax checks: passed.
- Render Blueprint parsed and contains one service named `urbansarthi`.
- Local ASGI CORS integration: health check 200, allowed Vercel preflight 200 with `X-Visitor-ID`, and unapproved origin denied.

A complete Vite production bundle was not verified in this environment because `npm ci` could not reach the npm registry (DNS `EAI_AGAIN`). Install dependencies and run `npm run build` in `frontend` in your normal network environment before final production sign-off.

## Public hackathon demo boundary

This package intentionally has no human login. Authority operations are public demo actions; `X-Visitor-ID` is not authentication. Do not connect this no-auth demo to physical signal controllers, private municipal systems, private CCTV networks, or production IoT fleets. Camera/IoT ingestion continues to require the server-side `X-Ingestion-Key`.
