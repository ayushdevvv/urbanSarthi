"""
UrbanSaarthi Multi-Agent API (Citizen AI & Authority AI)
-------------------------------------------------------
POST /api/v1/agent/citizen/chat    — Citizen AI Assistant (routes, pollution, traffic, incident reporting)
POST /api/v1/agent/authority/chat  — Authority AI Assistant (YOLO counts, triage, SUMO intervention simulation)
POST /api/v1/agent/incidents       — Submit a citizen incident report
GET  /api/v1/agent/incidents/{id}  — Check status of an incident report
GET  /api/v1/agent/authority/incidents — List incidents for operator triage
PATCH /api/v1/agent/authority/incidents/{id} — Update incident status
POST /api/v1/agent/analyze         — Unified agent analyze loop (backward compatibility)
GET  /api/v1/agent/status          — System capability status
GET  /api/v1/agent/tools           — Available tools description
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import CityAlert
from app.services.agent_engine import run_agent
from app.services.agents.citizen_agent import run_citizen_agent
from app.services.agents.authority_agent import run_authority_agent
from app.services.agents.base import get_llm_provider
from app.core.config import settings

router = APIRouter(prefix="/agent", tags=["Traffic Intelligence Agents"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CitizenChatRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=600)
    latitude: float = Field(default=28.6139, ge=-90, le=90)
    longitude: float = Field(default=77.2090, ge=-180, le=180)
    dest_latitude: float | None = Field(default=None, ge=-90, le=90)
    dest_longitude: float | None = Field(default=None, ge=-180, le=180)
    preference: str = Field(default="balanced")


class AuthorityChatRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=600)
    latitude: float = Field(default=28.6139, ge=-90, le=90)
    longitude: float = Field(default=77.2090, ge=-180, le=180)
    action_type: str | None = None
    action_payload: dict[str, Any] | None = None


class IncidentReportCreate(BaseModel):
    incident_type: Literal[
        "traffic_congestion", "accident", "waterlogging", "road_damage", "signal_failure", "other"
    ]
    location_name: str = Field(..., min_length=2, max_length=200)
    description: str = Field(..., min_length=5, max_length=1000)
    latitude: float = Field(default=28.6139, ge=-90, le=90)
    longitude: float = Field(default=77.2090, ge=-180, le=180)
    severity: Literal["low", "medium", "high", "critical"] = "medium"


class IncidentStatusUpdate(BaseModel):
    status: Literal["submitted", "reviewing", "verified", "resolved", "dismissed"]
    notes: str | None = None


class AgentAnalyzeRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=500)
    latitude: float = Field(default=28.6139, ge=-90, le=90)
    longitude: float = Field(default=77.2090, ge=-180, le=180)
    dest_latitude: float | None = Field(default=None, ge=-90, le=90)
    dest_longitude: float | None = Field(default=None, ge=-180, le=180)
    mode: str = Field(default="citizen", pattern="^(citizen|authority)$")


# ---------------------------------------------------------------------------
# Dedicated Agent Endpoints
# ---------------------------------------------------------------------------

@router.post("/citizen/chat")
def citizen_agent_chat(payload: CitizenChatRequest, db: Session = Depends(get_db)):
    """Run the Citizen AI Agent: route advisor, traffic, AQI, and incident tracking."""
    return run_citizen_agent(
        query=payload.query,
        db=db,
        latitude=payload.latitude,
        longitude=payload.longitude,
        dest_latitude=payload.dest_latitude,
        dest_longitude=payload.dest_longitude,
        preference=payload.preference,
    )


@router.post("/authority/chat")
def authority_agent_chat(payload: AuthorityChatRequest, db: Session = Depends(get_db)):
    """Run the Authority AI Agent: YOLO counts, SUMO intervention simulation, incident triage."""
    return run_authority_agent(
        query=payload.query,
        db=db,
        latitude=payload.latitude,
        longitude=payload.longitude,
        action_type=payload.action_type,
        action_payload=payload.action_payload,
    )


@router.post("/incidents")
def submit_incident(payload: IncidentReportCreate, db: Session = Depends(get_db)):
    """Submit a citizen incident report with instant tracking ID."""
    ref_id = f"INC-2026-{uuid.uuid4().hex[:6].upper()}"
    alert = CityAlert(
        public_id=ref_id,
        title=f"Citizen Report: {payload.incident_type.replace('_', ' ').title()} at {payload.location_name}",
        description=payload.description,
        category="incident",
        severity=payload.severity,
        status="submitted",
        latitude=payload.latitude,
        longitude=payload.longitude,
        starts_at=datetime.now(timezone.utc),
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return {
        "success": True,
        "reference_id": ref_id,
        "incident_type": payload.incident_type,
        "status": alert.status,
        "location": payload.location_name,
        "submitted_at": alert.starts_at.isoformat(),
        "message": f"Incident report logged successfully. Use reference ID {ref_id} to check status.",
    }


@router.get("/incidents/{report_id}")
def get_incident_status(report_id: str, db: Session = Depends(get_db)):
    """Look up status of an incident report by tracking ID."""
    alert = db.query(CityAlert).filter(CityAlert.public_id == report_id.upper()).first()
    if not alert:
        raise HTTPException(status_code=404, detail=f"Incident report '{report_id}' not found.")
    return {
        "reference_id": alert.public_id,
        "title": alert.title,
        "category": alert.category,
        "severity": alert.severity,
        "status": alert.status,
        "reported_at": alert.starts_at.isoformat(),
        "resolution_note": alert.resolution_note,
    }


@router.get("/authority/incidents")
def list_operator_incidents(
    status: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List incident reports for operator triage."""
    query = db.query(CityAlert).filter(CityAlert.category == "incident")
    if status:
        query = query.filter(CityAlert.status == status)
    alerts = query.order_by(CityAlert.starts_at.desc()).limit(limit).all()
    return [
        {
            "id": a.id,
            "reference_id": a.public_id,
            "title": a.title,
            "description": a.description,
            "severity": a.severity,
            "status": a.status,
            "latitude": a.latitude,
            "longitude": a.longitude,
            "reported_at": a.starts_at.isoformat(),
            "resolution_note": a.resolution_note,
        }
        for a in alerts
    ]


