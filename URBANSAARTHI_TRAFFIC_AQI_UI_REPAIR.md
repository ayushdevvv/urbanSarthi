# UrbanSaarthi traffic and AQI workspace repair

## Primary authority navigation

1. **Traffic Lab** — `/authority/traffic-lab`; OpenCV/YOLO image and video inference remains the real detector workflow.
2. **Traffic Simulation** — `/authority/traffic-simulation`; the existing 60-minute model-driven scenario, location search, timeline playback and map remain intact.
3. **Digital Twin** — `/authority/digital-twin`; signal-plan selection and analytical scenario application. Applying a plan changes the local what-if scenario only; it does not control physical signals.
4. **AQI Forecast** — `/authority/aqi-forecast`; current/provider outlook, 24-hour forecast, pollutants, stations and priority locations.
5. **CO₂ Emissions** — `/authority/carbon`; factor-based tailpipe estimate and vehicle-class breakdown.

## Route compatibility

- `/authority/traffic-model`, `/authority/traffic`, and `/authority/traffic-analysis` now resolve to Traffic Lab.
- `/authority/signal-plans` and `/authority/signals` resolve to Digital Twin.
- `/authority/aqi-prediction` resolves to AQI Forecast.

## Failure behaviour and data boundaries

- Traffic Lab shows an explicitly illustrative scene when there is no prior real YOLO report. The sample is not persisted as inference evidence and is not passed to Traffic Agent.
- Traffic Simulation starts with the bundled SUMO reference dataset, keeps the last usable scenario visible while refreshing, restores a valid saved scenario on service failure, and falls back to the bundled reference if needed. Its seed provides a 30-minute horizon; the 60-minute fallback holds the reference level after minute 30 and says so in the UI. Missing road-level vehicle counts remain blank.
- Digital Twin always has three labelled reference plans available if registered plans cannot be loaded. Selecting a plan does not apply it; the operator must press **Apply selected plan**. Reference plans change only the local what-if scenario.
- AQI Forecast has bundled illustrative values for the selected city when the provider, station, or hotspot service is unavailable. Any sample section is labelled as illustrative and is never called a measured sensor reading. Live provider responses remain preferred. A missing AQI-index forecast is filled by a separately labelled sample trend without replacing a usable current provider reading.
- CO₂ Emissions opens with an indicative sample mix and local estimate (or a local preview from saved video evidence). A successful platform estimate replaces the preview; if the platform fails, the local factor calculation remains available and is identified as an offline fallback.

## Validation performed

- `cd frontend && npm test` — passed, including source-level workspace checks, API fallback behaviour, and public route geometry checks.
- `pytest -q backend/tests --disable-warnings --maxfail=1` — 45 backend tests passed.
- TypeScript JSX parser/transpiler pass across all frontend JavaScript/JSX source files — no syntax diagnostics; all checked relative imports resolve.
- A production Vite build could not be run in this workspace because frontend dependencies were not installed; `npm ci --prefer-offline` did not complete in the available environment.
