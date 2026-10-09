"""Minimal, standards-aware GTFS Static importer and direct-journey timetable planner.

The importer reads members in-memory (never extracts untrusted zip paths) and replaces
only records tagged as GTFS data. It supports direct journeys; transfer routing is an
explicit extension point rather than a fabricated itinerary.
"""
import csv
import io
import zipfile
from datetime import date, datetime, time, timedelta
from math import ceil
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models import (
    TransitCalendar, TransitCalendarDate, TransitFrequency, TransitRoute, TransitStop, TransitStopTime, TransitTrip,
)
from app.services.common import haversine_m

GTFS_MODE = {
    "0": "tram", "1": "metro", "2": "rail", "3": "bus", "4": "ferry",
    "5": "cable_car", "6": "gondola", "7": "funicular", "11": "trolleybus", "12": "monorail",
}
REQUIRED_FILES = {"routes.txt", "stops.txt", "trips.txt", "stop_times.txt"}
MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024


def _rows(data: bytes, name: str) -> list[dict[str, str]]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{name} must be UTF-8 encoded") from exc
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError(f"{name} has no header")
    return [{str(k or "").strip(): str(v or "").strip() for k, v in row.items()} for row in reader]


def _int(value: str | None, default: int = 0) -> int:
    try:
        return int(value) if value not in (None, "") else default
    except ValueError:
        return default


