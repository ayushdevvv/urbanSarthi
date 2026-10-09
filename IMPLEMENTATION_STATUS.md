# UrbanSaarthi — feature and deployment status

This status summary follows `UrbanSaarthi_Complete_Plan_and_ML_Roadmap.txt` and the current repository. “Implemented” means a code path/UI workflow exists; it does not mean an external provider is connected or the feature is production-validated.

## Application areas

| Capability | Current implementation | Boundary to keep clear |
|---|---|---|
| No-login citizen and authority portals | Shared React routes, responsive green UI, English/Hindi preference, logo and favicon | Shared workspace is public; it is not appropriate for private or sensitive data |
| AQI and pollutants | AQI observation API, station map/cards, seeded scenario stations, OpenAQ-related integration path | Seed data is illustrative. For official Indian AQI, connect and verify an authorized CPCB/data.gov.in feed and its actual schema. Never equate PM2.5 concentration with AQI |
| Road routes | OSRM-compatible backend with public prototype endpoint; local estimate fallback | Public OSRM is rate-limited/no-SLA. Standard road routing does not include live congestion; fallback route geometry is illustrative |
| Pollution-aware routes | Nearby, recent AQI observations are sampled along route points; provenance accompanies supported scores | This is a route-level proxy, not measured personal exposure. The score is omitted when observations are unavailable |
| Traffic data and command centre | Junction/cluster/observation APIs, map, alert cards, data-source health and seeded records | Live camera/controller data needs an authorized ingestion source; UI values from seed are scenario estimates |
| NOW / +15 / +30 / +45 / +60 forecasts | Prediction API and new frontend forecast page with fallback trends | Fallback trend is not a trained/validated ML prediction. Use `MODEL_PATH` only with a trusted compatible artifact and report measured chronological test metrics |
| Signal recommendations / what-if | Create/review/simulate workflows; browser-only previews when backend is unavailable | Analytical preview is not SUMO unless the SUMO engine really runs. No physical signal commands are issued |
| Public transport | GTFS static import/query, route/stop views, static timetable and frequency logic, scenario route list | Live arrivals and delays require an official real-time feed; seeded routes are not a live operator schedule |
| Trips and ticket requests | Trip lifecycle, history, analytics, request list/create/cancel | Ticket requests are not bookings; no ticket/QR code/payment is issued. Shared records are not user-private |
| Analytics and source registry | City summary, journey metrics, export and source configuration/health screen | Analytics reflect stored records or scenario fallback, not verified city-wide outcomes |
| Data ingestion | Endpoints for authorized events and provider/GTFS ingestion paths | CCTV, traffic controllers, and private data sources must be authorized; no unrestricted camera reader is included |

## Seed and startup behaviour

For PostgreSQL, `AUTO_MIGRATE_ON_STARTUP` and `AUTO_SEED_DEMO_DATA` default to enabled. The FastAPI lifespan applies `alembic upgrade head` before serving and seeds only when one of its core tables is empty. A new forward-only Alembic revision repairs a physically missing `transit_routes` table without rewriting existing revisions. Seed validation in an isolated SQLite database produced 24 clusters, 48 junctions, 192 AQI observations, 1,632 traffic observations, 12 transit routes, 28 stops, 10 signal plans, 240 forecast horizon records, 12 trips, 3 ticket requests, and 8 data sources. Re-running the seed preserved these counts.

## Before calling this production-ready

1. Deploy this source revision to Render and confirm startup logs show migrations and seed completion; keep a database backup before deployment.
2. Confirm the actual Render `DATABASE_URL` points to the intended PostgreSQL database and the frontend `VITE_API_URL` points to that service ending in `/api/v1`.
3. Confirm the live browser has no 500 responses and run browser end-to-end checks after deployment.
4. Configure provider keys on Render only, verify terms/quotas/coverage and source timestamps; credentials alone do not integrate an adapter automatically.
5. Import the correct city GTFS, validate the supplied large dataset, train and evaluate a model chronologically, and report MAE/RMSE before claiming ML accuracy.
6. Keep authentication/roles or network restrictions in place before connecting anything sensitive. No-login authority writes must stay in a synthetic sandbox.

## Validation in this packaging run

- Backend tests: 7 passed.
- Python compilation: passed.
- Alembic repair test: simulated deleted `transit_routes` table was recreated and both indexes were restored.
- Isolated migration + double seed: passed, stable row counts.
- Frontend JS/JSX syntax and relative-import scan: 27 files passed.
- CSS parser: all four frontend stylesheets passed.
- Full `vite build`: not verified because npm dependencies could not be downloaded in this environment (`vite: not found`). Run `npm install` and `npm run build` in the deploy environment.
