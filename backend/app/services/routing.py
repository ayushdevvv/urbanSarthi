from datetime import datetime, timedelta, timezone
from statistics import mean
from concurrent.futures import ThreadPoolExecutor
import math
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
    # Merge alternatives from independent OSRM deployments. The first provider
    # often returns only one path, so returning early here used to hide the second.
    bases = [settings.osrm_base_url.rstrip("/")] if settings.osrm_base_url else [_ROUTING_BASES[mode]]
    if mode == "driving" and "https://router.project-osrm.org" not in bases:
        bases.append("https://router.project-osrm.org")

    def fetch(base: str) -> list[dict]:
        profile = "driving"
        url = f"{base}/route/v1/{profile}/{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
        try:
            response = httpx.get(
                url,
                params={"alternatives": "3", "overview": "full", "geometries": "geojson", "steps": "false"},
                headers={"User-Agent": "UrbanSaarthi/1.0 (mobility route planner)"},
                timeout=5.0,
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("code") != "Ok" or not payload.get("routes"):
                return []
            output: list[dict] = []
            for i, route in enumerate(payload["routes"][:3]):
                distance = float(route.get("distance", 0.0))
                duration = int(float(route.get("duration", 0.0)))
                geometry = route.get("geometry") or {}
                coordinates = geometry.get("coordinates") or []
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
            return output
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            return []

    with ThreadPoolExecutor(max_workers=min(3, len(bases))) as pool:
        batches = list(pool.map(fetch, bases))
    return [route for batch in batches for route in batch] or None

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
    costing_override: str | None = None,
    costing_options: dict | None = None,
    via: tuple[float, float] | None = None,
    strategy_label: str | None = None,
) -> list[dict]:
    """Fetch independent road-network paths from the public Valhalla OSM router."""
    costing = costing_override or {"driving": "auto", "walking": "pedestrian", "cycling": "bicycle"}.get(mode)
    if not costing:
        return []
    payload: dict = {
        "locations": [
            {"lat": origin[0], "lon": origin[1], "type": "break"},
            *([{"lat": via[0], "lon": via[1], "type": "through"}] if via else []),
            {"lat": dest[0], "lon": dest[1], "type": "break"},
        ],
        "costing": costing,
        "units": "kilometers",
        "format": "osrm",
        "shape_format": "geojson",
        "directions_type": "none",
        "alternates": max(0, min(int(alternates), 3)),
    }
    if costing_options:
        payload["costing_options"] = {costing: costing_options}
    if exclude_locations:
        # Valhalla maps each coordinate to its nearest road edge and excludes it.
        # Several spaced points force the solver to leave a previously used corridor.
        payload["exclude_locations"] = [
            {"lat": lat, "lon": lon}
            for lat, lon in exclude_locations[:12]
        ]
    try:
        response = httpx.post(
            _VALHALLA_URL,
            json=payload,
            headers={"User-Agent": "UrbanSaarthi/1.0 (mobility route planner)"},
            timeout=6.0,
        )
        response.raise_for_status()
        data = response.json()
        raw_routes = data.get("routes") or []
        if raw_routes:
            output = []
            for raw in raw_routes:
                normalized = _route_record(raw, mode, "Valhalla / OpenStreetMap")
                if normalized:
                    if strategy_label:
                        normalized["label"] = strategy_label
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
                if strategy_label:
                    normalized["label"] = strategy_label
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


def _route_sample_points(route: dict, sample_count: int = 32) -> list[tuple[float, float]]:
    """Sample a LineString at equal travelled-distance intervals, not vertex indexes."""
    coordinates = (route.get("geometry") or {}).get("coordinates") or []
    if len(coordinates) < 2:
        return []
    segments: list[tuple[float, list[float], list[float]]] = []
    total = 0.0
    for first, second in zip(coordinates, coordinates[1:]):
        lon1, lat1 = float(first[0]), float(first[1])
        lon2, lat2 = float(second[0]), float(second[1])
        length = haversine_m(lat1, lon1, lat2, lon2)
        if length <= 0:
            continue
        total += length
        segments.append((length, [lon1, lat1], [lon2, lat2]))
    if total <= 0:
        return []
    result: list[tuple[float, float]] = []
    for index in range(sample_count):
        target = total * index / max(1, sample_count - 1)
        traversed = 0.0
        for length, first, second in segments:
            if traversed + length >= target:
                ratio = max(0.0, min(1.0, (target - traversed) / length))
                result.append((first[0] + (second[0] - first[0]) * ratio, first[1] + (second[1] - first[1]) * ratio))
                break
            traversed += length
    return result


