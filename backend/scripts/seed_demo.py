"""Idempotently seed a fully populated UrbanSaarthi demo workspace.

All records created by this script are synthetic and explicitly marked as such.
Run from backend/ after migrations: python scripts/seed_demo.py
"""
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import select
from app.db import SessionLocal
from app.demo_workspace import get_demo_workspace_user
from app.models import (
    AqiObservation, CityAlert, CityCluster, DataSource, Junction, RouteOption,
    SignalPlan, SimulationRun, TicketOrder, TrafficForecast, TrafficObservation,
    TransitAlert, TransitCalendar, TransitFrequency, TransitRealtimeArrival, TransitRoute, TransitStop,
    TransitStopTime, TransitTrip, Trip,
)
from app.services.common import utc_now

# The location labels are useful map anchors; their coordinates are demonstration
# approximations, not surveyed controller/station locations or official sensor sites.
CITY_POINTS = [
    ("Connaught Place", 28.6315, 77.2167), ("India Gate", 28.6129, 77.2295),
    ("ITO", 28.6289, 77.2405), ("Anand Vihar", 28.6469, 77.3160),
    ("RK Puram", 28.5633, 77.1869), ("Punjabi Bagh", 28.6683, 77.1198),
    ("Dwarka Sector 8", 28.5650, 77.0670), ("Ashok Vihar", 28.6954, 77.1810),
    ("Mandir Marg", 28.6358, 77.2005), ("Lodhi Road", 28.5918, 77.2273),
    ("Chandni Chowk", 28.6506, 77.2303), ("Patparganj", 28.6230, 77.2870),
    ("Okhla Phase II", 28.5308, 77.2713), ("Najafgarh", 28.6127, 76.9798),
    ("Vivek Vihar", 28.6720, 77.3150), ("Wazirpur", 28.6998, 77.1654),
    ("Nehru Nagar", 28.5679, 77.2500), ("Sonia Vihar", 28.7105, 77.2490),
    ("Greater Kailash", 28.5480, 77.2420), ("Noida Sector 62", 28.6280, 77.3649),
    ("Ghaziabad Indirapuram", 28.6460, 77.3700), ("Gurugram Sector 51", 28.4320, 77.0730),
    ("Faridabad Sector 16A", 28.4080, 77.3070), ("Vasant Kunj", 28.5200, 77.1580),
]
AQI_BASE = [174, 142, 211, 286, 158, 232, 119, 203, 137, 104, 196, 248, 188, 121, 258, 219, 171, 193, 116, 207, 229, 128, 154, 99]
TRANSIT_STOPS = [
    ("New Delhi Railway Station",28.6420,77.2196), ("Rajiv Chowk",28.6328,77.2197),
    ("Patel Chowk",28.6233,77.2137), ("Central Secretariat",28.6147,77.2090),
    ("Khan Market",28.6000,77.2270), ("Mandi House",28.6259,77.2345),
    ("Supreme Court",28.6234,77.2496), ("Yamuna Bank",28.6233,77.2677),
    ("Akshardham",28.6233,77.2775), ("Kashmere Gate",28.6674,77.2282),
    ("Vishwavidyalaya",28.6880,77.2216), ("Hauz Khas",28.5430,77.2066),
    ("AIIMS",28.5672,77.2100), ("Lajpat Nagar",28.5701,77.2363),
    ("INA",28.5757,77.2074), ("Dhaula Kuan",28.5918,77.1613),
    ("Rajendra Place",28.6425,77.1782), ("Karol Bagh",28.6517,77.1900),
    ("ITO Bus Stop",28.6289,77.2405), ("Connaught Place Bus Stop",28.6315,77.2167),
    ("Anand Vihar Terminal",28.6469,77.3160), ("Dwarka Sector 21",28.5523,77.0583),
    ("Botanical Garden",28.5640,77.3340), ("Janakpuri West",28.6295,77.0770),
    ("Nehru Place",28.5491,77.2510), ("India Gate Bus Stop",28.6129,77.2295),
    ("Nizamuddin",28.5884,77.2505), ("Vasant Kunj",28.5200,77.1580),
]
TRANSIT_ROUTES = [
    ("Yellow Line", "Samaypur Badli ↔ HUDA City Centre", "metro", "D9B62D", ["Vishwavidyalaya","Kashmere Gate","New Delhi Railway Station","Rajiv Chowk","Patel Chowk","Central Secretariat","INA","AIIMS","Hauz Khas"]),
    ("Blue Line", "Dwarka Sector 21 ↔ Noida Electronic City", "metro", "3979C3", ["Dwarka Sector 21","Rajiv Chowk","Mandi House","Yamuna Bank","Akshardham","Anand Vihar Terminal"]),
    ("Violet Line", "Kashmere Gate ↔ Raja Nahar Singh", "metro", "8B63B4", ["Kashmere Gate","ITO Bus Stop","Mandi House","Khan Market","Central Secretariat","Lajpat Nagar"]),
    ("Pink Line", "Majlis Park ↔ Shiv Vihar", "metro", "D86D91", ["Dhaula Kuan","INA","Lajpat Nagar","Nizamuddin","Anand Vihar Terminal"]),
    ("Magenta Line", "Janakpuri West ↔ Botanical Garden", "metro", "AF4A9B", ["Janakpuri West","Dhaula Kuan","Vasant Kunj","Hauz Khas","Botanical Garden"]),
    ("Airport Express", "New Delhi ↔ Dwarka Sector 21", "metro", "B5A6A2", ["New Delhi Railway Station","Rajiv Chowk","Dwarka Sector 21"]),
    ("Rapid 410", "Connaught Place ↔ India Gate", "bus", "E18A42", ["Connaught Place Bus Stop","ITO Bus Stop","India Gate Bus Stop"]),
    ("Rapid 522", "ITO ↔ Hauz Khas", "bus", "5A9B80", ["ITO Bus Stop","Lajpat Nagar","AIIMS","Hauz Khas"]),
    ("Rapid 615", "Kashmere Gate ↔ Anand Vihar", "bus", "477D99", ["Kashmere Gate","ITO Bus Stop","Anand Vihar Terminal"]),
    ("Rapid 728", "Rajiv Chowk ↔ Dwarka Sector 8", "bus", "B87551", ["Rajiv Chowk","New Delhi Railway Station","Janakpuri West"]),
    ("Rapid 740", "AIIMS ↔ Nehru Place", "bus", "8A9865", ["AIIMS","Lajpat Nagar","Nehru Place"]),
    ("Rapid 894", "Lajpat Nagar ↔ Noida Sector 62", "bus", "6B83C3", ["Lajpat Nagar","Mandi House","Anand Vihar Terminal"]),
]


