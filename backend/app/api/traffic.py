from datetime import timedelta
from copy import deepcopy
import threading
import time
from math import asin, cos, radians, sin, sqrt
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session
import httpx
from app.core.config import settings
from app.db import get_db
from app.dependencies import require_ingestion_access, require_roles
from app.models import Junction, TrafficObservation, CityCluster
from app.schemas import JunctionCreateIn, JunctionOut, TrafficObservationIn, TrafficObservationOut
from app.services.common import audit, utc_now
from app.services.predictions import maybe_refresh_forecasts
from app.services.traffic_simulation import get_simulation_snapshot, get_simulation_scenario, get_xgboost_signal_scenario
from app.services.live_search import search_live_news
from app.services.sumo_runner import run_native_sumo_simulation, sumo_binary

router = APIRouter(prefix="/traffic", tags=["Traffic intelligence"])


class NativeSumoRunIn(BaseModel):
    name: str = Field(default="Traffic signal timing experiment", min_length=3, max_length=160)
    north_south_green_seconds: int = Field(default=42, ge=8, le=100)
    east_west_green_seconds: int = Field(default=42, ge=8, le=100)
    yellow_seconds: int = Field(default=3, ge=3, le=8)
    all_red_seconds: int = Field(default=1, ge=1, le=5)
    demand_multiplier: float = Field(default=1.0, ge=0.5, le=2.0)

    @model_validator(mode="after")
    def valid_cycle(self):
        cycle = self.north_south_green_seconds + self.east_west_green_seconds + 2 * (self.yellow_seconds + self.all_red_seconds)
        if cycle < 40 or cycle > 240:
            raise ValueError("The complete signal cycle must be between 40 and 240 seconds.")
        return self


@router.get("/current")
def current_traffic(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180)):
    """Fetch a current road segment snapshot from TomTom when configured. The API key stays server side."""
    if not settings.tomtom_api_key:
        return {
            "provider": None, "configured": False, "mode": "model_forecast", "data_mode": "model_forecast",
            "live_data_available": False,
            "message": "No live road-speed provider is configured for this coordinate. The separate network model forecast is not a live traffic observation.",
            "latitude": latitude, "longitude": longitude, "observed_at": None, "flow": None,
            "simulation": get_simulation_snapshot(),
        }
    url = "https://api.tomtom.com/traffic/services/4/flowSegmentData/relative/10/json"
    try:
        response = httpx.get(url, params={"point": f"{latitude},{longitude}", "key": settings.tomtom_api_key}, timeout=12)
        response.raise_for_status()
        payload = response.json().get("flowSegmentData") or {}
    except (httpx.HTTPError, ValueError):
        return {
            "provider": None, "configured": True, "mode": "provider_unavailable", "data_mode": "unavailable",
            "live_data_available": False,
            "message": "The configured live traffic provider could not return this road segment. The network model forecast remains separate and is not substituted as a live reading.",
            "latitude": latitude, "longitude": longitude, "observed_at": None, "flow": None,
            "simulation": get_simulation_snapshot(),
        }
    return {
        "provider": "TomTom Traffic Flow", "configured": True, "mode": "provider", "data_mode": "live_provider",
        "live_data_available": True,
        "latitude": latitude, "longitude": longitude, "observed_at": utc_now().isoformat(),
        "flow": {
            "current_speed_kmph": payload.get("currentSpeed"),
            "free_flow_speed_kmph": payload.get("freeFlowSpeed"),
            "current_travel_time_seconds": payload.get("currentTravelTime"),
            "free_flow_travel_time_seconds": payload.get("freeFlowTravelTime"),
            "confidence": payload.get("confidence"), "road_closed": payload.get("roadClosure"),
            "frc": payload.get("frc"),
        },
        "note": "Road segment flow snapshot from the configured provider. Coverage depends on provider availability at the selected coordinates.",
    }


ROAD_HIGHWAYS = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"
_NEARBY_ROAD_CACHE: dict[tuple, tuple[float, list[dict], str | None]] = {}
_NEARBY_ROAD_CACHE_LOCK = threading.Lock()
_NEARBY_ROAD_CACHE_TTL_SECONDS = 300

