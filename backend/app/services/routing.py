from datetime import datetime, timedelta, timezone
from statistics import mean
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models import AqiObservation, TrafficObservation, TransitRoute, TransitStop, Trip, RouteOption
from app.services.common import haversine_m, utc_now
from app.services.gtfs import find_direct_transit_options
from app.services.emissions import VEHICLE_PROFILES


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



def _route_co2_estimate(distance_meters: float, mode: str) -> float | None:
    """Estimate route tailpipe CO2 using the project's transparent vehicle proxy.

    Driving uses the passenger petrol BS-VI proxy (6.5 L/100 km and the
    configured petrol combustion factor). Walking/cycling have zero tailpipe
    emissions; transit remains unavailable until an occupancy/fuel mix is known.
    This is a comparison estimate, not a measured or speed-adjusted result.
    """
    if mode in {"walking", "cycling"}:
        return 0.0
    if mode != "driving":
        return None
    profile = VEHICLE_PROFILES["car"]
    grams_per_km = (
        float(profile["fuel_consumption_per_100km"]) / 100.0
        * float(profile["co2_g_per_fuel_unit"])
    )
    return round(max(0.0, float(distance_meters)) / 1000.0 * grams_per_km, 1)

def _estimation_route(mode: str, origin: tuple[float, float], dest: tuple[float, float], congestion: float) -> dict:
    """Conservative estimate used only when every road-routing provider is unavailable.

    Deliberately omits geometry: drawing a straight line as though it were a road route
    would be misleading. The frontend can still show the origin and destination pins.
    """
    direct = haversine_m(origin[0], origin[1], dest[0], dest[1])
    multipliers = {"driving": 1.28, "walking": 1.10, "cycling": 1.16, "transit": 1.3}
    road_distance = max(150.0, direct * multipliers.get(mode, 1.2))
    if mode == "driving":
        speed = max(7.0, 32.0 * (1.0 - 0.006 * congestion))
        delay = int((road_distance / 1000.0) / 32.0 * 3600 * (congestion / 100.0) * 0.65)
        co2 = _route_co2_estimate(road_distance, mode)
    elif mode == "cycling":
        speed, delay, co2 = 15.0, 0, _route_co2_estimate(road_distance, mode)
    else:
        speed, delay, co2 = 4.5, 0, _route_co2_estimate(road_distance, mode)
    duration = max(60, int(road_distance / 1000.0 / speed * 3600) + delay)
    mode_label = {"driving": "Road route estimate", "walking": "Walking estimate", "cycling": "Cycling estimate", "transit": "Transit estimate"}[mode]
    return {
        "label": mode_label, "mode": mode, "duration_seconds": duration,
        "distance_meters": round(road_distance, 1), "traffic_delay_seconds": delay,
        "pollution_score": None, "estimated_aqi": None, "estimated_co2_grams": co2,
        "transfers": 0, "provider": "distance-estimate", "data_quality": "estimated",
        "geometry": {"type": "LineString", "coordinates": []},
        "itinerary": {"note": "Estimated distance and time only. Turn-by-turn route geometry is unavailable until a road-routing provider responds."},
        "warnings": ["Road route geometry is unavailable right now; this is a distance/time estimate, not turn-by-turn navigation."],
    }


_ROUTING_BASES = {
    "driving": "https://routing.openstreetmap.de/routed-car",
    "walking": "https://routing.openstreetmap.de/routed-foot",
    "cycling": "https://routing.openstreetmap.de/routed-bike",
}


