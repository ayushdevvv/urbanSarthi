from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.dependencies import require_ingestion_access
from app.models import Junction, TrafficObservation
from app.schemas import TrafficObservationIn
from app.services.common import audit, utc_now
from app.services.predictions import maybe_refresh_forecasts

router = APIRouter(prefix="/ingestion", tags=["Edge and provider ingestion"])


@router.post("/vision-events", status_code=201)
def ingest_vision_event(payload: TrafficObservationIn, request: Request, db: Session = Depends(get_db), actor=Depends(require_ingestion_access)):
    """Accept compact edge-computed detections from an external YOLO/CCTV worker; no video is uploaded."""
    junction = db.get(Junction, payload.junction_id) if payload.junction_id is not None else None
    if payload.external_junction_id:
        external = db.scalar(select(Junction).where(Junction.external_id == payload.external_junction_id))
        if external:
            junction = external
    if not junction:
        raise HTTPException(status_code=404, detail="Register the junction before sending vision events")
    row = TrafficObservation(
        junction_id=junction.id, external_junction_id=junction.external_id,
        source=payload.source if payload.source != "manual" else "camera-vision",
        observed_at=payload.observed_at or utc_now(), vehicle_count=payload.vehicle_count,
        queue_length_m=payload.queue_length_m, average_speed_kmph=payload.average_speed_kmph,
        average_wait_seconds=payload.average_wait_seconds, lane_density=payload.lane_density,
        congestion_score=payload.congestion_score, lane_demand=payload.lane_demand,
        detection_summary=payload.detection_summary,
    )
    db.add(row)
    db.flush()
    junction.status = "online"
    audit(db, getattr(actor, "id", None), "camera.vision_event_ingested", "junction", str(junction.id), {"source": row.source, "observation_id": row.id}, request.client.host if request.client else None)
    maybe_refresh_forecasts(db, junction.id)
    db.commit()
    db.refresh(row)
    return {"accepted": True, "observation_id": row.id, "junction_external_id": junction.external_id,
            "observed_at": row.observed_at.isoformat(), "video_stored": False,
            "note": "Send aggregated detections from an authorized edge worker; raw CCTV streams are not stored by this API."}

@router.post("/source-heartbeat")
def source_heartbeat(payload: dict, request: Request, db: Session = Depends(get_db), actor=Depends(require_ingestion_access)):
    """Authenticated edge-worker heartbeat; only successful ingestion can mark a source online."""
    from app.models import DataSource
    from app.services.common import utc_now
    external_id = str(payload.get("external_id") or "").strip()[:100]
    if len(external_id) < 2:
        raise HTTPException(status_code=422, detail="external_id is required")
    source = db.scalar(select(DataSource).where(DataSource.external_id == external_id))
    if source is None:
        raise HTTPException(status_code=404, detail="Register the source before sending a heartbeat")
    source.status = "online"
    source.last_success_at = utc_now()
    source.last_error = None
    audit(db, getattr(actor, "id", None), "data_source.device_heartbeat", "data_source", external_id,
          {"device": str(payload.get("device") or "edge-worker")[:120]}, request.client.host if request.client else None)
    db.commit()
    return {"external_id": external_id, "status": "online", "last_success_at": source.last_success_at.isoformat()}
