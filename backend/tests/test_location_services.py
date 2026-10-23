from __future__ import annotations

from app.api import aqi as aqi_api
from app.api import mobility as mobility_api
from app.api import transit as transit_api
from app.api import traffic as traffic_api
from app.services import routing as routing_service


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def test_location_aqi_forecast_normalizes_open_meteo(monkeypatch):
    monkeypatch.setattr(aqi_api.httpx, "get", lambda *args, **kwargs: FakeResponse({
        "latitude": 28.6, "longitude": 77.2, "timezone": "Asia/Kolkata",
        "current": {"time": "2026-10-23T10:00", "us_aqi": 91, "european_aqi": 45, "pm2_5": 23.4, "pm10": 41.1, "ozone": 22.0},
        "hourly": {"time": ["2026-10-23T10:00", "2026-10-23T11:00"], "us_aqi": [91, 102], "pm2_5": [23.4, 25.0], "pm10": [41.1, 45.0]},
    }))
    result = aqi_api.location_aqi_forecast(28.6, 77.2)
    assert result["provider"] == "Open-Meteo / CAMS"
    assert result["current"]["us_aqi"] == 91
    assert result["current"]["category"] == "Moderate"
    assert len(result["forecast"]) == 2
    assert result["forecast"][1]["category"] == "Unhealthy for sensitive groups"


def test_osrm_routes_require_real_network_geometry(monkeypatch):
    monkeypatch.setattr(routing_service.settings, "osrm_base_url", "https://routes.example.test")
    monkeypatch.setattr(routing_service.httpx, "get", lambda *args, **kwargs: FakeResponse({
        "code": "Ok", "routes": [{"distance": 2350, "duration": 640, "geometry": {"type": "LineString", "coordinates": [[77.2, 28.6], [77.21, 28.61], [77.22, 28.62]]}}],
    }))
    routes = routing_service._osrm_routes("walking", (28.6, 77.2), (28.62, 77.22))
    assert routes and routes[0]["data_quality"] == "road-network-route"
    assert len(routes[0]["geometry"]["coordinates"]) == 3


def test_nearby_transit_returns_stops_and_mapped_routes(client, monkeypatch):
    def fake_post(url, data=None, **kwargs):
        query = (data or {}).get("data", "")
        if "relation(around" in query:
            return FakeResponse({"elements": [{"type": "relation", "id": 555, "tags": {"type": "route", "route": "subway", "name": "Metro Line A", "ref": "A"}}]})
        return FakeResponse({"elements": [{"type": "node", "id": 123, "lat": 28.61, "lon": 77.21, "tags": {"name": "Central Station", "railway": "station", "station": "subway"}}]})
    monkeypatch.setattr(transit_api.httpx, "post", fake_post)
    response = client.get("/api/v1/transit/nearby?latitude=28.6&longitude=77.2&radius_m=4000")
    assert response.status_code == 200
    payload = response.json()
    assert payload["stops"][0]["name"] == "Central Station"
    assert payload["routes"][0]["long_name"] == "Metro Line A"
    assert payload["routes"][0]["schedule_available"] is False


def test_60_minute_scenario_contains_13_frames_and_80_edges(client):
    response = client.get("/api/v1/traffic/simulation/scenario?minutes=60&step_minutes=5&scenario=baseline")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["timeline"]) == 13
    assert payload["timeline"][0]["minute"] == 0
    assert payload["timeline"][-1]["minute"] == 60
    assert len(payload["timeline"][0]["roads"]) == 80
    assert payload["training_data"]["records"] == 518400
    assert payload["models"]["horizon_60"]["level_accuracy_percent"] == 61.5


def test_nearby_roads_return_geometry_not_claimed_live_traffic(client, monkeypatch):
    def fake_post(url, data=None, **kwargs):
        return FakeResponse({"elements": [{
            "type": "way", "id": 77,
            "tags": {"name": "Hazratganj Road", "highway": "primary", "lanes": "3"},
            "center": {"lat": 26.8467, "lon": 80.9462},
            "geometry": [{"lat": 26.8466, "lon": 80.9460}, {"lat": 26.8468, "lon": 80.9464}],
        }]})
    monkeypatch.setattr(mobility_api.httpx, "post", fake_post)
    response = client.get("/api/v1/routing/nearby-roads?latitude=26.8467&longitude=80.9462&radius_m=1000")
    assert response.status_code == 200
    payload = response.json()
    assert payload["roads"][0]["name"] == "Hazratganj Road"
    assert len(payload["roads"][0]["geometry"]) == 2
    assert payload["traffic_data_available"] is False
    assert "Live speed" in payload["note"]


def test_traffic_current_includes_live_segment_geometry(client, monkeypatch):
    monkeypatch.setattr(traffic_api.settings, "tomtom_api_key", "test-key")
    monkeypatch.setattr(traffic_api.httpx, "get", lambda *args, **kwargs: FakeResponse({"flowSegmentData": {
        "currentSpeed": 24, "freeFlowSpeed": 60, "currentTravelTime": 40, "freeFlowTravelTime": 16,
        "confidence": 0.91, "coordinates": {"coordinate": [
            {"latitude": 26.8466, "longitude": 80.9460},
            {"latitude": 26.8468, "longitude": 80.9464},
        ]},
    }}))
    response = client.get("/api/v1/traffic/current?latitude=26.8467&longitude=80.9462")
    assert response.status_code == 200
    flow = response.json()["flow"]
    assert flow["current_speed_kmph"] == 24
    assert flow["geometry"][0] == {"lat": 26.8466, "lng": 80.946}
    assert len(flow["geometry"]) == 2