def _osrm_routes(mode: str, origin: tuple[float, float], dest: tuple[float, float]) -> list[dict] | None:
    if mode not in _ROUTING_BASES:
        return None
    # OpenStreetMap routing profiles support car, foot, and bike. If a custom
    # endpoint is configured, respect it; otherwise try the profile-specific
    # public router and a second OSRM instance for driving.
    bases = [settings.osrm_base_url.rstrip("/")] if settings.osrm_base_url else [_ROUTING_BASES[mode]]
    if not settings.osrm_base_url and mode == "driving":
        bases.append("https://router.project-osrm.org")
    for base in bases:
        url = f"{base}/route/v1/driving/{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
        try:
            response = httpx.get(
                url,
                params={"alternatives": "3", "overview": "full", "geometries": "geojson", "steps": "false"},
                headers={"User-Agent": "UrbanSaarthi/1.0 (mobility route planner)"},
                timeout=8.0,
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("code") != "Ok" or not payload.get("routes"):
                continue
            output = []
            for i, route in enumerate(payload["routes"][:3]):
                distance = float(route.get("distance", 0.0))
                duration = int(float(route.get("duration", 0.0)))
                geometry = route.get("geometry") or {}
                coordinates = geometry.get("coordinates") or []
                # A route without actual road-network coordinates must not be
                # rendered as a navigable path.
                if len(coordinates) < 2:
                    continue
                output.append({
                    "label": f"{mode.title()} route {chr(65 + i)}", "mode": mode,
                    "duration_seconds": duration, "distance_meters": distance, "traffic_delay_seconds": 0,
                    "pollution_score": None, "estimated_aqi": None,
                    "estimated_co2_grams": _route_co2_estimate(distance, mode), "transfers": 0,
                    "provider": "OpenStreetMap routing", "data_quality": "road-network-route",
                    "geometry": geometry,
                    "itinerary": {"provider_summary": "Route geometry follows the provider's mapped road, footpath, or cycle network. Live traffic is not implied."},
                    "warnings": ["Travel time is based on mapped network estimates; live traffic may not be included."],
                })
            if output:
                return output
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            continue
    return None

_VALHALLA_URL = "https://valhalla1.openstreetmap.de/route"


def _decode_polyline6(encoded: str) -> list[list[float]]:
    """Decode Valhalla's 1e-6 precision polyline into GeoJSON [lon, lat] points."""
    if not encoded:
        return []
    index = 0
    lat = 0
    lon = 0
    points: list[list[float]] = []
    while index < len(encoded):
        values = []
        for _ in range(2):
            result = 0
            shift = 0
            while True:
                if index >= len(encoded):
                    return points
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            values.append(~(result >> 1) if result & 1 else (result >> 1))
        lat += values[0]
        lon += values[1]
        points.append([lon / 1_000_000.0, lat / 1_000_000.0])
    return points


def _route_record(route: dict, mode: str, provider: str) -> dict | None:
    geometry = route.get("geometry") or {}
    coordinates = geometry.get("coordinates") if isinstance(geometry, dict) else None
    if not coordinates or len(coordinates) < 2:
        return None
    try:
        distance = float(route.get("distance", 0.0))
        duration = int(float(route.get("duration", 0.0)))
    except (TypeError, ValueError):
        return None
    if distance <= 0 or duration <= 0:
        return None
    return {
        "label": "Road-network route", "mode": mode,
        "duration_seconds": duration, "distance_meters": distance,
        "traffic_delay_seconds": 0, "pollution_score": None, "estimated_aqi": None,
        "estimated_co2_grams": _route_co2_estimate(distance, mode),
        "transfers": 0, "provider": provider, "data_quality": "road-network-route",
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "itinerary": {"provider_summary": "Full route geometry follows mapped OpenStreetMap roads. The ETA is a routing estimate and does not imply live traffic."},
        "warnings": ["Travel time is based on mapped network estimates; live traffic may not be included."],
    }


def _valhalla_routes(
    mode: str,
    origin: tuple[float, float],
    dest: tuple[float, float],
    *,
    alternates: int = 2,
    exclude_locations: list[tuple[float, float]] | None = None,
) -> list[dict]:
    """Fetch independent road-network paths from the public Valhalla OSM router."""
    costing = {"driving": "auto", "walking": "pedestrian", "cycling": "bicycle"}.get(mode)
    if not costing:
        return []
    payload: dict = {
        "locations": [
            {"lat": origin[0], "lon": origin[1]},
            {"lat": dest[0], "lon": dest[1]},
        ],
        "costing": costing,
        "units": "kilometers",
        "format": "osrm",
        "shape_format": "geojson",
        "directions_type": "none",
        "alternates": max(0, min(int(alternates), 3)),
    }
    if exclude_locations:
        payload["exclude_locations"] = [
            {"lat": lat, "lon": lon, "radius": 35}
            for lat, lon in exclude_locations[:5]
        ]
    try:
        response = httpx.post(
            _VALHALLA_URL,
            json=payload,
            headers={"User-Agent": "UrbanSaarthi/1.0 (mobility route planner)"},
            timeout=8.0,
        )
        response.raise_for_status()
        data = response.json()
        raw_routes = data.get("routes") or []
        if raw_routes:
            output = []
            for raw in raw_routes:
                normalized = _route_record(raw, mode, "Valhalla / OpenStreetMap")
                if normalized:
                    output.append(normalized)
            return output

        # Native Valhalla JSON fallback in case a hosted instance ignores OSRM formatting.
        trips = []
        if data.get("trip"):
            trips.append(data["trip"])
        trips.extend(data.get("alternates") or [])
        output = []
        for trip in trips:
            summary = trip.get("summary") or {}
            legs = trip.get("legs") or []
            if not legs:
                continue
            coordinates = _decode_polyline6(legs[0].get("shape", ""))
            normalized = _route_record({
                "distance": float(summary.get("length", 0.0)) * 1000.0,
                "duration": summary.get("time", 0.0),
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }, mode, "Valhalla / OpenStreetMap")
            if normalized:
                output.append(normalized)
        return output
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return []


def _sample_route_points(route: dict, fractions: tuple[float, ...] = (0.36, 0.52, 0.68)) -> list[tuple[float, float]]:
    coordinates = (route.get("geometry") or {}).get("coordinates") or []
    if len(coordinates) < 3:
        return []
    points = []
    for fraction in fractions:
        lon, lat = coordinates[min(len(coordinates) - 2, max(1, int((len(coordinates) - 1) * fraction)))][:2]
        points.append((float(lat), float(lon)))
    return points


def _is_distinct_network_route(candidate: dict, accepted: list[dict]) -> bool:
    """Reject duplicate router responses while allowing genuinely different road paths."""
    coords = (candidate.get("geometry") or {}).get("coordinates") or []
    if len(coords) < 3:
        return False
    candidate_samples = [coords[min(len(coords) - 1, int(i * (len(coords) - 1) / 17))] for i in range(18)]
    for existing in accepted:
        other = (existing.get("geometry") or {}).get("coordinates") or []
        if len(other) < 3:
            continue
        other_samples = [other[min(len(other) - 1, int(i * (len(other) - 1) / 17))] for i in range(18)]
        close = 0
        for lon, lat in candidate_samples:
            nearest = min(haversine_m(float(lat), float(lon), float(other_lat), float(other_lon)) for other_lon, other_lat in other_samples)
            if nearest <= 35:
                close += 1
        # More than 82% shared sampled geometry is treated as the same route.
        if close / len(candidate_samples) >= 0.82:
            return False
    return True


def _network_routes(mode: str, origin: tuple[float, float], dest: tuple[float, float]) -> list[dict]:
    """Combine OSRM and Valhalla, then request road-avoidance variants if needed.

    All returned options have provider-supplied road-network geometry. This function
    deliberately refuses to draw synthetic straight/curved lines as navigation paths.
    """
    candidates: list[dict] = []
    batches = (
        _osrm_routes(mode, origin, dest) or [],
        _valhalla_routes(mode, origin, dest, alternates=2),
    )
    for batch in batches:
        for route in batch:
            if _is_distinct_network_route(route, candidates):
                candidates.append(route)
            if len(candidates) >= 3:
                return candidates[:3]

    # OSRM and Valhalla may return fewer alternatives than requested. Ask
    # Valhalla for additional paths while excluding a point on each accepted
    # path. Only provider-supplied road geometry can become a visible route.
    fractions = (0.24, 0.40, 0.60, 0.76)
    attempts: list[tuple[float, float]] = []
    for route in candidates:
        attempts.extend(_sample_route_points(route, fractions))

    attempted: set[tuple[int, int]] = set()
    for avoid in attempts[:4]:
        if len(candidates) >= 3:
            break
        key = (round(avoid[0] * 10000), round(avoid[1] * 10000))
        if key in attempted:
            continue
        attempted.add(key)
        for route in _valhalla_routes(mode, origin, dest, alternates=0, exclude_locations=[avoid]):
            if _is_distinct_network_route(route, candidates):
                candidates.append(route)
                break
    return candidates[:3]


def build_routes(db: Session, request, user_id: int | None = None) -> dict:
    origin = (request.origin_latitude, request.origin_longitude)
    dest = (request.destination_latitude, request.destination_longitude)
    congestion, latest_traffic_at = _congestion_penalty(db)
    aqi_cutoff = utc_now() - timedelta(hours=3)
    latest_aqi_at = db.scalar(select(AqiObservation.observed_at).where(AqiObservation.observed_at >= aqi_cutoff).order_by(AqiObservation.observed_at.desc()).limit(1))
    routes: list[dict] = []
    global_warnings: list[str] = []
    for mode in ("driving", "walking", "cycling"):
        if mode not in request.modes:
            continue
        external = _network_routes(mode, origin, dest)
        if external:
            routes.extend(external)
            if len(external) < 3:
                global_warnings.append(
                    f"The {mode} road network returned {len(external)} distinct mapped route(s). "
                    "More alternatives are shown only when routing providers return genuinely different road paths."
                )
        else:
            routes.append(_estimation_route(mode, origin, dest, congestion))
            global_warnings.append(
                f"No {mode} routing provider returned road geometry. The fallback is a distance/time estimate, not a mapped route."
            )
    transit_count_before = len(routes)
    if "transit" in request.modes:
        routes.extend(find_direct_transit_options(db, *origin, *dest, departure_at=request.departure_at))
    if "transit" in request.modes and len(routes) == transit_count_before:
        # An unavailable transit itinerary is a warning, not a fabricated route.
        transit_ready = bool(db.scalar(select(TransitRoute.id).limit(1))) and bool(db.scalar(select(TransitStop.id).where(TransitStop.latitude.is_not(None), TransitStop.longitude.is_not(None)).limit(1)))
        if not transit_ready:
            global_warnings.append("Transit route planning is awaiting a GTFS static feed and stop coordinates; no transit itinerary has been fabricated.")
        else:
            global_warnings.append("No valid direct GTFS journey was found near the selected origin/destination and departure time. Transfer routing is not enabled in this build.")

    # Pollution is only reported when recent station observations exist near route points.
    for route in routes:
        coords = (route.get("geometry") or {}).get("coordinates") or []
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
    for mode in ("driving", "walking", "cycling"):
        mapped_routes = [route for route in routes if route.get("mode") == mode and route.get("data_quality") == "road-network-route"]
        for index, route in enumerate(mapped_routes):
            route["id"] = f"{mode}-route-{index + 1}"
            route["label"] = f"Route {chr(65 + index)}"
            route["route_number"] = index + 1
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
            "routing_provider": "OSRM + Valhalla / OpenStreetMap road network" if any(mode in request.modes for mode in ("driving", "walking", "cycling")) else "GTFS transit feed",
            "aqi_max_age_minutes": 180,
        },
        "warnings": global_warnings,
    }
