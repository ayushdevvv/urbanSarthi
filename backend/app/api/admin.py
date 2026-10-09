from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import DataSource, Junction
from app.schemas import DataSourceOut, DataSourceUpsertIn
from app.services.common import audit, utc_now

router = APIRouter(prefix="/admin", tags=["Platform administration"])


@router.get("/data-sources", response_model=list[DataSourceOut])
def list_data_sources(db: Session = Depends(get_db)):
    return list(db.scalars(select(DataSource).order_by(DataSource.source_type, DataSource.name)))


@router.post("/data-sources", response_model=DataSourceOut)
def upsert_data_source(payload: DataSourceUpsertIn, request: Request, db: Session = Depends(get_db)):
    row = db.scalar(select(DataSource).where(DataSource.external_id == payload.external_id))
    if row is None:
        row = DataSource(**payload.model_dump())
        db.add(row)
    else:
        for key, value in payload.model_dump().items():
            setattr(row, key, value)
    if payload.status == "online":
        row.last_success_at = utc_now()
        row.last_error = None
    audit(db, None, "data_source.upserted", "data_source", payload.external_id, {"status": payload.status, "source_type": payload.source_type}, request.client.host if request.client else None)
    db.commit()
    db.refresh(row)
    return row


@router.post("/data-sources/{external_id}/heartbeat")
def source_heartbeat(external_id: str, request: Request, status_value: str = "online", error: str | None = None, db: Session = Depends(get_db)):
    row = db.scalar(select(DataSource).where(DataSource.external_id == external_id))
    if not row:
        raise HTTPException(status_code=404, detail="Data source not found")
    if status_value not in {"online", "degraded", "offline", "not_configured", "unknown"}:
        raise HTTPException(status_code=422, detail="Invalid data source status")
    row.status = status_value
    if status_value == "online":
        row.last_success_at = utc_now()
        row.last_error = None
    elif error:
        row.last_error = error[:2000]
    audit(db, None, "data_source.heartbeat", "data_source", external_id, {"status": status_value}, request.client.host if request.client else None)
    db.commit()
    db.refresh(row)
    return {"external_id": row.external_id, "status": row.status, "last_success_at": row.last_success_at.isoformat() if row.last_success_at else None}


@router.patch("/junctions/{junction_id}/status")
def set_junction_status(junction_id: int, status_value: str, request: Request, db: Session = Depends(get_db)):
    junction = db.get(Junction, junction_id)
    if not junction:
        raise HTTPException(status_code=404, detail="Junction not found")
    if status_value not in {"online", "degraded", "offline", "unknown"}:
        raise HTTPException(status_code=422, detail="Invalid junction status")
    junction.status = status_value
    audit(db, None, "junction.status_changed", "junction", str(junction.id), {"status": status_value}, request.client.host if request.client else None)
    db.commit()
    return {"id": junction.id, "external_id": junction.external_id, "status": junction.status}


