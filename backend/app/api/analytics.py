from datetime import timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.db import get_db
from app.demo_workspace import get_demo_workspace_user
from app.models import TicketOrder, Trip
from app.services.common import utc_now

router = APIRouter(prefix="/analytics", tags=["Mobility analytics"])


@router.get("/my-mobility")
def my_mobility_analytics(db: Session = Depends(get_db)):
    workspace_user = get_demo_workspace_user(db)
    trips = list(db.scalars(select(Trip).where(Trip.user_id == workspace_user.id)))
    completed = [trip for trip in trips if trip.status == "completed"]
    distance = sum(trip.distance_meters or 0 for trip in completed)
    duration = sum(trip.duration_seconds or 0 for trip in completed)
    ticket_orders = db.scalar(select(func.count(TicketOrder.id)).where(TicketOrder.user_id == workspace_user.id)) or 0
    return {
        "total_trips": len(trips), "completed_trips": len(completed),
        "in_progress_trips": sum(trip.status == "in_progress" for trip in trips),
        "recorded_distance_km": round(distance / 1000, 2),
        "recorded_travel_hours": round(duration / 3600, 2), "ticket_requests": ticket_orders,
        "emissions_note": "Shared demo workspace records; CO₂ estimates are illustrative and not audited savings.",
    }


@router.get("/city-summary")
def city_summary(db: Session = Depends(get_db), days: int = 7):
    days = max(1, min(days, 90))
    cutoff = utc_now() - timedelta(days=days)
    trips = list(db.scalars(select(Trip).where(Trip.created_at >= cutoff)))
    return {
        "period_days": days, "trip_requests": len(trips),
        "completed_trips": sum(trip.status == "completed" for trip in trips),
        "cancelled_trips": sum(trip.status == "cancelled" for trip in trips),
        "recorded_route_distance_km": round(sum(trip.distance_meters or 0 for trip in trips) / 1000, 2),
        "note": "Shared demo workspace records; seeded trips are synthetic and do not represent city-wide demand.",
    }
