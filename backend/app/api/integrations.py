from datetime import datetime
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db import get_db
from app.models import AqiObservation, DataSource, TransitRoute, TransitStop
from app.services.common import audit, utc_now

router = APIRouter(prefix="/integrations", tags=["External data integrations"])


@router.get("/status")
def integration_status(db: Session = Depends(get_db)):
    sources = list(db.scalars(select(DataSource).order_by(DataSource.source_type, DataSource.name)))
    return {
        "generated_at": utc_now().isoformat(),
        "providers": {
            "openaq": {"configured": bool(settings.openaq_api_key), "mode": "pull" if settings.openaq_api_key else "not_configured", "api_version": "v3"},
            "cpcb": {"configured": any(s.source_type == "cpcb" and s.status not in {"not_configured", "offline"} for s in sources), "mode": "authorized source adapter / ingestion endpoint"},
            "gtfs_static": {"configured": bool(db.scalar(select(TransitRoute.id).limit(1))) and bool(db.scalar(select(TransitStop.id).limit(1))), "mode": "GTFS file import"},
            "routing": {"configured": bool(settings.osrm_base_url), "mode": "OSRM" if settings.osrm_base_url else "transparent heuristic fallback"},
            "camera_vision": {"configured": any(s.source_type == "camera" and s.status == "online" for s in sources), "mode": "push vision events; no RTSP frame worker is embedded"},
            "sumo": {"configured": any(s.source_type == "sumo" and s.status == "online" for s in sources), "mode": "analytical what-if fallback; no SUMO binary is launched"},
            "atcs_write_control": {"enabled": False, "mode": "dispatch preview only; physical signal writes intentionally disabled"},
        },
    }


@router.post("/openaq/sync")
def sync_openaq(request: Request, latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180), radius_km: int = Query(default=20, ge=1, le=50), max_locations: int = Query(default=10, ge=1, le=25), db: Session = Depends(get_db)):
    if not settings.openaq_api_key:
        raise HTTPException(status_code=409, detail="OPENAQ_API_KEY is not configured")
    headers = {"X-API-Key": settings.openaq_api_key, "Accept": "application/json"}
    try:
        response = httpx.get("https://api.openaq.org/v3/locations", params={"coordinates": f"{latitude},{longitude}", "radius": radius_km * 1000, "limit": max_locations, "page": 1}, headers=headers, timeout=15)
        response.raise_for_status()
        location_payload = response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAQ location request failed with status {exc.response.status_code}") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="OpenAQ location request failed") from exc

    locations = location_payload.get("results", [])
    imported = []
    errors = []
    for location in locations[:max_locations]:
        location_id = location.get("id")
        coordinates = location.get("coordinates") or {}
        station_lat = coordinates.get("latitude")
        station_lon = coordinates.get("longitude")
        if location_id is None or station_lat is None or station_lon is None:
            continue
        sensor_map = {}
        for sensor in location.get("sensors", []) or []:
            parameter = sensor.get("parameter") or {}
            sensor_id = sensor.get("id")
            if sensor_id is not None:
                sensor_map[int(sensor_id)] = str(parameter.get("name", "")).lower()
        try:
            latest_response = httpx.get(f"https://api.openaq.org/v3/locations/{location_id}/latest", params={"limit": 100, "page": 1}, headers=headers, timeout=15)
            latest_response.raise_for_status()
            latest_payload = latest_response.json()
        except (httpx.HTTPError, ValueError) as exc:
            errors.append({"location_id": location_id, "error": "latest_measurement_fetch_failed"})
            continue
        pollutant = {"pm25": None, "pm10": None, "no2": None, "o3": None, "co": None}
        latest_times = []
        for measurement in latest_payload.get("results", []) or []:
            parameter_name = sensor_map.get(measurement.get("sensorsId"), "")
            normalized = parameter_name.replace(".", "").replace("_", "")
            key = {"pm25": "pm25", "pm2_5": "pm25", "pm10": "pm10", "no2": "no2", "o3": "o3", "co": "co"}.get(normalized)
            if key and isinstance(measurement.get("value"), (int, float)):
                pollutant[key] = float(measurement["value"])
            stamp = (measurement.get("datetime") or {}).get("utc")
            if stamp:
                try:
                    latest_times.append(datetime.fromisoformat(stamp.replace("Z", "+00:00")))
                except ValueError:
                    pass
        observed_at = max(latest_times) if latest_times else utc_now()
        row = AqiObservation(
            external_station_id=str(location_id), station_name=location.get("name") or f"OpenAQ location {location_id}",
            latitude=float(station_lat), longitude=float(station_lon), source="openaq-v3",
            observed_at=observed_at, aqi=None, pm25=pollutant["pm25"], pm10=pollutant["pm10"],
            no2=pollutant["no2"], o3=pollutant["o3"], co=pollutant["co"], category=None,
            raw_payload={"provider": "OpenAQ v3", "location_id": location_id, "measurements_used": len(latest_payload.get("results", []) or []), "note": "OpenAQ concentrations are not converted to CPCB AQI here."},
        )
        db.add(row)
        imported.append({"location_id": location_id, "station_name": row.station_name, "observed_at": observed_at.isoformat()})
    audit(db, None, "integration.openaq_sync", "aqi_observation", None, {"imported_count": len(imported), "error_count": len(errors)}, request.client.host if request and request.client else None)
    db.commit()
    return {"provider": "openaq-v3", "locations_found": len(locations), "observations_created": len(imported), "imported": imported, "errors": errors,
            "note": "OpenAQ provides pollutant concentrations. This connector does not infer or relabel those values as CPCB AQI; ingest official AQI separately when available."}
