from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.dependencies import require_roles
from app.models import DataSource, Junction, User
from app.schemas import DataSourceOut, DataSourceUpsertIn, UserOut, UserRoleChangeIn
from app.services.common import audit, utc_now

router = APIRouter(prefix="/admin", tags=["Platform administration"])


@router.get("/data-sources", response_model=list[DataSourceOut])
def list_data_sources(db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    return list(db.scalars(select(DataSource).order_by(DataSource.source_type, DataSource.name)))


@router.post("/data-sources", response_model=DataSourceOut)
def upsert_data_source(payload: DataSourceUpsertIn, request: Request, db: Session = Depends(get_db), user=Depends(require_roles("admin"))):
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
    audit(db, user.id, "data_source.upserted", "data_source", payload.external_id, {"status": payload.status, "source_type": payload.source_type}, request.client.host if request.client else None)
    db.commit()
    db.refresh(row)
    return row


@router.post("/data-sources/{external_id}/heartbeat")
def source_heartbeat(external_id: str, request: Request, status_value: str = "online", error: str | None = None, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
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
    audit(db, user.id, "data_source.heartbeat", "data_source", external_id, {"status": status_value}, request.client.host if request.client else None)
    db.commit()
    db.refresh(row)
    return {"external_id": row.external_id, "status": row.status, "last_success_at": row.last_success_at.isoformat() if row.last_success_at else None}


@router.patch("/junctions/{junction_id}/status")
def set_junction_status(junction_id: int, status_value: str, request: Request, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    junction = db.get(Junction, junction_id)
    if not junction:
        raise HTTPException(status_code=404, detail="Junction not found")
    if status_value not in {"online", "degraded", "offline", "unknown"}:
        raise HTTPException(status_code=422, detail="Invalid junction status")
    junction.status = status_value
    audit(db, user.id, "junction.status_changed", "junction", str(junction.id), {"status": status_value}, request.client.host if request.client else None)
    db.commit()
    return {"id": junction.id, "external_id": junction.external_id, "status": junction.status}


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), user=Depends(require_roles("admin")), limit: int = 100, offset: int = 0):
    return list(db.scalars(select(User).order_by(User.created_at.desc()).offset(max(0, offset)).limit(max(1, min(limit, 250)))))


@router.patch("/users/{user_id}/role", response_model=UserOut)
def change_user_role(user_id: int, payload: UserRoleChangeIn, request: Request, db: Session = Depends(get_db), user=Depends(require_roles("admin"))):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == user.id:
        raise HTTPException(status_code=409, detail="You cannot change your own role")
    previous = target.role
    target.role = payload.role
    audit(db, user.id, "user.role_changed", "user", str(target.id), {"previous_role": previous, "new_role": target.role}, request.client.host if request.client else None)
    db.commit()
    db.refresh(target)
    return target
