from datetime import datetime, timedelta
from math import ceil
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db import get_db
from app.dependencies import require_ingestion_access, require_roles
from app.models import TransitAlert, TransitCalendarDate, TransitFrequency, TransitRealtimeArrival, TransitRoute, TransitStop, TransitStopTime, TransitTrip
from app.schemas import GtfsImportOut, RealtimeArrivalIn, TransitAlertIn, TransitRouteOut, TransitStopOut
from app.services.common import audit, utc_now
from app.services.gtfs import _active_service_ids, _gtfs_datetime, import_gtfs_zip
from app.services.gtfs import find_direct_transit_options
from zoneinfo import ZoneInfo

router = APIRouter(prefix="/transit", tags=["Public transport"])


@router.get("/routes", response_model=list[TransitRouteOut])
def list_routes(db: Session = Depends(get_db), mode: str | None = None, limit: int = 200, offset: int = 0):
    query = select(TransitRoute).order_by(TransitRoute.mode, TransitRoute.short_name, TransitRoute.long_name)
    if mode:
        query = query.where(TransitRoute.mode == mode)
    return list(db.scalars(query.offset(max(0, offset)).limit(max(1, min(limit, 500)))))


@router.get("/stops", response_model=list[TransitStopOut])
def list_stops(db: Session = Depends(get_db), search: str | None = None, latitude: float | None = None, longitude: float | None = None, limit: int = 100):
    query = select(TransitStop).order_by(TransitStop.name)
    if search:
        if len(search) > 100:
            raise HTTPException(status_code=422, detail="search cannot exceed 100 characters")
        query = query.where(TransitStop.name.ilike(f"%{search}%"))
    rows = list(db.scalars(query.limit(max(1, min(limit, 500)))))
    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=422, detail="latitude and longitude must be supplied together")
    if latitude is not None and longitude is not None:
        from app.services.common import haversine_m
        rows = sorted(rows, key=lambda s: haversine_m(latitude, longitude, s.latitude, s.longitude) if s.latitude is not None and s.longitude is not None else float("inf"))
    return rows


