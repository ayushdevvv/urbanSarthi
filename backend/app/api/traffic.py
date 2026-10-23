from datetime import timedelta
from pydantic import BaseModel, Field
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


class TrafficWhatIfInput(BaseModel):
    north_south_green_seconds: int = Field(default=34, ge=10, le=90)
    east_west_green_seconds: int = Field(default=22, ge=10, le=90)
    yellow_seconds: int = Field(default=3, ge=2, le=8)
    all_red_seconds: int = Field(default=1, ge=0, le=5)
    demand_factor: float = Field(default=1.0, ge=0.5, le=2.0)
    duration_minutes: int = Field(default=60, ge=15, le=60)



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
    coordinate_block = payload.get("coordinates") or {}
    coordinate_list = coordinate_block.get("coordinate") if isinstance(coordinate_block, dict) else []
    geometry = [
        {"lat": float(item["latitude"]), "lng": float(item["longitude"])}
        for item in (coordinate_list or [])
        if isinstance(item, dict) and item.get("latitude") is not None and item.get("longitude") is not None
    ]
    return {
        "provider": "TomTom Traffic Flow", "configured": True, "mode": "provider",
        "latitude": latitude, "longitude": longitude, "observed_at": utc_now().isoformat(),
        "flow": {
            "current_speed_kmph": payload.get("currentSpeed"),
            "free_flow_speed_kmph": payload.get("freeFlowSpeed"),
            "current_travel_time_seconds": payload.get("currentTravelTime"),
            "free_flow_travel_time_seconds": payload.get("freeFlowTravelTime"),
            "confidence": payload.get("confidence"), "road_closed": payload.get("roadClosure"),
            "frc": payload.get("frc"), "geometry": geometry,
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


@router.post("/simulation/what-if")
def traffic_what_if(payload: TrafficWhatIfInput):
    """Parameterised what-if estimate grounded in the supplied SUMO-trained queue forecasts.

    This transforms the trained forecast by explicit green-time/demand sensitivity factors;
    it does not launch a fresh SUMO/TraCI process or issue physical signal commands.
    """
    try:
        base = get_simulation_scenario(minutes=payload.duration_minutes, step_minutes=5, scenario="baseline")
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The trained traffic forecast is unavailable. Confirm the simulation model dependencies and artifacts.") from exc

    ns = float(payload.north_south_green_seconds)
    ew = float(payload.east_west_green_seconds)
    green_total = max(ns + ew, 1.0)
    # Reference timing 34s / 22s is normalised to factor 1.0. These factors are sensitivity assumptions, not calibrated control outcomes.
    reference_total = 56.0
    reference_ns_share = 34.0 / reference_total
    clearance_seconds = (2.0 * float(payload.yellow_seconds)) + (2.0 * float(payload.all_red_seconds))
    reference_cycle = reference_total + 8.0  # reference is 34/22 green + two 3s yellow + two 1s all-red
    green_capacity_factor = (reference_cycle / max(green_total + clearance_seconds, 1.0)) ** 0.45
    distribution_penalty = 1.0 + 0.65 * abs((ns / green_total) - reference_ns_share)
    signal_factor = max(0.62, min(1.48, green_capacity_factor * distribution_penalty))
    impact_factor = payload.demand_factor * signal_factor

    base_timeline = base["timeline"]
    current_roads = {str(road["road"]): float(road.get("queue", 0)) for road in (base_timeline[0].get("roads") or [])}
    proposed_timeline = []
    for frame in base_timeline:
        adjusted_roads = []
        for road in frame.get("roads") or []:
            name = str(road["road"])
            start_queue = current_roads.get(name, float(road.get("queue", 0)))
            model_queue = float(road.get("queue", 0))
            queue = max(0.0, start_queue + (model_queue - start_queue) * impact_factor)
            level = "Free" if queue < 3 else "Moderate" if queue < 10 else "Heavy"
            adjusted_roads.append({**road, "queue": round(queue, 1), "level": level})
        total = sum(r["queue"] for r in adjusted_roads)
        proposed_timeline.append({**frame, "queue_total": round(total), "heavy_roads": sum(r["level"] == "Heavy" for r in adjusted_roads), "moderate_roads": sum(r["level"] == "Moderate" for r in adjusted_roads), "free_roads": sum(r["level"] == "Free" for r in adjusted_roads), "roads": adjusted_roads})

    first = proposed_timeline[0]
    last = proposed_timeline[-1]
    base_last = base_timeline[-1]
    base_wait = 12.0 + (float(base_last["queue_total"]) / max(len(base_last.get("roads") or []), 1)) * 1.1
    proposed_wait = 12.0 + (float(last["queue_total"]) / max(len(last.get("roads") or []), 1)) * 1.1
    base_vehicles = max(1, int(base_last.get("vehicles") or 1))
    proposed_throughput = max(0, round(base_vehicles / max(impact_factor, 0.25)))
    base_throughput = base_vehicles
    return {
        "mode": "trained_model_what_if", "engine": "SUMO-trained XGBoost forecast + signal sensitivity layer",
        "fresh_sumo_run": False, "physical_signal_control": False,
        "assumptions": {"north_south_green_seconds": payload.north_south_green_seconds, "east_west_green_seconds": payload.east_west_green_seconds, "yellow_seconds": payload.yellow_seconds, "all_red_seconds": payload.all_red_seconds, "demand_factor": payload.demand_factor, "duration_minutes": payload.duration_minutes, "signal_sensitivity_factor": round(signal_factor, 3), "combined_impact_factor": round(impact_factor, 3)},
        "baseline": {"queue_start": base_timeline[0]["queue_total"], "queue_end": base_last["queue_total"], "average_wait_seconds_estimate": round(base_wait, 1), "throughput_index": base_throughput, "heavy_roads_end": base_last["heavy_roads"]},
        "proposed": {"queue_start": first["queue_total"], "queue_end": last["queue_total"], "queue_change_percent": round((last["queue_total"] - base_last["queue_total"]) / max(base_last["queue_total"], 1) * 100, 1), "average_wait_seconds_estimate": round(proposed_wait, 1), "throughput_index": proposed_throughput, "heavy_roads_end": last["heavy_roads"]},
        "timeline": proposed_timeline, "baseline_timeline": base_timeline,
        "notes": ["Queue trends originate from the supplied SUMO-generated training dataset and XGBoost forecasts.", "Signal timing changes are applied through an explicit sensitivity layer; this is an analytical what-if estimate, not a fresh microscopic SUMO/TraCI simulation.", "Average wait and throughput are derived comparison indicators, not independently validated field measurements."],
    }


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