def _cached_road_geometry(latitude: float, longitude: float, radius_m: int) -> tuple[list[dict], str | None]:
    # Round to roughly 100 m cells; reusing geometry avoids repeatedly hitting Overpass.
    key = (round(latitude, 3), round(longitude, 3), int(radius_m / 500) * 500)
    now = time.monotonic()
    with _NEARBY_ROAD_CACHE_LOCK:
        cached = _NEARBY_ROAD_CACHE.get(key)
        if cached and cached[0] > now:
            return deepcopy(cached[1]), cached[2]
        if cached:
            _NEARBY_ROAD_CACHE.pop(key, None)

    # Overpass endpoints are tried sequentially with hard, short timeouts.
    query = (f'[out:json][timeout:5];way(around:{radius_m},{latitude},{longitude})'
             f'["highway"~"^({ROAD_HIGHWAYS})$"];out center geom;')
    elements: list[dict] = []
    provider_note = None
    for endpoint, timeout in (("https://overpass-api.de/api/interpreter", 3.5),
                              ("https://overpass.kumi.systems/api/interpreter", 2.5)):
        try:
            response = httpx.post(endpoint, data={"data": query},
                                  headers={"User-Agent": "UrbanSaarthi/1.0 (nearby road discovery)"}, timeout=timeout)
            response.raise_for_status()
            elements = response.json().get("elements", [])
            if elements:
                break
        except (httpx.HTTPError, ValueError, TypeError):
            provider_note = "OpenStreetMap road discovery could not be reached."

    roads = []
    for element in elements:
        tags = element.get("tags") or {}
        centre = element.get("center") or {}
        road_lat = element.get("lat", centre.get("lat"))
        road_lon = element.get("lon", centre.get("lon"))
        geometry_raw = element.get("geometry") or []
        if (road_lat is None or road_lon is None) and geometry_raw:
            road_lat = sum(float(point["lat"]) for point in geometry_raw) / len(geometry_raw)
            road_lon = sum(float(point["lon"]) for point in geometry_raw) / len(geometry_raw)
        if road_lat is None or road_lon is None:
            continue
        distance = _haversine_m(latitude, longitude, float(road_lat), float(road_lon))
        geometry = [{"lat": float(point["lat"]), "lng": float(point["lon"])}
                    for point in geometry_raw if point.get("lat") is not None and point.get("lon") is not None]
        roads.append({
            "id": f"osm-road-{element.get('id')}",
            "name": tags.get("name") or tags.get("ref") or tags.get("highway", "Mapped road").replace("_", " ").title(),
            "road_type": tags.get("highway"), "distance_meters": round(distance),
            "latitude": float(road_lat), "longitude": float(road_lon), "geometry": geometry[:250],
            "traffic": None, "source": "OpenStreetMap road geometry",
        })
    roads.sort(key=lambda row: row["distance_meters"])
    roads = roads[:24]
    # Cache successful geometry for five minutes; cache an unavailable result briefly
    # to avoid hammering both public Overpass endpoints during an outage.
    cache_ttl = _NEARBY_ROAD_CACHE_TTL_SECONDS if roads else 30
    with _NEARBY_ROAD_CACHE_LOCK:
        _NEARBY_ROAD_CACHE[key] = (now + cache_ttl, deepcopy(roads), provider_note)
    return roads, provider_note


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 6371000 * 2 * asin(sqrt(min(1, a)))


def _road_flow(latitude: float, longitude: float) -> dict | None:
    if not settings.tomtom_api_key:
        return None
    try:
        response = httpx.get(
            "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json",
            params={"point": f"{latitude},{longitude}", "key": settings.tomtom_api_key},
            headers={"User-Agent": "UrbanSaarthi/1.0"}, timeout=4.0,
        )
        response.raise_for_status()
        payload = response.json().get("flowSegmentData") or {}
        current, free = payload.get("currentSpeed"), payload.get("freeFlowSpeed")
        if current is None or free is None:
            return None
        current, free = float(current), max(1.0, float(free))
        ratio = current / free
        level = "heavy" if ratio < 0.40 or payload.get("roadClosure") else "slow" if ratio < 0.72 else "moving"
        return {"current_speed_kmph": current, "free_flow_speed_kmph": free,
                "travel_time_seconds": payload.get("currentTravelTime"),
                "free_flow_travel_time_seconds": payload.get("freeFlowTravelTime"),
                "confidence": payload.get("confidence"), "road_closed": bool(payload.get("roadClosure")),
                "congestion_ratio": round(ratio, 3), "status": "closed" if payload.get("roadClosure") else level,
                "provider": "TomTom Traffic Flow"}
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return None


