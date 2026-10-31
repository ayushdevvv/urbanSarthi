from datetime import datetime, timedelta, timezone
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db import get_db
from app.dependencies import require_ingestion_access
from app.models import AqiObservation
from app.schemas import AqiObservationIn, AqiObservationOut
from app.services.common import audit, haversine_m, utc_now

router = APIRouter(prefix="/aqi", tags=["Air quality"])


@router.get("/observations", response_model=list[AqiObservationOut])
def list_aqi(db: Session = Depends(get_db), latitude: float | None = Query(default=None, ge=-90, le=90), longitude: float | None = Query(default=None, ge=-180, le=180), radius_km: float = Query(default=20, ge=0.1, le=500), max_age_hours: float = Query(default=24, ge=0.1, le=720), limit: int = 100):
    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=422, detail="latitude and longitude must be supplied together")
    cutoff = utc_now() - timedelta(hours=max_age_hours)
    rows = list(db.scalars(select(AqiObservation).where(AqiObservation.observed_at >= cutoff).order_by(AqiObservation.observed_at.desc()).limit(2000)))
    if latitude is not None and longitude is not None:
        max_m = radius_km * 1000
        rows = [r for r in rows if haversine_m(latitude, longitude, r.latitude, r.longitude) <= max_m]
        rows.sort(key=lambda r: haversine_m(latitude, longitude, r.latitude, r.longitude))
    return rows[:max(1, min(limit, 500))]


@router.get("/nearby")
def nearby_aqi(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180), radius_km: float = Query(default=20, ge=0.1, le=500), db: Session = Depends(get_db)):
    now = utc_now()
    cutoff = now - timedelta(hours=24)
    rows = list(db.scalars(select(AqiObservation).where(AqiObservation.observed_at >= cutoff).order_by(AqiObservation.observed_at.desc()).limit(1000)))
    nearby = []
    for row in rows:
        distance = haversine_m(latitude, longitude, row.latitude, row.longitude)
        if distance <= radius_km * 1000:
            nearby.append({"station": AqiObservationOut.model_validate(row).model_dump(mode="json"), "distance_meters": round(distance, 1), "age_seconds": max(0, int((now - row.observed_at.replace(tzinfo=row.observed_at.tzinfo or now.tzinfo)).total_seconds()))})
    nearby.sort(key=lambda x: x["distance_meters"])
    return {"generated_at": now.isoformat(), "radius_km": radius_km, "stations": nearby, "status": "available" if nearby else "no_recent_station_data"}


