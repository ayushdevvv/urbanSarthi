from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import Junction, SignalPlan, SimulationRun
from app.schemas import ReviewIn, SignalPlanCreateIn, SignalPlanOut, SimulationCreateIn
from app.services.common import audit
from app.services.signal_planning import generate_recommendation, simulate_signal_plan
import uuid

router = APIRouter(tags=["Adaptive signals and digital twin"])


@router.get("/signals/plans", response_model=list[SignalPlanOut])
def list_signal_plans(db: Session = Depends(get_db), junction_id: int | None = None, status_filter: str | None = None, limit: int = 100):
    query = select(SignalPlan).order_by(SignalPlan.created_at.desc())
    if junction_id is not None:
        query = query.where(SignalPlan.junction_id == junction_id)
    if status_filter:
        query = query.where(SignalPlan.status == status_filter)
    return list(db.scalars(query.limit(max(1, min(limit, 300)))))


@router.post("/signals/recommendations/{junction_id}", response_model=SignalPlanOut, status_code=201)
def create_recommendation(junction_id: int, request: Request, db: Session = Depends(get_db)):
    junction = db.get(Junction, junction_id)
    if not junction:
        raise HTTPException(status_code=404, detail="Junction not found")
    plan = generate_recommendation(db, junction, None)
    db.add(plan)
    db.flush()
    audit(db, None, "signal.recommendation_created", "signal_plan", str(plan.id), {"junction_id": junction.id, "cycle_seconds": plan.cycle_seconds}, request.client.host if request.client else None)
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/signals/plans", response_model=SignalPlanOut, status_code=201)
def create_signal_plan(payload: SignalPlanCreateIn, request: Request, db: Session = Depends(get_db)):
    junction = db.get(Junction, payload.junction_id)
    if not junction:
        raise HTTPException(status_code=404, detail="Junction not found")
    phases = [p.model_dump() for p in payload.phases]
    cycle = sum(p["green_seconds"] + p["yellow_seconds"] + p["all_red_seconds"] for p in phases)
    plan = SignalPlan(public_id=str(uuid.uuid4()), junction_id=junction.id, created_by_user_id=None,
                      status="draft", plan_type=payload.plan_type, cycle_seconds=cycle, phases=phases,
                      rationale=payload.rationale, projected_outcomes={"status": "not_simulated"}, model_version="operator-authored-v1")
    db.add(plan)
    db.flush()
    audit(db, None, "signal.plan_created", "signal_plan", str(plan.id), {"junction_id": junction.id, "cycle_seconds": cycle}, request.client.host if request.client else None)
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/signals/plans/{plan_id}/approve", response_model=SignalPlanOut)
def approve_signal_plan(plan_id: int, payload: ReviewIn, request: Request, db: Session = Depends(get_db)):
    plan = db.get(SignalPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Signal plan not found")
    if plan.status not in {"draft", "simulated", "rejected"}:
        raise HTTPException(status_code=409, detail=f"Cannot approve a plan in status {plan.status}")
    plan.status = "approved"
    plan.reviewed_by_user_id = None
    plan.reviewed_at = datetime.now(timezone.utc)
    plan.review_note = payload.note
    audit(db, None, "signal.plan_approved", "signal_plan", str(plan.id), {"note": payload.note}, request.client.host if request.client else None)
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/signals/plans/{plan_id}/reject", response_model=SignalPlanOut)
def reject_signal_plan(plan_id: int, payload: ReviewIn, request: Request, db: Session = Depends(get_db)):
    plan = db.get(SignalPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Signal plan not found")
    if plan.status not in {"draft", "simulated"}:
        raise HTTPException(status_code=409, detail=f"Cannot reject a plan in status {plan.status}")
    plan.status = "rejected"
    plan.reviewed_by_user_id = None
    plan.reviewed_at = datetime.now(timezone.utc)
    plan.review_note = payload.note
    audit(db, None, "signal.plan_rejected", "signal_plan", str(plan.id), {"note": payload.note}, request.client.host if request.client else None)
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/signals/plans/{plan_id}/dispatch-preview")
def signal_dispatch_preview(plan_id: int, request: Request, db: Session = Depends(get_db)):
    plan = db.get(SignalPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Signal plan not found")
    if plan.status != "approved":
        raise HTTPException(status_code=409, detail="Only an operator-approved plan can produce a dispatch preview")
    junction = db.get(Junction, plan.junction_id)
    payload = {
        "command_id": str(uuid.uuid4()), "junction_external_id": junction.external_id if junction else None,
        "plan_public_id": plan.public_id, "cycle_seconds": plan.cycle_seconds,
        "phases": plan.phases, "generated_at": datetime.now(timezone.utc).isoformat(),
        "physical_dispatch_enabled": False,
        "safety_note": "Preview only. No ATCS/physical traffic signal command is sent by this backend. Real control needs authorized municipal integration, interlocks, fail-safe behavior, and field validation.",
    }
    audit(db, None, "signal.dispatch_preview_created", "signal_plan", str(plan.id), {"command_id": payload["command_id"]}, request.client.host if request.client else None)
    db.commit()
    return payload


@router.post("/simulations", status_code=201)
def create_simulation(payload: SimulationCreateIn, request: Request, db: Session = Depends(get_db)):
    junction = db.get(Junction, payload.junction_id)
    if not junction:
        raise HTTPException(status_code=404, detail="Junction not found")
    linked_plan = db.get(SignalPlan, payload.signal_plan_id) if payload.signal_plan_id else None
    if payload.signal_plan_id and not linked_plan:
        raise HTTPException(status_code=404, detail="Signal plan not found")
    if linked_plan and linked_plan.junction_id != junction.id:
        raise HTTPException(status_code=422, detail="Signal plan belongs to a different junction")
    phases = [p.model_dump() for p in payload.proposed_phases]
    simulation = simulate_signal_plan(db, junction, payload.name, phases, None, linked_plan.id if linked_plan else None)
    db.add(simulation)
    db.flush()
    if linked_plan and linked_plan.status in {"draft", "simulated"}:
        linked_plan.status = "simulated"
        linked_plan.projected_outcomes = {**linked_plan.projected_outcomes, **simulation.results, "simulation_run_id": simulation.id, "caveats": simulation.caveats}
    audit(db, None, "simulation.completed", "simulation_run", str(simulation.id), {"junction_id": junction.id, "engine": simulation.engine}, request.client.host if request.client else None)
    db.commit()
    db.refresh(simulation)
    return simulation


@router.post("/signals/plans/{plan_id}/simulate", status_code=201)
def simulate_existing_plan(plan_id: int, request: Request, db: Session = Depends(get_db)):
    plan = db.get(SignalPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Signal plan not found")
    junction = db.get(Junction, plan.junction_id)
    simulation = simulate_signal_plan(db, junction, f"Simulation for plan {plan.public_id[:8]}", plan.phases, None, plan.id)
    db.add(simulation)
    db.flush()
    if plan.status in {"draft", "simulated"}:
        plan.status = "simulated"
    plan.projected_outcomes = {**plan.projected_outcomes, **simulation.results, "simulation_run_id": simulation.id, "caveats": simulation.caveats}
    audit(db, None, "signal.plan_simulated", "signal_plan", str(plan.id), {"simulation_run_id": simulation.id}, request.client.host if request.client else None)
    db.commit()
    db.refresh(simulation)
    return simulation


@router.get("/simulations")
def list_simulations(db: Session = Depends(get_db), junction_id: int | None = None, limit: int = 100):
    query = select(SimulationRun).order_by(SimulationRun.created_at.desc())
    if junction_id is not None:
        query = query.where(SimulationRun.junction_id == junction_id)
    return list(db.scalars(query.limit(max(1, min(limit, 300)))))
