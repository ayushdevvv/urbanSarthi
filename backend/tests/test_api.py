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


def test_traffic_detection_status_and_rejects_unsupported_upload(client):
    status = client.get('/api/v1/traffic-detection/status')
    assert status.status_code == 200
    payload = status.json()
    assert payload['model'] == 'YOLO11 traffic detector'
    assert payload['classes_counted_as_vehicles'] == ['car', 'bus', 'motorbike', 'bicycle']
    rejected = client.post(
        '/api/v1/traffic-detection/analyze',
        files={'file': ('notes.txt', b'not an image', 'text/plain')},
    )
    assert rejected.status_code == 415


def test_traffic_what_if_uses_edited_signal_timings_and_demand(client, monkeypatch):
    from app.api import traffic as traffic_api

    def fake_scenario(minutes=60, step_minutes=5, scenario='baseline'):
        frames = [
            {"minute": 0, "queue_total": 30, "vehicles": 100, "heavy_roads": 0, "moderate_roads": 2, "free_roads": 0,
             "roads": [{"road": "north-south", "queue": 10, "level": "Moderate", "vehicles": 40}, {"road": "east-west", "queue": 20, "level": "Heavy", "vehicles": 60}]},
            {"minute": 5, "queue_total": 40, "vehicles": 100, "heavy_roads": 1, "moderate_roads": 1, "free_roads": 0,
             "roads": [{"road": "north-south", "queue": 15, "level": "Heavy", "vehicles": 40}, {"road": "east-west", "queue": 25, "level": "Heavy", "vehicles": 60}]},
            {"minute": 10, "queue_total": 50, "vehicles": 100, "heavy_roads": 2, "moderate_roads": 0, "free_roads": 0,
             "roads": [{"road": "north-south", "queue": 20, "level": "Heavy", "vehicles": 40}, {"road": "east-west", "queue": 30, "level": "Heavy", "vehicles": 60}]},
        ]
        return {"mode": "trained_model_scenario", "timeline": frames}

    monkeypatch.setattr(traffic_api, "get_simulation_scenario", fake_scenario)
    base = client.post('/api/v1/traffic/simulation/what-if', json={
        "north_south_green_seconds": 34, "east_west_green_seconds": 22,
        "yellow_seconds": 3, "all_red_seconds": 1, "demand_factor": 1.0,
        "duration_minutes": 15,
    })
    changed = client.post('/api/v1/traffic/simulation/what-if', json={
        "north_south_green_seconds": 60, "east_west_green_seconds": 15,
        "yellow_seconds": 6, "all_red_seconds": 3, "demand_factor": 1.8,
        "duration_minutes": 15,
    })
    assert base.status_code == 200, base.text
    assert changed.status_code == 200, changed.text
    assert base.json()['proposed']['queue_end'] == 50
    assert changed.json()['proposed']['queue_end'] != base.json()['proposed']['queue_end']
    assert changed.json()['assumptions']['combined_impact_factor'] != 1.0
    assert changed.json()['fresh_sumo_run'] is False
    assert changed.json()['physical_signal_control'] is False


def test_traffic_video_endpoint_rejects_unsupported_upload(client):
    response = client.post(
        '/api/v1/traffic-detection/analyze-video',
        files={'file': ('notes.txt', b'not a video', 'text/plain')},
    )
    assert response.status_code == 415