@router.get("/location-forecast")
def location_aqi_forecast(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180)):
    """Location-based air-quality outlook. Prefer OpenWeather when weather_api_key is configured, then fall back to Open-Meteo/CAMS."""
    def us_category(aqi):
        if aqi is None: return "Unavailable"
        value = float(aqi)
        if value <= 50: return "Good"
        if value <= 100: return "Moderate"
        if value <= 150: return "Unhealthy for sensitive groups"
        if value <= 200: return "Unhealthy"
        if value <= 300: return "Very unhealthy"
        return "Hazardous"

    def openweather_category(index):
        return {1: "Good", 2: "Fair", 3: "Moderate", 4: "Poor", 5: "Very Poor"}.get(index, "Unavailable")

    def iso_timestamp(epoch):
        try:
            return datetime.fromtimestamp(float(epoch), tz=timezone.utc).isoformat().replace("+00:00", "Z")
        except (TypeError, ValueError, OSError, OverflowError):
            return None

    # OpenWeather reports its own 1-5 index. Keep this separate from the US AQI 0-500 scale.
    if settings.weather_api_key.strip():
        try:
            current_response = httpx.get(
                "https://api.openweathermap.org/data/2.5/air_pollution",
                params={"lat": latitude, "lon": longitude, "appid": settings.weather_api_key.strip()},
                headers={"User-Agent": "UrbanSaarthi/1.0 (location air quality)"}, timeout=8.0,
            )
            current_response.raise_for_status()
            current_payload = current_response.json()
            current_item = (current_payload.get("list") or [])[0]
            current_main = current_item.get("main") or {}
            current_components = current_item.get("components") or {}
            openweather_index = current_main.get("aqi")
            forecast = []
            try:
                forecast_response = httpx.get(
                    "https://api.openweathermap.org/data/2.5/air_pollution/forecast",
                    params={"lat": latitude, "lon": longitude, "appid": settings.weather_api_key.strip()},
                    headers={"User-Agent": "UrbanSaarthi/1.0 (location air quality)"}, timeout=8.0,
                )
                forecast_response.raise_for_status()
                current_epoch = float(current_item.get("dt") or 0)
                # OpenWeather returns samples at three-hour intervals. Keep only
                # the next 24 hours instead of treating 24 records as 24 hours.
                next_day_items = [
                    item for item in (forecast_response.json().get("list") or [])
                    if item.get("dt") is not None and current_epoch <= float(item["dt"]) <= current_epoch + 24 * 60 * 60
                ]
                for item in next_day_items:
                    main = item.get("main") or {}
                    components = item.get("components") or {}
                    index = main.get("aqi")
                    forecast.append({
                        "time": iso_timestamp(item.get("dt")), "us_aqi": None,
                        "openweather_index": index, "category": openweather_category(index),
                        "pm25": components.get("pm2_5"), "pm10": components.get("pm10"),
                        "nitrogen_dioxide": components.get("no2"), "ozone": components.get("o3"),
                        "carbon_monoxide": components.get("co"), "sulphur_dioxide": components.get("so2"),
                    })
            except (httpx.HTTPError, ValueError, TypeError, IndexError):
                # Current conditions remain useful even if the optional forecast request fails.
                forecast = []
            return {
                "status": "available" if openweather_index is not None else "partial",
                "provider": "OpenWeather Air Pollution API", "aqi_scale": "OpenWeather 1–5",
                "latitude": latitude, "longitude": longitude, "timezone": "UTC",
                "updated_at": iso_timestamp(current_item.get("dt")),
                "current": {
                    "us_aqi": None, "european_aqi": None, "openweather_index": openweather_index,
                    "category": openweather_category(openweather_index), "pm25": current_components.get("pm2_5"),
                    "pm10": current_components.get("pm10"), "nitrogen_dioxide": current_components.get("no2"),
                    "ozone": current_components.get("o3"), "carbon_monoxide": current_components.get("co"),
                    "sulphur_dioxide": current_components.get("so2"),
                },
                "forecast": forecast, "model": "OpenWeather Air Pollution API",
                "note": "OpenWeather Air Quality Index is on a 1–5 scale and is not the US AQI 0–500 scale. Pollutants and index describe provider model data, not an official ground-station measurement.",
            }
        except (httpx.HTTPError, ValueError, TypeError, IndexError, KeyError):
            # Fall through to the public, keyless provider without exposing API error details or credentials.
            pass

    params = {"latitude": latitude, "longitude": longitude, "timezone": "auto", "forecast_hours": 24,
        "current": "us_aqi,european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide,sulphur_dioxide",
        "hourly": "us_aqi,european_aqi,pm2_5,pm10"}
    try:
        response = httpx.get("https://air-quality-api.open-meteo.com/v1/air-quality", params=params,
            headers={"User-Agent": "UrbanSaarthi/1.0 (air quality outlook)"}, timeout=10.0)
        response.raise_for_status()
        payload = response.json(); current = payload.get("current") or {}; hourly = payload.get("hourly") or {}
        times = hourly.get("time") or []; us_values = hourly.get("us_aqi") or []; pm25 = hourly.get("pm2_5") or []; pm10 = hourly.get("pm10") or []
        forecast = []
        for i, at in enumerate(times):
            aqi = us_values[i] if i < len(us_values) else None
            forecast.append({"time": at, "us_aqi": aqi, "openweather_index": None, "category": us_category(aqi), "pm25": pm25[i] if i < len(pm25) else None, "pm10": pm10[i] if i < len(pm10) else None})
        current_aqi = current.get("us_aqi")
        return {"status": "available" if current_aqi is not None else "partial", "provider": "Open-Meteo / CAMS",
            "aqi_scale": "US AQI 0–500", "latitude": payload.get("latitude", latitude), "longitude": payload.get("longitude", longitude),
            "timezone": payload.get("timezone"), "updated_at": current.get("time"),
            "current": {"us_aqi": current_aqi, "european_aqi": current.get("european_aqi"), "openweather_index": None,
                "category": us_category(current_aqi), "pm25": current.get("pm2_5"), "pm10": current.get("pm10"),
                "nitrogen_dioxide": current.get("nitrogen_dioxide"), "ozone": current.get("ozone"),
                "carbon_monoxide": current.get("carbon_monoxide"), "sulphur_dioxide": current.get("sulphur_dioxide")},
            "forecast": forecast[:24], "model": "CAMS atmospheric composition forecast",
            "note": "Location-based model estimate from atmospheric forecasts, not an official ground-station measurement. Forecast updates depend on provider model cycles."}
    except (httpx.HTTPError, ValueError, TypeError):
        return {"status": "unavailable", "provider": None, "aqi_scale": None, "latitude": latitude, "longitude": longitude,
            "current": {"us_aqi": None, "european_aqi": None, "openweather_index": None, "category": "Unavailable", "pm25": None, "pm10": None},
            "forecast": [], "note": "Air-quality forecasts could not be reached. Retry when connectivity returns; no live value is being substituted."}


@router.post("/observations", response_model=AqiObservationOut, status_code=201)
def ingest_aqi(payload: AqiObservationIn, request: Request, db: Session = Depends(get_db), actor=Depends(require_ingestion_access)):
    row = AqiObservation(**payload.model_dump(exclude={"observed_at"}), observed_at=payload.observed_at or utc_now())
    db.add(row)
    audit(db, getattr(actor, "id", None), "aqi.observation_ingested", "aqi_observation", None, {"station": payload.station_name, "source": payload.source}, request.client.host if request.client else None)
    db.commit()
    db.refresh(row)
    return row
