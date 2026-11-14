# UrbanSaarthi — error-only recovery and loading refinement

## Data and recovery behaviour

- Removed timer-driven seeded data. A request that is merely slow stays in its loading state; elapsed time alone never switches the page to generated values.
- AQI Forecast and Traffic Simulation continue to use their existing live API flows. Their bundled/reference view is used only after the relevant API request fails or returns an incomplete response.
- Digital Twin only displays its built-in timing references after the plans endpoint fails. A successful empty plans response remains an empty state so operators can create or register real plans.
- Traffic Lab creates a local recovery report only after an analysis request has actually been sent and the API fails, returns an error, or does not return a completed report. It is not shown on page load, is not persisted, and is not passed to Traffic Agent.
- Traffic Agent creates a local recovery analysis only after its workflow request fails or returns an incomplete/error response. The recovery view is not saved as a server workflow and cannot be approved or dispatched.
- CO₂ Emissions opens with real saved YOLO evidence or empty operator inputs. Its local calculation is used only after a calculation API error from a run based on saved evidence or operator-entered vehicle counts.
- A late successful API response remains authoritative; no mock data is substituted just because the request takes longer than a fixed delay.

## Loading and appearance

- Replaced section-level loading indicators in the affected workspaces with a branded full-viewport spinner/loading screen.
- The loading screen supports the existing light and dark themes through the app's `theme-root` classes.
- Updated fallback/status language to product-facing terms such as “Reference view”, “Recovery result”, and “Continuity view”. The operator-facing screens do not label values as “sample” or “illustrative”, and do not use “live data delayed”.
- Kept the established UrbanSaarthi visual theme and existing page workflows.

## Traffic Agent reliability

- Removed a duplicate automatic `runWorkflow()` invocation so one saved evidence/junction combination submits one request.
- Recovery output remains local-only, is excluded from saved evidence, and does not unlock human approval or physical dispatch.

## Navigation retained

- Overview remains first in the authority sidebar.
- Traffic remains ahead of AQI: Traffic Lab, Traffic Simulation, Digital Twin, and Traffic Agent remain separate workspaces.
- Digital Twin remains the operator-facing label for Signal Plans.

## Validation

- Frontend smoke tests: passed (`npm test`).
- JS/JSX/TS syntax parse: passed for all frontend source files.
- Relative imports: checked separately before packaging.
- A production Vite build is not claimed; the environment previously lacked an installed Vite binary and dependency installation timed out.
