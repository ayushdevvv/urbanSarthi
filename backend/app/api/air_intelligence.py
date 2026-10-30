"""Air Intelligence: emissions estimates, pollution hotspot ranking and repeatable scenarios."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import require_roles
from app.services.common import audit
from app.models import AqiObservation, Junction, SignalPlan, SimulationRun, TrafficObservation
from app.services.emissions import estimate_from_counts, public_factor_catalog
from app.services.traffic_ops_agent import build_draft_phases
from app.services.sumo_runner import run_native_sumo_simulation

router = APIRouter(prefix="/air-intelligence", tags=["Air Intelligence"])


class EmissionsEstimateIn(BaseModel):
    vehicle_counts: dict[str, int] = Field(default_factory=dict)
    segment_distance_km: float = Field(default=0.5, ge=0.001, le=100)


class SignalOptimizeIn(BaseModel):
    junction_id: int
    cycle_seconds: int = Field(default=90, ge=40, le=180)
    approach_demand: dict[str, Any] | None = None
    notes: str = Field(default="", max_length=1000)


class ScenarioCompareIn(BaseModel):
    junction_id: int
    signal_plan_id: int | None = None
    phases: list[dict[str, Any]] | None = None
    scenario: str = Field(default="baseline", pattern="^(baseline|demand_surge|signal_priority)$")
    name: str = Field(default="HawaFlow baseline vs intervention", min_length=3, max_length=160)


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 6371.0 * 2 * asin(sqrt(a))


def _observation_counts(observation: TrafficObservation) -> dict[str, int]:
    summary = observation.detection_summary or {}
    counts = summary.get("counts") if isinstance(summary, dict) else None
    if not isinstance(counts, dict):
        counts = summary if isinstance(summary, dict) else {}
    return {str(key): max(0, int(value)) for key, value in counts.items() if isinstance(value, (int, float))}


def _latest_observations(db: Session, hours: int = 24) -> list[TrafficObservation]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = db.scalars(
        select(TrafficObservation)
        .where(TrafficObservation.junction_id.is_not(None), TrafficObservation.observed_at >= cutoff)
        .order_by(TrafficObservation.observed_at.desc())
        .limit(5000)
    )
    latest: dict[int, TrafficObservation] = {}
    for row in rows:
        if row.junction_id not in latest:
            latest[row.junction_id] = row
    return list(latest.values())


@router.get("/factors")
def list_emission_factors():
    """Return the factor profiles, source metadata, units and assumptions used by the estimator."""
    return public_factor_catalog()


@router.post("/emissions/estimate")
def estimate_traffic_emissions(payload: EmissionsEstimateIn, _user=Depends(require_roles("operator", "admin"))):
    try:
        return estimate_from_counts(payload.vehicle_counts, payload.segment_distance_km)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/hotspots")
def pollution_hotspots(
    db: Session = Depends(get_db),
    corridor_distance_km: float = Query(default=0.5, ge=0.001, le=100, description="Operator assumption for the monitored corridor length"),
    aqi_radius_km: float = Query(default=5.0, ge=0.1, le=30),
    observation_hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=50, ge=1, le=200),
    _user=Depends(require_roles("operator", "admin")),
):
    """Rank junctions using latest traffic, estimated emissions and nearest recent AQI."""
    observations = _latest_observations(db, observation_hours)
    if not observations:
        return {"generated_at": datetime.now(timezone.utc).isoformat(), "items": [], "note": "No junction traffic observations were recorded in the selected time window."}
    junction_ids = [item.junction_id for item in observations]
    junctions = {item.id: item for item in db.scalars(select(Junction).where(Junction.id.in_(junction_ids)))}
    cutoff = datetime.now(timezone.utc) - timedelta(hours=min(observation_hours, 24))
    aqi_rows = list(db.scalars(select(AqiObservation).where(AqiObservation.observed_at >= cutoff).order_by(AqiObservation.observed_at.desc()).limit(5000)))

    working = []
    for observation in observations:
        junction = junctions.get(observation.junction_id)
        if not junction:
            continue
        counts = _observation_counts(observation)
        emissions = estimate_from_counts(counts, corridor_distance_km) if any(counts.values()) else None
        closest = None
        closest_distance = None
        for station in aqi_rows:
            distance = _distance_km(junction.latitude, junction.longitude, station.latitude, station.longitude)
            if distance <= aqi_radius_km and (closest_distance is None or distance < closest_distance):
                closest = station
                closest_distance = distance
        congestion = observation.congestion_score
        if congestion is None and observation.lane_density is not None:
            congestion = max(0.0, min(100.0, observation.lane_density * 100.0))
        pollutant_mass = None
        if emissions:
            pollutant_mass = float(emissions["totals"].get("nox_g", 0)) + float(emissions["totals"].get("pm_g", 0))
        working.append({
            "junction": junction,
            "observation": observation,
            "congestion_score": float(congestion) if congestion is not None else None,
            "emissions": emissions,
            "pollutant_mass_g": pollutant_mass,
            "aqi": closest,
            "aqi_distance_km": closest_distance,
        })

    max_emissions = max([item["pollutant_mass_g"] or 0 for item in working] + [0.0])
    max_volume = max([item["observation"].vehicle_count for item in working] + [1])
    items = []
    for item in working:
        observation = item["observation"]
        components: list[tuple[str, float, float]] = []
        if item["congestion_score"] is not None:
            components.append(("traffic_congestion", max(0, min(100, item["congestion_score"])), 0.35))
        else:
            components.append(("traffic_volume_proxy", min(100, observation.vehicle_count / max_volume * 100), 0.20))
        if item["pollutant_mass_g"] is not None and max_emissions > 0:
            # Relative normalization is only within this returned shortlist, not a regulatory risk scale.
            emissions_score = min(100, item["pollutant_mass_g"] / max_emissions * 100)
            components.append(("estimated_nox_plus_pm", emissions_score, 0.40))
        if item["aqi"] and item["aqi"].aqi is not None:
            components.append(("nearby_ambient_aqi", max(0, min(100, float(item["aqi"].aqi) / 300 * 100)), 0.25))
        weight_sum = sum(weight for _, _, weight in components)
        score = round(sum(value * weight for _, value, weight in components) / max(weight_sum, 0.01), 1)
        source_labels = ["traffic_observation"]
        if item["emissions"]:
            source_labels.append("estimated_tailpipe_emissions")
        if item["aqi"]:
            source_labels.append(f"ambient_aqi:{item['aqi'].source}")
        quality = "complete_inputs" if len(components) == 3 and item["emissions"] else "partial_inputs" if len(components) >= 2 else "traffic_only"
        items.append({
            "junction_id": item["junction"].id,
            "junction_name": item["junction"].name,
            "location": {"latitude": item["junction"].latitude, "longitude": item["junction"].longitude},
            "hotspot_score": score,
            "score_basis": [name for name, _, _ in components],
            "data_quality": quality,
            "traffic": {
                "vehicle_count": observation.vehicle_count,
                "congestion_score": item["congestion_score"],
                "queue_length_m": observation.queue_length_m,
                "average_wait_seconds": observation.average_wait_seconds,
                "source": observation.source,
                "observed_at": observation.observed_at.isoformat(),
            },
            "emissions": item["emissions"],
            "ambient_air_quality": ({"aqi": item["aqi"].aqi, "category": item["aqi"].category, "station_name": item["aqi"].station_name, "source": item["aqi"].source, "observed_at": item["aqi"].observed_at.isoformat(), "distance_km": round(item["aqi_distance_km"], 2)} if item["aqi"] else None),
            "source_labels": source_labels,
            "distance_assumption_km": corridor_distance_km if item["emissions"] else None,
        })
    items.sort(key=lambda row: row["hotspot_score"], reverse=True)
    for rank, item in enumerate(items[:limit], 1):
        item["rank"] = rank
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_hours": observation_hours,
        "corridor_distance_km_assumption": corridor_distance_km,
        "items": items[:limit],
        "note": "Hotspot scores are relative to this returned set, not a regulatory AQI scale. Estimated tailpipe emissions and nearby measured AQI are shown separately. Missing class counts or AQI reduce data completeness.",
    }


@router.post("/signal-plans/optimize", status_code=201)
def optimize_signal_plan(payload: SignalOptimizeIn, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    junction = db.get(Junction, payload.junction_id)
    if not junction:
        raise HTTPException(status_code=404, detail="Junction not found")
    approach_demand = payload.approach_demand
    observation = None
    if not approach_demand:
        observation = db.scalar(select(TrafficObservation).where(TrafficObservation.junction_id == junction.id).order_by(TrafficObservation.observed_at.desc()).limit(1))
        approach_demand = (observation.lane_demand or {}) if observation else {}
    evidence = {"approach_demand": approach_demand or {}, "source_filename": "latest saved camera approach demand"}
    draft = build_draft_phases(evidence, payload.cycle_seconds)
    plan = SignalPlan(
        public_id=str(uuid.uuid4()), junction_id=junction.id, created_by_user_id=user.id,
        status="draft", plan_type="emissions_aware_recommendation", cycle_seconds=draft["cycle_seconds"],
        phases=draft["phases"], rationale=(draft["rationale"] + (f" Operator note: {payload.notes}" if payload.notes else ""))[:3000],
        projected_outcomes={"optimization_method": draft.get("optimization_method"), "optimized": draft.get("optimized"), "approach_evidence": draft.get("approach_evidence", []), "human_review_required": True, "physical_dispatch_enabled": False, "source_observation_id": observation.id if observation else None},
        model_version="emissions-aware-signal-v1" if draft.get("optimized") else "equal-split-uncalibrated-v1",
    )
    db.add(plan)
    db.flush()
    audit(db, user.id, "air_intelligence.signal_plan_created", "signal_plan", str(plan.id), {
        "junction_id": junction.id,
        "model_version": plan.model_version,
        "optimized": bool(draft.get("optimized")),
        "human_review_required": True,
    })
    db.commit()
    db.refresh(plan)
    return {"success": True, "plan": {"id": plan.id, "public_id": plan.public_id, "status": plan.status, "cycle_seconds": plan.cycle_seconds, "phases": plan.phases, "rationale": plan.rationale, "model_version": plan.model_version, "projected_outcomes": plan.projected_outcomes}, "human_review_required": True, "physical_dispatch_enabled": False}


@router.post("/simulations/compare", status_code=201)
def compare_scenarios(payload: ScenarioCompareIn, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    junction = db.get(Junction, payload.junction_id)
    if not junction:
        raise HTTPException(status_code=404, detail="Junction not found")
    plan = db.get(SignalPlan, payload.signal_plan_id) if payload.signal_plan_id else None
    if payload.signal_plan_id and (not plan or plan.junction_id != junction.id):
        raise HTTPException(status_code=404, detail="Signal plan not found for this junction")
    if plan and plan.status == "rejected":
        raise HTTPException(status_code=409, detail="A rejected signal plan cannot be run through the impact comparison")
    phases = payload.phases or (plan.phases if plan else None)
    if not phases:
        raise HTTPException(status_code=422, detail="Provide a candidate signal plan or signal_plan_id")
    latest = db.scalar(select(TrafficObservation).where(TrafficObservation.junction_id == junction.id).order_by(TrafficObservation.observed_at.desc()).limit(1))
    evidence = latest.detection_summary if latest and isinstance(latest.detection_summary, dict) else {}
    # The native simulator needs class proportions, not a modelled XGBoost queue overlay.
    report = {
        **evidence,
        "counts": evidence.get("counts") or {},
        "mean_vehicles_per_sampled_frame": evidence.get("mean_vehicles_per_sampled_frame") or max(1, (latest.vehicle_count if latest else 5)),
    }
    try:
        result = run_native_sumo_simulation(payload.scenario, report=report, proposed_phases=phases)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"SUMO comparison failed ({type(exc).__name__}). Check the SUMO installation and bundled network.") from exc
    if result is None:
        raise HTTPException(status_code=424, detail="Native SUMO is required for a reproducible baseline-versus-intervention impact comparison. Install SUMO and set SUMO_BINARY. The XGBoost fallback is a forecast, not a signal-plan experiment.")
    caveats = list(result.get("notes") or []) + ["Human approval is required for the candidate plan. This API never sends commands to physical controllers."]
    simulation = SimulationRun(
        public_id=str(uuid.uuid4()), junction_id=junction.id, submitted_by_user_id=user.id,
        signal_plan_id=plan.id if plan else None, name=payload.name, engine=str(result.get("engine") or "sumo"),
        status="completed", baseline={"timeline": result.get("baseline_timeline", []), "summary": result.get("emissions_comparison", {}).get("baseline")},
        proposed_phases=phases, results=result, caveats=caveats,
    )
    db.add(simulation)
    db.flush()
    if plan:
        if plan.status in {"draft", "simulated"}:
            plan.status = "simulated"
        plan.projected_outcomes = {
            **(plan.projected_outcomes or {}),
            "simulation_run_id": simulation.id,
            "simulation_engine": simulation.engine,
            "traffic_comparison": result.get("traffic_comparison"),
            "emissions_comparison": result.get("emissions_comparison"),
            "human_review_required": True,
            "physical_dispatch_enabled": False,
        }
    audit(db, user.id, "air_intelligence.simulation_completed", "simulation_run", str(simulation.id), {
        "junction_id": junction.id,
        "signal_plan_id": plan.id if plan else None,
        "engine": simulation.engine,
        "duration_minutes": result.get("duration_minutes"),
    })
    db.commit()
    db.refresh(simulation)
    return {"success": True, "simulation_id": simulation.id, "public_id": simulation.public_id, "engine": simulation.engine, "result": result, "caveats": caveats, "report_url": f"/api/v1/air-intelligence/reports/{simulation.id}"}


@router.get("/reports/{simulation_id}")
def get_environmental_report(simulation_id: int, db: Session = Depends(get_db), _user=Depends(require_roles("operator", "admin"))):
    simulation = db.get(SimulationRun, simulation_id)
    if not simulation:
        raise HTTPException(status_code=404, detail="Impact report not found")
    junction = db.get(Junction, simulation.junction_id)
    return {
        "report_type": "UrbanSaarthi Environmental Impact Report",
        "report_version": "hawaflow-impact-report-v1",
        "generated_at": simulation.created_at.isoformat() if simulation.created_at else datetime.now(timezone.utc).isoformat(),
        "junction": {"id": junction.id, "name": junction.name, "latitude": junction.latitude, "longitude": junction.longitude} if junction else None,
        "simulation": {"id": simulation.id, "public_id": simulation.public_id, "name": simulation.name, "engine": simulation.engine, "status": simulation.status},
        "results": simulation.results,
        "candidate_phases": simulation.proposed_phases,
        "caveats": simulation.caveats,
        "human_review_required": True,
        "physical_dispatch_enabled": False,
    }