def _is_distinct_network_route(candidate: dict, accepted: list[dict]) -> bool:
    """Reject paths that substantially reuse an already displayed road corridor."""
    candidate_samples = _route_sample_points(candidate)
    if len(candidate_samples) < 3:
        return False
    for existing in accepted:
        other_samples = _route_sample_points(existing)
        if len(other_samples) < 3:
            continue
        close = 0
        for lon, lat in candidate_samples:
            nearest = min(haversine_m(lat, lon, other_lat, other_lon) for other_lon, other_lat in other_samples)
            if nearest <= 25:
                close += 1
        # A candidate must diverge meaningfully from an existing route for a
        # material part of the journey; parallel roads can be only a few metres apart.
        if close / len(candidate_samples) >= 0.80:
            return False
    return True


def _detour_waypoints(origin: tuple[float, float], dest: tuple[float, float]) -> list[tuple[float, float]]:
    """Generate candidate via-points either side of the direct corridor.

    The routing engine snaps these coordinates to its road graph; returned geometry
    remains provider-generated and is never replaced with a straight line.
    """
    lat1, lon1 = origin
    lat2, lon2 = dest
    mid_lat = (lat1 + lat2) / 2.0
    cos_lat = max(0.2, abs(math.cos(math.radians(mid_lat))))
    dx = (lon2 - lon1) * cos_lat
    dy = lat2 - lat1
    norm = (dx * dx + dy * dy) ** 0.5
    if norm < 1e-9:
        return []
    # In local road networks a few hundred metres can move the route onto a
    # parallel arterial without forcing a large, unrealistic detour.
    direct = haversine_m(lat1, lon1, lat2, lon2)
    perp_x, perp_y = -dy / norm, dx / norm
    points: list[tuple[float, float]] = []
    # Two offset scales help the solver snap onto both nearby parallel streets
    # and a wider arterial corridor. All returned paths still come from Valhalla.
    offsets = [max(220.0, min(900.0, direct * 0.12)), max(450.0, min(2200.0, direct * 0.28))]
    candidates = [(0.30, 1, 0), (0.48, -1, 0), (0.68, 1, 0), (0.38, -1, 1), (0.60, 1, 1), (0.76, -1, 1), (0.22, 1, 1), (0.54, -1, 0)]
    for fraction, side, scale_index in candidates:
        offset_m = offsets[scale_index]
        lat = lat1 + (lat2 - lat1) * fraction + side * perp_y * offset_m / 111_000.0
        lon = lon1 + (lon2 - lon1) * fraction + side * perp_x * offset_m / (111_000.0 * cos_lat)
        if -90 < lat < 90 and -180 < lon < 180:
            points.append((lat, lon))
    return points


def _network_routes(mode: str, origin: tuple[float, float], dest: tuple[float, float]) -> list[dict]:
    """Build up to three distinct paths from independent OSM network searches.

    Native alternatives are best-effort. If the initial engines return at least one
    road path, a bounded second wave varies driving cost profiles and forces several
    routes through different snapped road corridors. If both engines are unavailable,
    stop quickly and let the caller show a clearly labelled distance/time estimate.
    Every returned alternative is provider-generated road geometry; no straight line
    is invented to reach a target count.
    """
    candidates: list[dict] = []

    def add_batch(batch: list[dict] | None) -> None:
        for route in batch or []:
            if _is_distinct_network_route(route, candidates):
                candidates.append(route)
                if len(candidates) >= 3:
                    return

    # Independent OSRM + Valhalla requests run concurrently.
    with ThreadPoolExecutor(max_workers=2) as pool:
        osrm_future = pool.submit(_osrm_routes, mode, origin, dest)
        valhalla_future = pool.submit(_valhalla_routes, mode, origin, dest, alternates=3)
        add_batch(osrm_future.result())
        add_batch(valhalla_future.result())

    # If neither primary engine can produce a path, additional calls to the same
    # unavailable routing services are unlikely to help and only increase latency.
    if not candidates:
        return []

    if len(candidates) < 3:
        jobs = []
        if mode == "driving":
            jobs.extend([
                lambda: _valhalla_routes(mode, origin, dest, alternates=0, costing_override="auto_shorter", strategy_label="Shorter distance"),
                lambda: _valhalla_routes(mode, origin, dest, alternates=0, costing_options={"use_distance": 0.72}, strategy_label="Distance-balanced"),
            ])
        # Four offset waypoints explore both nearby streets and a wider arterial.
        # The server snaps each waypoint to its actual road graph.
        vias = _detour_waypoints(origin, dest)[:4]
        jobs.extend([
            (lambda via=via, index=index: _valhalla_routes(
                mode, origin, dest, alternates=0, via=via,
                strategy_label=f"Alternate corridor {index + 1}"
            ))
            for index, via in enumerate(vias)
        ])
        with ThreadPoolExecutor(max_workers=max(1, len(jobs))) as pool:
            futures = [pool.submit(job) for job in jobs]
            for future in futures:
                add_batch(future.result())
                if len(candidates) >= 3:
                    break

    return candidates[:3]