@router.get("/nearby")
def nearby_road_traffic(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    radius_m: int = Query(default=3500, ge=500, le=8000),
):
    """Return cached OSM road geometry quickly, then enrich with real provider observations."""
    roads, provider_note = _cached_road_geometry(latitude, longitude, radius_m)

    # Flow calls run concurrently and are deliberately capped to the nearest six roads.
    # This keeps response latency bounded instead of serially waiting on up to ten 8s calls.
    flow_candidates = [row for row in roads if settings.tomtom_api_key][:6]
    incidents: list[dict] = []
    incident_status = "not_configured" if not settings.tomtom_api_key else "unavailable"
    incident_note = "Configure TOMTOM_API_KEY for live incident and road-closure data."
    incident_future = None
    executor = ThreadPoolExecutor(max_workers=max(1, len(flow_candidates) + 1))
    try:
        flow_futures = [executor.submit(_road_flow, row["latitude"], row["longitude"]) for row in flow_candidates]
        if settings.tomtom_api_key:
            lat_delta = radius_m / 111000
            lon_delta = radius_m / max(1, 111000 * cos(radians(latitude)))
            bbox = f"{longitude-lon_delta},{latitude-lat_delta},{longitude+lon_delta},{latitude+lat_delta}"
            fields = "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity,lastReportTime}}}"
            def fetch_incidents():
                response = httpx.get(
                    "https://api.tomtom.com/traffic/services/5/incidentDetails",
                    params={"key": settings.tomtom_api_key, "bbox": bbox, "fields": fields,
                            "language": "en-GB", "timeValidityFilter": "present"},
                    headers={"User-Agent": "UrbanSaarthi/1.0"}, timeout=4.0,
                )
                response.raise_for_status()
                return response.json().get("incidents") or []
            incident_future = executor.submit(fetch_incidents)

        for row, future in zip(flow_candidates, flow_futures):
            try:
                row["traffic"] = future.result(timeout=4.5)
            except Exception:
                row["traffic"] = None
        if incident_future is not None:
            try:
                for item in incident_future.result(timeout=4.5)[:80]:
                    props = item.get("properties") or {}
                    events = props.get("events") or []
                    coords = (item.get("geometry") or {}).get("coordinates") or []
                    point = coords[0] if coords and isinstance(coords[0], list) and len(coords[0]) == 2 and isinstance(coords[0][0], (int, float)) else coords
                    incidents.append({
                        "id": props.get("id"), "type": (events[0].get("description") if events else None) or {1: "Accident", 6: "Traffic jam", 7: "Lane closure", 8: "Road closure", 9: "Road works", 11: "Flooding"}.get(props.get("iconCategory"), "Traffic incident"),
                        "category": props.get("iconCategory"), "magnitude": props.get("magnitudeOfDelay"),
                        "from": props.get("from"), "to": props.get("to"), "delay_seconds": props.get("delay"),
                        "length_meters": props.get("length"), "road_numbers": props.get("roadNumbers") or [],
                        "observed_at": props.get("lastReportTime") or props.get("startTime"),
                        "latitude": point[1] if isinstance(point, list) and len(point) >= 2 else None,
                        "longitude": point[0] if isinstance(point, list) and len(point) >= 2 else None,
                        "source": "TomTom Traffic Incidents",
                    })
                incident_status = "available"
                incident_note = "Current incident details from TomTom. Coverage varies by road and provider region."
            except Exception:
                incident_note = "TomTom incident lookup did not return data for this area."
    finally:
        executor.shutdown(wait=True, cancel_futures=True)

    flows = [row["traffic"] for row in roads if row.get("traffic")]
    traffic_summary = {
        "measured_roads": len(flows),
        "heavy_roads": sum(1 for flow in flows if flow["status"] in {"heavy", "closed"}),
        "slow_roads": sum(1 for flow in flows if flow["status"] == "slow"),
        "moving_roads": sum(1 for flow in flows if flow["status"] == "moving"),
    }
    return {
        "status": "available" if roads else "provider_unavailable", "latitude": latitude, "longitude": longitude, "radius_m": radius_m,
        "roads": roads, "road_count": len(roads), "traffic_summary": traffic_summary,
        "traffic_provider": "TomTom Traffic Flow" if flows else None,
        "traffic_status": "available" if flows else "not_configured" if not settings.tomtom_api_key else "unavailable",
        "traffic_note": "Flow readings are live provider observations." if flows else "Live speed requires TOMTOM_API_KEY; mapped roads are shown without invented traffic colours.",
        "incidents": incidents, "incident_status": incident_status, "incident_note": incident_note,
        "provider": "OpenStreetMap" if roads else None,
        "note": provider_note or "Road geometry is mapped from OpenStreetMap. Speed and incident status are sourced separately and remain unavailable until the traffic provider returns readings.",
        "updated_at": utc_now().isoformat(),
    }


