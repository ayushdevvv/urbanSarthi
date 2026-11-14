# UrbanSaarthi brand refresh

UrbanSaarthi is the primary product brand across the landing page, citizen portal, authority workspace, browser metadata, exported emissions reports and ESP32 serial output.

The descriptor is **Air Quality · Traffic Intelligence**. Navigation and page hierarchy continue to foreground the product domains: Air Quality, Carbon & Emissions, Traffic and IoT Sensor Network.

The shared brand component now uses the repository's existing `public/urbansaarthi-mark.svg` asset. Existing air-quality, traffic-video, emissions and sensor-ingestion workflows are unchanged.

## Verification

- Frontend workflow smoke test: passed (7 checks).
- Backend test suite: passed (38 tests).
- JavaScript / JSX syntax transpilation: passed (36 files).
- Full Vite production build: not re-run for this brand-only change. Run `npm ci && npm run build` from `frontend` before deployment.
- The old `hawaflow.latestVisionEvidence` browser-storage key remains intentionally as a migration compatibility key; it is not shown in the interface.
