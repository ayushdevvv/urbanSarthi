from datetime import datetime, timezone
import httpx
from fastapi import Query
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.dependencies import get_current_user, get_optional_user
from app.models import RouteOption, Trip, User
from app.schemas import RoutePlanIn, RoutePlanOut, TripOut
from app.services.common import audit
from app.services.routing import build_routes

router = APIRouter(tags=["Citizen mobility"])


@router.post("/routing/plan", response_model=RoutePlanOut)
def plan_route(payload: RoutePlanIn, db: Session = Depends(get_db), user: User | None = Depends(get_optional_user)):
    result = build_routes(db, payload, user.id if user else None)
    return result


@router.get("/routing/geocode")
def geocode_location(q: str = Query(min_length=2, max_length=180), limit: int = Query(default=5, ge=1, le=8)):
    """Search for a place using OpenStreetMap's public geocoder."""
    try:
        response = httpx.get("https://nominatim.openstreetmap.org/search", params={"q": q, "format": "jsonv2", "addressdetails": 1, "limit": limit}, headers={"User-Agent": "UrbanSaarthi/1.0 (location search)"}, timeout=8.0)
        response.raise_for_status()
        payload = response.json()
        return {"results": [{"label": item.get("display_name", q), "latitude": float(item["lat"]), "longitude": float(item["lon"]), "type": item.get("type"), "category": item.get("category"), "place_id": item.get("place_id")} for item in payload if item.get("lat") and item.get("lon")], "provider": "OpenStreetMap Nominatim"}
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        raise HTTPException(status_code=503, detail="Place search is temporarily unavailable. Try a more specific place name or enter coordinates.") from exc


@router.get("/routing/reverse-geocode")
def reverse_geocode(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180)):
    try:
        response = httpx.get("https://nominatim.openstreetmap.org/reverse", params={"lat": latitude, "lon": longitude, "format": "jsonv2", "zoom": 16}, headers={"User-Agent": "UrbanSaarthi/1.0 (location search)"}, timeout=8.0)
        response.raise_for_status()
        item = response.json()
        address = item.get("address") or {}
        label = address.get("amenity") or address.get("road") or address.get("suburb") or address.get("city_district") or address.get("city") or address.get("town") or address.get("village") or item.get("display_name") or f"{latitude:.5f}, {longitude:.5f}"
        return {"label": label, "display_name": item.get("display_name", label), "latitude": latitude, "longitude": longitude, "address": address}
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        raise HTTPException(status_code=503, detail="Location name lookup is temporarily unavailable.") from exc


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import asin, cos, radians, sin, sqrt
    dlat, dlon = radians(lat2-lat1), radians(lon2-lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1))*cos(radians(lat2))*sin(dlon/2)**2
    return 6371 * 2 * asin(sqrt(min(1, a)))


@router.get("/routing/nearby-places")
def nearby_places(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180), radius_m: int = Query(default=2500, ge=250, le=10000), kind: str = Query(default="all", pattern="^(all|food|health|sights|essentials)$", max_length=20)):
    """Find real mapped places around the selected location."""
    tag_filters = {
        "all": '("amenity"~"restaurant|cafe|hospital|pharmacy|fuel|toilets|bank|atm|police|marketplace")',
        "food": '("amenity"~"restaurant|cafe|fast_food")',
        "health": '("amenity"~"hospital|clinic|pharmacy")',
        "sights": '("tourism"~"attraction|museum|viewpoint|monument")',
        "essentials": '("amenity"~"fuel|toilets|bank|atm|police|marketplace")',
    }
    filter_text = tag_filters[kind]
    query = f"[out:json][timeout:12];(node(around:{radius_m},{latitude},{longitude}){filter_text};way(around:{radius_m},{latitude},{longitude}){filter_text};);out center tags 60;"
    for endpoint in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
        try:
            response = httpx.post(endpoint, data={"data": query}, headers={"User-Agent": "UrbanSaarthi/1.0 (nearby places)"}, timeout=13.0)
            response.raise_for_status()
            elements = response.json().get("elements", [])
            items = []
            for element in elements:
                tags = element.get("tags") or {}
                center = element.get("center") or {}
                lat = element.get("lat", center.get("lat")); lon = element.get("lon", center.get("lon"))
                if lat is None or lon is None: continue
                name = tags.get("name") or tags.get("brand") or tags.get("amenity") or tags.get("tourism") or "Nearby place"
                category = tags.get("amenity") or tags.get("tourism") or tags.get("shop") or "place"
                items.append({"id": f"osm-{element.get('type')}-{element.get('id')}", "name": name, "category": category, "latitude": float(lat), "longitude": float(lon), "operator": tags.get("operator"), "opening_hours": tags.get("opening_hours"), "distance_meters": round(_haversine_km(latitude, longitude, float(lat), float(lon))*1000), "source": "OpenStreetMap"})
            items.sort(key=lambda item: item["distance_meters"])
            # An empty response from one public Overpass instance does not mean
            # the area has no mapped amenities; try the next instance first.
            if items:
                return {"places": items[:60], "count": len(items[:60]), "radius_m": radius_m, "provider": "OpenStreetMap", "generated_at": datetime.now(timezone.utc).isoformat()}
        except (httpx.HTTPError, ValueError, TypeError):
            continue
    return {"places": [], "count": 0, "radius_m": radius_m, "provider": "OpenStreetMap", "generated_at": datetime.now(timezone.utc).isoformat(), "message": "No mapped places were returned nearby. Try a wider search radius."}


