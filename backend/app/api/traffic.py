from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
import math
from fastapi import APIRouter, Depends, HTTPException, Query, Request
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
from app.services.traffic_simulation import get_simulation_snapshot, get_simulation_scenario

router = APIRouter(prefix="/traffic", tags=["Traffic intelligence"])


def _distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(min(1.0, a)))


def _road_status(current_speed: float | None, free_flow_speed: float | None, closed: bool = False) -> str:
    if closed:
        return "Closed"
    if current_speed is None or free_flow_speed is None or free_flow_speed <= 0:
        return "No reading"
    ratio = current_speed / free_flow_speed
    return "Heavy" if ratio <= 0.40 else "Slow" if ratio <= 0.72 else "Moving"


def _closest_point_on_road(latitude: float, longitude: float, geometry: list[dict]) -> tuple[float, float, float] | None:
    """Project the query point onto each mapped road segment and return the nearest point.

    A local equirectangular plane is accurate enough for the 5 km lookup radius and
    avoids the long-road vertex-midpoint error that can hide a nearby road.
    """
    valid = [(float(point["lat"]), float(point["lon"])) for point in geometry
             if point.get("lat") is not None and point.get("lon") is not None]
    if not valid:
        return None
    earth_radius = 6_371_000.0
    cos_lat = max(1e-6, abs(math.cos(math.radians(latitude))))

    def to_xy(lat: float, lon: float) -> tuple[float, float]:
        return (math.radians(lon - longitude) * earth_radius * cos_lat,
                math.radians(lat - latitude) * earth_radius)

    best: tuple[float, float, float] | None = None
    segments = list(zip(valid, valid[1:])) or [(valid[0], valid[0])]
    for (lat1, lon1), (lat2, lon2) in segments:
        x1, y1 = to_xy(lat1, lon1)
        x2, y2 = to_xy(lat2, lon2)
        dx, dy = x2 - x1, y2 - y1
        length_sq = dx * dx + dy * dy
        ratio = 0.0 if length_sq <= 1e-9 else max(0.0, min(1.0, -(x1 * dx + y1 * dy) / length_sq))
        x, y = x1 + ratio * dx, y1 + ratio * dy
        distance = math.hypot(x, y)
        candidate = (distance, latitude + math.degrees(y / earth_radius),
                     longitude + math.degrees(x / (earth_radius * cos_lat)))
        if best is None or candidate[0] < best[0]:
            best = candidate
    return best


def _osm_road_candidates(latitude: float, longitude: float, radius_m: int) -> list[dict]:
    query = (
        f"[out:json][timeout:12];way(around:{radius_m},{latitude},{longitude})"
        f"[\"highway\"~\"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)$\"]"
        f"[\"name\"];out body geom qt 70;"
    )
    for endpoint in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
        try:
            response = httpx.post(endpoint, data={"data": query}, headers={"User-Agent": "UrbanSaarthi/1.0 (nearby traffic)"}, timeout=6.5)
            response.raise_for_status()
            elements = response.json().get("elements", [])
            roads = []
            seen = set()
            for element in elements:
                tags = element.get("tags") or {}
                name = str(tags.get("name") or "").strip()
                if not name:
                    continue
                # Use the closest mapped point on the road, not the centre of
                # the entire OSM way (which can be kilometres away for long roads).
                geometry = element.get("geometry") or []
                closest = _closest_point_on_road(latitude, longitude, geometry)
                if closest is None:
                    center = element.get("center") or {}
                    lat, lon = center.get("lat"), center.get("lon")
                    if lat is None or lon is None:
                        continue
                    distance = _distance_meters(latitude, longitude, float(lat), float(lon))
                    closest = (distance, float(lat), float(lon))
                distance, lat, lon = closest
                if distance > radius_m:
                    continue
                key = name.casefold()
                if key in seen:
                    continue
                seen.add(key)
                roads.append({
                    "id": f"osm-road-{element.get('id')}", "road_name": name,
                    "road_type": tags.get("highway"), "latitude": lat, "longitude": lon,
                    "distance_meters": round(distance),
                })
            roads.sort(key=lambda item: item["distance_meters"])
            if roads:
                return roads[:10]
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            continue
    return []


def _tomtom_road_flow(road: dict) -> dict | None:
    if not settings.tomtom_api_key:
        return None
    try:
        response = httpx.get(
            "https://api.tomtom.com/traffic/services/4/flowSegmentData/relative/10/json",
            params={"point": f"{road['latitude']},{road['longitude']}", "key": settings.tomtom_api_key},
            timeout=8.0,
        )
        response.raise_for_status()
        payload = response.json().get("flowSegmentData") or {}
        current = payload.get("currentSpeed")
        free_flow = payload.get("freeFlowSpeed")
        if current is None or free_flow is None:
            return None
        current, free_flow = float(current), float(free_flow)
        closed = bool(payload.get("roadClosure"))
        return {
            **road, "current_speed_kmph": current, "free_flow_speed_kmph": free_flow,
            "congestion_percent": round(max(0.0, min(100.0, (1 - current / max(free_flow, 1.0)) * 100)), 1),
            "status": _road_status(current, free_flow, closed), "road_closed": closed,
            "confidence": payload.get("confidence"), "provider": "TomTom Traffic Flow",
            "observed_at": utc_now().isoformat(),
        }
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return None