def category_for(aqi: float) -> str:
    if aqi <= 50: return "Good"
    if aqi <= 100: return "Satisfactory"
    if aqi <= 200: return "Moderate"
    if aqi <= 300: return "Poor"
    return "Very Poor"


def upsert_source(db, external_id, name, source_type, provider, status="not_configured", safe_config=None):
    row = db.scalar(select(DataSource).where(DataSource.external_id == external_id))
    if row is None:
        row = DataSource(external_id=external_id, name=name, source_type=source_type, provider=provider)
        db.add(row)
    row.name, row.source_type, row.provider, row.status = name, source_type, provider, status
    row.safe_config = safe_config or {"is_synthetic": external_id == "synthetic-demo"}
    if status == "online":
        row.last_success_at = utc_now()
        row.last_error = None
    return row


def seed_network(db):
    clusters, junctions = [], []
    for i, (place, lat, lon) in enumerate(CITY_POINTS, start=1):
        cluster_key = f"DEMO-CLUSTER-{i:02d}"
        cluster = db.scalar(select(CityCluster).where(CityCluster.external_id == cluster_key))
        if cluster is None:
            cluster = CityCluster(external_id=cluster_key, name=f"Demo cluster · {place}", city="Delhi NCR (synthetic demo)", config={"is_synthetic": True})
            db.add(cluster)
        cluster.name = f"Demo cluster · {place}"
        cluster.city = "Delhi NCR (synthetic demo)"
        cluster.status = "online" if i % 7 else "degraded"
        cluster.config = {"is_synthetic": True, "coordinates_verified": False}
        db.flush()
        clusters.append(cluster)
        for offset_idx, offset in enumerate([(-0.0014, 0.0011), (0.0011, -0.0010)], start=1):
            external_id = f"DEMO-JUNCTION-{i:02d}-{offset_idx:02d}"
            junction = db.scalar(select(Junction).where(Junction.external_id == external_id))
            if junction is None:
                junction = Junction(external_id=external_id, name=f"Demo junction · {place} {offset_idx}", cluster_id=cluster.id,
                                    latitude=lat + offset[0], longitude=lon + offset[1], status="online", lane_count=4,
                                    baseline_cycle_seconds=90, configuration={})
                db.add(junction)
            junction.name = f"Demo junction · {place} {offset_idx}"
            junction.cluster_id = cluster.id
            junction.latitude, junction.longitude = lat + offset[0], lon + offset[1]
            junction.status = "degraded" if (i + offset_idx) % 11 == 0 else "online"
            junction.lane_count = 4 if i % 5 else 6
            junction.baseline_cycle_seconds = 90 + (i % 4) * 5
            junction.configuration = {"is_synthetic": True, "coordinates_verified": False, "demo_place_anchor": place}
            db.flush()
            junctions.append(junction)
    return clusters, junctions


