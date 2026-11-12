# UrbanSaarthi — Admin AQI Forecast & Signal Files Update

## Authority AQI forecasting

- The authority workspace now exposes a dedicated `/authority/aqi-forecast` view while keeping the sidebar compact under the existing AQI section.
- The admin AQI page includes a 24-hour **AQI index** outlook, not only a PM2.5 trend.
- Forecast cards show expected peak, 24-hour average, and whether the outlook is rising, easing, or steady when the current and forecast AQI scales match.
- US AQI (0–500) and OpenWeather index (1–5) are plotted and labelled separately. They are never compared as though they were the same scale.
- If an upstream current reading exists but its hourly AQI forecast is empty, the client requests a separate Open-Meteo forecast and records the forecast provider separately.
- Forecast model values are explicitly distinguished from ground-station observations.
- Area changes invalidate older in-flight requests so a slower previous city response cannot overwrite the selected city.

## Service-state presentation

- AQI page status is handled within the AQI experience; unrelated station and hotspot retries no longer place a page-wide outage banner over a successful provider-backed forecast.
- Generic connection copy uses neutral wording such as “Live data is temporarily delayed”. It does not claim that the backend is broken.
- Authority empty and error states provide a retry action without exposing raw transport exceptions.
- Previously loaded values are retained where available; illustrative previews remain explicitly labelled and are not presented as live records.

## Signal files retained in the project archive

- `frontend/src/pages/authority/SignalPlansPage.jsx`
- `frontend/src/pages/authority/monitoring-pages.css` (signal/monitoring visual styles)
- `backend/app/api/signals.py`
- `backend/app/services/signal_planning.py`
- `backend/app/models.py` (`SignalPlan` and `SimulationRun` models)
- `backend/app/schemas.py` (signal plan and simulation schemas)
- `backend/tests/` signal and traffic coverage

The existing compact authority navigation remains unchanged; the Signal Plans source and API/service implementation are preserved in the ZIP.

## Validation notes

- OpenWeather forecast output is now filtered to the next 24 hours. Its endpoint emits three-hour samples, so the API no longer mistakenly returns 24 samples and labels that 72-hour range as a 24-hour outlook.
- Frontend production build and live external provider calls should be run in the deployment environment with dependencies/network available.