@router.get("/nearby-roads")
def nearby_road_traffic(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    radius_m: int = Query(default=2500, ge=500, le=5000),
    db: Session = Depends(get_db),
):
    """Return named nearby roads with current flow or recent registered-junction observations."""
    osm_roads = _osm_road_candidates(latitude, longitude, radius_m)
    if settings.tomtom_api_key and osm_roads:
        measured = []
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = [pool.submit(_tomtom_road_flow, road) for road in osm_roads[:8]]
            for future in as_completed(futures):
                result = future.result()
                if result:
                    measured.append(result)
        measured.sort(key=lambda item: (
            0 if item["status"] == "Closed" else 1 if item["status"] == "Heavy" else 2 if item["status"] == "Slow" else 3,
            item["distance_meters"],
        ))
        measured_names = {item["road_name"].casefold() for item in measured}
        unmeasured = [{
            **road, "status": "No reading", "current_speed_kmph": None,
            "free_flow_speed_kmph": None, "congestion_percent": None,
            "provider": "OpenStreetMap",
        } for road in osm_roads if road["road_name"].casefold() not in measured_names]
        roads = (measured + unmeasured)[:12]
        if measured:
            return {
                "roads": roads, "count": len(roads), "radius_m": radius_m,
                "provider": "TomTom Traffic Flow + OpenStreetMap", "generated_at": utc_now().isoformat(),
            }
        # If the provider returned no segment readings, continue to the local
        # observation store below before settling for road names without flow.

    # When no TomTom key is configured, use only actual recent observations linked
    # to registered junctions. Never derive a traffic level from the simulation.
    lat_delta = radius_m / 111_000
    lon_delta = radius_m / max(1.0, 111_000 * math.cos(math.radians(latitude)))
    junctions = list(db.scalars(select(Junction).where(
        Junction.latitude.between(latitude - lat_delta, latitude + lat_delta),
        Junction.longitude.between(longitude - lon_delta, longitude + lon_delta),
    )))
    junctions = [j for j in junctions if _distance_meters(latitude, longitude, j.latitude, j.longitude) <= radius_m]
    junction_ids = [j.id for j in junctions]
    observations = []
    if junction_ids:
        cutoff = utc_now() - timedelta(minutes=30)
        observations = list(db.scalars(
            select(TrafficObservation)
            .where(TrafficObservation.junction_id.in_(junction_ids), TrafficObservation.observed_at >= cutoff)
            .order_by(TrafficObservation.observed_at.desc())
        ))
    latest_by_junction = {}
    for observation in observations:
        latest_by_junction.setdefault(observation.junction_id, observation)
    measured = []
    for junction in junctions:
        observation = latest_by_junction.get(junction.id)
        if not observation:
            continue
        current = float(observation.average_speed_kmph) if observation.average_speed_kmph is not None else None
        free_flow = float((junction.configuration or {}).get("free_flow_speed_kmph", 40)) if current is not None else None
        congestion = float(observation.congestion_score) if observation.congestion_score is not None else None
        status = ("Heavy" if congestion >= 70 else "Slow" if congestion >= 40 else "Moving") if congestion is not None else _road_status(current, free_flow)
        measured.append({
            "id": f"junction-{junction.id}", "road_name": junction.name, "road_type": "junction",
            "latitude": junction.latitude, "longitude": junction.longitude,
            "distance_meters": round(_distance_meters(latitude, longitude, junction.latitude, junction.longitude)),
            "current_speed_kmph": current, "free_flow_speed_kmph": free_flow,
            "congestion_percent": round(congestion, 1) if congestion is not None else None,
            "status": status, "vehicle_count": observation.vehicle_count,
            "queue_length_m": observation.queue_length_m, "provider": observation.source,
            "observed_at": observation.observed_at.isoformat(),
        })
    measured.sort(key=lambda item: (0 if item["status"] == "Heavy" else 1 if item["status"] == "Slow" else 2, item["distance_meters"]))
    measured_names = {item["road_name"].casefold() for item in measured}
    # Keep registered junction names visible even when no recent observation
    # exists, but never assign them a traffic category without a measurement.
    unmeasured_junctions = [{
        "id": f"junction-{junction.id}", "road_name": junction.name, "road_type": "junction",
        "latitude": junction.latitude, "longitude": junction.longitude,
        "distance_meters": round(_distance_meters(latitude, longitude, junction.latitude, junction.longitude)),
        "current_speed_kmph": None, "free_flow_speed_kmph": None,
        "congestion_percent": None, "status": "No reading", "vehicle_count": None,
        "queue_length_m": None, "provider": "UrbanSaarthi junction registry",
    } for junction in junctions if junction.name.casefold() not in measured_names]
    registered_names = measured_names | {item["road_name"].casefold() for item in unmeasured_junctions}
    unmeasured_osm = [{
        **road, "status": "No reading", "current_speed_kmph": None,
        "free_flow_speed_kmph": None, "congestion_percent": None,
        "provider": "OpenStreetMap",
    } for road in osm_roads if road["road_name"].casefold() not in registered_names]
    unmeasured_junctions.sort(key=lambda item: item["distance_meters"])
    roads = (measured + unmeasured_junctions + unmeasured_osm)[:12]
    return {
        "roads": roads, "count": len(roads), "radius_m": radius_m,
        "provider": "UrbanSaarthi junction observations" if measured else "OpenStreetMap",
        "generated_at": utc_now().isoformat(),
    }


