# UrbanSaarthi AQI Vision — implementation and verification

## Implemented

- Added the actual four AQI artifacts supplied in `UrbanSarthi-AQI-Model-main` under `backend/models/aqi/`.
- Rebuilt the `MultimodalAQIModel` structure from the uploaded `UKHack.ipynb`: two ResNet18 image encoders (`front`, `rear`), a tabular branch, and a six-class classifier. The checkpoint loads with `strict=True`.
- Reused the supplied `preprocessor.joblib` and `label_encoder.joblib`. The preprocessor is checked to take six named raw columns and generate the nine tabular values the network requires.
- Added lazy-load endpoints:
  - `GET /api/v1/aqi-vision/status`
  - `POST /api/v1/aqi-vision/analyze`
- The inference endpoint accepts two image uploads and validated PM2.5, PM10, temperature, humidity, season, and time-of-day form values. It returns the predicted category, confidence, full six-class softmax distribution, input summary, timestamp, and provenance caveat. It does not claim to return numeric/official AQI.
- Added a responsive AQI Vision page at `/citizen/aqi-vision`, including camera capture for separate front/rear views, paired image upload, input validation, loading/error states, probability bars, model limits, example sensor fields, and a model status indicator.
- Added a clearly labelled sample preview for service/infra failures only. User input errors stay actionable and do not silently produce a sample result.
- Added the AQI Vision navbar link while preserving the existing station-observation page. Added tests/docs, the OpenAPI contract, and CPU-only PyTorch dependency pins.

## Source-model notes

The notebook uses `Resize((128, 128))`, ImageNet mean/std normalization, and a six-column tabular dataframe. `model_config.json` says `num_tabular_features: 9`, which is the **post-preprocessing** width. The fitted preprocessor was checked to transform the six raw columns into a shape of `(1, 9)`. Its categories are Monsoon/Summer/Winter and Day/Night.

The supplied notebook reports 82.09% test accuracy and 0.7226 macro F1. The report also shows uneven class scores (for example, Good class F1 0.32 and Satisfactory F1 0.88). These are notebook-reported metrics, not independently reproduced or guaranteed for deployment. They should not be presented as the confidence score of a single prediction.

## Verification performed

- Backend test suite: **9 passed**.
- Python compilation for new/changed backend modules: passed.
- AQI model status route: passed; all four model files detected.
- Local checkpoint load and real forward inference using generated smoke-test images: passed; returned one of the six labels and six probabilities summing to 100%. The generated smoke-test images only validate the load/inference plumbing, not real-world accuracy.
- Full FastAPI multipart analysis request using generated smoke-test images: **HTTP 200**, valid category and probability list returned.
- TypeScript compiler transpile parser: **24 frontend JS/JSX files passed syntax checks**.
- Full Vite production build: **not run** because `npm install` timed out in this environment and frontend packages were unavailable. Camera permissions and responsive layout still need browser testing after install/deploy.
- Actual phone camera capture and live Render deployment were not testable from this environment.

## Deploy checklist

1. Deploy this complete repository's backend source, including `backend/models/aqi/` and `backend/models/best.pt`, to Render.
2. Let Render install the updated `backend/requirements.txt`. It uses CPU-only PyTorch/torchvision wheels and scikit-learn 1.7.2 to match the supplied preprocessor artifact.
3. Call `GET /api/v1/aqi-vision/status`; confirm all four artifacts and inference dependencies are present.
4. Submit two valid images and readings to `POST /api/v1/aqi-vision/analyze`. Check that `mode` is `model`; a frontend sample preview does not count as a successful inference.
5. Verify the existing `GET /api/v1/traffic-detection/status` and perform one actual traffic inference too. Loading both models can consume significant RAM; small Render instances may need more memory or separated inference workers.
6. Deploy the frontend to Vercel with `frontend` as root directory and `VITE_API_URL` pointing to the backend URL ending in `/api/v1`. Ensure the backend's CORS allow-list includes the exact Vercel origin.
7. Test the camera feature on HTTPS on both desktop and mobile. It captures the front and rear images separately; it does not record continuously.

## Final repair note

The AQI page previously referenced `useCallback` without importing it. That caused a render error and prevented AQI Vision from appearing correctly. The import is now fixed. See `FINAL_QA.md` for the checks performed and the remaining deployment verification items.
