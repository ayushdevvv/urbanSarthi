from datetime import timedelta
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


@router.get("/simulation")
def traffic_simulation():
    """Forecast 30 minutes using the supplied SUMO dataset and trained model."""
    return get_simulation_snapshot()


@router.get("/simulation/scenario")
def traffic_simulation_scenario(minutes: int = Query(default=60, ge=15, le=60), step_minutes: int = Query(default=5, ge=1, le=15), scenario: str = Query(default="baseline", pattern="^(baseline|demand_surge|signal_priority)$")):
    """Return a multi-step forecast timeline for interactive 60-minute playback."""
    return get_simulation_scenario(minutes=minutes, step_minutes=step_minutes, scenario=scenario)


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
