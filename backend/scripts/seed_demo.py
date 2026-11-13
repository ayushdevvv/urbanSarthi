"""Register source adapters and optionally seed explicitly synthetic demo infrastructure.

Usage: python scripts/seed_demo.py [--demo-network] [--demo-telemetry]
The public hackathon build provisions an internal demo operator actor on first use.
"""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import select, text
from app.db import SessionLocal
from app.models import AqiObservation, CityCluster, DataSource, Junction, TrafficObservation
from app.services.common import utc_now


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo-network", action="store_true", help="Create 24 clearly synthetic clusters and 48 demo junctions")
    parser.add_argument("--demo-telemetry", action="store_true", help="Add synthetic traffic/AQI records; also enables --demo-network")
    args = parser.parse_args()
    demo_network = args.demo_network or args.demo_telemetry
    db = SessionLocal()
    try:
        # Several Cloud Run instances can start together. Serialize the
        # idempotent connector seed on PostgreSQL to avoid unique-key races.
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": 741_902_613_2027})
        if demo_network:
            for i in range(1, 25):
                external_id = f"DEMO-CLUSTER-{i:02d}"
                cluster = db.scalar(select(CityCluster).where(CityCluster.external_id == external_id))
                if not cluster:
                    cluster = CityCluster(external_id=external_id, name=f"Demo Mobility Cluster {i:02d}", city="Synthetic demo city", status="unknown", config={"is_synthetic": True})
                    db.add(cluster)
                    db.flush()
                for j in range(1, 3):
                    junction_external = f"DEMO-JUNCTION-{i:02d}-{j:02d}"
                    junction = db.scalar(select(Junction).where(Junction.external_id == junction_external))
                    if not junction:
                        # Coordinates are demo placeholders and must be replaced with the pilot's surveyed coordinates.
                        offset = (i * 2 + j) * 0.001
                        junction = Junction(external_id=junction_external, name=f"Synthetic Junction {i:02d}-{j:02d}", cluster_id=cluster.id,
                                            latitude=28.6139 + offset, longitude=77.2090 - offset, status="unknown", lane_count=4,
                                            baseline_cycle_seconds=90, configuration={"is_synthetic": True, "coordinates_verified": False})
                        db.add(junction)
        default_sources = [
            ("camera-edge", "Camera vision edge feed", "camera", "edge-json-events"),
            ("cpcb-aqi", "CPCB ambient air quality feed", "cpcb", "authorized CPCB integration"),
            ("openaq-v3", "OpenAQ v3", "openaq", "OpenAQ API v3"),
            ("gtfs-static", "GTFS static transit feed", "gtfs", "GTFS ZIP import"),
            ("osrm-routing", "Road network routing", "osm", "OSRM-compatible routing service"),
            ("atcs-signal", "Adaptive traffic signal controller", "atcs", "preview-only; no write adapter"),
            ("sumo-twin", "SUMO digital twin", "sumo", "external SUMO runner integration"),
        ]
        for external_id, name, source_type, provider in default_sources:
            row = db.scalar(select(DataSource).where(DataSource.external_id == external_id))
            if not row:
                row = DataSource(external_id=external_id, name=name, source_type=source_type, provider=provider,
                                 status="not_configured", safe_config={"is_synthetic": False})
                db.add(row)
        if args.demo_telemetry:
            junctions = list(db.scalars(select(Junction).where(Junction.external_id.like("DEMO-JUNCTION-%"))))
            now = utc_now()
            for index, junction in enumerate(junctions):
                db.add(TrafficObservation(junction_id=junction.id, external_junction_id=junction.external_id,
                                          source="synthetic-demo", observed_at=now,
                                          vehicle_count=18 + (index * 7) % 90, queue_length_m=float(5 + (index * 11) % 55),
                                          average_speed_kmph=float(12 + (index * 3) % 38), average_wait_seconds=float(15 + (index * 5) % 100),
                                          lane_density=min(1.0, ((index * 9) % 75) / 100), congestion_score=float((index * 13) % 100),
                                          lane_demand={"north_south_through": 12 + index % 40, "east_west_through": 10 + index % 30,
                                                       "north_south_turn": 5 + index % 15, "east_west_turn": 3 + index % 10},
                                          detection_summary={"is_synthetic": True, "origin": "seed_demo.py"}))
            for i in range(8):
                db.add(AqiObservation(external_station_id=f"DEMO-AQI-{i+1:02d}", station_name=f"Synthetic AQI Station {i+1:02d}",
                                      latitude=28.62 + i * 0.005, longitude=77.20 - i * 0.004, source="synthetic-demo", observed_at=now,
                                      aqi=float(55 + (i * 19) % 250), pm25=float(10 + (i * 7) % 180), pm10=float(20 + (i * 11) % 250),
                                      category="synthetic-demo", raw_payload={"is_synthetic": True, "origin": "seed_demo.py"}))
            if not db.scalar(select(DataSource.id).where(DataSource.external_id == "synthetic-demo")):
                db.add(DataSource(external_id="synthetic-demo", name="Synthetic demo observations", source_type="other", provider="seed_demo.py", status="online", last_success_at=now, safe_config={"is_synthetic": True}))
        db.commit()
        print("Seed complete: connector registry created.")
        print("Synthetic demo network created:", demo_network)
        print("Demo telemetry added:", args.demo_telemetry)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
