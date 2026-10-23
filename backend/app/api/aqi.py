from datetime import timedelta
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
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
    """Location-only air quality outlook from Open-Meteo/CAMS. No API key required."""
    params = {"latitude": latitude, "longitude": longitude, "timezone": "auto", "forecast_hours": 24,
        "current": "us_aqi,european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide,sulphur_dioxide",
        "hourly": "us_aqi,european_aqi,pm2_5,pm10"}
    def category(aqi):
        if aqi is None: return "Unavailable"
        value = float(aqi)
        if value <= 50: return "Good"
        if value <= 100: return "Moderate"
        if value <= 150: return "Unhealthy for sensitive groups"
        if value <= 200: return "Unhealthy"
        if value <= 300: return "Very unhealthy"
        return "Hazardous"
    try:
        response = httpx.get("https://air-quality-api.open-meteo.com/v1/air-quality", params=params, headers={"User-Agent": "UrbanSaarthi/1.0 (air quality outlook)"}, timeout=10.0)
        response.raise_for_status()
        payload = response.json(); current = payload.get("current") or {}; hourly = payload.get("hourly") or {}
        times = hourly.get("time") or []; us_values = hourly.get("us_aqi") or []; pm25 = hourly.get("pm2_5") or []; pm10 = hourly.get("pm10") or []
        forecast = []
        for i, at in enumerate(times):
            aqi = us_values[i] if i < len(us_values) else None
            forecast.append({"time": at, "us_aqi": aqi, "category": category(aqi), "pm25": pm25[i] if i < len(pm25) else None, "pm10": pm10[i] if i < len(pm10) else None})
        current_aqi = current.get("us_aqi")
        return {"status": "available" if current_aqi is not None else "partial", "provider": "Open-Meteo / CAMS",
            "latitude": payload.get("latitude", latitude), "longitude": payload.get("longitude", longitude), "timezone": payload.get("timezone"), "updated_at": current.get("time"),
            "current": {"us_aqi": current_aqi, "european_aqi": current.get("european_aqi"), "category": category(current_aqi), "pm25": current.get("pm2_5"), "pm10": current.get("pm10"), "nitrogen_dioxide": current.get("nitrogen_dioxide"), "ozone": current.get("ozone"), "carbon_monoxide": current.get("carbon_monoxide"), "sulphur_dioxide": current.get("sulphur_dioxide")},
            "forecast": forecast[:24], "model": "CAMS atmospheric composition forecast", "note": "Location-based model estimate from atmospheric forecasts, not an official ground-station measurement. Forecast updates depend on provider model cycles."}
    except (httpx.HTTPError, ValueError, TypeError):
        return {"status": "unavailable", "provider": None, "latitude": latitude, "longitude": longitude,
            "current": {"us_aqi": None, "european_aqi": None, "category": "Unavailable", "pm25": None, "pm10": None},
            "forecast": [], "note": "Air-quality forecasts could not be reached. Retry when connectivity returns; no live value is being substituted."}


@router.post("/observations", response_model=AqiObservationOut, status_code=201)
def ingest_aqi(payload: AqiObservationIn, request: Request, db: Session = Depends(get_db), actor=Depends(require_ingestion_access)):
    row = AqiObservation(**payload.model_dump(exclude={"observed_at"}), observed_at=payload.observed_at or utc_now())
    db.add(row)
    audit(db, getattr(actor, "id", None), "aqi.observation_ingested", "aqi_observation", None, {"station": payload.station_name, "source": payload.source}, request.client.host if request.client else None)
    db.commit()
    db.refresh(row)
    return row