@router.get("/news")
def traffic_news(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180), area: str = Query(default="", max_length=160), limit: int = Query(default=8, ge=1, le=12)):
    place = " ".join(str(area or "nearby area").split())[:160]
    query = f"traffic accident road closure congestion roadworks near {place} India" if place else f"traffic accident road closure congestion near {latitude:.4f},{longitude:.4f} India"
    result = search_live_news(query, limit=limit, topic="news")
    result["area"] = place
    return result


@router.get("/simulation/capabilities")
def simulation_capabilities():
    """Report which traffic playback modes are actually available on this worker."""
    from importlib.util import find_spec
    from app.services.sumo_runner import NETWORK
    from app.services.traffic_simulation import BASE as SIMULATION_BASE

    native_ready = bool(sumo_binary() and NETWORK.is_file())
    forecast_files = (
        "queue_model.json", "queue_model_60min.json", "metrics.json",
        "metrics_60min.json", "edge_mean.json",
    )
    forecast_artifacts = all((SIMULATION_BASE / "models" / name).is_file() for name in forecast_files)
    forecast_artifacts = forecast_artifacts and (SIMULATION_BASE / "data" / "raw.csv").is_file()
    try:
        forecast_dependency = find_spec("xgboost") is not None
    except (ImportError, ValueError):
        forecast_dependency = False
    forecast_ready = bool(forecast_artifacts and forecast_dependency)
    return {
        "native_simulation_available": native_ready,
        "forecast_available": forecast_ready,
        "reference_network_available": NETWORK.is_file(),
        "recommended_mode": "microscopic" if native_ready else "forecast" if forecast_ready else "unavailable",
        "message": None if native_ready else "A 60-minute network forecast is available; detailed vehicle tracking is not enabled on this worker." if forecast_ready else "No traffic simulation engine is ready on this worker.",
    }


@router.post("/sumo/run")
def run_sumo_signal_experiment(payload: NativeSumoRunIn, _user=Depends(require_roles("operator", "admin"))):
    """Run a reproducible native SUMO baseline vs. signal-timing intervention.

    This runs the bundled reference grid network. It is genuine SUMO execution,
    but the bundled grid is not a mapped or calibrated city network.
    """
    if not sumo_binary():
        raise HTTPException(status_code=424, detail="SUMO CLI is not installed or SUMO_BINARY is not configured. Install SUMO on the API worker to run this experiment; the XGBoost forecast is not substituted.")
    phases = [
        {"green_seconds": payload.north_south_green_seconds, "yellow_seconds": payload.yellow_seconds, "all_red_seconds": payload.all_red_seconds},
        {"green_seconds": payload.east_west_green_seconds, "yellow_seconds": payload.yellow_seconds, "all_red_seconds": payload.all_red_seconds},
    ]
    report = {"mean_vehicles_per_sampled_frame": 5 * payload.demand_multiplier, "counts": {"car": 70, "motorbike": 20, "bus": 5, "truck": 5}}
    try:
        result = run_native_sumo_simulation("baseline", report=report, proposed_phases=phases)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"SUMO execution failed ({type(exc).__name__}). Check SUMO installation and the bundled network files.") from exc
    if result is None:
        raise HTTPException(status_code=424, detail="Native SUMO could not be started. Check SUMO_BINARY and the bundled grid network.")
    result["experiment"] = {
        "name": payload.name,
        "signal_timings": {
            "north_south_green_seconds": payload.north_south_green_seconds,
            "east_west_green_seconds": payload.east_west_green_seconds,
            "yellow_seconds": payload.yellow_seconds,
            "all_red_seconds": payload.all_red_seconds,
            "cycle_seconds": payload.north_south_green_seconds + payload.east_west_green_seconds + 2 * (payload.yellow_seconds + payload.all_red_seconds),
        },
        "demand_multiplier": payload.demand_multiplier,
    }
    return result


