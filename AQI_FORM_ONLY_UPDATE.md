# AQI form only update

- Removed camera capture and image upload controls from the citizen AQI prediction page.
- Added browser location permission flow with reverse geocoding to show the city when available; users can enter the city manually.
- Added `POST /api/v1/aqi-vision/predict-form`, which accepts the existing pollutant and weather fields plus city and optional coordinates.
- The supplied AQI checkpoint was trained as a multimodal model requiring two road images and tabular inputs. To support the requested form-only workflow without changing the checkpoint, the new endpoint supplies neutral image placeholders. The UI discloses this limitation; results should be treated as an approximation and not as official measured AQI.
- If model service is unavailable, the UI displays a clearly labelled preview derived from the entered PM2.5 value rather than a connection error banner.

Verification: `python -m compileall -q backend/app` passed; backend tests: 10 passed.
