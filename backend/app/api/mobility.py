from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.demo_workspace import get_demo_workspace_user
from app.models import RouteOption, Trip
from app.schemas import RoutePlanIn, RoutePlanOut, TripOut
from app.services.common import audit
from app.services.routing import build_routes

router = APIRouter(tags=["Citizen mobility"])


@router.post("/routing/plan", response_model=RoutePlanOut)
def plan_route(payload: RoutePlanIn, db: Session = Depends(get_db)):
    # The internal workspace owner preserves the existing trip/route foreign keys;
    # the API has no login, authorization header, account session, or role check.
    workspace_user = get_demo_workspace_user(db)
    return build_routes(db, payload, workspace_user.id)


@router.get("/trips", response_model=list[TripOut])
def list_trips(db: Session = Depends(get_db), limit: int = 50, offset: int = 0):
    workspace_user = get_demo_workspace_user(db)
    limit = max(1, min(limit, 100))
    return list(db.scalars(select(Trip).where(Trip.user_id == workspace_user.id).order_by(Trip.created_at.desc()).offset(max(0, offset)).limit(limit)))


def _workspace_trip(db: Session, trip_id: int) -> Trip:
    workspace_user = get_demo_workspace_user(db)
    trip = db.scalar(select(Trip).where(Trip.id == trip_id, Trip.user_id == workspace_user.id))
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip


@router.get("/trips/{trip_id}", response_model=TripOut)
def trip_detail(trip_id: int, db: Session = Depends(get_db)):
    return _workspace_trip(db, trip_id)


@router.get("/trips/{trip_id}/routes")
def trip_routes(trip_id: int, db: Session = Depends(get_db)):
    trip = _workspace_trip(db, trip_id)
    return list(db.scalars(select(RouteOption).where(RouteOption.trip_id == trip.id).order_by(RouteOption.id)))


@router.post("/trips/{trip_id}/select-route", response_model=TripOut)
def select_route(trip_id: int, route_option_id: int, request: Request, db: Session = Depends(get_db)):
    trip = _workspace_trip(db, trip_id)
    option = db.scalar(select(RouteOption).where(RouteOption.id == route_option_id, RouteOption.trip_id == trip.id))
    if not option:
        raise HTTPException(status_code=404, detail="Route option does not belong to this trip")
    trip.selected_route_id = option.id
    trip.distance_meters = option.distance_meters
    trip.duration_seconds = option.duration_seconds
    audit(db, None, "trip.route_selected", "trip", str(trip.id), {"route_option_id": option.id}, request.client.host if request.client else None)
    db.commit()
    db.refresh(trip)
    return trip


@router.post("/trips/{trip_id}/start", response_model=TripOut)
def start_trip(trip_id: int, request: Request, db: Session = Depends(get_db)):
    trip = _workspace_trip(db, trip_id)
    if trip.status == "completed" or trip.status == "cancelled":
        raise HTTPException(status_code=409, detail=f"Cannot start a {trip.status} trip")
    trip.status = "in_progress"
    trip.started_at = datetime.now(timezone.utc)
    audit(db, None, "trip.started", "trip", str(trip.id), {}, request.client.host if request.client else None)
    db.commit()
    db.refresh(trip)
    return trip


@router.post("/trips/{trip_id}/complete", response_model=TripOut)
def complete_trip(trip_id: int, request: Request, db: Session = Depends(get_db)):
    trip = _workspace_trip(db, trip_id)
    if trip.status not in {"planned", "in_progress"}:
        raise HTTPException(status_code=409, detail=f"Cannot complete a {trip.status} trip")
    trip.status = "completed"
    trip.completed_at = datetime.now(timezone.utc)
    audit(db, None, "trip.completed", "trip", str(trip.id), {}, request.client.host if request.client else None)
    db.commit()
    db.refresh(trip)
    return trip


@router.post("/trips/{trip_id}/cancel", response_model=TripOut)
def cancel_trip(trip_id: int, request: Request, db: Session = Depends(get_db)):
    trip = _workspace_trip(db, trip_id)
    if trip.status == "completed":
        raise HTTPException(status_code=409, detail="Completed trip cannot be cancelled")
    trip.status = "cancelled"
    audit(db, None, "trip.cancelled", "trip", str(trip.id), {}, request.client.host if request.client else None)
    db.commit()
    db.refresh(trip)
    return trip
