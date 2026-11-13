"""Idempotently seed public Delhi reference data.

AQI records are an explicitly historical CPCB/DPCC station snapshot from
2026-10-27 11:00 IST. Junctions are official Delhi Traffic Police hotspot
references with approximate geocoded coordinates; no traffic measurements
or live vehicle counts are fabricated.
Run after migrations: python -m app.scripts.seed_delhi
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
import time
import httpx
from sqlalchemy import select
from app.db import SessionLocal
from app.models import CityAlert, CityCluster, Junction, AqiObservation

AQI_SOURCE = "https://www.aqi.in/in/dashboard/india/delhi"
AQI_SNAPSHOT = datetime(2026, 10, 27, 5, 30, tzinfo=timezone.utc)  # 11:00 IST
TRAFFIC_SOURCE = "https://traffic.delhipolice.gov.in/traffic-circulation-plan"

# Coordinates are approximate locations for finding the corridor on a map.
# Their metadata says so; they are not signal-controller coordinates.
JUNCTIONS = [
    ("delhi-traffic-anand-vihar", "Anand Vihar ISBT", 28.6469, 77.3160, "East Delhi"),
    ("delhi-traffic-ashram", "Ashram Chowk", 28.5712, 77.2590, "South East Delhi"),
    ("delhi-traffic-kalindi", "Kalindi Kunj", 28.5450, 77.3058, "South East Delhi"),
    ("delhi-traffic-dhaula", "Dhaula Kuan", 28.5918, 77.1610, "South West Delhi"),
    ("delhi-traffic-bhairon", "Bhairon Marg T-Point", 28.6120, 77.2434, "Central Delhi"),
    ("delhi-traffic-ip", "IP Flyover", 28.6274, 77.2490, "Central Delhi"),
    ("delhi-traffic-kashmere", "Kashmere Gate ISBT", 28.6675, 77.2280, "North Delhi"),
    ("delhi-traffic-khajuri", "Khajuri Chowk", 28.7115, 77.2570, "North East Delhi"),
    ("delhi-traffic-yusuf", "Yusuf Sarai", 28.5595, 77.2060, "South Delhi"),
    ("delhi-traffic-tilak", "Tilak Marg Circle", 28.6120, 77.2434, "New Delhi"),
]

# Public station summary values in the cited historical page. The source lists
# AQI and dominant pollutant, not station pollutant concentrations; those remain null.
AQI_STATIONS = [
    ("R K Puram", "rk-puram", 28.5633, 77.1869, 233, "PM2.5", "Poor"),
    ("IIT Delhi", "iit-delhi", 28.5425, 77.1917, 231, "PM10", "Poor"),
    ("Anand Vihar", "anand-vihar", 28.6476, 77.3158, 192, "PM10", "Moderate"),
    ("CRRI Mathura Road", "crri-mathura-road", 28.5512, 77.2736, 261, "PM10", "Poor"),
    ("Jahangirpuri", "jahangirpuri", 28.7328, 77.1706, 256, "PM2.5", "Poor"),
    ("Rohini", "rohini", 28.7325, 77.1199, 245, "PM2.5", "Poor"),
    ("Mundka", "mundka", 28.6847, 77.0766, 244, "PM10", "Poor"),
    ("Dwarka Sector 8", "dwarka-sector-8", 28.5710, 77.0719, 236, "PM10", "Poor"),
]

ALERTS = [
    {
        "key": "delhi-chhath-diversions-2026-11-15",
        "title": "Chhath Puja traffic diversions · 15–16 November",
        "description": "Delhi Traffic Police announced diversions around riverfront ghats. Avoid Shanti Van–Nigambodh Ghat, Nanaksar T-Point–Sonia Vihar Toll Tax and the Shastri Park–Khajuri Khas stretch during notified periods. Check the official advisory before travelling. Source: https://traffic.delhipolice.gov.in/traffic-circulation-plan",
        "category": "traffic_diversion", "severity": "high",
        "latitude": 28.6860, "longitude": 77.2450,
        "starts_at": datetime(2026, 11, 15, 0, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
        "ends_at": datetime(2026, 11, 17, 0, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
    },
    {
        "key": "delhi-iitf-traffic-2026-11-14",
        "title": "India International Trade Fair · expected congestion",
        "description": "Delhi Traffic Police advisory notes expected congestion around Mathura Road, Bhairon Marg, Ring Road, Shershah Road, Purana Qila Road, Bhagwan Das Road and Tilak Marg from 14–27 November. Source: https://traffic.delhipolice.gov.in/traffic-circulation-plan",
        "category": "event_traffic", "severity": "medium",
        "latitude": 28.6120, "longitude": 77.2434,
        "starts_at": datetime(2026, 11, 14, 0, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
        "ends_at": datetime(2026, 11, 28, 0, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
    },
]


def seed() -> dict:
    db = SessionLocal()
    counts = {"cluster": 0, "junctions": 0, "aqi_snapshots": 0, "alerts": 0}
    try:
        cluster = db.scalar(select(CityCluster).where(CityCluster.external_id == "delhi-reference-city"))
        if cluster is None:
            cluster = CityCluster(external_id="delhi-reference-city", name="Delhi Reference Network", city="Delhi", status="degraded", config={
                "dataset_type": "public_reference_seed", "coordinates_precision": "approximate_for_junctions",
                "traffic_source": TRAFFIC_SOURCE, "aqi_source": AQI_SOURCE,
                "note": "Reference seed only. No live traffic telemetry is included. AQI snapshot is historical.",
            })
            db.add(cluster); db.flush(); counts["cluster"] = 1
        for ext_id, name, lat, lon, district in JUNCTIONS:
            row = db.scalar(select(Junction).where(Junction.external_id == ext_id))
            if row is None:
                db.add(Junction(external_id=ext_id, name=name, cluster_id=cluster.id, latitude=lat, longitude=lon,
                    status="reference", lane_count=4, baseline_cycle_seconds=90,
                    configuration={"seed_type": "public_corridor_reference", "source": TRAFFIC_SOURCE,
                        "district": district, "reference_only": True, "coordinates_precision": "approximate", "telemetry_connected": False,
                        "note": "Officially named traffic corridor; coordinates are approximate and not signal-controller coordinates."}))
                counts["junctions"] += 1
        for name, ext, lat, lon, aqi, dominant, category in AQI_STATIONS:
            row = db.scalar(select(AqiObservation).where(AqiObservation.external_station_id == f"delhi-{ext}", AqiObservation.observed_at == AQI_SNAPSHOT))
            if row is None:
                db.add(AqiObservation(external_station_id=f"delhi-{ext}", station_name=name, latitude=lat, longitude=lon,
                    source="public_historical_AQI_snapshot", observed_at=AQI_SNAPSHOT, aqi=float(aqi),
                    category=category, raw_payload={"dominant_pollutant": dominant, "snapshot_at_ist": "2026-10-27 11:00",
                        "source_url": AQI_SOURCE, "provenance": "Public station summary; pollutant concentrations were not published in this seed record.",
                        "data_mode": "historical_reference", "live": False}))
                counts["aqi_snapshots"] += 1
        for alert in ALERTS:
            row = db.scalar(select(CityAlert).where(CityAlert.public_id == alert["key"]))
            if row is None:
                db.add(CityAlert(public_id=alert["key"], title=alert["title"], description=alert["description"],
                    category=alert["category"], severity=alert["severity"], status="active", latitude=alert["latitude"],
                    longitude=alert["longitude"], starts_at=alert["starts_at"], ends_at=alert["ends_at"],
                    resolution_note="Imported from public Delhi Traffic Police notice. Verify the current notice before acting."))
                counts["alerts"] += 1
        db.commit()
        return {"status": "ok", "city": "Delhi", "inserted": counts,
            "traffic_data": "Named corridors only; no traffic observations or live counts fabricated.",
            "aqi_data": "Historical CPCB/DPCC station snapshot dated 27 October 2026, 11:00 IST; stale by design.",
            "alerts": "Public Delhi Traffic Police advisories with their notified dates and source URL."}
    except Exception:
        db.rollback(); raise
    finally:
        db.close()


if __name__ == "__main__":
    print(seed())
