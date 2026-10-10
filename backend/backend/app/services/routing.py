from datetime import datetime, timedelta, timezone
from statistics import mean
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models import AqiObservation, TrafficObservation, TransitRoute, TransitStop, Trip, RouteOption
from app.services.common import haversine_m, utc_now
from app.services.gtfs import find_direct_transit_options


def _latest_traffic(db: Session) -> tuple[float, datetime | None]:
    cutoff = utc_now() - timedelta(minutes=30)
    observations = list(db.scalars(select(TrafficObservation).where(TrafficObservation.observed_at >= cutoff).order_by(TrafficObservation.observed_at.desc()).limit(100)))
    scores = [float(o.congestion_score) for o in observations if o.congestion_score is not None]
    return (mean(scores) if scores else 0.0, observations[0].observed_at if observations else None)


def _aqi_near_points(db: Session, points: list[tuple[float, float]]) -> tuple[float | None, int, datetime | None]:
    cutoff = utc_now() - timedelta(hours=3)
    stations = list(db.scalars(select(AqiObservation).where(AqiObservation.observed_at >= cutoff, AqiObservation.aqi.is_not(None)).order_by(AqiObservation.observed_at.desc()).limit(500)))
    if not stations:
        return None, 0, None
    samples: list[float] = []
    seen: set[int] = set()
    nearest_time = None
    for lat, lon in points:
        choices = sorted(((haversine_m(lat, lon, s.latitude, s.longitude), s) for s in stations), key=lambda x: x[0])
        if choices and choices[0][0] <= 20_000:
            station = choices[0][1]
            samples.append(float(station.aqi))
            seen.add(station.id)
            if nearest_time is None or station.observed_at > nearest_time:
                nearest_time = station.observed_at
    return (round(mean(samples), 1) if samples else None, len(seen), nearest_time)


def _congestion_penalty(db: Session) -> tuple[float, datetime | None]:
    score, at = _latest_traffic(db)
    return max(0.0, min(100.0, score)), at


def _estimation_route(mode: str, origin: tuple[float, float], dest: tuple[float, float], congestion: float) -> dict:
    direct = haversine_m(origin[0], origin[1], dest[0], dest[1])
    multipliers = {"driving": 1.28, "walking": 1.10, "cycling": 1.16}
    road_distance = max(150.0, direct * multipliers.get(mode, 1.2))
    if mode == "driving":
        speed = max(7.0, 32.0 * (1.0 - 0.006 * congestion))
        delay = int((road_distance / 1000.0) / 32.0 * 3600 * (congestion / 100.0) * 0.65)
        co2 = round((road_distance / 1000.0) * 120.0, 1)
    elif mode == "cycling":
        speed, delay, co2 = 15.0, 0, 0.0
    else:
        speed, delay, co2 = 4.5, 0, 0.0
    duration = max(60, int(road_distance / 1000.0 / speed * 3600) + delay)
    mode_label = {"driving": "Road route estimate", "walking": "Walking estimate", "cycling": "Cycling estimate"}[mode]
    return {
        "label": mode_label, "mode": mode, "duration_seconds": duration,
        "distance_meters": round(road_distance, 1), "traffic_delay_seconds": delay,
        "pollution_score": None, "estimated_aqi": None, "estimated_co2_grams": co2,
        "transfers": 0, "provider": "straight-line-heuristic", "data_quality": "estimated",
        "geometry": {"type": "LineString", "coordinates": [[origin[1], origin[0]], [dest[1], dest[0]]]},
        "itinerary": {"note": "Not turn-by-turn navigation. Configure OSRM_BASE_URL or another routing provider for road-network geometry."},
        "warnings": ["Fallback distance and time estimate; no road-network routing provider is configured."],
    }


def _osrm_routes(mode: str, origin: tuple[float, float], dest: tuple[float, float]) -> list[dict] | None:
    if mode != "driving" or not settings.osrm_base_url:
        return None
    base = settings.osrm_base_url.rstrip("/")
    url = f"{base}/route/v1/driving/{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
    try:
        response = httpx.get(url, params={"alternatives": "3", "overview": "full", "geometries": "geojson", "steps": "false"}, timeout=5.0)
        response.raise_for_status()
        payload = response.json()
        if payload.get("code") != "Ok" or not payload.get("routes"):
            return None
        output = []
        for i, route in enumerate(payload["routes"][:3]):
            distance = float(route.get("distance", 0.0))
            duration = int(float(route.get("duration", 0.0)))
            output.append({
                "label": ["Road route A", "Road route B", "Road route C"][i], "mode": "driving",
                "duration_seconds": duration, "distance_meters": distance, "traffic_delay_seconds": 0,
                "pollution_score": None, "estimated_aqi": None,
                "estimated_co2_grams": round(distance / 1000 * 120, 1), "transfers": 0,
                "provider": "osrm", "data_quality": "road-network-route",
                "geometry": route.get("geometry") or {},
                "itinerary": {"provider_summary": "OSRM route response; live traffic is not implied by a standard OSRM routing response."},
                "warnings": ["OSRM supplies road-network routing; live traffic adjustments require a traffic-aware provider."],
            })
        return output
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return None