@router.get("/stops/{stop_external_id}/arrivals")
def stop_arrivals(stop_external_id: str, db: Session = Depends(get_db), minutes_ahead: int = Query(default=120, ge=1, le=720), limit: int = Query(default=50, ge=1, le=200)):
    stop = db.scalar(select(TransitStop).where(TransitStop.external_id == stop_external_id))
    if not stop:
        raise HTTPException(status_code=404, detail="Transit stop not found")
    from app.services.common import utc_now
    from zoneinfo import ZoneInfo
    now_utc = utc_now()
    cutoff = now_utc + timedelta(minutes=minutes_ahead)
    recent_rt_cutoff = now_utc - timedelta(minutes=15)
    realtime = list(db.scalars(select(TransitRealtimeArrival).where(
        TransitRealtimeArrival.stop_id == stop.id,
        TransitRealtimeArrival.observed_at >= recent_rt_cutoff,
        TransitRealtimeArrival.expected_at >= now_utc,
        TransitRealtimeArrival.expected_at <= cutoff,
    ).order_by(TransitRealtimeArrival.expected_at).limit(limit)))
    rows = []
    for item in realtime:
        route = db.get(TransitRoute, item.route_id) if item.route_id else None
        rows.append({"expected_at": item.expected_at.isoformat(), "route": route.short_name or route.long_name if route else None,
                     "route_external_id": route.external_id if route else None, "mode": route.mode if route else None,
                     "delay_seconds": item.delay_seconds, "vehicle_id": item.vehicle_id,
                     "source": item.source, "data_quality": "realtime", "observed_at": item.observed_at.isoformat()})

    # Static schedule remains available if no live arrival is supplied for a departure.
    tz = ZoneInfo(settings.timezone)
    now_local = datetime.now(tz)
    trip_ids = set(db.scalars(select(TransitStopTime.trip_id).where(TransitStopTime.stop_id == stop.id)))
    if trip_ids:
        trips = {t.id: t for t in db.scalars(select(TransitTrip).where(TransitTrip.id.in_(trip_ids)))}
        routes = {r.id: r for r in db.scalars(select(TransitRoute))}
        schedule_rows = list(db.scalars(select(TransitStopTime).where(TransitStopTime.stop_id == stop.id).order_by(TransitStopTime.departure_time).limit(20000)))
        frequency_rows = list(db.scalars(select(TransitFrequency).where(TransitFrequency.trip_id.in_(trip_ids))))
        frequencies_by_trip: dict[int, list[TransitFrequency]] = {}
        for frequency in frequency_rows:
            frequencies_by_trip.setdefault(frequency.trip_id, []).append(frequency)
        for day_offset in (0, 1):
            service_day = now_local.date() + timedelta(days=day_offset)
            active_services = _active_service_ids(db, service_day)
            # Headway-based frequency trips emit predicted arrivals per GTFS frequency window.
            for st in schedule_rows:
                trip = trips.get(st.trip_id)
                if not trip or trip.service_id not in active_services:
                    continue
                if st.trip_id in frequencies_by_trip:
                    continue  # frequencies.txt replaces the template trip's single scheduled instance
                expected = _gtfs_datetime(service_day, st.departure_time, tz)
                if expected is None or expected < now_local or expected > now_local + timedelta(minutes=minutes_ahead):
                    continue
                route = routes.get(trip.route_id)
                # If a recent realtime observation is within 60 seconds of this scheduled time, suppress duplicate.
                expected_utc = expected.astimezone(now_utc.tzinfo)
                if any(abs((datetime.fromisoformat(r["expected_at"]).astimezone(now_utc.tzinfo) - expected_utc).total_seconds()) < 60 and r["route_external_id"] == (route.external_id if route else None) for r in rows):
                    continue
                rows.append({"expected_at": expected_utc.isoformat(), "route": (route.short_name or route.long_name) if route else None,
                             "route_external_id": route.external_id if route else None, "mode": route.mode if route else None,
                             "delay_seconds": None, "vehicle_id": None, "source": "gtfs-static",
                             "data_quality": "scheduled", "observed_at": None})

            # Frequency-based trips: calculate the stop's offset from the first stop and
            # emit only the upcoming headway departures; these are timetable estimates.
            max_expected_local = now_local + timedelta(minutes=minutes_ahead)
            for trip_id, trip_frequencies in frequencies_by_trip.items():
                trip = trips.get(trip_id)
                if not trip or trip.service_id not in active_services:
                    continue
                this_stop_times = list(db.scalars(select(TransitStopTime).where(TransitStopTime.trip_id == trip_id).order_by(TransitStopTime.stop_sequence)))
                if not this_stop_times:
                    continue
                first_time = this_stop_times[0]
                stop_time = next((t for t in this_stop_times if t.stop_id == stop.id), None)
                if stop_time is None:
                    continue
                first_departure = _gtfs_datetime(service_day, first_time.departure_time, tz)
                stop_departure_template = _gtfs_datetime(service_day, stop_time.departure_time, tz)
                if first_departure is None or stop_departure_template is None:
                    continue
                offset_seconds = max(0, int((stop_departure_template - first_departure).total_seconds()))
                route = routes.get(trip.route_id)
                for frequency in trip_frequencies:
                    window_start = _gtfs_datetime(service_day, frequency.start_time, tz)
                    window_end = _gtfs_datetime(service_day, frequency.end_time, tz)
                    if window_start is None or window_end is None or frequency.headway_secs <= 0 or window_end <= window_start:
                        continue
                    first_stop_instance = window_start
                    # Jump close to the requested window instead of iterating from service opening.
                    earliest_origin_dep = first_stop_instance + timedelta(seconds=offset_seconds)
                    start_n = max(0, int((now_local - earliest_origin_dep).total_seconds() // frequency.headway_secs))
                    start_n = max(0, start_n - 1)
                    max_n = min(1000, ceil((window_end - window_start).total_seconds() / frequency.headway_secs))
                    for n in range(start_n, max_n):
                        origin_departure = first_stop_instance + timedelta(seconds=n * frequency.headway_secs + offset_seconds)
                        if origin_departure > max_expected_local:
                            break
                        if origin_departure < now_local:
                            continue
                        expected_utc = origin_departure.astimezone(now_utc.tzinfo)
                        if any(abs((datetime.fromisoformat(r["expected_at"]).astimezone(now_utc.tzinfo) - expected_utc).total_seconds()) < 60 and r["route_external_id"] == (route.external_id if route else None) for r in rows):
                            continue
                        rows.append({"expected_at": expected_utc.isoformat(), "route": (route.short_name or route.long_name) if route else None,
                                     "route_external_id": route.external_id if route else None, "mode": route.mode if route else None,
                                     "delay_seconds": None, "vehicle_id": None, "source": "gtfs-frequency",
                                     "data_quality": "headway-estimate", "observed_at": None,
                                     "headway_seconds": frequency.headway_secs, "exact_times": frequency.exact_times})
    rows.sort(key=lambda r: r["expected_at"])
    return {"stop": TransitStopOut.model_validate(stop).model_dump(mode="json"), "generated_at": now_utc.isoformat(),
            "minutes_ahead": minutes_ahead, "arrivals": rows[:limit],
            "status": "available" if rows else "no_arrival_data",
            "note": "Realtime estimates are preferred where provided. Static GTFS arrivals are schedules, not live vehicle positions."}


@router.get("/plan")
def plan_transit(origin_latitude: float = Query(ge=-90, le=90), origin_longitude: float = Query(ge=-180, le=180), destination_latitude: float = Query(ge=-90, le=90), destination_longitude: float = Query(ge=-180, le=180), departure_at: datetime | None = None, db: Session = Depends(get_db)):
    options = find_direct_transit_options(db, origin_latitude, origin_longitude, destination_latitude, destination_longitude, departure_at=departure_at)
    return {"options": options, "status": "available" if options else "no_journey_found", "limitations": ["Transit planning supports direct and one-transfer journeys; journeys needing two or more transfers are not computed.", "Frequency-based departures are headway estimates when GTFS exact_times is not enabled.", "Static schedule values are not real-time arrivals; ingest a real-time feed to show current delays."]}


@router.post("/gtfs/import", response_model=GtfsImportOut, status_code=200)
async def upload_gtfs(file: UploadFile = File(...), db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    filename = file.filename or "feed.zip"
    max_bytes = settings.gtfs_max_upload_mb * 1024 * 1024
    content = await file.read(max_bytes + 1)
    await file.close()
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"GTFS upload exceeds {settings.gtfs_max_upload_mb} MB")
    try:
        result = import_gtfs_zip(db, content, filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    audit(db, user.id, "gtfs.feed_imported", "gtfs_feed", filename, result)
    db.commit()
    return result


@router.post("/realtime-arrivals", status_code=201)
def ingest_realtime_arrival(payload: RealtimeArrivalIn, request: Request, db: Session = Depends(get_db), actor=Depends(require_ingestion_access)):
    stop = db.scalar(select(TransitStop).where(TransitStop.external_id == payload.stop_external_id))
    if not stop:
        raise HTTPException(status_code=404, detail="stop_external_id is unknown; import/register the stop first")
    route = None
    if payload.route_external_id:
        route = db.scalar(select(TransitRoute).where(TransitRoute.external_id == payload.route_external_id))
        if not route:
            raise HTTPException(status_code=404, detail="route_external_id is unknown; import/register the route first")
    row = TransitRealtimeArrival(stop_id=stop.id, route_id=route.id if route else None, expected_at=payload.expected_at,
                                 delay_seconds=payload.delay_seconds, vehicle_id=payload.vehicle_id, source=payload.source)
    db.add(row)
    audit(db, getattr(actor, "id", None), "transit.realtime_arrival_ingested", "transit_stop", str(stop.id), {"source": payload.source}, request.client.host if request.client else None)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "stop_external_id": stop.external_id, "route_external_id": route.external_id if route else None, "expected_at": row.expected_at.isoformat(), "status": "accepted"}


@router.get("/alerts")
def transit_alerts(db: Session = Depends(get_db), status_filter: str = Query(default="active", alias="status"), limit: int = 100):
    query = select(TransitAlert).order_by(TransitAlert.created_at.desc())
    if status_filter:
        query = query.where(TransitAlert.status == status_filter)
    return list(db.scalars(query.limit(max(1, min(limit, 300)))))


@router.post("/alerts", status_code=201)
def upsert_transit_alert(payload: TransitAlertIn, request: Request, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    row = db.scalar(select(TransitAlert).where(TransitAlert.external_id == payload.external_id)) if payload.external_id else None
    if row is None:
        row = TransitAlert(external_id=payload.external_id, **payload.model_dump(exclude={"external_id"}))
        db.add(row)
    else:
        for key, value in payload.model_dump(exclude={"external_id"}).items():
            setattr(row, key, value)
    audit(db, user.id, "transit.alert_upserted", "transit_alert", payload.external_id, {"severity": payload.severity}, request.client.host if request.client else None)
    db.commit()
    db.refresh(row)
    return row
