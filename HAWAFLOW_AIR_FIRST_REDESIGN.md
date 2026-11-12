# UrbanSaarthi Air-First Workspace

The authority workspace is organised around urban air quality, traffic operations and field sensor data. The product navigation contains AQI overview, carbon and emissions analysis, traffic conditions, road-video analysis, signal plans, IoT sensor observations and analytics.

## Current user-facing modules

- **AQI overview** (`/authority/air-intelligence`): location-based air-quality context, nearby observations, trends and priority locations.
- **Carbon & emissions** (`/authority/carbon`): indicative pollutant estimates from observed road traffic counts and explicit distance assumptions.
- **Traffic operations** (`/authority/traffic`, `/authority/signals`): traffic conditions, scenario planning and reviewable signal-plan drafts.
- **Road video analysis** (`/authority/traffic-lab`): uploaded road-camera footage can be analysed for visible vehicle counts and operational evidence. It is not a continuous CCTV ingest service.
- **IoT sensor network** (`/authority/iot`): stored field observations and HTTP ingestion details. Provider status is not proof that a physical device is connected.

## Data and capability boundaries

AQI forecasts, stored station observations, traffic observations, uploaded road-video detections and modelled emissions are different data types. The interface should retain their source, timestamp and quality labels. A road-video model detects visible vehicles; it does not infer PM2.5 or AQI from pixels. Emissions and signal outcomes are estimates unless validated against field measurements.

## Routing

The citizen route planner combines OSRM and Valhalla road-network geometry, uses route-segment avoidance to seek distinct alternatives, displays up to three mapped paths and provides a Google Maps handoff for each path. Routing engines may return fewer than three genuinely distinct alternatives for some origin/destination pairs; the UI reports this rather than drawing fabricated straight lines.
