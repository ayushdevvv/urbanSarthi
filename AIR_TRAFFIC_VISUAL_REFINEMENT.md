# UrbanSaarthi visual refinement

## Product presentation

- Restored **UrbanSaarthi** as the primary product brand, with **Air Quality** and **Traffic** used as the prominent product sections.
- Updated the browser title and description to lead with UrbanSaarthi and describe its air-quality, traffic and emissions focus.
- Simplified the authority navigation into Air Quality, Traffic, Field Monitoring and Insights.
- Removed the Data Sources item from the primary navigation to keep the workspace focused; its route remains available for administration.

## Design system

- Preserved the existing forest-green, lime and warm-neutral palette.
- Increased the global type scale and improved page-title, section-title and body-copy hierarchy.
- Increased sidebar width, header height, content padding and control sizes.
- Standardized card radii, borders, shadows, hover states and spacing across AQI, carbon, traffic, IoT and citizen surfaces.
- Kept responsive layouts and reduced-motion support.

## Data workflow compatibility

- Added `src/services/visionEvidence.js` as the shared handoff between road traffic video analysis and emissions estimation.
- New evidence uses `airtraffic.latestVisionEvidence`.
- Previously saved evidence under the legacy browser-storage key is read and migrated automatically on the next read.
- No backend API contract was changed by this visual refinement.

## Verification

- Frontend source-level workflow smoke tests: passed.
- JavaScript / JSX syntax transpilation: 36 files passed.
- Backend tests: 38 passed.
- Backend Python compilation: passed.
- A complete Vite production build was not verified because `npm ci` timed out in this environment. Run `npm ci` and `npm run build` in `frontend` before deployment.

## Run locally

```bash
cd frontend
npm ci
npm run dev
```

Configure `VITE_API_URL` in `frontend/.env` with the backend API base URL ending in `/api/v1`.