def _float(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def _gtfs_bool(value: str | None) -> bool | None:
    # GTFS: 1 = yes, 2 = no, 0/blank = unknown or not specified.
    if value == "1":
        return True
    if value == "2":
        return False
    return None


def _parse_gtfs_date(value: str, field: str) -> date:
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Invalid GTFS date in {field}: {value!r}") from exc


def import_gtfs_zip(db: Session, content: bytes, filename: str) -> dict:
    if not filename.lower().endswith(".zip"):
        raise ValueError("Upload a GTFS .zip archive")
    max_bytes = settings.gtfs_max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise ValueError(f"GTFS upload exceeds the configured {settings.gtfs_max_upload_mb} MB limit")
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise ValueError("The uploaded file is not a valid ZIP archive") from exc
    with archive:
        infos = archive.infolist()
        if sum(info.file_size for info in infos) > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("GTFS archive expands beyond the safety limit")
        members = {info.filename.rsplit("/", 1)[-1]: info for info in infos if not info.is_dir()}
        missing = sorted(REQUIRED_FILES - members.keys())
        if missing:
            raise ValueError(f"GTFS archive is missing required file(s): {', '.join(missing)}")
        parsed = {name: _rows(archive.read(members[name]), name) for name in REQUIRED_FILES}
        for optional in ("calendar.txt", "calendar_dates.txt", "frequencies.txt"):
            parsed[optional] = _rows(archive.read(members[optional]), optional) if optional in members else []

    route_rows = parsed["routes.txt"]
    stop_rows = parsed["stops.txt"]
    trip_rows = parsed["trips.txt"]
    stop_time_rows = parsed["stop_times.txt"]
    if any(not row.get("route_id") for row in route_rows):
        raise ValueError("routes.txt contains a row without route_id")
    if any(not row.get("stop_id") for row in stop_rows):
        raise ValueError("stops.txt contains a row without stop_id")
    if any(not row.get("trip_id") or not row.get("route_id") or not row.get("service_id") for row in trip_rows):
        raise ValueError("trips.txt contains a row missing trip_id, route_id, or service_id")

    try:
        # Full replacement is scoped to GTFS records and is rolled back together on failure.
        gtfs_trip_ids = select(TransitTrip.id).where(TransitTrip.route_id.in_(select(TransitRoute.id).where(TransitRoute.source == "gtfs")))
        db.execute(delete(TransitFrequency).where(TransitFrequency.trip_id.in_(gtfs_trip_ids)))
        db.execute(delete(TransitStopTime).where(TransitStopTime.trip_id.in_(gtfs_trip_ids)))
        db.execute(delete(TransitTrip).where(TransitTrip.route_id.in_(select(TransitRoute.id).where(TransitRoute.source == "gtfs"))) )
        db.execute(delete(TransitCalendar))
        db.execute(delete(TransitCalendarDate))
        db.execute(delete(TransitRoute).where(TransitRoute.source == "gtfs"))
        db.execute(delete(TransitStop).where(TransitStop.source == "gtfs"))

        routes_by_external: dict[str, TransitRoute] = {}
        for row in route_rows:
            external_id = row["route_id"]
            try:
                route_type = str(_int(row.get("route_type"), 3))
                route = TransitRoute(
                    external_id=external_id,
                    short_name=row.get("route_short_name") or None,
                    long_name=row.get("route_long_name") or row.get("route_desc") or None,
                    mode=GTFS_MODE.get(route_type, "other"),
                    agency_name=row.get("agency_id") or None,
                    route_color=("#" + row["route_color"]) if row.get("route_color") and not row["route_color"].startswith("#") else row.get("route_color") or None,
                    source="gtfs",
                )
                db.add(route)
                routes_by_external[external_id] = route
            except Exception as exc:
                raise ValueError(f"Could not parse GTFS route {external_id!r}: {exc}") from exc
        db.flush()
        route_id_map = {key: value.id for key, value in routes_by_external.items()}

        stops_by_external: dict[str, TransitStop] = {}
        for row in stop_rows:
            external_id = row["stop_id"]
            stops_by_external[external_id] = TransitStop(
                external_id=external_id,
                name=row.get("stop_name") or external_id,
                latitude=_float(row.get("stop_lat")),
                longitude=_float(row.get("stop_lon")),
                wheelchair_boarding=_gtfs_bool(row.get("wheelchair_boarding")),
                parent_station=row.get("parent_station") or None,
                source="gtfs",
            )
            db.add(stops_by_external[external_id])
        db.flush()
        stop_id_map = {key: value.id for key, value in stops_by_external.items()}

        trips_by_external: dict[str, TransitTrip] = {}
        for row in trip_rows:
            if row["route_id"] not in route_id_map:
                raise ValueError(f"Trip {row['trip_id']} references unknown route_id {row['route_id']}")
            trips_by_external[row["trip_id"]] = TransitTrip(
                external_id=row["trip_id"], route_id=route_id_map[row["route_id"]],
                service_id=row["service_id"], headsign=row.get("trip_headsign") or None,
                direction_id=row.get("direction_id") or None,
                wheelchair_accessible=_gtfs_bool(row.get("wheelchair_accessible")),
            )
            db.add(trips_by_external[row["trip_id"]])
        db.flush()
        trip_id_map = {key: value.id for key, value in trips_by_external.items()}

        count_times = 0
        for row in stop_time_rows:
            trip_external, stop_external = row.get("trip_id", ""), row.get("stop_id", "")
            if trip_external not in trip_id_map or stop_external not in stop_id_map:
                raise ValueError(f"stop_times.txt references unknown trip/stop: {trip_external!r}/{stop_external!r}")
            arr, dep = row.get("arrival_time", ""), row.get("departure_time", "")
            if not arr or not dep:
                continue
            db.add(TransitStopTime(
                trip_id=trip_id_map[trip_external], stop_id=stop_id_map[stop_external],
                stop_sequence=_int(row.get("stop_sequence")), arrival_time=arr, departure_time=dep,
                pickup_type=row.get("pickup_type") or None, drop_off_type=row.get("drop_off_type") or None,
            ))
            count_times += 1

        count_frequencies = 0
        for row in parsed["frequencies.txt"]:
            trip_external = row.get("trip_id", "")
            if trip_external not in trip_id_map:
                raise ValueError(f"frequencies.txt references unknown trip_id {trip_external!r}")
            headway = _int(row.get("headway_secs"))
            if headway <= 0 or not row.get("start_time") or not row.get("end_time"):
                raise ValueError(f"Invalid frequency window for trip {trip_external!r}")
            db.add(TransitFrequency(trip_id=trip_id_map[trip_external], start_time=row["start_time"],
                                    end_time=row["end_time"], headway_secs=headway,
                                    exact_times=bool(_int(row.get("exact_times")))))
            count_frequencies += 1

        for row in parsed["calendar.txt"]:
            service_id = row.get("service_id", "")
            if not service_id:
                continue
            db.add(TransitCalendar(
                service_id=service_id,
                monday=bool(_int(row.get("monday"))), tuesday=bool(_int(row.get("tuesday"))),
                wednesday=bool(_int(row.get("wednesday"))), thursday=bool(_int(row.get("thursday"))),
                friday=bool(_int(row.get("friday"))), saturday=bool(_int(row.get("saturday"))),
                sunday=bool(_int(row.get("sunday"))), start_date=_parse_gtfs_date(row.get("start_date", ""), "calendar.txt"),
                end_date=_parse_gtfs_date(row.get("end_date", ""), "calendar.txt"),
            ))
        for row in parsed["calendar_dates.txt"]:
            service_id = row.get("service_id", "")
            if not service_id:
                continue
            exception_type = _int(row.get("exception_type"))
            if exception_type not in (1, 2):
                raise ValueError("calendar_dates.txt exception_type must be 1 or 2")
            db.add(TransitCalendarDate(service_id=service_id, service_date=_parse_gtfs_date(row.get("date", ""), "calendar_dates.txt"), exception_type=exception_type))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {
        "routes_upserted": len(route_rows), "stops_upserted": len(stop_rows),
        "trips_upserted": len(trip_rows), "stop_times_upserted": count_times,
        "frequencies_upserted": count_frequencies,
        "calendars_upserted": len(parsed["calendar.txt"]),
        "calendar_dates_upserted": len(parsed["calendar_dates.txt"]),
        "warnings": (["No calendar.txt/calendar_dates.txt found; scheduled service validity will be approximated."] if not parsed["calendar.txt"] and not parsed["calendar_dates.txt"] else []),
    }


def _gtfs_datetime(service_day: date, value: str, tzinfo) -> datetime | None:
    try:
        parts = [int(piece) for piece in value.split(":")]
        if len(parts) != 3 or min(parts) < 0 or parts[1] > 59 or parts[2] > 59:
            return None
        hours, minutes, seconds = parts
        return datetime.combine(service_day, time(0, 0), tzinfo=tzinfo) + timedelta(hours=hours, minutes=minutes, seconds=seconds)
    except (ValueError, TypeError):
        return None


def _active_service_ids(db: Session, service_day: date) -> set[str]:
    weekday_column = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")[service_day.weekday()]
    calendars = list(db.scalars(select(TransitCalendar).where(TransitCalendar.start_date <= service_day, TransitCalendar.end_date >= service_day)))
    active = {cal.service_id for cal in calendars if getattr(cal, weekday_column)}
    exceptions = list(db.scalars(select(TransitCalendarDate).where(TransitCalendarDate.service_date == service_day)))
    for ex in exceptions:
        if ex.exception_type == 1:
            active.add(ex.service_id)
        elif ex.exception_type == 2:
            active.discard(ex.service_id)
    has_any_calendar = bool(calendars) or bool(exceptions)
    if not has_any_calendar:
        active = set(db.scalars(select(TransitTrip.service_id).distinct()))
    return active


def _frequency_instances_for_stop(
    schedule: list[TransitStopTime],
    target_stop_time: TransitStopTime,
    frequencies: list[TransitFrequency],
    service_day: date,
    now: datetime,
    horizon: datetime,
    tzinfo,
) -> list[tuple[datetime, timedelta, TransitFrequency]]:
    """Return possible frequency departures at a stop with the time shift for the whole trip.

    GTFS frequencies.txt uses each window's start_time as the first-stop departure for
    the first instance. The stop-time template supplies offsets along the trip. Results
    are estimates when exact_times=0 and are capped to prevent malformed feeds from
    generating unbounded loops.
    """
    if not schedule or not frequencies:
        return []
    first_template_departure = _gtfs_datetime(service_day, schedule[0].departure_time, tzinfo)
    target_template_departure = _gtfs_datetime(service_day, target_stop_time.departure_time, tzinfo)
    if first_template_departure is None or target_template_departure is None:
        return []
    stop_offset = max(0, int((target_template_departure - first_template_departure).total_seconds()))
    results: list[tuple[datetime, timedelta, TransitFrequency]] = []
    for frequency in frequencies:
        headway = int(frequency.headway_secs or 0)
        window_start = _gtfs_datetime(service_day, frequency.start_time, tzinfo)
        window_end = _gtfs_datetime(service_day, frequency.end_time, tzinfo)
        if headway <= 0 or window_start is None or window_end is None or window_end <= window_start:
            continue
        instance_count = min(1000, max(0, ceil((window_end - window_start).total_seconds() / headway)))
        template_stop_instance = window_start + timedelta(seconds=stop_offset)
        start_index = max(0, int((now - template_stop_instance).total_seconds() // headway) - 1)
        for index in range(start_index, instance_count):
            first_stop_departure = window_start + timedelta(seconds=index * headway)
            target_departure = first_stop_departure + timedelta(seconds=stop_offset)
            if target_departure > horizon:
                break
            if target_departure < now:
                continue
            results.append((target_departure, first_stop_departure - first_template_departure, frequency))
    return results


def _service_instances_for_stop(
    schedule: list[TransitStopTime],
    target_stop_time: TransitStopTime,
    frequencies: list[TransitFrequency],
    service_day: date,
    now: datetime,
    horizon: datetime,
    tzinfo,
) -> list[tuple[datetime, timedelta, TransitFrequency | None]]:
    if frequencies:
        return _frequency_instances_for_stop(schedule, target_stop_time, frequencies, service_day, now, horizon, tzinfo)
    departure = _gtfs_datetime(service_day, target_stop_time.departure_time, tzinfo)
    if departure is None or departure < now or departure > horizon:
        return []
    return [(departure, timedelta(0), None)]


def find_direct_transit_options(
    db: Session,
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    departure_at: datetime | None = None,
    max_options: int = 3,
) -> list[dict]:
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(settings.timezone)
    now = departure_at or datetime.now(tz)
    if now.tzinfo is None:
        now = now.replace(tzinfo=tz)
    horizon = now + timedelta(hours=3)

    # Only geocoded stops can support coordinate-based journey planning.
    stop_rows = list(db.scalars(select(TransitStop).where(TransitStop.latitude.is_not(None), TransitStop.longitude.is_not(None))))
    if not stop_rows:
        return []
    origin_stops = sorted(((haversine_m(origin_lat, origin_lon, s.latitude, s.longitude), s) for s in stop_rows), key=lambda x: x[0])[:8]
    destination_stops = sorted(((haversine_m(dest_lat, dest_lon, s.latitude, s.longitude), s) for s in stop_rows), key=lambda x: x[0])[:8]
    origin_stops = [(d, s) for d, s in origin_stops if d <= 2500]
    destination_stops = [(d, s) for d, s in destination_stops if d <= 2500]
    if not origin_stops or not destination_stops:
        return []

    origin_ids = {s.id for _, s in origin_stops}
    destination_ids = {s.id for _, s in destination_stops}
    endpoint_rows = list(db.scalars(select(TransitStopTime).where(TransitStopTime.stop_id.in_(origin_ids | destination_ids))))
    candidate_trip_ids = {row.trip_id for row in endpoint_rows}
    if not candidate_trip_ids:
        return []
    all_times = list(db.scalars(select(TransitStopTime).where(TransitStopTime.trip_id.in_(candidate_trip_ids)).order_by(TransitStopTime.trip_id, TransitStopTime.stop_sequence)))
    by_trip: dict[int, list[TransitStopTime]] = {}
    for row in all_times:
        by_trip.setdefault(row.trip_id, []).append(row)
    frequencies_by_trip: dict[int, list[TransitFrequency]] = {}
    for frequency in db.scalars(select(TransitFrequency).where(TransitFrequency.trip_id.in_(candidate_trip_ids))):
        frequencies_by_trip.setdefault(frequency.trip_id, []).append(frequency)

    trips = {t.id: t for t in db.scalars(select(TransitTrip).where(TransitTrip.id.in_(candidate_trip_ids)))}
    route_ids = {trip.route_id for trip in trips.values()}
    routes = {r.id: r for r in db.scalars(select(TransitRoute).where(TransitRoute.id.in_(route_ids)))}
    stops_by_id = {s.id: s for s in stop_rows}
    origin_distance = {s.id: distance for distance, s in origin_stops}
    destination_distance = {s.id: distance for distance, s in destination_stops}
    candidates: list[dict] = []

    for day_offset in (0, 1):
        service_day = now.date() + timedelta(days=day_offset)
        active = _active_service_ids(db, service_day)
        for trip_id, schedule in by_trip.items():
            trip = trips.get(trip_id)
            if not trip or trip.service_id not in active or not schedule:
                continue
            trip_frequencies = frequencies_by_trip.get(trip_id, [])
            origin_times = [item for item in schedule if item.stop_id in origin_ids]
            destination_times = [item for item in schedule if item.stop_id in destination_ids]
            for origin_time in origin_times:
                for destination_time in destination_times:
                    if destination_time.stop_sequence <= origin_time.stop_sequence:
                        continue
                    board_stop = stops_by_id.get(origin_time.stop_id)
                    alight_stop = stops_by_id.get(destination_time.stop_id)
                    route = routes.get(trip.route_id)
                    if not board_stop or not alight_stop or not route:
                        continue
                    departures = _service_instances_for_stop(
                        schedule, origin_time, trip_frequencies, service_day, now, horizon, tz
                    )
                    origin_distance_m = origin_distance.get(board_stop.id, float("inf"))
                    destination_distance_m = destination_distance.get(alight_stop.id, float("inf"))
                    if not (origin_distance_m < float("inf") and destination_distance_m < float("inf")):
                        continue
                    access_seconds = ceil(origin_distance_m / 1.2) + ceil(destination_distance_m / 1.2)
                    for departure, time_shift, frequency in departures:
                        template_arrival = _gtfs_datetime(service_day, destination_time.arrival_time, tz)
                        if template_arrival is None:
                            continue
                        arrival = template_arrival + time_shift
                        if arrival < departure:
                            continue
                        wait_seconds = max(0, ceil((departure - now).total_seconds()))
                        ride_seconds = ceil((arrival - departure).total_seconds())
                        is_headway_estimate = frequency is not None and not frequency.exact_times
                        candidates.append({
                            "label": f"{route.mode.title()} {route.short_name or route.long_name or route.external_id}",
                            "mode": "transit", "duration_seconds": access_seconds + wait_seconds + ride_seconds,
                            "distance_meters": float(origin_distance_m + destination_distance_m), "traffic_delay_seconds": 0,
                            "pollution_score": None, "estimated_aqi": None, "estimated_co2_grams": None,
                            "transfers": 0, "provider": "gtfs-frequency" if frequency else "gtfs-static",
                            "data_quality": "headway-estimate" if is_headway_estimate else "scheduled", "geometry": {},
                            "itinerary": {
                                "route_external_id": route.external_id,
                                "route_name": route.long_name or route.short_name,
                                "route_mode": route.mode, "trip_external_id": trip.external_id,
                                "headsign": trip.headsign, "board_stop": board_stop.name,
                                "board_stop_external_id": board_stop.external_id, "board_at": departure.isoformat(),
                                "alight_stop": alight_stop.name, "alight_stop_external_id": alight_stop.external_id,
                                "arrive_at": arrival.isoformat(), "access_distance_meters": round(origin_distance_m, 1),
                                "egress_distance_meters": round(destination_distance_m, 1),
                                "headway_seconds": frequency.headway_secs if frequency else None,
                                "frequency_exact_times": frequency.exact_times if frequency else None,
                            },
                            "warnings": (["Headway-based departure estimate from GTFS frequencies.txt; it is not a live vehicle position."] if is_headway_estimate else [])
                                + ["GTFS timetable data does not include live delays unless a real-time feed is ingested."],
                            "_sort": access_seconds + wait_seconds + ride_seconds,
                        })
    candidates.sort(key=lambda item: item["_sort"])
    unique: list[dict] = []
    seen = set()
    for item in candidates:
        key = (
            item["itinerary"].get("route_external_id"), item["itinerary"].get("board_stop_external_id"),
            item["itinerary"].get("alight_stop_external_id"), item["itinerary"].get("board_at"),
        )
        if key in seen:
            continue
        seen.add(key)
        item.pop("_sort", None)
        unique.append(item)
        if len(unique) >= max_options:
            break
    if unique:
        return unique
    return find_one_transfer_options(db, origin_lat, origin_lon, dest_lat, dest_lon, departure_at=departure_at, max_options=max_options)


def find_one_transfer_options(
    db: Session,
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    departure_at: datetime | None = None,
    max_options: int = 3,
) -> list[dict]:
    """Find one-transfer journeys from GTFS trips, including frequency-based legs."""
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(settings.timezone)
    now = departure_at or datetime.now(tz)
    if now.tzinfo is None:
        now = now.replace(tzinfo=tz)
    horizon = now + timedelta(hours=4)
    stops = list(db.scalars(select(TransitStop).where(TransitStop.latitude.is_not(None), TransitStop.longitude.is_not(None))))
    if not stops:
        return []
    origins = sorted(((haversine_m(origin_lat, origin_lon, s.latitude, s.longitude), s) for s in stops), key=lambda x: x[0])[:8]
    destinations = sorted(((haversine_m(dest_lat, dest_lon, s.latitude, s.longitude), s) for s in stops), key=lambda x: x[0])[:8]
    origins = [(distance, stop) for distance, stop in origins if distance <= 2500]
    destinations = [(distance, stop) for distance, stop in destinations if distance <= 2500]
    if not origins or not destinations:
        return []
    origin_ids = {s.id for _, s in origins}
    destination_ids = {s.id for _, s in destinations}
    origin_times = list(db.scalars(select(TransitStopTime).where(TransitStopTime.stop_id.in_(origin_ids))))
    destination_times = list(db.scalars(select(TransitStopTime).where(TransitStopTime.stop_id.in_(destination_ids))))
    relevant_trip_ids = {row.trip_id for row in origin_times + destination_times}
    if not relevant_trip_ids:
        return []
    all_times = list(db.scalars(select(TransitStopTime).where(TransitStopTime.trip_id.in_(relevant_trip_ids)).order_by(TransitStopTime.trip_id, TransitStopTime.stop_sequence)))
    by_trip: dict[int, list[TransitStopTime]] = {}
    by_second_transfer: dict[int, list[tuple[int, TransitStopTime]]] = {}
    for row in all_times:
        by_trip.setdefault(row.trip_id, []).append(row)
    for trip_id in {row.trip_id for row in destination_times}:
        for row in by_trip.get(trip_id, []):
            by_second_transfer.setdefault(row.stop_id, []).append((trip_id, row))
    trips = {t.id: t for t in db.scalars(select(TransitTrip).where(TransitTrip.id.in_(relevant_trip_ids)))}
    route_ids = {trip.route_id for trip in trips.values()}
    routes = {r.id: r for r in db.scalars(select(TransitRoute).where(TransitRoute.id.in_(route_ids)))}
    frequency_rows = list(db.scalars(select(TransitFrequency).where(TransitFrequency.trip_id.in_(relevant_trip_ids))))
    frequencies_by_trip: dict[int, list[TransitFrequency]] = {}
    for frequency in frequency_rows:
        frequencies_by_trip.setdefault(frequency.trip_id, []).append(frequency)
    stop_by_id = {s.id: s for s in stops}
    origin_distance = {s.id: d for d, s in origins}
    destination_distance = {s.id: d for d, s in destinations}
    origin_rows_by_trip: dict[int, list[TransitStopTime]] = {}
    dest_rows_by_trip: dict[int, list[TransitStopTime]] = {}
    for row in origin_times:
        origin_rows_by_trip.setdefault(row.trip_id, []).append(row)
    for row in destination_times:
        dest_rows_by_trip.setdefault(row.trip_id, []).append(row)
    results: list[dict] = []

    for day_offset in (0, 1):
        service_day = now.date() + timedelta(days=day_offset)
        active_services = _active_service_ids(db, service_day)
        for first_trip_id, start_rows in origin_rows_by_trip.items():
            first_trip = trips.get(first_trip_id)
            first_schedule = by_trip.get(first_trip_id, [])
            if not first_trip or first_trip.service_id not in active_services or not first_schedule:
                continue
            first_frequencies = frequencies_by_trip.get(first_trip_id, [])
            for origin_time in start_rows:
                first_departures = _service_instances_for_stop(
                    first_schedule, origin_time, first_frequencies, service_day, now, horizon, tz
                )
                for origin_departure, first_shift, first_frequency in first_departures:
                    for transfer_in in first_schedule:
                        if transfer_in.stop_sequence <= origin_time.stop_sequence or transfer_in.stop_id not in by_second_transfer:
                            continue
                        transfer_arrival_template = _gtfs_datetime(service_day, transfer_in.arrival_time, tz)
                        if transfer_arrival_template is None:
                            continue
                        transfer_arrival = transfer_arrival_template + first_shift
                        for second_trip_id, transfer_out in by_second_transfer[transfer_in.stop_id]:
                            if second_trip_id == first_trip_id:
                                continue
                            second_trip = trips.get(second_trip_id)
                            second_schedule = by_trip.get(second_trip_id, [])
                            if not second_trip or second_trip.service_id not in active_services or not second_schedule:
                                continue
                            if transfer_out.stop_sequence >= max((item.stop_sequence for item in second_schedule if item.stop_id in destination_ids), default=-1):
                                continue
                            second_frequencies = frequencies_by_trip.get(second_trip_id, [])
                            second_departures = _service_instances_for_stop(
                                second_schedule, transfer_out, second_frequencies, service_day,
                                max(now, transfer_arrival + timedelta(minutes=2)), horizon, tz,
                            )
                            for transfer_departure, second_shift, second_frequency in second_departures:
                                if transfer_departure < transfer_arrival + timedelta(minutes=2) or transfer_departure > transfer_arrival + timedelta(minutes=45):
                                    continue
                                for destination_time in dest_rows_by_trip.get(second_trip_id, []):
                                    if destination_time.stop_sequence <= transfer_out.stop_sequence:
                                        continue
                                    final_arrival_template = _gtfs_datetime(service_day, destination_time.arrival_time, tz)
                                    if final_arrival_template is None:
                                        continue
                                    final_arrival = final_arrival_template + second_shift
                                    if final_arrival <= transfer_departure or final_arrival > horizon:
                                        continue
                                    board_stop = stop_by_id.get(origin_time.stop_id)
                                    transfer_stop = stop_by_id.get(transfer_in.stop_id)
                                    alight_stop = stop_by_id.get(destination_time.stop_id)
                                    route1 = routes.get(first_trip.route_id)
                                    route2 = routes.get(second_trip.route_id)
                                    if not board_stop or not transfer_stop or not alight_stop or not route1 or not route2:
                                        continue
                                    access = origin_distance.get(board_stop.id, 0.0)
                                    egress = destination_distance.get(alight_stop.id, 0.0)
                                    walk_seconds = ceil(access / 1.2) + ceil(egress / 1.2)
                                    duration = max(60, ceil((final_arrival - now).total_seconds()) + walk_seconds)
                                    track_distance = haversine_m(board_stop.latitude, board_stop.longitude, transfer_stop.latitude, transfer_stop.longitude) + haversine_m(transfer_stop.latitude, transfer_stop.longitude, alight_stop.latitude, alight_stop.longitude)
                                    frequency_used = first_frequency is not None or second_frequency is not None
                                    headway_estimate = any(
                                        f is not None and not f.exact_times for f in (first_frequency, second_frequency)
                                    )
                                    results.append({
                                        "label": f"{route1.mode.title()} {route1.short_name or route1.external_id} + {route2.mode.title()} {route2.short_name or route2.external_id}",
                                        "mode": "transit", "duration_seconds": duration, "distance_meters": round(access + track_distance + egress, 1),
                                        "traffic_delay_seconds": 0, "pollution_score": None, "estimated_aqi": None, "estimated_co2_grams": None,
                                        "transfers": 1, "provider": "gtfs-frequency" if frequency_used else "gtfs-static",
                                        "data_quality": "headway-estimate" if headway_estimate else "scheduled", "geometry": {},
                                        "itinerary": {
                                            "transfers": 1, "transfer_stop": transfer_stop.name, "transfer_stop_external_id": transfer_stop.external_id,
                                            "legs": [
                                                {"route_external_id": route1.external_id, "route_name": route1.long_name or route1.short_name, "mode": route1.mode,
                                                 "trip_external_id": first_trip.external_id, "board_stop": board_stop.name, "board_at": origin_departure.isoformat(),
                                                 "alight_stop": transfer_stop.name, "arrive_at": transfer_arrival.isoformat(),
                                                 "headway_seconds": first_frequency.headway_secs if first_frequency else None},
                                                {"route_external_id": route2.external_id, "route_name": route2.long_name or route2.short_name, "mode": route2.mode,
                                                 "trip_external_id": second_trip.external_id, "board_stop": transfer_stop.name, "board_at": transfer_departure.isoformat(),
                                                 "alight_stop": alight_stop.name, "arrive_at": final_arrival.isoformat(),
                                                 "headway_seconds": second_frequency.headway_secs if second_frequency else None},
                                            ], "access_distance_meters": round(access, 1), "egress_distance_meters": round(egress, 1),
                                        },
                                        "warnings": (
                                            ["Headway-based departure estimate from GTFS frequencies.txt; departure and transfer times may vary."] if headway_estimate else []
                                        ) + ["GTFS schedules do not include live delays unless a real-time feed is ingested."],
                                        "_sort": duration,
                                    })
                                    if len(results) >= 200:
                                        break
                                if len(results) >= 200:
                                    break
                            if len(results) >= 200:
                                break
                        if len(results) >= 200:
                            break
                    if len(results) >= 200:
                        break
                if len(results) >= 200:
                    break
            if len(results) >= 200:
                break
    results.sort(key=lambda item: item["_sort"])
    unique_results: list[dict] = []
    seen = set()
    for item in results:
        key = (
            item["itinerary"]["legs"][0]["trip_external_id"],
            item["itinerary"]["legs"][1]["trip_external_id"],
            item["itinerary"]["legs"][0]["board_at"],
            item["itinerary"]["legs"][1]["board_at"],
        )
        if key in seen:
            continue
        seen.add(key)
        item.pop("_sort", None)
        unique_results.append(item)
        if len(unique_results) >= max_options:
            break
    return unique_results