def build_routes(db: Session, request, user_id: int | None = None) -> dict:
    origin = (request.origin_latitude, request.origin_longitude)
    dest = (request.destination_latitude, request.destination_longitude)
    congestion, latest_traffic_at = _congestion_penalty(db)
    aqi_cutoff = utc_now() - timedelta(hours=3)
    latest_aqi_at = db.scalar(select(AqiObservation.observed_at).where(AqiObservation.observed_at >= aqi_cutoff).order_by(AqiObservation.observed_at.desc()).limit(1))
    routes: list[dict] = []
    if "driving" in request.modes:
        external = _osrm_routes("driving", origin, dest)
        routes.extend(external if external else [_estimation_route("driving", origin, dest, congestion)])
    for mode in ("walking", "cycling"):
        if mode in request.modes:
            routes.append(_estimation_route(mode, origin, dest, congestion))
    transit_count_before = len(routes)
    if "transit" in request.modes:
        routes.extend(find_direct_transit_options(db, *origin, *dest, departure_at=request.departure_at))
    if "transit" in request.modes and len(routes) == transit_count_before:
        # An unavailable transit itinerary is a warning, not a fabricated route.
        transit_ready = bool(db.scalar(select(TransitRoute.id).limit(1))) and bool(db.scalar(select(TransitStop.id).where(TransitStop.latitude.is_not(None), TransitStop.longitude.is_not(None)).limit(1)))
        if not transit_ready:
            global_warnings = ["Transit route planning is awaiting a GTFS static feed and stop coordinates; no transit itinerary has been fabricated."]
        else:
            global_warnings = ["No valid direct GTFS journey was found near the selected origin/destination and departure time. Transfer routing is not enabled in this build."]
    else:
        global_warnings = []

    # Pollution is only reported when recent station observations exist near route points.
    for route in routes:
        coords = route.get("geometry", {}).get("coordinates") or []
        sample_points: list[tuple[float, float]] = [(origin[0], origin[1]), (dest[0], dest[1])]
        if len(coords) > 2:
            for index in (len(coords) // 3, 2 * len(coords) // 3):
                lon, lat = coords[index][:2]
                sample_points.append((lat, lon))
        aqi, station_count, sampled_at = _aqi_near_points(db, sample_points)
        if aqi is not None:
            route["estimated_aqi"] = aqi
            route["pollution_score"] = round(min(100.0, aqi / 5.0), 1)
            route["itinerary"] = {**route.get("itinerary", {}), "aqi_sample_station_count": station_count, "aqi_sampled_at": sampled_at.isoformat() if sampled_at else None, "pollution_metric": "mean of nearest recent station observations at route sample points; not personal exposure dosimetry"}
        elif route["mode"] == "transit":
            route["warnings"] = list(route.get("warnings", [])) + ["No recent AQI station was found within 20 km of sampled route points; pollution score omitted."]
        else:
            route["warnings"] = list(route.get("warnings", [])) + ["Recent location-relevant AQI is unavailable; pollution score omitted."]

    if request.preference == "fastest":
        routes.sort(key=lambda x: x["duration_seconds"])
    elif request.preference == "cleanest":
        routes.sort(key=lambda x: (x["pollution_score"] is None, x["pollution_score"] if x["pollution_score"] is not None else 9999, x["estimated_co2_grams"] if x["estimated_co2_grams"] is not None else 999999, x["duration_seconds"]))
    else:
        durations = [r["duration_seconds"] for r in routes] or [1]
        max_duration = max(durations)
        for route in routes:
            time_cost = route["duration_seconds"] / max_duration
            pollution = route["pollution_score"] / 100 if route["pollution_score"] is not None else time_cost
            route["_rank"] = 0.65 * time_cost + 0.35 * pollution
        routes.sort(key=lambda x: x.get("_rank", 0))
    for index, route in enumerate(routes):
        route["preference_rank"] = f"{request.preference}-#{index + 1}"
        route.pop("_rank", None)
    if not any(r["pollution_score"] is not None for r in routes):
        global_warnings.append("Clean-air comparison is limited because no recent AQI observations cover the route area.")
    if not routes:
        global_warnings.append("No route option could be generated for the selected modes. Configure a routing provider or add a supported route mode.")

    trip = None
    if user_id is not None:
        import uuid
        trip = Trip(
            public_id=str(uuid.uuid4()), user_id=user_id,
            origin_label=request.origin_label, destination_label=request.destination_label,
            origin_latitude=request.origin_latitude, origin_longitude=request.origin_longitude,
            destination_latitude=request.destination_latitude, destination_longitude=request.destination_longitude,
            preference=request.preference, status="planned",
        )
        db.add(trip)
        db.flush()
        for option in routes:
            db.add(RouteOption(trip_id=trip.id, **option))
        db.commit()
        db.refresh(trip)
        stored = list(db.scalars(select(RouteOption).where(RouteOption.trip_id == trip.id).order_by(RouteOption.id)))
        routes = []
        for stored_route in stored:
            routes.append({
                "id": stored_route.id, "label": stored_route.label, "mode": stored_route.mode,
                "preference_rank": stored_route.preference_rank, "duration_seconds": stored_route.duration_seconds,
                "distance_meters": stored_route.distance_meters, "traffic_delay_seconds": stored_route.traffic_delay_seconds,
                "pollution_score": stored_route.pollution_score, "estimated_aqi": stored_route.estimated_aqi,
                "estimated_co2_grams": stored_route.estimated_co2_grams, "transfers": stored_route.transfers,
                "provider": stored_route.provider, "data_quality": stored_route.data_quality,
                "geometry": stored_route.geometry, "itinerary": stored_route.itinerary, "warnings": stored_route.warnings,
            })
    else:
        routes = [{"id": None, **r} for r in routes]

    return {
        "trip_id": trip.id if trip else None, "public_trip_id": trip.public_id if trip else None,
        "preference": request.preference, "routes": routes,
        "data_freshness": {
            "traffic_last_observed_at": latest_traffic_at.isoformat() if latest_traffic_at else None,
            "aqi_last_observed_at": latest_aqi_at.isoformat() if latest_aqi_at else None,
            "routing_provider": "OSRM configured" if settings.osrm_base_url else "heuristic fallback for road/walk/cycle",
            "aqi_max_age_minutes": 180,
        },
        "warnings": global_warnings,
    }