@router.patch("/authority/incidents/{report_id}")
def update_operator_incident(
    report_id: str,
    payload: IncidentStatusUpdate,
    db: Session = Depends(get_db),
):
    """Update review status of an incident report."""
    alert = db.query(CityAlert).filter(CityAlert.public_id == report_id.upper()).first()
    if not alert:
        raise HTTPException(status_code=404, detail=f"Incident report '{report_id}' not found.")
    alert.status = payload.status
    if payload.notes:
        alert.resolution_note = payload.notes
    db.commit()
    db.refresh(alert)
    return {
        "success": True,
        "reference_id": alert.public_id,
        "status": alert.status,
        "resolution_note": alert.resolution_note,
    }


# ---------------------------------------------------------------------------
# Backward Compatibility & Status Endpoints
# ---------------------------------------------------------------------------

@router.post("/analyze")
def agent_analyze(payload: AgentAnalyzeRequest):
    """Run unified agent analyze loop for backward compatibility."""
    return run_agent(
        query=payload.query,
        latitude=payload.latitude,
        longitude=payload.longitude,
        dest_latitude=payload.dest_latitude,
        dest_longitude=payload.dest_longitude,
        mode=payload.mode,
    )


@router.get("/status")
def agent_status():
    """Report the current capability status of the multi-agent system."""
    sumo_available = False
    sumo_note = ""
    try:
        from app.services.traffic_simulation import get_simulation_snapshot
        snap = get_simulation_snapshot()
        sumo_available = snap.get("mode") == "sumo_model"
        sumo_note = f"XGBoost models loaded. Dataset: {snap.get('road_count', 0)} roads."
    except Exception as e:
        sumo_note = f"SUMO model unavailable: {e}"

    provider, _, model_name = get_llm_provider()

    return {
        "agent_name": "UrbanSaarthi Multi-Agent System",
        "agent_version": "2.0.0",
        "tools_available": [
            {"name": "get_traffic_snapshot", "label": "Traffic Snapshot", "available": True},
            {"name": "get_aqi_snapshot", "label": "AQI Snapshot", "available": True},
            {"name": "analyze_routes", "label": "Route Advisor", "available": True},
            {"name": "recommend_signal_strategy", "label": "Signal Strategy", "available": True},
        ],
        "cooperating_agents": [
            {
                "name": "Citizen AI Agent",
                "role": "citizen",
                "scope": "Traveler recommendations, pollution-aware routes, incident reporting",
                "tools": ["get_route_options", "get_traffic_conditions", "get_aqi_information", "submit_incident_report", "get_incident_status"],
            },
            {
                "name": "Authority AI Agent",
                "role": "authority",
                "scope": "City traffic operations, YOLO counts, SUMO intervention simulation, incident triage",
                "tools": ["get_traffic_intelligence", "get_aqi_intelligence", "list_incident_reports", "update_incident_status", "simulate_traffic_intervention", "recommend_signal_strategy"],
            },
        ],
        "llm_engine": {
            "provider": provider,
            "model": model_name,
            "is_live_llm": provider != "fallback",
            "fallback_label": "Deterministic rule-based tool-use fallback active (Keyless operation).",
        },
        "simulation_models": {
            "sumo_xgboost": {"available": sumo_available, "note": sumo_note},
        },
    }


@router.get("/tools")
def list_tools():
    """Describe available tools per agent role."""
    base_tools = [
        {"name": "get_traffic_snapshot", "description": "Vehicle counts and queue lengths."},
        {"name": "get_aqi_snapshot", "description": "AQI, PM2.5, and pollutant mix."},
        {"name": "analyze_routes", "description": "Route comparison and pollution exposure."},
        {"name": "recommend_signal_strategy", "description": "Demand-weighted signal timing."},
    ]
    return {
        "tools": base_tools,
        "citizen_tools": [
            {"name": "get_route_options", "description": "Compares route options with travel time and pollution intake trade-offs."},
            {"name": "get_traffic_conditions", "description": "Location-specific congestion scores and vehicle queue dynamics."},
            {"name": "get_aqi_information", "description": "Atmospheric air quality index, PM2.5, PM10, and health guidance."},
            {"name": "submit_incident_report", "description": "Registers citizen traffic/accident/waterlogging reports with reference ID."},
            {"name": "get_incident_status", "description": "Returns verified status of an existing incident report."},
        ],
        "authority_tools": [
            {"name": "get_traffic_intelligence", "description": "YOLO vehicle detection status and SUMO queue predictions."},
            {"name": "get_aqi_intelligence", "description": "Sensor-level and satellite CAMS pollution analytics."},
            {"name": "list_incident_reports", "description": "Triage queue of citizen incident reports prioritized by severity."},
            {"name": "update_incident_status", "description": "Updates operator review state (submitted/reviewing/verified/resolved)."},
            {"name": "simulate_traffic_intervention", "description": "Simulates 30-minute intervention scenarios with queue impact."},
            {"name": "recommend_signal_strategy", "description": "Demand-weighted signal timing and green wave optimization."},
        ],
    }