def _normalised_score(value: float, low: float, high: float) -> float:
    if not math.isfinite(value) or not math.isfinite(low) or not math.isfinite(high):
        return 0.5
    if high - low < 1e-9:
        return 0.5
    return max(0.0, min(1.0, (value - low) / (high - low)))


def _sort_route_options(routes: list[dict], preference: str) -> list[dict]:
    """Order routes deterministically using only metrics actually available."""
    if not routes:
        return []

    def number(route: dict, key: str, missing: float = math.inf) -> float:
        try:
            value = float(route.get(key))
            return value if math.isfinite(value) and value >= 0 else missing
        except (TypeError, ValueError):
            return missing

    if preference == "fastest":
        return sorted(routes, key=lambda route: (
            number(route, "duration_seconds"),
            number(route, "distance_meters"),
            number(route, "estimated_co2_grams"),
        ))

    pollution_values = [number(route, "pollution_score") for route in routes]
    has_pollution = any(math.isfinite(value) for value in pollution_values)
    if preference == "cleanest":
        if has_pollution:
            return sorted(routes, key=lambda route: (
                number(route, "pollution_score"),
                number(route, "estimated_co2_grams"),
                number(route, "duration_seconds"),
            ))
        return sorted(routes, key=lambda route: (
            number(route, "estimated_co2_grams"),
            number(route, "duration_seconds"),
            number(route, "distance_meters"),
        ))

    durations = [number(route, "duration_seconds") for route in routes]
    emissions = [number(route, "estimated_co2_grams") for route in routes]
    valid_durations = [value for value in durations if math.isfinite(value)] or [0.0]
    valid_emissions = [value for value in emissions if math.isfinite(value)] or [0.0]
    valid_pollution = [value for value in pollution_values if math.isfinite(value)] or [0.0]
    min_time, max_time = min(valid_durations), max(valid_durations)
    min_co2, max_co2 = min(valid_emissions), max(valid_emissions)
    min_pollution, max_pollution = min(valid_pollution), max(valid_pollution)

    def balanced_key(route: dict):
        time_score = _normalised_score(number(route, "duration_seconds"), min_time, max_time)
        co2_value = number(route, "estimated_co2_grams")
        co2_score = _normalised_score(co2_value, min_co2, max_co2)
        pollution_value = number(route, "pollution_score")
        if has_pollution:
            # Missing station coverage is neutral, not an artificially clean score.
            pollution_score = _normalised_score(pollution_value, min_pollution, max_pollution) if math.isfinite(pollution_value) else 0.5
            total = 0.40 * time_score + 0.35 * pollution_score + 0.25 * co2_score
        else:
            total = 0.70 * time_score + 0.30 * co2_score
        return (total, number(route, "duration_seconds"), co2_value, number(route, "distance_meters"))

    return sorted(routes, key=balanced_key)


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

    routes = _sort_route_options(routes, request.preference)
    # Labels are applied AFTER sorting, so they always describe the selected
    # preference order rather than the order returned by an external provider.
    for index, route in enumerate(routes):
        if route.get("data_quality") != "road-network-route":
            route["label"] = route.get("label") or "Distance/time estimate"
        elif index == 0:
            if request.preference == "fastest":
                route["label"] = "Fastest route"
            elif request.preference == "cleanest":
                route["label"] = "Lowest-impact route" if route.get("pollution_score") is not None else "Lowest CO₂ route"
            else:
                route["label"] = "Recommended balance"
        else:
            route["label"] = f"Alternative route {index + 1}"
        route["preference_rank"] = f"{request.preference}-#{index + 1}"
    for mode in ("driving", "walking", "cycling"):
        mapped_routes = [route for route in routes if route.get("mode") == mode and route.get("data_quality") == "road-network-route"]
        for index, route in enumerate(mapped_routes):
            route["id"] = f"{mode}-route-{index + 1}"
            existing_label = str(route.get("label") or "").strip()
            if not existing_label or existing_label in {"Road-network route", "Driving route", "Walking route", "Cycling route"}:
                route["label"] = ("Fastest route", "Alternative route 2", "Alternative route 3")[index]
            route["route_number"] = index + 1
    for route in routes:
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
