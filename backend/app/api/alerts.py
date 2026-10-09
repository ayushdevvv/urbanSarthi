import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import CityAlert, Junction
from app.schemas import CityAlertCreateIn, ResolveAlertIn
from app.services.common import audit, utc_now

router = APIRouter(prefix="/alerts", tags=["City and service alerts"])


@router.get("")
def list_alerts(db: Session = Depends(get_db), status_filter: str | None = None, category: str | None = None, severity: str | None = None, limit: int = 100):
    query = select(CityAlert).order_by(CityAlert.created_at.desc())
    if status_filter:
        query = query.where(CityAlert.status == status_filter)
    if category:
        query = query.where(CityAlert.category == category)
    if severity:
        query = query.where(CityAlert.severity == severity)
    return list(db.scalars(query.limit(max(1, min(limit, 300)))))


@router.post("", status_code=201)
def create_alert(payload: CityAlertCreateIn, request: Request, db: Session = Depends(get_db)):
    if payload.junction_id is not None and not db.get(Junction, payload.junction_id):
        raise HTTPException(status_code=404, detail="Junction not found")
    if (payload.latitude is None) != (payload.longitude is None):
        raise HTTPException(status_code=422, detail="latitude and longitude must be supplied together")
    alert = CityAlert(public_id=str(uuid.uuid4()), created_by_user_id=None, starts_at=utc_now(), **payload.model_dump())
    db.add(alert)
    db.flush()
    audit(db, None, "alert.created", "city_alert", str(alert.id), {"severity": alert.severity, "category": alert.category}, request.client.host if request.client else None)
    db.commit()
    db.refresh(alert)
    return alert


@router.post("/{alert_id}/resolve")
def resolve_alert(alert_id: int, payload: ResolveAlertIn, request: Request, db: Session = Depends(get_db)):
    alert = db.get(CityAlert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if alert.status == "resolved":
        raise HTTPException(status_code=409, detail="Alert is already resolved")
    alert.status = "resolved"
    alert.resolution_note = payload.resolution_note
    audit(db, None, "alert.resolved", "city_alert", str(alert.id), {"resolution_note": payload.resolution_note}, request.client.host if request.client else None)
    db.commit()
    db.refresh(alert)
    return alert
