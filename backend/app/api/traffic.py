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
from app.services.traffic_simulation import get_simulation_snapshot

router = APIRouter(prefix="/traffic", tags=["Traffic intelligence"])


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
    """Forecast the next 30 minutes using the supplied SUMO dataset and trained model."""
    return get_simulation_snapshot()


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