def seed_aqi(db, now):
    # Replace generated rows on each seed so they remain recent and repeated seed runs
    # remain idempotent. Only records whose source is synthetic-demo are affected.
    for row in db.scalars(select(AqiObservation).where(AqiObservation.source == "synthetic-demo")):
        db.delete(row)
    db.flush()
    for i, (place, lat, lon) in enumerate(CITY_POINTS):
        for sample in range(8):
            aqi = max(38, AQI_BASE[i] + ((sample * 7 + i * 3) % 31) - 15)
            observed_at = now - timedelta(hours=sample * 3, minutes=(i * 7) % 40)
            db.add(AqiObservation(
                external_station_id=f"DEMO-AQI-{i+1:02d}", station_name=f"Demo monitor · {place}",
                latitude=lat, longitude=lon, source="synthetic-demo", observed_at=observed_at,
                aqi=float(aqi), pm25=round(aqi * 0.41, 1), pm10=round(aqi * 0.72, 1),
                no2=round(14 + (i * 7 + sample * 3) % 36, 1), o3=round(18 + (i * 11 + sample * 5) % 48, 1),
                co=round(0.3 + ((i + sample) % 8) * 0.11, 2), category=category_for(aqi),
                raw_payload={"is_synthetic": True, "origin": "scripts/seed_demo.py", "note": "Not an official CPCB/CAAQMS observation."},
            ))