@router.get("/current")
def current_traffic(latitude: float = Query(default=28.6139, ge=-90, le=90), longitude: float = Query(default=77.2090, ge=-180, le=180)):
    """Fetch a current road segment snapshot from TomTom when configured. The API key stays server side."""
    if not settings.tomtom_api_key:
        return {
            "provider": "UrbanSaarthi SUMO traffic model", "configured": False, "mode": "sumo_model",
            "message": "Showing a forecast from the supplied SUMO simulation model.",
            "latitude": latitude, "longitude": longitude, "observed_at": utc_now().isoformat(), "flow": None,
            "simulation": get_simulation_snapshot(),
        }
    url = "https://api.tomtom.com/traffic/services/4/flowSegmentData/relative/10/json"
    try:
        response = httpx.get(url, params={"point": f"{latitude},{longitude}", "key": settings.tomtom_api_key}, timeout=12)
        response.raise_for_status()
        payload = response.json().get("flowSegmentData") or {}
    except (httpx.HTTPError, ValueError):
        return {
            "provider": "UrbanSaarthi SUMO traffic model", "configured": False, "mode": "sumo_model",
            "message": "Showing a forecast from the supplied SUMO simulation model.",
            "latitude": latitude, "longitude": longitude, "observed_at": utc_now().isoformat(), "flow": None,
            "simulation": get_simulation_snapshot(),
        }
    return {
        "provider": "TomTom Traffic Flow", "configured": True, "mode": "provider",
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


@router.get("/simulation")
def traffic_simulation():
    """Forecast 30 minutes using the supplied SUMO dataset and trained model."""
    return get_simulation_snapshot()


@router.get("/simulation/scenario")
def traffic_simulation_scenario(minutes: int = Query(default=60, ge=15, le=60), step_minutes: int = Query(default=5, ge=1, le=15), scenario: str = Query(default="baseline", pattern="^(baseline|demand_surge|signal_priority)$")):
    """Return a multi-step forecast timeline for interactive 60-minute playback."""
    return get_simulation_scenario(minutes=minutes, step_minutes=step_minutes, scenario=scenario)


@router.get("/junctions", response_model=list[JunctionOut])
def list_junctions(db: Session = Depends(get_db), cluster_id: int | None = None, status_filter: str | None = Query(default=None, alias="status"), limit: int = 100, offset: int = 0):
    query = select(Junction).order_by(Junction.name)
    if cluster_id is not None:
        query = query.where(Junction.cluster_id == cluster_id)
    if status_filter:
        query = query.where(Junction.status == status_filter)
    return list(db.scalars(query.offset(max(0, offset)).limit(max(1, min(limit, 250)))))


@router.get("/junctions/{junction_id}", response_model=JunctionOut)
def get_junction(junction_id: int, db: Session = Depends(get_db)):
    junction = db.get(Junction, junction_id)
    if not junction:
        raise HTTPException(status_code=404, detail="Junction not found")
    return junction


@router.get("/junctions/{junction_id}/observations", response_model=list[TrafficObservationOut])
def junction_observations(junction_id: int, db: Session = Depends(get_db), limit: int = 50):
    if not db.get(Junction, junction_id):
        raise HTTPException(status_code=404, detail="Junction not found")
    return list(db.scalars(select(TrafficObservation).where(TrafficObservation.junction_id == junction_id).order_by(TrafficObservation.observed_at.desc()).limit(max(1, min(limit, 500)))))


@router.get("/overview")
def traffic_overview(db: Session = Depends(get_db)):
    now = utc_now()
    cutoff = now - timedelta(minutes=30)
    junction_count = db.scalar(select(func.count(Junction.id)) ) or 0
    active_junction_count = db.scalar(select(func.count(Junction.id)).where(Junction.status == "online")) or 0
    observations = list(db.scalars(select(TrafficObservation).where(TrafficObservation.observed_at >= cutoff).order_by(TrafficObservation.observed_at.desc()).limit(1000)))
    latest_by_junction: dict[int, TrafficObservation] = {}
    for row in observations:
        if row.junction_id is not None and row.junction_id not in latest_by_junction:
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
