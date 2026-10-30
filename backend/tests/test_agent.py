from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services import agent_engine

client = TestClient(app)


def test_agent_status_endpoint():
    response = client.get("/api/v1/agent/status")
    assert response.status_code == 200
    data = response.json()
    assert "agent_name" in data
    assert "tools_available" in data
    assert len(data["tools_available"]) == 4


def test_agent_tools_endpoint():
    response = client.get("/api/v1/agent/tools")
    assert response.status_code == 200
    data = response.json()
    assert "tools" in data
    tool_names = [t["name"] for t in data["tools"]]
    assert "get_traffic_snapshot" in tool_names
    assert "get_aqi_snapshot" in tool_names
    assert "analyze_routes" in tool_names
    assert "recommend_signal_strategy" in tool_names


def test_keyword_router_does_not_false_trigger():
    """
    Issue #3 test:
    - 'Connaught Place traffic' must NOT trigger AQI because of 'co' in Connaught!
    - 'How is the weather today' must NOT trigger analyze_routes because of 'to' in today!
    """
    tools_cp = agent_engine._select_tools("Connaught Place traffic", "citizen")
    assert tools_cp == ["get_traffic_snapshot"], f"Expected only traffic snapshot, got {tools_cp}"

    tools_weather = agent_engine._select_tools("How is the weather today", "citizen")
    assert "analyze_routes" not in tools_weather, f"Weather query must not trigger routes, got {tools_weather}"


def test_destination_missing_explicit_handling():
    """
    Issue #4 test:
    When destination coordinates are missing and query asks for a route without destination,
    agent must NOT silently skip! It must report status='needs_destination' and prompt the user.
    """
    response = client.post(
        "/api/v1/agent/analyze",
        json={"query": "What is the best route?", "latitude": 28.6139, "longitude": 77.2090},
    )
    assert response.status_code == 200
    data = response.json()
    route_steps = [s for s in data["agent_steps"] if s["tool"] == "analyze_routes"]
    assert len(route_steps) == 1, "analyze_routes must not be silently skipped"
    assert route_steps[0]["status"] == "needs_destination"
    assert "Destination" in route_steps[0]["result_summary"]
    # Check recommendation card
    route_recs = [r for r in data["recommendations"] if r["type"] == "route"]
    assert len(route_recs) >= 1
    assert "Destination" in route_recs[0]["title"]


def test_route_landmarks_resolution():
    """
    Issue #4 landmark auto-resolution:
    'Best route from CP to ITO' resolves coordinates and executes route analysis.
    """
    response = client.post(
        "/api/v1/agent/analyze",
        json={"query": "Best route from CP to ITO"},
    )
    assert response.status_code == 200
    data = response.json()
    route_steps = [s for s in data["agent_steps"] if s["tool"] == "analyze_routes"]
    assert len(route_steps) == 1
    assert route_steps[0]["status"] == "success"
    routes = route_steps[0]["result"]["routes"]
    assert len(routes) >= 2, "Must return multiple route alternatives"


def test_score_label_consistency():
    """
    Issue #5 test:
    Score 68 must consistently be labeled 'High' and 'High Congestion Detected' everywhere.
    """
    label_68 = agent_engine._congestion_label(68)
    assert label_68 == "High"

    rec_68 = agent_engine._congestion_recommendation(68)
    assert "High Congestion Detected" in rec_68["title"]
    assert rec_68["priority"] == "high"


def test_multi_city_traffic_roads():
    """
    Issue #6 test:
    Bengaluru coordinates must return Bengaluru corridors (e.g. Silk Board, Hosur Road),
    never Delhi roads like Connaught Place!
    """
    response = client.post(
        "/api/v1/agent/analyze",
        json={"query": "Traffic around Silk Board", "latitude": 12.9175, "longitude": 77.6238},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["city"] == "Bengaluru"
    traffic_step = next(s for s in data["agent_steps"] if s["tool"] == "get_traffic_snapshot")
    roads = [r["road"] for r in traffic_step["result"]["roads"]]
    assert any("Silk Board" in r or "Hosur" in r or "Outer Ring" in r for r in roads)
    assert not any("Connaught Place" in r for r in roads)


def test_provenance_honesty_when_aqi_mock():
    """
    Issue #7 test:
    When AQI data is mock, the label must NEVER contain 'Open-Meteo'.
    """
    orig_aqi_fn = agent_engine.get_aqi_snapshot
    agent_engine.get_aqi_snapshot = lambda lat, lon: {
        "tool": "get_aqi_snapshot",
        "data_mode": "mock",
        "data_mode_label": "🔵 Simulated Reference Data",
        "current": {"us_aqi": 88, "category": "Moderate", "pm25_ug_m3": 25.0},
    }
    try:
        response = client.post(
            "/api/v1/agent/analyze",
            json={"query": "Traffic and air quality near my location", "latitude": 28.6139, "longitude": 77.2090},
        )
        assert response.status_code == 200
        data = response.json()
        assert "Open-Meteo" not in data["data_mode_label"], "Open-Meteo must not be in overall label when AQI is mock!"
        assert "Simulated" in data["data_mode_label"]
    finally:
        agent_engine.get_aqi_snapshot = orig_aqi_fn