@router.get("/trips", response_model=list[TripOut])
def my_trips(db: Session = Depends(get_db), user: User = Depends(get_current_user), limit: int = 50, offset: int = 0):
    limit = max(1, min(limit, 100))
    return list(db.scalars(select(Trip).where(Trip.user_id == user.id).order_by(Trip.created_at.desc()).offset(offset).limit(limit)))


@router.get("/trips/{trip_id}", response_model=TripOut)
def trip_detail(trip_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trip = db.scalar(select(Trip).where(Trip.id == trip_id, Trip.user_id == user.id))
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip


@router.get("/trips/{trip_id}/routes")
def trip_routes(trip_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trip = db.scalar(select(Trip).where(Trip.id == trip_id, Trip.user_id == user.id))
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return list(db.scalars(select(RouteOption).where(RouteOption.trip_id == trip_id).order_by(RouteOption.id)))


@router.post("/trips/{trip_id}/select-route", response_model=TripOut)
def select_route(trip_id: int, route_option_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trip = db.scalar(select(Trip).where(Trip.id == trip_id, Trip.user_id == user.id))
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    option = db.scalar(select(RouteOption).where(RouteOption.id == route_option_id, RouteOption.trip_id == trip.id))
    if not option:
        raise HTTPException(status_code=404, detail="Route option does not belong to this trip")
    trip.selected_route_id = option.id
    trip.distance_meters = option.distance_meters
    trip.duration_seconds = option.duration_seconds
    audit(db, user.id, "trip.route_selected", "trip", str(trip.id), {"route_option_id": option.id}, request.client.host if request.client else None)
    db.commit()
    db.refresh(trip)
    return trip


@router.post("/trips/{trip_id}/start", response_model=TripOut)
def start_trip(trip_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trip = db.scalar(select(Trip).where(Trip.id == trip_id, Trip.user_id == user.id))
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if trip.status == "completed" or trip.status == "cancelled":
        raise HTTPException(status_code=409, detail=f"Cannot start a {trip.status} trip")
    trip.status = "in_progress"
    trip.started_at = datetime.now(timezone.utc)
    audit(db, user.id, "trip.started", "trip", str(trip.id), {}, request.client.host if request.client else None)
    db.commit()
    db.refresh(trip)
    return trip


@router.post("/trips/{trip_id}/complete", response_model=TripOut)
def complete_trip(trip_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trip = db.scalar(select(Trip).where(Trip.id == trip_id, Trip.user_id == user.id))
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if trip.status not in {"planned", "in_progress"}:
        raise HTTPException(status_code=409, detail=f"Cannot complete a {trip.status} trip")
    trip.status = "completed"
    trip.completed_at = datetime.now(timezone.utc)
    audit(db, user.id, "trip.completed", "trip", str(trip.id), {}, request.client.host if request.client else None)
    db.commit()
    db.refresh(trip)
    return trip


@router.post("/trips/{trip_id}/cancel", response_model=TripOut)
def cancel_trip(trip_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trip = db.scalar(select(Trip).where(Trip.id == trip_id, Trip.user_id == user.id))
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if trip.status == "completed":
        raise HTTPException(status_code=409, detail="Completed trip cannot be cancelled")
    trip.status = "cancelled"
    audit(db, user.id, "trip.cancelled", "trip", str(trip.id), {}, request.client.host if request.client else None)
    db.commit()
    db.refresh(trip)
    return trip
