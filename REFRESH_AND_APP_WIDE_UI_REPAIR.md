# UrbanSaarthi — refresh and app-wide UI repair

## Refresh behaviour

- Safe, cache-eligible GET requests use a bounded 5-second live-first retry window before restoring a saved snapshot. Transient DNS/network failures and HTTP 5xx/408/429 responses no longer trigger only a few quick retries followed by a long idle wait.
- Each connection attempt has a bounded timeout, while the request is allowed to retry during the live-first window. A live response received during this period wins over any saved snapshot.
- Only cache-eligible reads (and explicitly cache-enabled read-only POST requests) can restore a prior successful response after an availability failure. Private routes, autocomplete/geocoding, agent actions and other non-cacheable operations do not show unrelated saved page data and fail fast.
- HTTP validation/authorization/not-found errors are not masked with cached responses.
- API snapshot storage has been versioned to `v3`; snapshots from older bundles are ignored. API snapshots expire after six hours. Saved user-generated records have a separate seven-day retention.
- Data-status notices are tracked per endpoint and route. A successful request clears that endpoint's warning; a pending request only clears its own old state; stale asynchronous failures cannot overwrite newer results.
- Traffic conditions no longer shows a hard-coded map pin before selected area data is available.

## Navigation and UI

- Shared green/light appearance is the default on fresh page loads; an old persisted dark preference no longer overrides the main theme.
- Authority sidebar has a bounded viewport height, independent scrollable navigation, fixed mobile drawer, scrim, accessible open/close controls and automatic close after navigation.
- Citizen navigation is responsive, scrollable on narrow screens and has clear active-page styling.
- Header and utility controls have accessible labels, consistent sizing, keyboard focus treatment and disabled states.
- Shared spacing, typography, cards, panels, form controls, tables and content grids were normalised across authority and citizen pages. Mobile and tablet layouts collapse gracefully.
- Route navigation resets the page/content scroll position.

## Validation

- Frontend workspace smoke tests: passed.
- Backend tests at the time of this historical repair: 44 passed; see `TRAFFIC_AQI_SIMULATION_FIX.md` for the current verification count.
- JS/JSX/TS syntax parsing at the time of this historical repair: 40 files, zero parse errors; see the current traffic/AQI fix guide for the latest count.
- CSS brace check: 15 stylesheets, zero unbalanced rules.
- Vite production build: not verified in this environment because the Vite executable/dependencies are not installed. After extracting, run `npm install` then `npm run build` from `frontend`.

## Notes

Saved snapshots are recovery data, not new live measurements. When one is restored, UrbanSaarthi displays a visible last-successful-update notice with its saved timestamp. Illustrative page previews remain separate from real API responses and user-generated reports.
