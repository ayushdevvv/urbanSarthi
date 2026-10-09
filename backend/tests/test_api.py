from datetime import datetime, timezone
from sqlalchemy import select
from app.db import get_db
from app.models import CityCluster, Junction


def _demo_junction(client):
    # The fixture's session is accessible through FastAPI's overridden dependency.
    override = client.app.dependency_overrides[get_db]
    db = next(override())
    try:
        cluster = CityCluster(external_id="C-001", name="Cluster 1", city="Test City", status="unknown", config={})
        db.add(cluster)
        db.flush()
        junction = Junction(external_id="J-001", name="Test Junction", cluster_id=cluster.id, latitude=28.61, longitude=77.20,
                            status="unknown", lane_count=4, baseline_cycle_seconds=90, configuration={})
        db.add(junction)
        db.commit()
        junction_id = junction.id
    finally:
        db.close()
    return {}, junction_id


def test_health_and_open_route_planning(client):
    assert client.get("/healthz").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 404  # authentication routes are removed
    response = client.post("/api/v1/routing/plan", json={
        "origin_latitude": 28.6139, "origin_longitude": 77.2090,
        "destination_latitude": 28.6200, "destination_longitude": 77.2150,
        "origin_label": "Origin", "destination_label": "Destination", "preference": "balanced",
        "modes": ["driving", "walking"]
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["trip_id"] is not None
    assert len(body["routes"]) >= 2
    assert body["routes"][0]["data_quality"] == "estimated"
    history = client.get("/api/v1/trips")
    assert history.status_code == 200 and len(history.json()) == 1


def test_ingestion_forecast_signal_simulation(client):
    headers, junction_id = _demo_junction(client)
    obs = client.post("/api/v1/traffic/observations", headers=headers, json={
        "junction_id": junction_id, "source": "test-camera", "vehicle_count": 48,
        "queue_length_m": 32.5, "average_speed_kmph": 12.5, "average_wait_seconds": 68,
        "lane_density": 0.72, "congestion_score": 78,
        "lane_demand": {"north_south_through": 34, "east_west_through": 21, "north_south_turn": 8, "east_west_turn": 6},
        "detection_summary": {"car": 42, "bus": 3, "motorcycle": 3}
    })
    assert obs.status_code == 201, obs.text
    forecasts = client.post("/api/v1/predictions/refresh", headers=headers, json={"junction_id": junction_id})
    assert forecasts.status_code == 200, forecasts.text
    assert [x["horizon_minutes"] for x in forecasts.json()["forecasts"]] == [0, 15, 30, 45, 60]
    plan = client.post(f"/api/v1/signals/recommendations/{junction_id}", headers=headers)
    assert plan.status_code == 201, plan.text
    plan_id = plan.json()["id"]
    sim = client.post(f"/api/v1/signals/plans/{plan_id}/simulate", headers=headers)
    assert sim.status_code == 201, sim.text
    assert sim.json()["engine"] == "analytical-what-if-v1"
    approved = client.post(f"/api/v1/signals/plans/{plan_id}/approve", headers=headers, json={"note": "Reviewed for test"})
    assert approved.status_code == 200, approved.text
    preview = client.post(f"/api/v1/signals/plans/{plan_id}/dispatch-preview", headers=headers)
    assert preview.status_code == 200, preview.text
    assert preview.json()["physical_dispatch_enabled"] is False


def test_demo_authority_access_and_no_fake_transit(client):
    response = client.get("/api/v1/command-center/overview")
    assert response.status_code == 200
    anon = client.post("/api/v1/routing/plan", json={
        "origin_latitude": 28.6139, "origin_longitude": 77.2090,
        "destination_latitude": 28.63, "destination_longitude": 77.23,
        "preference": "cleanest", "modes": ["transit"]
    })
    assert anon.status_code == 200
    assert anon.json()["routes"] == []
    assert any("GTFS" in message for message in anon.json()["warnings"])


def test_cors_preflight_for_production_and_vercel_preview_origins(client):
    for origin in ("https://urbansarthi.vercel.app", "https://urbansarthi-git-preview.vercel.app"):
        response = client.options("/api/v1/aqi/observations", headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        })
        assert response.status_code == 200, response.text
        assert response.headers.get("access-control-allow-origin") == origin
        assert "GET" in response.headers.get("access-control-allow-methods", "")
