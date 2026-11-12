from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from app.db import get_db
from app.models import CityCluster, DataSource, Junction


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


def test_health_and_open_route_planning(client, monkeypatch):
    # The API contract test is specifically for the no-provider distance estimate.
    # Keep it deterministic and offline; mapped provider behavior is covered separately.
    from app.services import routing as routing_service
    monkeypatch.setattr(routing_service, '_network_routes', lambda *args, **kwargs: [])
    assert client.get("/healthz").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200  # local-only demo identity; production requires a token
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
    assert payload['classes_counted_as_vehicles'] == ['car', 'bus', 'motorbike', 'bicycle', 'truck']
    rejected = client.post(
        '/api/v1/traffic-detection/analyze',
        files={'file': ('notes.txt', b'not an image', 'text/plain')},
    )
    assert rejected.status_code == 415


def test_command_center_overview_groups_data_source_statuses(client):
    # Seed at least one source so the grouped status query is non-empty.
    override = client.app.dependency_overrides[get_db]
    db = next(override())
    try:
        db.add_all([
            DataSource(external_id="camera-01", name="Camera 01", source_type="camera", provider="Municipal CCTV", status="online", last_success_at=datetime.now(timezone.utc), freshness_seconds=300, safe_config={}),
            DataSource(external_id="camera-02", name="Camera 02", source_type="camera", provider="Municipal CCTV", status="online", last_success_at=datetime.now(timezone.utc) - timedelta(hours=1), freshness_seconds=120, safe_config={}),
            DataSource(external_id="aqi-01", name="AQI 01", source_type="cpcb", provider="CPCB", status="offline", safe_config={}),
            DataSource(external_id="aqi-02", name="AQI 02", source_type="cpcb", provider="CPCB", status="offline", safe_config={}),
        ])
        db.commit()
    finally:
        db.close()

    response = client.get("/api/v1/command-center/overview")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["data_sources"]["status_counts"] == {"online": 1, "stale": 1, "offline": 2}
    assert body["data_sources"]["configured_sources"] == 4
    assert "stations" in body["air_quality"] and isinstance(body["air_quality"]["stations"], list)
    assert all("latitude" in station and "longitude" in station for station in body["air_quality"]["stations"])
    assert all("latitude" in alert and "longitude" in alert for alert in body["alerts"]["items"])
    freshness = client.get("/api/v1/command-center/health/data-sources").json()["sources"]
    assert next(row for row in freshness if row["external_id"] == "camera-02")["status"] == "stale"
    provider_status = client.get("/api/v1/integrations/status")
    assert provider_status.status_code == 200, provider_status.text
    providers = provider_status.json()["providers"]
    assert providers["camera_vision"]["status"] == "online"
    assert providers["camera_vision"]["healthy"] is True
    assert providers["cpcb"]["status"] == "waiting_for_feed"
    assert providers["atcs_write_control"]["enabled"] is False


