from __future__ import annotations

from app.api import aqi as aqi_api
from app.api import transit as transit_api
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


def test_network_routes_combine_distinct_osrm_and_valhalla_paths(monkeypatch):
    def route(points, provider):
        return {
            "distance_meters": 4200,
            "duration_seconds": 720,
            "mode": "driving",
            "provider": provider,
            "data_quality": "road-network-route",
            "geometry": {"type": "LineString", "coordinates": points},
        }

    osrm_path = route([[77.000, 28.000], [77.010, 28.012], [77.020, 28.020], [77.030, 28.030]], "OSRM")
    valhalla_path_a = route([[77.000, 28.000], [77.008, 28.018], [77.019, 28.026], [77.030, 28.030]], "Valhalla")
    valhalla_path_b = route([[77.000, 28.000], [77.015, 28.006], [77.025, 28.018], [77.030, 28.030]], "Valhalla")
    monkeypatch.setattr(routing_service, "_osrm_routes", lambda mode, origin, dest: [osrm_path])
    monkeypatch.setattr(routing_service, "_valhalla_routes", lambda mode, origin, dest, **kwargs: [valhalla_path_a, valhalla_path_b])

    routes = routing_service._network_routes("driving", (28.0, 77.0), (28.03, 77.03))

    assert len(routes) == 3
    assert all(route["data_quality"] == "road-network-route" for route in routes)
    assert all(len(route["geometry"]["coordinates"]) >= 2 for route in routes)


def test_duplicate_network_route_is_not_counted_as_alternative():
    route = {
        "geometry": {"type": "LineString", "coordinates": [[77.0, 28.0], [77.01, 28.01], [77.02, 28.02], [77.03, 28.03]]}
    }
    duplicate = {
        "geometry": {"type": "LineString", "coordinates": [[77.0, 28.0], [77.01, 28.01], [77.02, 28.02], [77.03, 28.03]]}
    }
    assert not routing_service._is_distinct_network_route(duplicate, [route])


def test_route_co2_uses_transparent_car_profile_and_varies_by_distance():
    short_route = routing_service._route_co2_estimate(5000, "driving")
    long_route = routing_service._route_co2_estimate(8000, "driving")

    assert short_route == 746.3
    assert long_route == 1194.1
    assert long_route > short_route
    assert routing_service._route_co2_estimate(5000, "walking") == 0.0
    assert routing_service._route_co2_estimate(5000, "cycling") == 0.0
    assert routing_service._route_co2_estimate(5000, "transit") is None


def test_osrm_search_merges_independent_driving_router_results(monkeypatch):
    monkeypatch.setattr(routing_service.settings, "osrm_base_url", None)
    calls = []

    def route(coords, distance, duration):
        return {"distance": distance, "duration": duration, "geometry": {"type": "LineString", "coordinates": coords}}

    payloads = [
        {"code": "Ok", "routes": [route([[77.0, 28.0], [77.01, 28.012], [77.02, 28.02]], 4000, 600)]},
        {"code": "Ok", "routes": [route([[77.0, 28.0], [77.012, 28.006], [77.02, 28.02]], 4300, 660)]},
    ]

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse(payloads[len(calls) - 1])

    monkeypatch.setattr(routing_service.httpx, "get", fake_get)
    routes = routing_service._osrm_routes("driving", (28.0, 77.0), (28.02, 77.02))

    assert len(calls) == 2
    assert len(routes) == 2
    assert all(item["data_quality"] == "road-network-route" for item in routes)
    assert routes[0]["geometry"]["coordinates"] != routes[1]["geometry"]["coordinates"]