def seed_traffic(db, junctions, now):
    for row in db.scalars(select(TrafficObservation).where(TrafficObservation.source == "synthetic-demo")):
        db.delete(row)
    db.flush()
    for i, junction in enumerate(junctions):
        base_congestion = 24 + (i * 17) % 73
        # Recent readings keep command centre and route optimization populated.
        for sample in range(6):
            congestion = max(8, min(98, base_congestion + ((sample * 5 + i) % 17) - 8))
            observed_at = now - timedelta(minutes=3 + sample * 6 + (i % 4))
            vehicles = 24 + ((i * 19 + sample * 23) % 150)
            queue = round(5 + ((i * 7 + sample * 9) % 58), 1)
            speed = round(max(6, 44 - congestion * 0.29 + (sample % 3) * 2), 1)
            db.add(TrafficObservation(
                junction_id=junction.id, external_junction_id=junction.external_id, source="synthetic-demo", observed_at=observed_at,
                vehicle_count=vehicles, queue_length_m=queue, average_speed_kmph=speed,
                average_wait_seconds=round(12 + congestion * 0.7, 1), lane_density=round(min(0.96, 0.16 + congestion / 120), 2),
                congestion_score=float(congestion),
                lane_demand={"north_south_through": 12 + (i % 40), "east_west_through": 10 + (i % 30), "north_south_turn": 5 + (i % 15), "east_west_turn": 3 + (i % 10)},
                detection_summary={"is_synthetic": True, "origin": "scripts/seed_demo.py", "sample_index": sample},
            ))
        # 7 days of hourly sample points support historical charts without creating a huge DB.
        for hour in range(1, 169, 6):
            historical = max(9, min(96, base_congestion + ((hour // 6 + i * 3) % 31) - 15))
            db.add(TrafficObservation(
                junction_id=junction.id, external_junction_id=junction.external_id, source="synthetic-demo", observed_at=now - timedelta(hours=hour),
                vehicle_count=20 + ((i * 11 + hour) % 128), queue_length_m=round(4 + ((i * 5 + hour) % 54), 1),
                average_speed_kmph=round(max(7, 43 - historical * 0.28), 1), average_wait_seconds=round(12 + historical * 0.65, 1),
                lane_density=round(min(0.95, 0.18 + historical / 125), 2), congestion_score=float(historical),
                lane_demand={"north_south_through": 10 + (i % 32), "east_west_through": 8 + (hour % 25)},
                detection_summary={"is_synthetic": True, "origin": "scripts/seed_demo.py", "historical_sample": True},
            ))


def seed_transit(db, now):
    # Delete only synthetic child rows before their parent routes. Demo stops are
    # updated in place rather than removed, so an imported real GTFS feed that
    # happens to reuse a station cannot lose its stop-time records.
    demo_route_keys = list(db.scalars(select(TransitRoute.id).where(TransitRoute.external_id.like("DEMO-ROUTE-%"))))
    demo_trip_keys = list(db.scalars(select(TransitTrip.id).where(TransitTrip.external_id.like("DEMO-GTFS-TRIP-%"))))
    if demo_trip_keys:
        for row in db.scalars(select(TransitStopTime).where(TransitStopTime.trip_id.in_(demo_trip_keys))): db.delete(row)
        for row in db.scalars(select(TransitFrequency).where(TransitFrequency.trip_id.in_(demo_trip_keys))): db.delete(row)
        db.flush()
        for row in db.scalars(select(TransitTrip).where(TransitTrip.id.in_(demo_trip_keys))): db.delete(row)
        db.flush()
    for row in db.scalars(select(TransitRealtimeArrival).where(TransitRealtimeArrival.source == "synthetic-demo")):
        db.delete(row)
    for row in db.scalars(select(TransitAlert).where(TransitAlert.source == "synthetic-demo")):
        db.delete(row)
    db.flush()
    if demo_route_keys:
        for row in db.scalars(select(TransitRoute).where(TransitRoute.id.in_(demo_route_keys))): db.delete(row)
        db.flush()

    stops = {}
    for index, (name, lat, lon) in enumerate(TRANSIT_STOPS, start=1):
        external_id = f"DEMO-STOP-{index:02d}"
        stop = db.scalar(select(TransitStop).where(TransitStop.external_id == external_id))
        if stop is None:
            stop = TransitStop(external_id=external_id, name=name, latitude=lat, longitude=lon,
                               wheelchair_boarding=(index % 3 != 0), parent_station=None, source="synthetic-demo")
            db.add(stop)
        else:
            stop.name, stop.latitude, stop.longitude = name, lat, lon
            stop.wheelchair_boarding, stop.parent_station, stop.source = (index % 3 != 0), None, "synthetic-demo"
        db.flush()
        stops[name] = stop

    service_id = "DEMO-SERVICE-DAILY"
    calendar = db.scalar(select(TransitCalendar).where(TransitCalendar.service_id == service_id))
    if calendar is None:
        calendar = TransitCalendar(service_id=service_id, monday=True, tuesday=True, wednesday=True, thursday=True, friday=True, saturday=True, sunday=True,
                                   start_date=date.today()-timedelta(days=365), end_date=date.today()+timedelta(days=730))
        db.add(calendar)
    else:
        calendar.start_date = date.today()-timedelta(days=365); calendar.end_date = date.today()+timedelta(days=730)
        calendar.monday = calendar.tuesday = calendar.wednesday = calendar.thursday = calendar.friday = calendar.saturday = calendar.sunday = True

    for index, (short_name, long_name, mode, color, stop_names) in enumerate(TRANSIT_ROUTES, start=1):
        route = TransitRoute(external_id=f"DEMO-ROUTE-{index:02d}", short_name=short_name, long_name=long_name, mode=mode,
                             agency_name="UrbanSaarthi synthetic network", route_color=color, source="synthetic-demo")
        db.add(route); db.flush()
        trip = TransitTrip(external_id=f"DEMO-GTFS-TRIP-{index:02d}", route_id=route.id, service_id=service_id,
                           headsign=stop_names[-1], direction_id="0", wheelchair_accessible=True)
        db.add(trip); db.flush()
        for sequence, stop_name in enumerate(stop_names, start=1):
            seconds = (sequence - 1) * (8 * 60 if mode == "metro" else 11 * 60)
            hour, remainder = divmod(seconds, 3600); minute, second = divmod(remainder, 60)
            clock = f"{5+hour:02d}:{minute:02d}:{second:02d}"
            db.add(TransitStopTime(trip_id=trip.id, stop_id=stops[stop_name].id, stop_sequence=sequence,
                                   arrival_time=clock, departure_time=clock, pickup_type="0", drop_off_type="0"))
        db.add(TransitFrequency(trip_id=trip.id, start_time="05:00:00", end_time="23:00:00", headway_secs=600 if mode == "metro" else 900, exact_times=False))

    transit_alerts = [
        ("DEMO-TRANSIT-ALERT-01", "Demo notice · Blue Line peak crowding", "Synthetic crowding notice for preview only.", "medium", ["DEMO-ROUTE-02"], ["DEMO-STOP-02"]),
        ("DEMO-TRANSIT-ALERT-02", "Demo notice · ITO bus diversion", "Illustrative disruption card; no live operator feed is connected.", "high", ["DEMO-ROUTE-08"], ["DEMO-STOP-19"]),
        ("DEMO-TRANSIT-ALERT-03", "Demo notice · Airport Express info", "Sample informational status, not a live timetable confirmation.", "info", ["DEMO-ROUTE-06"], ["DEMO-STOP-01"]),
    ]
    for external_id, title, description, severity, route_ids, stop_ids in transit_alerts:
        db.add(TransitAlert(external_id=external_id, title=title, description=description, severity=severity, status="active",
                            route_external_ids=route_ids, stop_external_ids=stop_ids, starts_at=now-timedelta(minutes=15), source="synthetic-demo"))


def seed_alerts(db, junctions, now):
    for row in db.scalars(select(CityAlert).where(CityAlert.title.like("Demo · %"))): db.delete(row)
    db.flush()
    samples = [
        ("Demo · Elevated congestion near ITO", "Synthetic traffic sample indicates elevated queue pressure for this demo scenario.", "traffic", "high", 2),
        ("Demo · AQI category elevated in Anand Vihar", "Synthetic air-quality sample for the UI demonstration; not an official station alert.", "air_quality", "medium", 6),
        ("Demo · Bus corridor running slow", "Illustrative transit disruption notice for the sample network.", "transit", "medium", 8),
        ("Demo · Camera connection pending", "No real camera stream is claimed to be connected by this demo.", "data_source", "low", 11),
        ("Demo · Peak-hour plan ready for review", "A synthetic signal plan is available for the what-if flow.", "signals", "info", 15),
        ("Demo · Queue spillback scenario", "Sample queue length is above the demo threshold.", "traffic", "high", 19),
        ("Demo · Cleaner route corridor available", "An illustrative lower-emission alternative is ready in the planner.", "mobility", "low", 24),
    ]
    for title, description, category, severity, junction_index in samples:
        junction = junctions[min(junction_index, len(junctions)-1)]
        db.add(CityAlert(public_id=str(uuid.uuid4()), title=title, description=description, category=category, severity=severity,
                         status="active", junction_id=junction.id, latitude=junction.latitude, longitude=junction.longitude,
                         starts_at=now-timedelta(minutes=7 + junction_index*3), created_by_user_id=None))


def seed_signal_plans(db, junctions, now):
    for row in db.scalars(select(SignalPlan).where(SignalPlan.plan_type.like("demo-%"))):
        for run in db.scalars(select(SimulationRun).where(SimulationRun.signal_plan_id == row.id)): db.delete(run)
        db.delete(row)
    for row in db.scalars(select(SimulationRun).where(SimulationRun.name.like("Demo · %"))): db.delete(row)
    db.flush()
    plans = []
    for index, junction in enumerate(junctions[::5][:10]):
        phases = [
            {"name":"North–South", "movement":"north_south", "green_seconds":26+(index%7), "yellow_seconds":3, "all_red_seconds":1, "demand_weight":1.2},
            {"name":"East–West", "movement":"east_west", "green_seconds":22+(index%5), "yellow_seconds":3, "all_red_seconds":1, "demand_weight":1.0},
            {"name":"Protected turns", "movement":"turns", "green_seconds":12+(index%4), "yellow_seconds":3, "all_red_seconds":1, "demand_weight":0.6},
        ]
        cycle = sum(p["green_seconds"] + p["yellow_seconds"] + p["all_red_seconds"] for p in phases)
        plan = SignalPlan(public_id=str(uuid.uuid4()), junction_id=junction.id, created_by_user_id=None,
                          status=["simulated", "draft", "approved", "simulated"][index%4],
                          plan_type=["demo-adaptive-recommendation", "demo-peak-hour", "demo-emissions-aware"][index%3],
                          cycle_seconds=cycle, phases=phases,
                          rationale="Synthetic demonstration strategy based on sample arrival pressure. Review against measured local traffic before real-world use.",
                          projected_outcomes={"is_synthetic":True,"estimated_delay_reduction_pct":7+(index*3)%18,"estimated_queue_reduction_pct":5+(index*4)%22},
                          model_version="demo-scenario-v1", created_at=now-timedelta(days=index%6, hours=index))
        db.add(plan); db.flush(); plans.append((plan,junction))
    for index, (plan, junction) in enumerate(plans[:4]):
        results={"is_synthetic":True,"delay_reduction_pct":round(6.5+index*2.8,1),"queue_reduction_pct":round(9+index*3.4,1),"mean_wait_reduction_seconds":round(4.2+index*1.1,1)}
        db.add(SimulationRun(public_id=str(uuid.uuid4()), junction_id=junction.id, submitted_by_user_id=None,
                             signal_plan_id=plan.id, name=f"Demo · What-if run {index+1}", engine="analytical-demo-v1", status="completed",
                             baseline={"is_synthetic":True,"vehicle_count":80+index*12,"queue_length_m":24+index*3,"average_wait_seconds":42+index*5},
                             proposed_phases=plan.phases, results=results,
                             caveats=["Synthetic demo input; not validated against observed vehicle trajectories.", "No physical traffic signal command was sent."]))


def seed_trips(db, workspace_user, now):
    existing = list(db.scalars(select(Trip).where(Trip.public_id.like("DEMO-SEED-TRIP-%"))))
    for trip in existing:
        for option in db.scalars(select(RouteOption).where(RouteOption.trip_id == trip.id)): db.delete(option)
        db.delete(trip)
    db.flush()
    scenarios = [
        ("New Delhi Railway Station","India Gate",28.6420,77.2196,28.6129,77.2295,"balanced","completed",4850,1020,0),
        ("Rajiv Chowk","Akshardham",28.6328,77.2197,28.6233,77.2775,"fastest","completed",8100,1560,1),
        ("AIIMS","Hauz Khas",28.5672,77.2100,28.5430,77.2066,"cleanest","completed",3600,900,2),
        ("Kashmere Gate","Connaught Place",28.6674,77.2282,28.6315,77.2167,"balanced","in_progress",5200,1200,0),
        ("Lajpat Nagar","Nehru Place",28.5701,77.2363,28.5491,77.2510,"cleanest","planned",4100,1080,3),
        ("Dhaula Kuan","Vasant Kunj",28.5918,77.1613,28.5200,77.1580,"fastest","cancelled",9100,1380,7),
        ("ITO","Patel Chowk",28.6289,77.2405,28.6233,77.2137,"balanced","completed",3300,780,12),
        ("Connaught Place","Anand Vihar",28.6315,77.2167,28.6469,77.3160,"fastest","completed",13100,2280,14),
        ("Patel Chowk","Central Secretariat",28.6233,77.2137,28.6147,77.2090,"cleanest","planned",1750,540,3),
        ("Dwarka Sector 8","New Delhi Railway Station",28.5650,77.0670,28.6420,77.2196,"balanced","completed",22600,3600,19),
        ("Greater Kailash","Lajpat Nagar",28.5480,77.2420,28.5701,77.2363,"fastest","cancelled",3100,840,22),
        ("Anand Vihar","ITO",28.6469,77.3160,28.6289,77.2405,"balanced","completed",10300,1920,27),
    ]
    for index, row in enumerate(scenarios, start=1):
        origin_name,dest_name,olat,olon,dlat,dlon,preference,status,distance,duration,days_back=row
        created = now-timedelta(days=days_back, hours=(index*3)%8)
        trip = Trip(public_id=f"DEMO-SEED-TRIP-{index:03d}", user_id=workspace_user.id,
                    origin_label=origin_name, destination_label=dest_name,
                    origin_latitude=olat, origin_longitude=olon, destination_latitude=dlat, destination_longitude=dlon,
                    preference=preference, status=status, started_at=created+timedelta(minutes=3) if status in {"in_progress","completed"} else None,
                    completed_at=created+timedelta(minutes=duration/60) if status=="completed" else None,
                    distance_meters=distance, duration_seconds=duration,
                    actual_metrics={"is_synthetic":True,"origin":"scripts/seed_demo.py"}, created_at=created)
        db.add(trip); db.flush()
        route_ids=[]
        for option_index, factor in enumerate((1.0,1.12,1.24)):
            option = RouteOption(trip_id=trip.id, label=["Fastest road estimate","Balanced arterial route","Lower-emission alternative"][option_index],
                                 mode="driving", preference_rank=f"{preference}-#{option_index+1}", duration_seconds=int(duration*(1+(factor-1)*0.7)),
                                 distance_meters=distance*factor, traffic_delay_seconds=int(duration*0.06*(option_index+1)),
                                 pollution_score=round(48+option_index*9,1), estimated_aqi=160-option_index*18,
                                 estimated_co2_grams=round(distance/1000*(126-option_index*12),1), transfers=0,
                                 provider="synthetic-demo", data_quality="synthetic-demo",
                                 geometry={"type":"LineString","coordinates":[[olon,olat],[(olon+dlon)/2,(olat+dlat)/2],[dlon,dlat]]},
                                 itinerary={"is_synthetic":True,"note":"Illustrative saved-route details only."},
                                 warnings=["Synthetic saved route; not a verified road-network path."])
            db.add(option); db.flush(); route_ids.append(option.id)
        trip.selected_route_id = route_ids[0]


def seed_tickets(db, workspace_user, now):
    for row in db.scalars(select(TicketOrder).where(TicketOrder.public_id.like("DEMO-SEED-TICKET-%"))): db.delete(row)
    db.flush()
    rows = [
        ("Metro","Rajiv Chowk","Akshardham",1,"requested",0),
        ("Bus","ITO","Hauz Khas",2,"requested",1),
        ("Metro","New Delhi Railway Station","Central Secretariat",1,"cancelled",4),
    ]
    for index, (mode, origin, destination, passengers, status, days_back) in enumerate(rows, start=1):
        db.add(TicketOrder(public_id=f"DEMO-SEED-TICKET-{index:03d}", user_id=workspace_user.id, mode=mode.lower(),
                           origin_label=origin, destination_label=destination, departure_at=now+timedelta(hours=index), passengers=passengers,
                           status=status, provider="not-configured", provider_reference=None, currency="INR", quoted_amount=None,
                           qr_token=f"demo-token-{uuid.uuid4().hex}", booking_response={"is_synthetic":True,"booking_confirmed":False,
                           "message":"Demo request only; no ticket is issued and no payment is processed."}, created_at=now-timedelta(days=days_back)))


def seed_forecasts(db, junctions, now):
    for row in db.scalars(select(TrafficForecast).where(TrafficForecast.model_version == "demo-heuristic-v1")):
        db.delete(row)
    db.flush()
    for index, junction in enumerate(junctions):
        base = 24 + (index*17)%73
        for horizon in (15,30,60):
            predicted_queue = round(max(0, (5+(index*7)%58) * (0.94 + horizon/1000)), 1)
            db.add(TrafficForecast(junction_id=junction.id, generated_at=now, horizon_minutes=horizon,
                                   predicted_queue_length_m=predicted_queue, predicted_vehicle_count=30+(index*19)%140,
                                   predicted_average_wait_seconds=round(15+base*0.65+horizon/10,1),
                                   predicted_congestion_score=round(min(100,max(0,base+(horizon/15-1)*2)),1),
                                   predicted_aqi=float(AQI_BASE[index//2%len(AQI_BASE)]), predicted_co2_grams_per_minute=round(90+base*1.6,1),
                                   confidence=round(0.58+(index%5)*0.06,2), model_version="demo-heuristic-v1",
                                   feature_snapshot={"is_synthetic":True,"origin":"scripts/seed_demo.py","note":"Illustrative heuristic projection, not a validated model."}))


def main():
    now = utc_now()
    db = SessionLocal()
    try:
        workspace_user = get_demo_workspace_user(db)
        clusters, junctions = seed_network(db)
        sources = [
            ("synthetic-demo", "Synthetic demo observations", "other", "Seeded sample records", "online", {"is_synthetic":True}),
            ("camera-edge", "Camera vision edge feed", "camera", "Push event API; no real stream configured", "not_configured", {"is_synthetic":False}),
            ("cpcb-aqi", "Official CPCB / CAAQMS AQI feed", "cpcb", "Authorized provider adapter required", "not_configured", {"is_synthetic":False}),
            ("openaq-v3", "OpenAQ v3 pollutant feed", "openaq", "API key required", "not_configured", {"is_synthetic":False}),
            ("gtfs-static", "GTFS static transit sample", "gtfs", "Synthetic timetable seed", "online", {"is_synthetic":True}),
            ("osrm-routing", "Road-network routing", "osm", "Heuristic fallback active; configure OSRM for road geometry", "degraded", {"is_synthetic":True}),
            ("atcs-signal", "Adaptive traffic signal controller", "atcs", "Preview-only; physical signal writes disabled", "not_configured", {"is_synthetic":False}),
            ("sumo-twin", "SUMO digital twin", "sumo", "Analytical what-if fallback; SUMO runtime not launched", "degraded", {"is_synthetic":True}),
        ]
        for ext,name,stype,provider,status,config in sources:
            upsert_source(db, ext, name, stype, provider, status, config)
        db.flush()
        seed_aqi(db, now)
        seed_traffic(db, junctions, now)
        seed_transit(db, now)
        seed_alerts(db, junctions, now)
        seed_signal_plans(db, junctions, now)
        seed_trips(db, workspace_user, now)
        seed_tickets(db, workspace_user, now)
        seed_forecasts(db, junctions, now)
        db.commit()
        print("UrbanSaarthi demo seed complete.")
        print(f"  {len(clusters)} clusters · {len(junctions)} junctions")
        print(f"  {len(CITY_POINTS) * 8} synthetic AQI observations (24 stations, 8 samples each)")
        print(f"  {len(junctions) * (6 + 28)} synthetic traffic observations")
        print(f"  {len(TRANSIT_ROUTES)} synthetic transit routes and {len(TRANSIT_STOPS)} sample stops, service alerts, signal plans, forecasts and saved trips")
        print("  Reminder: every seeded observation is synthetic; no live data connection is implied.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