def test_production_auth_login_and_edge_ingestion_key(client, monkeypatch):
    from app.core.config import settings
    from app.core.security import hash_password
    from app.models import User
    monkeypatch.setattr(settings, "auth_enabled", True)
    monkeypatch.setattr(settings, "jwt_secret", "test-jwt-secret-that-is-at-least-32-characters-long")
    monkeypatch.setattr(settings, "ingestion_api_key", "test-ingestion-key-that-is-at-least-32-chars")

    override = client.app.dependency_overrides[get_db]
    db = next(override())
    try:
        db.add(User(email="operator@example.org", full_name="Test Operator", password_hash=hash_password("strong-test-password-123"), role="operator", is_active=True, preferences={}))
        db.add(DataSource(external_id="camera-test-source", name="Test RTSP camera", source_type="camera", provider="edge-worker", status="not_configured", safe_config={}, freshness_seconds=120))
        cluster = CityCluster(external_id="AUTH-C", name="Auth cluster", city="Test city", status="unknown", config={})
        db.add(cluster)
        db.flush()
        junction = Junction(external_id="AUTH-J", name="Auth junction", cluster_id=cluster.id, latitude=26.85, longitude=80.95, status="unknown", lane_count=4, baseline_cycle_seconds=90, configuration={})
        db.add(junction)
        db.commit()
    finally:
        db.close()

    assert client.get("/api/v1/auth/me").status_code == 401
    registration = client.post("/api/v1/auth/register", json={"email": "citizen@example.org", "full_name": "Test Citizen", "password": "citizen-password-123", "role": "admin"})
    assert registration.status_code == 201, registration.text
    assert registration.json()["user"]["role"] == "citizen"
    assert client.post("/api/v1/auth/register", json={"email": "citizen@example.org", "full_name": "Duplicate Citizen", "password": "citizen-password-123"}).status_code == 409
    login = client.post("/api/v1/auth/login", json={"email": "operator@example.org", "password": "strong-test-password-123"})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["role"] == "operator"
    assert client.get("/api/v1/command-center/overview").status_code == 401
    assert client.get("/api/v1/command-center/overview", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    # Heavy inference uploads are private operator actions, not public endpoints.
    assert client.post("/api/v1/traffic-detection/analyze", files={"file": ("frame.jpg", b"x", "image/jpeg")}).status_code == 401
    assert client.post("/api/v1/traffic-detection/analyze-video", files={"file": ("clip.mp4", b"x", "video/mp4")}).status_code == 401

    payload = {"external_junction_id": "AUTH-J", "source": "camera-edge", "vehicle_count": 7, "detection_summary": {"camera_id": "test-camera"}}
    denied = client.post("/api/v1/ingestion/vision-events", json=payload)
    accepted = client.post("/api/v1/ingestion/vision-events", json=payload, headers={"X-Ingestion-Key": "test-ingestion-key-that-is-at-least-32-chars"})
    assert denied.status_code == 401
    assert accepted.status_code == 201, accepted.text
    assert client.get(f"/api/v1/traffic/junctions/{junction.id}/observations?since_minutes=15").status_code == 401
    live_rows = client.get(f"/api/v1/traffic/junctions/{junction.id}/observations?since_minutes=15", headers={"Authorization": f"Bearer {token}"})
    assert live_rows.status_code == 200 and len(live_rows.json()) == 1
    heartbeat = client.post("/api/v1/ingestion/source-heartbeat", json={"external_id": "camera-test-source", "device": "test-camera"}, headers={"X-Ingestion-Key": "test-ingestion-key-that-is-at-least-32-chars"})
    assert heartbeat.status_code == 200 and heartbeat.json()["status"] == "online"


def test_native_sumo_endpoint_returns_clear_setup_error_when_engine_missing(client, monkeypatch):
    from app.api import traffic as traffic_api
    monkeypatch.setattr(traffic_api, "sumo_binary", lambda: None)
    response = client.post("/api/v1/traffic/sumo/run", json={
        "name": "Missing engine test",
        "north_south_green_seconds": 40,
        "east_west_green_seconds": 50,
        "yellow_seconds": 3,
        "all_red_seconds": 1,
        "demand_multiplier": 1.2,
    })
    assert response.status_code == 424
    assert "SUMO CLI is not installed" in response.json()["detail"]


def test_native_sumo_endpoint_returns_native_run_and_submitted_signal_timings(client, monkeypatch):
    from app.api import traffic as traffic_api
    monkeypatch.setattr(traffic_api, "sumo_binary", lambda: "sumo")
    captured = {}

    def fake_run(scenario, report=None, proposed_phases=None):
        captured["scenario"] = scenario
        captured["report"] = report
        captured["phases"] = proposed_phases
        return {
            "mode": "native_sumo_simulation", "engine": "SUMO test runner",
            "summary": {"queue_end": 12}, "timeline": [{"minute": 0, "roads": []}],
            "baseline_timeline": [{"minute": 0, "queue_total": 16}], "notes": [],
        }

    monkeypatch.setattr(traffic_api, "run_native_sumo_simulation", fake_run)
    response = client.post("/api/v1/traffic/sumo/run", json={
        "name": "North south priority",
        "north_south_green_seconds": 55,
        "east_west_green_seconds": 35,
        "yellow_seconds": 4,
        "all_red_seconds": 2,
        "demand_multiplier": 1.3,
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "native_sumo_simulation"
    assert body["experiment"]["signal_timings"]["north_south_green_seconds"] == 55
    assert body["experiment"]["signal_timings"]["east_west_green_seconds"] == 35
    assert captured["scenario"] == "baseline"
    assert captured["phases"][0]["green_seconds"] == 55
    assert captured["phases"][1]["green_seconds"] == 35
    assert captured["report"]["mean_vehicles_per_sampled_frame"] == 6.5


def test_xgboost_model_scenario_endpoint_accepts_signal_settings(client, monkeypatch):
    from app.api import traffic as traffic_api
    captured = {}

    def fake_scenario(**kwargs):
        captured.update(kwargs)
        return {
            "mode": "xgboost_model_scenario", "engine": "XGBoost test forecast",
            "timeline": [{"minute": 0, "queue_total": 10, "roads": []}],
            "baseline_timeline": [{"minute": 0, "queue_total": 9, "roads": []}],
        }

    monkeypatch.setattr(traffic_api, "get_xgboost_signal_scenario", fake_scenario)
    response = client.post("/api/v1/traffic/simulation/model-scenario", json={
        "name": "Fallback test", "north_south_green_seconds": 58,
        "east_west_green_seconds": 34, "yellow_seconds": 4,
        "all_red_seconds": 2, "demand_multiplier": 1.3,
    })
    assert response.status_code == 200, response.text
    assert response.json()["mode"] == "xgboost_model_scenario"
    assert captured["north_south_green_seconds"] == 58
    assert captured["east_west_green_seconds"] == 34
    assert captured["demand_multiplier"] == 1.3


def test_nearby_traffic_returns_cached_osm_roads_without_fake_flow(client, monkeypatch):
    from app.api import traffic as traffic_api

    traffic_api._NEARBY_ROAD_CACHE.clear()
    monkeypatch.setattr(traffic_api.settings, "tomtom_api_key", "")
    calls = []

    class RoadResponse:
        def raise_for_status(self):
            return None
        def json(self):
            return {"elements": [{
                "type": "way", "id": 101, "center": {"lat": 26.8468, "lon": 80.9463},
                "geometry": [{"lat": 26.8467, "lon": 80.9462}, {"lat": 26.8470, "lon": 80.9470}],
                "tags": {"highway": "primary", "name": "Test Ring Road"},
            }]}

    def fake_post(url, **kwargs):
        calls.append(url)
        return RoadResponse()

    monkeypatch.setattr(traffic_api.httpx, "post", fake_post)
    first = client.get("/api/v1/traffic/nearby?latitude=26.8467&longitude=80.9462&radius_m=3500")
    assert first.status_code == 200, first.text
    payload = first.json()
    assert payload["roads"][0]["name"] == "Test Ring Road"
    assert len(payload["roads"][0]["geometry"]) == 2
    assert payload["roads"][0]["traffic"] is None
    assert payload["traffic_status"] == "not_configured"

    second = client.get("/api/v1/traffic/nearby?latitude=26.8467&longitude=80.9462&radius_m=3500")
    assert second.status_code == 200
    assert len(calls) == 1
    assert second.json()["roads"][0]["name"] == "Test Ring Road"


def test_traffic_news_uses_short_timeout_and_five_minute_cache(client, monkeypatch):
    from app.services import live_search

    live_search._NEWS_CACHE.clear()
    calls = []

    class NewsResponse:
        content = b'''<?xml version="1.0"?><rss><channel><item><title>Road closure near test area</title><link>https://example.com/road-closure</link><pubDate>Thu, 12 Nov 2026 10:00:00 GMT</pubDate><source>Example News</source></item></channel></rss>'''
        def raise_for_status(self):
            return None

    def fake_get(url, **kwargs):
        calls.append((url, kwargs.get("timeout")))
        return NewsResponse()

    monkeypatch.setattr(live_search.settings, "tavily_api_key", "")
    monkeypatch.setattr(live_search.httpx, "get", fake_get)
    first = client.get("/api/v1/traffic/news?latitude=26.8467&longitude=80.9462&area=Hazratganj")
    second = client.get("/api/v1/traffic/news?latitude=26.8467&longitude=80.9462&area=Hazratganj")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["items"][0]["title"] == "Road closure near test area"
    assert first.json()["served_from_cache"] is False
    assert second.json()["served_from_cache"] is True
    assert calls == [("https://news.google.com/rss/search", 2.5)]


def test_sumo_unavailable_route_can_run_real_xgboost_fallback(client, monkeypatch):
    from app.api import traffic as traffic_api

    monkeypatch.setattr(traffic_api, "sumo_binary", lambda: None)
    payload = {
        "name": "XGBoost fallback integration",
        "north_south_green_seconds": 58,
        "east_west_green_seconds": 34,
        "yellow_seconds": 4,
        "all_red_seconds": 2,
        "demand_multiplier": 1.1,
    }
    native = client.post("/api/v1/traffic/sumo/run", json=payload)
    assert native.status_code == 424, native.text

    fallback = client.post("/api/v1/traffic/simulation/model-scenario", json=payload)
    assert fallback.status_code == 200, fallback.text
    body = fallback.json()
    assert body["mode"] == "xgboost_model_scenario"
    assert len(body["timeline"]) == 13
    assert len(body["timeline"][0]["roads"]) == 80
    assert "sensitivity" in body["engine"].lower()
