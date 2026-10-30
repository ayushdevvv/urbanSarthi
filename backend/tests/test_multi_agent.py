from __future__ import annotations

import pytest


def test_citizen_agent_chat_traffic_and_aqi(client):
    response = client.post(
        "/api/v1/agent/citizen/chat",
        json={"query": "Is there heavy congestion and how is the air quality?", "latitude": 28.6139, "longitude": 77.2090},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["agent_role"] == "citizen"
    assert "response" in data
    assert "tools_called" in data
    assert any("traffic" in t or "aqi" in t for t in data["tools_called"])


def test_citizen_incident_reporting_lifecycle(client):
    # 1. Citizen submits incident report
    response = client.post(
        "/api/v1/agent/incidents",
        json={
            "incident_type": "waterlogging",
            "location_name": "Moti Bagh Ring Road",
            "description": "Heavy waterlogging under the flyover blocking 2 lanes.",
            "latitude": 28.5800,
            "longitude": 77.1700,
            "severity": "high",
        },
    )
    assert response.status_code == 200
    sub_data = response.json()
    ref_id = sub_data["reference_id"]
    assert ref_id.startswith("INC-2026-")
    assert sub_data["status"] == "submitted"

    # 2. Citizen queries status of the report via Chat
    query_resp = client.post(
        "/api/v1/agent/citizen/chat",
        json={"query": f"What is the status of {ref_id}?"},
    )
    assert query_resp.status_code == 200
    q_data = query_resp.json()
    assert "SUBMITTED" in q_data["response"].upper() or ref_id in q_data["response"]

    # 3. Authority lists incident reports for triage
    list_resp = client.get("/api/v1/agent/authority/incidents")
    assert list_resp.status_code == 200
    incidents = list_resp.json()
    found = next((i for i in incidents if i["reference_id"] == ref_id), None)
    assert found is not None
    assert found["severity"] == "high"

    # 4. Authority operator updates status to verified
    update_resp = client.patch(
        f"/api/v1/agent/authority/incidents/{ref_id}",
        json={"status": "verified", "notes": "Dispatched drainage maintenance team."},
    )
    assert update_resp.status_code == 200
    up_data = update_resp.json()
    assert up_data["status"] == "verified"

    # 5. Citizen re-checks status to confirm update
    check_resp = client.get(f"/api/v1/agent/incidents/{ref_id}")
    assert check_resp.status_code == 200
    assert check_resp.json()["status"] == "verified"


def test_authority_agent_chat_and_simulation(client):
    response = client.post(
        "/api/v1/agent/authority/chat",
        json={"query": "Simulate signal priority intervention and check traffic bottlenecks"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["agent_role"] == "authority"
    assert "response" in data
    assert any("simulate" in t or "traffic" in t for t in data["tools_called"])


def test_multi_agent_status(client):
    response = client.get("/api/v1/agent/status")
    assert response.status_code == 200
    data = response.json()
    assert "cooperating_agents" in data
    roles = [a["role"] for a in data["cooperating_agents"]]
    assert "citizen" in roles
    assert "authority" in roles