@router.post("/simulation/model-scenario")
def run_xgboost_signal_experiment(payload: NativeSumoRunIn, _user=Depends(require_roles("operator", "admin"))):
    """Run the trained network forecast with a clearly-labelled signal sensitivity overlay.

    This is an XGBoost forecast, not a microscopic vehicle simulation and not SUMO.
    The signal/demand overlay is an explicit what-if assumption because these model
    artifacts were trained on queue features, not signal timing control experiments.
    """
    try:
        return get_xgboost_signal_scenario(
            north_south_green_seconds=payload.north_south_green_seconds,
            east_west_green_seconds=payload.east_west_green_seconds,
            yellow_seconds=payload.yellow_seconds,
            all_red_seconds=payload.all_red_seconds,
            demand_multiplier=payload.demand_multiplier,
            name=payload.name,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The 60-minute traffic forecast could not be completed. Please check the server forecast files and try again.") from exc


@router.get("/simulation")
def traffic_simulation():
    """Forecast 30 minutes using the supplied SUMO dataset and trained model."""
    return get_simulation_snapshot()


@router.get("/simulation/scenario")
def traffic_simulation_scenario(minutes: int = Query(default=60, ge=15, le=60), step_minutes: int = Query(default=5, ge=1, le=15), scenario: str = Query(default="baseline", pattern="^(baseline|demand_surge|signal_priority)$")):
    """Return a multi-step 60-minute XGBoost forecast and its reference road geometry."""
    result = get_simulation_scenario(minutes=minutes, step_minutes=step_minutes, scenario=scenario)
    try:
        from app.services.sumo_runner import NETWORK, _network_geometry
        result["network_geometry"] = _network_geometry(NETWORK)
    except Exception:
        result["network_geometry"] = {"roads": [], "junctions": [], "bounds": {"x_min": 0, "y_min": 0, "x_max": 1000, "y_max": 1000}}
    return result


@router.get("/junctions", response_model=list[JunctionOut])
def list_junctions(db: Session = Depends(get_db), cluster_id: int | None = None, status_filter: str | None = Query(default=None, alias="status"), include_synthetic: bool = False, limit: int = 100, offset: int = 0):
    query = select(Junction).order_by(Junction.name)
    if cluster_id is not None:
        query = query.where(Junction.cluster_id == cluster_id)
    if status_filter:
        query = query.where(Junction.status == status_filter)
    rows = list(db.scalars(query))
    if not include_synthetic:
        rows = [row for row in rows if not (row.configuration or {}).get("is_synthetic")]
    return rows[max(0, offset):max(0, offset) + max(1, min(limit, 250))]


@router.get("/junctions/{junction_id}", response_model=JunctionOut)
def get_junction(junction_id: int, db: Session = Depends(get_db)):
    junction = db.get(Junction, junction_id)
    if not junction:
        raise HTTPException(status_code=404, detail="Junction not found")
    return junction


@router.get("/junctions/{junction_id}/observations", response_model=list[TrafficObservationOut])
def junction_observations(
    junction_id: int,
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=500),
    since_minutes: int = Query(default=1440, ge=1, le=10080),
    source: str | None = Query(default=None, max_length=80),
    include_synthetic: bool = False,
    user=Depends(require_roles("operator", "admin")),
):
    junction = db.get(Junction, junction_id)
    if not junction or ((junction.configuration or {}).get("is_synthetic") and not include_synthetic):
        raise HTTPException(status_code=404, detail="Registered live junction not found")
    query = select(TrafficObservation).where(
        TrafficObservation.junction_id == junction_id,
        TrafficObservation.observed_at >= utc_now() - timedelta(minutes=since_minutes),
    )
    if source:
        query = query.where(TrafficObservation.source == source)
    else:
        query = query.where(TrafficObservation.source != "synthetic-demo")
    return list(db.scalars(query.order_by(TrafficObservation.observed_at.desc()).limit(limit)))


