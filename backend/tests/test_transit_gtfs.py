import io
import zipfile
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.security import create_access_token, hash_password
from app.db import get_db
from app.models import User


def _gtfs_time(value: datetime, service_day: datetime) -> str:
    day_offset = (value.date() - service_day.date()).days
    total_seconds = day_offset * 86400 + value.hour * 3600 + value.minute * 60 + value.second
    hours, rem = divmod(total_seconds, 3600)
    minutes, seconds = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def _service_calendar(today: datetime) -> str:
    weekday_names = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    values = {name: "0" for name in weekday_names}
    values[weekday_names[today.weekday()]] = "1"
    return (
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
        f"daily,{values['monday']},{values['tuesday']},{values['wednesday']},{values['thursday']},"
        f"{values['friday']},{values['saturday']},{values['sunday']},{today:%Y%m%d},{today:%Y%m%d}\n"
    )


def _feed_zip(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, value in files.items():
            archive.writestr(name, value)
    return buffer.getvalue()


def _operator_headers(client):
    override = client.app.dependency_overrides[get_db]
    db = next(override())
    try:
        user = User(
            email="transit-operator@example.com",
            full_name="Transit Operator",
            password_hash=hash_password("development-password-123"),
            role="operator",
            is_active=True,
        )
        db.add(user)
        db.commit()
        user_id = user.id
    finally:
        db.close()
    token, _ = create_access_token(user_id, "operator")
    return {"Authorization": f"Bearer {token}"}


def test_gtfs_frequency_feed_import_and_frequency_route_plan(client):
    tz = ZoneInfo("Asia/Kolkata")
    now = datetime.now(tz).replace(second=0, microsecond=0)
    start = now + timedelta(minutes=15)
    end = now + timedelta(minutes=90)
    headers = _operator_headers(client)
    files = {
        "routes.txt": "route_id,route_short_name,route_long_name,route_type\nR-FREQ,F1,Frequency Bus,3\n",
        "stops.txt": (
            "stop_id,stop_name,stop_lat,stop_lon\n"
            "ORIGIN,Origin Stop,28.6000,77.2000\n"
            "DEST,Destination Stop,28.6700,77.2000\n"
        ),
        "trips.txt": "route_id,service_id,trip_id,trip_headsign\nR-FREQ,daily,T-FREQ,Destination\n",
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "T-FREQ,06:00:00,06:00:00,ORIGIN,1\n"
            "T-FREQ,06:20:00,06:20:00,DEST,2\n"
        ),
        "calendar.txt": _service_calendar(now),
        "frequencies.txt": (
            "trip_id,start_time,end_time,headway_secs,exact_times\n"
            f"T-FREQ,{_gtfs_time(start, now)},{_gtfs_time(end, now)},600,0\n"
        ),
    }
    response = client.post(
        "/api/v1/transit/gtfs/import",
        headers=headers,
        files={"file": ("test-feed.zip", _feed_zip(files), "application/zip")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["frequencies_upserted"] == 1

    plan = client.get("/api/v1/transit/plan", params={
        "origin_latitude": 28.6000,
        "origin_longitude": 77.2000,
        "destination_latitude": 28.6700,
        "destination_longitude": 77.2000,
        "departure_at": now.isoformat(),
    })
    assert plan.status_code == 200, plan.text
    options = plan.json()["options"]
    assert options, plan.json()
    assert options[0]["provider"] == "gtfs-frequency"
    assert options[0]["data_quality"] == "headway-estimate"
    assert options[0]["itinerary"]["headway_seconds"] == 600


def test_gtfs_one_transfer_route_plan(client):
    tz = ZoneInfo("Asia/Kolkata")
    now = datetime.now(tz).replace(second=0, microsecond=0)
    first_board = now + timedelta(minutes=10)
    transfer_arrival = now + timedelta(minutes=20)
    second_board = now + timedelta(minutes=25)
    final_arrival = now + timedelta(minutes=45)
    headers = _operator_headers(client)
    files = {
        "routes.txt": (
            "route_id,route_short_name,route_long_name,route_type\n"
            "R1,B1,Line One,3\nR2,B2,Line Two,3\n"
        ),
        "stops.txt": (
            "stop_id,stop_name,stop_lat,stop_lon\n"
            "ORIGIN,Origin Stop,28.6000,77.2000\n"
            "TRANSFER,Transfer Stop,28.6350,77.2000\n"
            "DEST,Destination Stop,28.6700,77.2000\n"
        ),
        "trips.txt": (
            "route_id,service_id,trip_id,trip_headsign\n"
            "R1,daily,T1,Transfer\nR2,daily,T2,Destination\n"
        ),
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            f"T1,{_gtfs_time(first_board, now)},{_gtfs_time(first_board, now)},ORIGIN,1\n"
            f"T1,{_gtfs_time(transfer_arrival, now)},{_gtfs_time(transfer_arrival, now)},TRANSFER,2\n"
            f"T2,{_gtfs_time(second_board, now)},{_gtfs_time(second_board, now)},TRANSFER,1\n"
            f"T2,{_gtfs_time(final_arrival, now)},{_gtfs_time(final_arrival, now)},DEST,2\n"
        ),
        "calendar.txt": _service_calendar(now),
    }
    response = client.post(
        "/api/v1/transit/gtfs/import",
        headers=headers,
        files={"file": ("transfer-feed.zip", _feed_zip(files), "application/zip")},
    )
    assert response.status_code == 200, response.text

    plan = client.get("/api/v1/transit/plan", params={
        "origin_latitude": 28.6000,
        "origin_longitude": 77.2000,
        "destination_latitude": 28.6700,
        "destination_longitude": 77.2000,
        "departure_at": now.isoformat(),
    })
    assert plan.status_code == 200, plan.text
    options = plan.json()["options"]
    assert options, plan.json()
    assert options[0]["transfers"] == 1
    assert len(options[0]["itinerary"]["legs"]) == 2


def test_production_configuration_fails_closed():
    import pytest
    from pydantic import ValidationError
    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(app_env="production", database_url="sqlite:///./prod.db", secret_key="dev-only-change-this-secret-before-deploying", cors_origins="*")
    settings = Settings(
        app_env="production",
        database_url="postgresql+psycopg://user:pass@localhost:5432/urbansaarthi",
        secret_key="a" * 48,
        cors_origins="https://frontend.example.org",
    )
    assert settings.app_env == "production"
