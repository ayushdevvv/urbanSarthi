from datetime import datetime, timezone
from math import floor
import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import Junction, SignalPlan, SimulationRun, TrafficObservation


def latest_observation(db: Session, junction_id: int) -> TrafficObservation | None:
    return db.scalar(select(TrafficObservation).where(TrafficObservation.junction_id == junction_id).order_by(TrafficObservation.observed_at.desc()).limit(1))


def generate_recommendation(db: Session, junction: Junction, created_by_user_id: int | None) -> SignalPlan:
    observation = latest_observation(db, junction.id)
    cycle = max(30, min(240, int(junction.baseline_cycle_seconds or 90)))
    lanes = ["north_south_through", "east_west_through", "north_south_turn", "east_west_turn"]
    demand = (observation.lane_demand if observation else {}) or {}
    weights = [max(0.1, float(demand.get(name, 1.0))) for name in lanes]
    phase_count = len(lanes)
    clearance = phase_count * 4  # 3 s yellow + 1 s all-red per phase
    green_budget = cycle - clearance
    minimum_total = phase_count * 8
    if green_budget < minimum_total:
        green_budget = minimum_total
        cycle = green_budget + clearance
    residual = green_budget - phase_count * 8
    weight_sum = sum(weights) or float(phase_count)
    greens = [8 + floor(residual * weight / weight_sum) for weight in weights]
    remainder = green_budget - sum(greens)
    for i in range(remainder):
        greens[i % phase_count] += 1
    phases = [
        {"name": name.replace("_", " ").title(), "movement": name, "green_seconds": greens[i], "yellow_seconds": 3, "all_red_seconds": 1, "demand_weight": weights[i]}
        for i, name in enumerate(lanes)
    ]
    rationale = "Demand-weighted draft based on the latest lane_demand input. Review with traffic engineers; this is not a live controller command."
    metrics = {
        "latest_observation_id": observation.id if observation else None,
        "observed_queue_length_m": observation.queue_length_m if observation else None,
        "observed_wait_seconds": observation.average_wait_seconds if observation else None,
        "observed_vehicle_count": observation.vehicle_count if observation else None,
        "estimated_effect": "not quantified until a calibrated SUMO/city model is connected",
    }
    return SignalPlan(
        public_id=str(uuid.uuid4()), junction_id=junction.id, created_by_user_id=created_by_user_id,
        status="draft", plan_type="adaptive_recommendation", cycle_seconds=sum(p["green_seconds"] + p["yellow_seconds"] + p["all_red_seconds"] for p in phases),
        phases=phases, rationale=rationale, projected_outcomes=metrics, model_version="demand-weighted-v1",
    )


def simulate_signal_plan(db: Session, junction: Junction, name: str, phases: list[dict], submitted_by_user_id: int | None, signal_plan_id: int | None = None) -> SimulationRun:
    obs = latest_observation(db, junction.id)
    cycle = sum(int(p["green_seconds"]) + int(p.get("yellow_seconds", 3)) + int(p.get("all_red_seconds", 1)) for p in phases)
    weights = [max(0.0, float(p.get("demand_weight", 1.0))) for p in phases]
    green = [max(0, int(p["green_seconds"])) for p in phases]
    if sum(weights) <= 0:
        weights = [1.0 for _ in phases]
    demand_shares = [x / sum(weights) for x in weights]
    green_shares = [x / max(1, sum(green)) for x in green]
    alignment = sum(d * g for d, g in zip(demand_shares, green_shares))
    equal_baseline = sum(d * (1 / len(phases)) for d in demand_shares)
    # This index is a normalized heuristic; it is not a SUMO or calibrated field result.
    alignment_delta = max(-0.15, min(0.20, (alignment - equal_baseline) * 1.5))
    baseline = {
        "queue_length_m": obs.queue_length_m if obs else None,
        "average_wait_seconds": obs.average_wait_seconds if obs else None,
        "vehicle_count": obs.vehicle_count if obs else None,
        "average_speed_kmph": obs.average_speed_kmph if obs else None,
        "congestion_score": obs.congestion_score if obs else None,
        "source_observation_id": obs.id if obs else None,
    }
    results = {
        "cycle_seconds": cycle,
        "demand_green_alignment_score": round(alignment, 4),
        "equal_split_alignment_baseline": round(equal_baseline, 4),
        "estimated_relative_change": round(alignment_delta, 4),
        "queue_length_m": round(max(0.0, obs.queue_length_m * (1 - alignment_delta)), 2) if obs and obs.queue_length_m is not None else None,
        "average_wait_seconds": round(max(0.0, obs.average_wait_seconds * (1 - alignment_delta)), 2) if obs and obs.average_wait_seconds is not None else None,
        "throughput_vehicle_count": round(obs.vehicle_count * (1 + max(-0.1, alignment_delta * 0.6))) if obs else None,
        "traffic_metrics_available": bool(obs),
        "method": "demand-green-alignment heuristic",
        "sumo_run": False,
    }
    caveats = [
        "Analytical what-if estimate only; no SUMO execution or validated traffic dynamics were run.",
        "Relative changes are scenario indicators, not guaranteed real-world improvements.",
        "Physical traffic signals are not changed by a simulation request.",
    ]
    return SimulationRun(
        public_id=str(uuid.uuid4()), junction_id=junction.id, submitted_by_user_id=submitted_by_user_id,
        signal_plan_id=signal_plan_id, name=name, engine="analytical-what-if-v1", status="completed",
        baseline=baseline, proposed_phases=phases, results=results, caveats=caveats,
    )
