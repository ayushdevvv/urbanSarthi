"""seed Delhi public traffic corridors, historical AQI and advisories

Revision ID: 7d12b413a9f0
Revises: 4fa8c8210d31
Create Date: 2026-11-13
"""
from datetime import datetime, timezone
from alembic import op
import sqlalchemy as sa

revision = "7d12b413a9f0"
down_revision = "4fa8c8210d31"
branch_labels = None
depends_on = None

AQI_SOURCE = "https://www.aqi.in/in/dashboard/india/delhi"
TRAFFIC_SOURCE = "https://traffic.delhipolice.gov.in/traffic-circulation-plan"
AQI_SNAPSHOT = datetime(2026, 10, 27, 5, 30, tzinfo=timezone.utc)  # 11:00 IST

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


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    clusters = sa.table("city_clusters", sa.column("id", sa.Integer), sa.column("external_id", sa.String),
        sa.column("name", sa.String), sa.column("city", sa.String), sa.column("status", sa.String),
        sa.column("config", sa.JSON), sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)))
    cluster_row = bind.execute(sa.select(clusters.c.id).where(clusters.c.external_id == "delhi-reference-city")).first()
    if cluster_row:
        cluster_id = cluster_row[0]
    else:
        bind.execute(clusters.insert().values(external_id="delhi-reference-city", name="Delhi Reference Network",
            city="Delhi", status="degraded", config={"dataset_type": "public_reference_seed", "coordinates_precision": "approximate_for_junctions",
            "traffic_source": TRAFFIC_SOURCE, "aqi_source": AQI_SOURCE,
            "note": "Reference seed only. No live traffic telemetry is included. AQI snapshot is historical."}, created_at=now, updated_at=now))
        # Lightweight migration table clauses do not automatically expose an
        # inserted primary key unless it is explicitly modelled. Re-read by the
        # stable external identifier instead; this is portable across Postgres
        # and SQLite and keeps the migration restart-safe.
        cluster_id = bind.execute(sa.select(clusters.c.id).where(
            clusters.c.external_id == "delhi-reference-city"
        )).scalar_one()

    junctions = sa.table("junctions", sa.column("id", sa.Integer), sa.column("external_id", sa.String),
        sa.column("name", sa.String), sa.column("cluster_id", sa.Integer), sa.column("latitude", sa.Float),
        sa.column("longitude", sa.Float), sa.column("status", sa.String), sa.column("lane_count", sa.Integer),
        sa.column("baseline_cycle_seconds", sa.Integer), sa.column("configuration", sa.JSON),
        sa.column("created_at", sa.DateTime(timezone=True)), sa.column("updated_at", sa.DateTime(timezone=True)))
    for ext_id, name, lat, lon, district in JUNCTIONS:
        exists = bind.execute(sa.select(junctions.c.id).where(junctions.c.external_id == ext_id)).first()
        if not exists:
            bind.execute(junctions.insert().values(external_id=ext_id, name=name, cluster_id=cluster_id,
                latitude=lat, longitude=lon, status="reference", lane_count=4, baseline_cycle_seconds=90,
                configuration={"seed_type": "public_corridor_reference", "source": TRAFFIC_SOURCE, "district": district,
                    "reference_only": True, "coordinates_precision": "approximate", "telemetry_connected": False,
                    "note": "Publicly named traffic corridor; approximate map coordinate, not a surveyed signal-controller location."},
                created_at=now, updated_at=now))

    aqi = sa.table("aqi_observations", sa.column("id", sa.Integer), sa.column("external_station_id", sa.String),
        sa.column("station_name", sa.String), sa.column("latitude", sa.Float), sa.column("longitude", sa.Float),
        sa.column("source", sa.String), sa.column("observed_at", sa.DateTime(timezone=True)), sa.column("aqi", sa.Float),
        sa.column("pm25", sa.Float), sa.column("pm10", sa.Float), sa.column("no2", sa.Float), sa.column("o3", sa.Float),
        sa.column("co", sa.Float), sa.column("category", sa.String), sa.column("raw_payload", sa.JSON))
    for name, ext, lat, lon, value, dominant, category in AQI_STATIONS:
        external_id = f"delhi-{ext}"
        exists = bind.execute(sa.select(aqi.c.id).where(aqi.c.external_station_id == external_id, aqi.c.observed_at == AQI_SNAPSHOT)).first()
        if not exists:
            bind.execute(aqi.insert().values(external_station_id=external_id, station_name=name, latitude=lat, longitude=lon,
                source="public_historical_AQI_snapshot", observed_at=AQI_SNAPSHOT, aqi=float(value),
                pm25=None, pm10=None, no2=None, o3=None, co=None, category=category,
                raw_payload={"dominant_pollutant": dominant, "snapshot_at_ist": "2026-10-27 11:00", "source_url": AQI_SOURCE,
                    "provenance": "Public station summary; pollutant concentrations not published in this seed record.",
                    "data_mode": "historical_reference", "live": False}))

    alerts = sa.table("city_alerts", sa.column("id", sa.Integer), sa.column("public_id", sa.String),
        sa.column("title", sa.String), sa.column("description", sa.Text), sa.column("category", sa.String),
        sa.column("severity", sa.String), sa.column("status", sa.String), sa.column("junction_id", sa.Integer),
        sa.column("latitude", sa.Float), sa.column("longitude", sa.Float), sa.column("starts_at", sa.DateTime(timezone=True)),
        sa.column("ends_at", sa.DateTime(timezone=True)), sa.column("created_by_user_id", sa.Integer),
        sa.column("resolution_note", sa.Text), sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)))
    notices = [
        ("delhi-chhath-diversions-2026-11-15", "Chhath Puja traffic diversions · 15–16 November",
         "Delhi Traffic Police announced diversions around riverfront ghats. Avoid Shanti Van–Nigambodh Ghat, Nanaksar T-Point–Sonia Vihar Toll Tax and the Shastri Park–Khajuri Khas stretch during notified periods. Verify the current notice before travel. Source: " + TRAFFIC_SOURCE,
         "traffic_diversion", "high", 28.6860, 77.2450, datetime(2026, 11, 14, 18, 30, tzinfo=timezone.utc), datetime(2026, 11, 16, 18, 30, tzinfo=timezone.utc)),
        ("delhi-iitf-traffic-2026-11-14", "India International Trade Fair · expected congestion",
         "Delhi Traffic Police advisory notes expected congestion around Mathura Road, Bhairon Marg, Ring Road, Shershah Road, Purana Qila Road, Bhagwan Das Road and Tilak Marg from 14–27 November. Source: " + TRAFFIC_SOURCE,
         "event_traffic", "medium", 28.6120, 77.2434, datetime(2026, 11, 13, 18, 30, tzinfo=timezone.utc), datetime(2026, 11, 27, 18, 30, tzinfo=timezone.utc)),
    ]
    for public_id, title, description, category, severity, lat, lon, starts_at, ends_at in notices:
        exists = bind.execute(sa.select(alerts.c.id).where(alerts.c.public_id == public_id)).first()
        if not exists:
            bind.execute(alerts.insert().values(public_id=public_id, title=title, description=description,
                category=category, severity=severity, status="active", junction_id=None, latitude=lat, longitude=lon,
                starts_at=starts_at, ends_at=ends_at, created_by_user_id=None,
                resolution_note="Imported from a public Delhi Traffic Police advisory. Verify the live notice before acting.",
                created_at=now, updated_at=now))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM city_alerts WHERE public_id IN ('delhi-chhath-diversions-2026-11-15', 'delhi-iitf-traffic-2026-11-14')"))
    bind.execute(sa.text("DELETE FROM aqi_observations WHERE external_station_id IN ('delhi-rk-puram','delhi-iit-delhi','delhi-anand-vihar','delhi-crri-mathura-road','delhi-jahangirpuri','delhi-rohini','delhi-mundka','delhi-dwarka-sector-8')"))
    bind.execute(sa.text("DELETE FROM junctions WHERE external_id LIKE 'delhi-traffic-%'"))
    bind.execute(sa.text("DELETE FROM city_clusters WHERE external_id = 'delhi-reference-city'"))
