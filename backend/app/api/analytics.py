from datetime import timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.db import get_db
from app.dependencies import get_current_user, require_roles
from app.models import RouteOption, TicketOrder, Trip, User
from app.services.common import utc_now

router = APIRouter(prefix="/analytics", tags=["Mobility analytics"])


@router.get("/my-mobility")
def my_mobility_analytics(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trips = list(db.scalars(select(Trip).where(Trip.user_id == user.id)))
    completed = [t for t in trips if t.status == "completed"]
    distance = sum(t.distance_meters or 0 for t in completed)
    duration = sum(t.duration_seconds or 0 for t in completed)
    ticket_orders = db.scalar(select(func.count(TicketOrder.id)).where(TicketOrder.user_id == user.id)) or 0
    return {"total_trips": len(trips), "completed_trips": len(completed), "in_progress_trips": sum(t.status == "in_progress" for t in trips),
            "recorded_distance_km": round(distance / 1000, 2), "recorded_travel_hours": round(duration / 3600, 2),
            "ticket_requests": ticket_orders,
            "emissions_note": "Route CO2 values are estimates attached to route options, not audited emissions or verified savings."}


@router.get("/city-summary")
def city_summary(db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin")), days: int = 7):
    days = max(1, min(days, 90))
    cutoff = utc_now() - timedelta(days=days)
    trips = list(db.scalars(select(Trip).where(Trip.created_at >= cutoff)))
    return {"period_days": days, "trip_requests": len(trips), "completed_trips": sum(t.status == "completed" for t in trips),
            "cancelled_trips": sum(t.status == "cancelled" for t in trips),
            "recorded_route_distance_km": round(sum(t.distance_meters or 0 for t in trips) / 1000, 2),
            "note": "Anonymous trip planning requests are not persisted, and these metrics reflect only registered users' saved trips."}
