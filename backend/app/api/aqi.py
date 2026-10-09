from datetime import timedelta
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


@router.post("/observations", response_model=AqiObservationOut, status_code=201)
def ingest_aqi(payload: AqiObservationIn, request: Request, db: Session = Depends(get_db), actor=Depends(require_ingestion_access)):
    row = AqiObservation(**payload.model_dump(exclude={"observed_at"}), observed_at=payload.observed_at or utc_now())
    db.add(row)
    audit(db, getattr(actor, "id", None), "aqi.observation_ingested", "aqi_observation", None, {"station": payload.station_name, "source": payload.source}, request.client.host if request.client else None)
    db.commit()
    db.refresh(row)
    return row