@router.get("/overview")
def traffic_overview(db: Session = Depends(get_db)):
    now = utc_now()
    cutoff = now - timedelta(minutes=30)
    all_junctions = list(db.scalars(select(Junction)))
    real_junctions = [junction for junction in all_junctions if not (junction.configuration or {}).get("is_synthetic")]
    real_junction_ids = {junction.id for junction in real_junctions}
    junction_count = len(real_junctions)
    live_cutoff = now - timedelta(minutes=5)
    observations = list(db.scalars(select(TrafficObservation).where(TrafficObservation.observed_at >= cutoff, TrafficObservation.source != "synthetic-demo").order_by(TrafficObservation.observed_at.desc()).limit(1000)))
    fresh_junction_ids = {o.junction_id for o in observations if o.junction_id in real_junction_ids and o.observed_at >= live_cutoff}
    active_junction_count = len(fresh_junction_ids)
    latest_by_junction: dict[int, TrafficObservation] = {}
    for row in observations:
        if row.junction_id in real_junction_ids and row.junction_id not in latest_by_junction:
            latest_by_junction[row.junction_id] = row
    congested = [o for o in latest_by_junction.values() if (o.congestion_score or 0) >= 70]
    scores = [o.congestion_score for o in latest_by_junction.values() if o.congestion_score is not None]
    return {
        "generated_at": now.isoformat(), "junction_count": junction_count,
        "online_junction_count": active_junction_count, "junctions_with_recent_data": len(latest_by_junction),
        "high_congestion_junction_count": len(congested),
        "mean_congestion_score": round(sum(scores) / len(scores), 1) if scores else None,
        "vehicle_count_latest_observations": sum(o.vehicle_count for o in latest_by_junction.values()),
        "data_window_minutes": 30,
        "data_quality": "based only on observations received by this backend; no live camera polling is implied",
    }


@router.post("/observations", response_model=TrafficObservationOut, status_code=201)
def ingest_traffic(payload: TrafficObservationIn, request: Request, db: Session = Depends(get_db), _actor=Depends(require_ingestion_access)):
    junction = db.get(Junction, payload.junction_id) if payload.junction_id is not None else None
    if payload.external_junction_id:
        by_external = db.scalar(select(Junction).where(Junction.external_id == payload.external_junction_id))
        if by_external:
            junction = by_external
    if payload.junction_id is not None and not junction:
        raise HTTPException(status_code=404, detail="Junction not found")
    if not junction:
        raise HTTPException(status_code=404, detail="Unknown external_junction_id; register the junction first")
    row = TrafficObservation(
        junction_id=junction.id, external_junction_id=junction.external_id,
        source=payload.source, observed_at=payload.observed_at or utc_now(),
        vehicle_count=payload.vehicle_count, queue_length_m=payload.queue_length_m,
        average_speed_kmph=payload.average_speed_kmph, average_wait_seconds=payload.average_wait_seconds,
        lane_density=payload.lane_density, congestion_score=payload.congestion_score,
        lane_demand=payload.lane_demand, detection_summary=payload.detection_summary,
    )
    db.add(row)
    db.flush()
    junction.status = "online"
    audit(db, getattr(_actor, "id", None), "traffic.observation_ingested", "junction", str(junction.id), {"source": payload.source, "observation_id": row.id}, request.client.host if request.client else None)
    maybe_refresh_forecasts(db, junction.id)
    db.commit()
    db.refresh(row)
    return row


@router.post("/junctions", response_model=JunctionOut, status_code=201)
def create_junction(payload: JunctionCreateIn, request: Request, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    if db.scalar(select(Junction.id).where(Junction.external_id == payload.external_id)):
        raise HTTPException(status_code=409, detail="external_id already exists")
    if payload.cluster_id is not None and not db.get(CityCluster, payload.cluster_id):
        raise HTTPException(status_code=404, detail="Cluster not found")
    junction = Junction(**payload.model_dump())
    db.add(junction)
    db.flush()
    audit(db, user.id, "junction.created", "junction", str(junction.id), {"external_id": junction.external_id}, request.client.host if request.client else None)
    db.commit()
    db.refresh(junction)
    return junction
