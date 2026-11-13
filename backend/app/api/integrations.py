from datetime import datetime
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db import get_db
from app.dependencies import require_roles
from app.models import AqiObservation, DataSource, TransitRoute, TransitStop
from app.services.common import audit, utc_now

router = APIRouter(prefix="/integrations", tags=["External data integrations"])


@router.get("/status")
def integration_status(db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    sources = list(db.scalars(select(DataSource).order_by(DataSource.source_type, DataSource.name)))
    now = utc_now()
    def source_is_fresh(source: DataSource, default_seconds: int = 120) -> bool:
        if source.status != "online" or source.last_success_at is None:
            return False
        last = source.last_success_at.replace(tzinfo=source.last_success_at.tzinfo or now.tzinfo)
        target = source.freshness_seconds if source.freshness_seconds is not None else default_seconds
        return (now - last).total_seconds() <= target
    source_by_external_id = {source.external_id: source for source in sources}
    openaq_source = source_by_external_id.get("openaq-v3")
    cpcb_sources = [source for source in sources if source.source_type == "cpcb"]
    camera_sources = [source for source in sources if source.source_type == "camera"]
    openaq_recent = source_is_fresh(openaq_source, 3600) if openaq_source else False
    cpcb_recent = any(source_is_fresh(source, 3600) for source in cpcb_sources)
    camera_recent = any(source_is_fresh(source, 120) for source in camera_sources)
    camera_has_reported = any(source.last_success_at is not None for source in camera_sources)
    camera_status = "online" if camera_recent else "stale" if camera_has_reported else "waiting_for_heartbeat" if camera_sources else "not_configured"
    cpcb_has_reported = any(source.last_success_at is not None for source in cpcb_sources)
    cpcb_status = "online" if cpcb_recent else "stale" if cpcb_has_reported else "waiting_for_feed" if cpcb_sources else "not_configured"
    try:
        from app.services.sumo_runner import sumo_binary
        native_sumo = sumo_binary()
    except Exception:
        native_sumo = None
    from app.services.agents.base import get_google_api_key, get_google_models
    google_key_present = bool(get_google_api_key())
    google_primary, google_fallback = get_google_models()
    try:
        from importlib.util import find_spec
        google_adk_installed = find_spec("google.adk") is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        google_adk_installed = False

    return {
        "generated_at": utc_now().isoformat(),
        "providers": {
            "google_ai_agent": {
                "configured": google_key_present,
                "dependencies_ready": google_adk_installed,
                "healthy": None,
                "mode": "Google ADK agent with Gemini/Gemma routing" if google_key_present and google_adk_installed else "Google AI key configured; ADK package missing" if google_key_present else "not_configured",
                "primary_model": google_primary if google_key_present else None,
                "fallback_model": google_fallback if google_key_present else None,
                "key_server_side_only": True,
            },
            "openaq": {"configured": bool(settings.openaq_api_key), "healthy": openaq_recent, "mode": "pull" if settings.openaq_api_key else "not_configured", "api_version": "v3", "last_sync_at": openaq_source.last_success_at.isoformat() if openaq_source and openaq_source.last_success_at else None},
            "tomtom_traffic": {"configured": bool(settings.tomtom_api_key), "healthy": None, "mode": "current road flow API; verified when a selected coordinate is queried" if settings.tomtom_api_key else "not_configured", "key_server_side_only": True},
            "openweather_air": {"configured": bool(settings.weather_api_key), "healthy": None, "mode": "current air quality and forecast provider" if settings.weather_api_key else "not_configured"},
            "cpcb": {"configured": bool(cpcb_sources), "healthy": cpcb_recent, "status": cpcb_status, "mode": "authorized source adapter / authenticated ingestion endpoint", "fresh_observation_required": True},
            "gtfs_static": {"configured": bool(db.scalar(select(TransitRoute.id).limit(1))) and bool(db.scalar(select(TransitStop.id).limit(1))), "mode": "GTFS file import"},
            "routing": {"configured": True, "mode": "custom OSRM" if settings.osrm_base_url else "public OSM geocoding/routing with transparent estimated fallback"},
            "camera_vision": {"configured": bool(camera_sources), "healthy": camera_recent, "status": camera_status, "mode": "authenticated RTSP edge worker; deploy backend/scripts/edge_camera_worker.py on the camera network", "fresh_heartbeat_required": True},
            "sumo": {"configured": bool(native_sumo), "healthy": bool(native_sumo), "status": "ready" if native_sumo else "not_installed", "mode": "native SUMO available" if native_sumo else "not_configured", "binary": native_sumo},
            "atcs_write_control": {"configured": False, "healthy": False, "status": "disabled", "enabled": False, "mode": "dispatch preview only; physical signal writes intentionally disabled"},
        },
    }


@router.post("/openaq/sync")
def sync_openaq(request: Request, latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180), radius_km: int = Query(default=20, ge=1, le=50), max_locations: int = Query(default=10, ge=1, le=25), db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
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
    source = db.scalar(select(DataSource).where(DataSource.external_id == "openaq-v3"))
    if source is not None:
        source.status = "online" if imported else ("degraded" if errors else "offline")
        source.last_success_at = utc_now() if imported else source.last_success_at
        source.last_error = (f"{len(errors)} station fetches failed" if errors else None)[:2000] if errors else None
    audit(db, user.id, "integration.openaq_sync", "aqi_observation", None, {"imported_count": len(imported), "error_count": len(errors)}, request.client.host if request and request.client else None)
    db.commit()
    return {"provider": "openaq-v3", "locations_found": len(locations), "observations_created": len(imported), "imported": imported, "errors": errors,
            "note": "OpenAQ provides pollutant concentrations. This connector does not infer or relabel those values as CPCB AQI; ingest official AQI separately when available."}
