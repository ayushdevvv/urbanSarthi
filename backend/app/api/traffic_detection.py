from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.db import get_db
from app.dependencies import require_roles
from app.models import Junction, SignalPlan, SimulationRun, TrafficAnalysisReport, TrafficObservation
from app.services.emissions import estimate_from_counts
from app.services.traffic_detection import analyze_image, status
from app.services.traffic_ops_agent import build_draft_phases, run_forecast, run_ops_agent
from app.services.traffic_video import analyze_video, video_status

router = APIRouter(prefix="/traffic-detection", tags=["Traffic intelligence"])
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_VIDEO_BYTES = 25 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_VIDEO_TYPES = {
    "video/mp4", "video/quicktime", "video/x-msvideo", "video/avi",
    "video/x-matroska", "video/webm", "video/mpeg", "application/octet-stream",
}


def _compact_payload(value: Any, *, depth: int = 0) -> Any:
    """Keep saved reports small: no base64 images, raw detections or video payloads."""
    if depth > 7:
        return None
    if isinstance(value, dict):
        hidden = {"annotated_frame", "annotated_image", "frame_base64", "raw_frame", "detections", "fcd_frames", "vehicle_positions"}
        return {str(key): _compact_payload(item, depth=depth + 1) for key, item in value.items() if key not in hidden}
    if isinstance(value, list):
        return [_compact_payload(item, depth=depth + 1) for item in value[:500]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)[:500]


def _save_report(db: Session, user, report_type: str, source_name: str, source_mode: str, result: dict, junction_id: int | None = None) -> TrafficAnalysisReport:
    compact = _compact_payload(result)
    report = TrafficAnalysisReport(
        public_id=str(uuid.uuid4()), report_type=report_type[:40], junction_id=junction_id,
        source_name=str(source_name or "unknown source")[:180], source_mode=str(source_mode or "unknown")[:40],
        summary={
            "total_vehicles": compact.get("total_vehicles", compact.get("peak_vehicles_in_frame")),
            "peak_vehicles_in_frame": compact.get("peak_vehicles_in_frame"),
            "congestion_estimate": compact.get("congestion_estimate"),
            "sampled_frames": (compact.get("video") or {}).get("sampled_frames"),
            "queue_end": (compact.get("summary") or {}).get("queue_end"),
            "heavy_roads_end": (compact.get("summary") or {}).get("heavy_roads_end"),
            "queue_change_percent": ((compact.get("traffic_comparison") or {}).get("queue_at_60m") or {}).get("change_percent"),
            "cycle_seconds": ((compact.get("experiment") or {}).get("signal_timings") or {}).get("cycle_seconds"),
        },
        result=compact, created_by_user_id=getattr(user, "id", None),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


def _report_out(row: TrafficAnalysisReport) -> dict:
    return {
        "report_id": row.public_id, "report_type": row.report_type, "source_name": row.source_name,
        "source_mode": row.source_mode, "junction_id": row.junction_id,
        "summary": row.summary or {}, "result": row.result or {},
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/status")
def traffic_model_status():
    return status()


@router.get("/video-status")
def traffic_video_status():
    return video_status()


@router.get("/reports")
def list_traffic_reports(limit: int = Query(default=12, ge=1, le=100), report_type: str | None = Query(default=None), db: Session = Depends(get_db), _user=Depends(require_roles("operator", "admin"))):
    query = select(TrafficAnalysisReport).order_by(desc(TrafficAnalysisReport.created_at)).limit(limit)
    if report_type:
        query = select(TrafficAnalysisReport).where(TrafficAnalysisReport.report_type == report_type).order_by(desc(TrafficAnalysisReport.created_at)).limit(limit)
    return [_report_out(row) for row in db.scalars(query).all()]


@router.get("/reports/{report_id}")
def get_traffic_report(report_id: str, db: Session = Depends(get_db), _user=Depends(require_roles("operator", "admin"))):
    row = db.scalar(select(TrafficAnalysisReport).where(TrafficAnalysisReport.public_id == report_id))
    if not row:
        raise HTTPException(status_code=404, detail="Traffic report not found.")
    return _report_out(row)


class SignalStudyReportIn(BaseModel):
    name: str = Field(default="Signal timing study", min_length=3, max_length=180)
    result: dict = Field(..., description="Completed read-only signal timing comparison")


@router.post("/reports/signal-study", status_code=201)
def save_signal_study(payload: SignalStudyReportIn, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    """Persist a forecast-based signal study for review and later retrieval."""
    result = payload.result
    if result.get("mode") != "xgboost_model_scenario" or not isinstance(result.get("timeline"), list) or not result["timeline"]:
        raise HTTPException(status_code=422, detail="A completed 60-minute signal study is required.")
    saved = _save_report(db, user, "signal_plan_study", payload.name, "model_forecast", result)
    return _report_out(saved)


@router.post("/analyze")
async def analyze_traffic_image(
    file: UploadFile = File(...), confidence: float = Query(default=0.25, ge=0.05, le=0.9),
    db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin")),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG or WebP image.")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    filename = file.filename or "road-scene.jpg"
    await file.close()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large. Maximum upload size is 8 MB.")
    try:
        result = await run_in_threadpool(analyze_image, raw, confidence)
        saved = _save_report(db, user, "image_analysis", filename, "image", result)
        return {**result, "report_id": saved.public_id, "saved_at": saved.created_at.isoformat()}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Vehicle detection weights are unavailable on this service.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Traffic image analysis could not complete. Retry after the service is ready.") from exc


class OpsWorkflowIn(BaseModel):
    junction_id: int | None = None
    report: dict = Field(..., description="Structured result from a traffic image or video analysis")
    scenario: str = Field(default="baseline", pattern="^(baseline|demand_surge|signal_priority)$")
    prompt: str = Field(default="Review the evidence, draft a safe signal plan and run a 60-minute forecast.", min_length=3, max_length=700)
    cycle_seconds: int = Field(default=90, ge=40, le=180)
    segment_distance_km: float = Field(default=0.5, ge=0.001, le=100)


@router.post("/analyze-video")
async def analyze_traffic_video(
    file: UploadFile = File(...), confidence: float = Query(default=0.25, ge=0.05, le=0.9),
    sample_every_seconds: int = Query(default=5, ge=1, le=10),
    approach_rois: str | None = Query(default=None), db: Session = Depends(get_db),
    user=Depends(require_roles("operator", "admin")),
):
    if file.content_type not in ALLOWED_VIDEO_TYPES and not (file.filename or "").lower().endswith((".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v")):
        raise HTTPException(status_code=415, detail="Upload an MP4, MOV, AVI, MKV, WebM or M4V traffic video.")
    raw = await file.read(MAX_VIDEO_BYTES + 1)
    filename = file.filename or "traffic-clip.mp4"
    await file.close()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded video is empty.")
    if len(raw) > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="Video is larger than 25 MB. Choose a smaller clip for reliable cloud processing.")
    try:
        parsed_rois = json.loads(approach_rois) if approach_rois else None
        if parsed_rois is not None and not isinstance(parsed_rois, list):
            raise ValueError("approach_rois must be a JSON array")
        result = await run_in_threadpool(analyze_video, raw, filename, confidence, sample_every_seconds, parsed_rois)
        saved = _save_report(db, user, "video_analysis", filename, "video", result)
        return {**result, "report_id": saved.public_id, "saved_at": saved.created_at.isoformat()}
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Vehicle detection is unavailable because the model weights are missing.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Video analysis could not complete. Try a shorter MP4 clip.") from exc


@router.post("/ops-workflow", status_code=201)
def run_traffic_ops_workflow(payload: OpsWorkflowIn, request: Request, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    """Analyse evidence without requiring a registered junction; field plans remain junction-gated."""
    junction = db.get(Junction, payload.junction_id) if payload.junction_id else None
    if payload.junction_id and not junction:
        raise HTTPException(status_code=404, detail="Selected junction was not found. Clear the junction selection to run a corridor analysis.")
    report = payload.report
    try:
        total = max(0, min(100000, int(report.get("total_vehicles") or report.get("peak_vehicles_in_frame") or 0)))
        peak = max(0, min(100000, int(report.get("peak_vehicles_in_frame") or total)))
        score = report.get("congestion_score_heuristic")
        score = max(0.0, min(100.0, float(score))) if score is not None else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="The traffic report has invalid vehicle counts or congestion values.")

    evidence = {
        "mode": report.get("mode"), "model": report.get("model"),
        "source_filename": str(report.get("source_filename") or "uploaded traffic clip")[:180],
        "video": report.get("video") if isinstance(report.get("video"), dict) else {},
        "counts": report.get("counts") if isinstance(report.get("counts"), dict) else {},
        "total_vehicles": total, "peak_vehicles_in_frame": peak,
        "mean_vehicles_per_sampled_frame": report.get("mean_vehicles_per_sampled_frame"),
        "congestion_estimate": report.get("congestion_estimate"), "congestion_score_heuristic": score,
        "tracking_ids_available": bool(report.get("tracking_ids_available")),
        "unique_count_method": report.get("unique_count_method"),
        "approach_calibration": report.get("approach_calibration") if isinstance(report.get("approach_calibration"), dict) else {"enabled": False},
        "approach_demand": report.get("approach_demand") if isinstance(report.get("approach_demand"), dict) else {},
        "congestion_note": report.get("congestion_note"), "confidence_threshold": report.get("confidence_threshold"),
        "report_version": report.get("report_version", "traffic-report-v1"),
    }
    distance_km = float(payload.segment_distance_km)
    estimated_emissions = estimate_from_counts(evidence["counts"], distance_km)
    evidence["emissions_estimate"] = estimated_emissions
    evidence["segment_distance_km"] = distance_km

    observation = None
    if junction:
        observation = TrafficObservation(
            junction_id=junction.id, external_junction_id=junction.external_id,
            source="opencv_yolo_video", observed_at=datetime.now(timezone.utc),
            vehicle_count=peak, queue_length_m=None, average_speed_kmph=None, average_wait_seconds=None,
            lane_density=None, congestion_score=score, lane_demand=evidence.get("approach_demand") or {},
            detection_summary=evidence,
        )
        db.add(observation)
        junction.status = "online"
        db.flush()

    try:
        agent_result = run_ops_agent(report=evidence, prompt=payload.prompt, scenario=payload.scenario, cycle_seconds=payload.cycle_seconds)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Traffic analysis could not complete. Your camera report is still saved; retry the agent in a moment.") from exc

    draft = agent_result.get("tool_results", {}).get("draft_signal_timing") or build_draft_phases(evidence, payload.cycle_seconds)
    phases = draft.get("phases") or build_draft_phases(evidence, payload.cycle_seconds)["phases"]
    cycle = sum(int(item["green_seconds"]) + int(item.get("yellow_seconds", 3)) + int(item.get("all_red_seconds", 1)) for item in phases)
    forecast = agent_result.get("tool_results", {}).get("run_60_minute_traffic_forecast")
    if not forecast:
        try:
            forecast = run_forecast(payload.scenario, report=evidence, cycle_seconds=payload.cycle_seconds, phases=phases)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=503, detail="The 60-minute forecast is unavailable. The evidence report remains saved.") from exc
    timeline = forecast.get("timeline") or []
    compact_timeline = [{key: point.get(key) for key in ("minute", "queue_total", "vehicles", "heavy_roads", "moderate_roads", "free_roads")} for point in timeline]
    summary = forecast.get("summary") or {}
    saved_result = {
        "evidence": evidence,
        "agent": {key: value for key, value in agent_result.items() if key != "tool_results"},
        "plan_draft": {"status": "draft" if junction else "corridor_preview", "junction_id": junction.id if junction else None, "cycle_seconds": cycle, "phases": phases, "rationale": draft.get("rationale")},
        "simulation": {"mode": forecast.get("mode"), "engine": forecast.get("engine"), "summary": summary, "timeline": compact_timeline, "baseline_timeline": forecast.get("baseline_timeline"), "training_data": forecast.get("training_data"), "models": forecast.get("models"), "notes": forecast.get("notes")},
    }
    saved = _save_report(db, user, "traffic_agent_run", evidence["source_filename"], "agent", saved_result, junction.id if junction else None)

    if not junction:
        return {
            "success": True, "report_id": saved.public_id, "observation_id": None,
            "plan": {"id": None, "public_id": None, "status": "corridor_preview", "cycle_seconds": cycle, "phases": phases, "rationale": draft.get("rationale"), "junction_id": None, "requires_junction_mapping": True},
            "simulation": {"id": None, "engine": forecast.get("engine") or forecast.get("mode"), "status": "completed", "name": "60-minute corridor forecast", "summary": summary, "timeline": compact_timeline, "baseline_timeline": forecast.get("baseline_timeline"), "models": forecast.get("models"), "training_data": forecast.get("training_data"), "mode": forecast.get("mode"), "caveats": forecast.get("notes") or []},
            "agent": {key: value for key, value in agent_result.items() if key != "tool_results"},
            "tools": agent_result.get("tools_called", []), "emissions_estimate": estimated_emissions,
            "human_review_required": True, "junction_mapping_required_for_approval": True, "physical_dispatch_enabled": False,
        }

    observation_id = observation.id if observation else None
    plan = SignalPlan(
        public_id=str(uuid.uuid4()), junction_id=junction.id, created_by_user_id=user.id,
        status="draft", plan_type="adaptive_recommendation", cycle_seconds=cycle, phases=phases,
        rationale=str(draft.get("rationale") or "Draft generated from camera evidence; lane calibration may be incomplete.")[:3000],
        projected_outcomes={"video_observation_id": observation_id, "video_evidence": evidence, "human_review_required": True, "physical_dispatch_enabled": False},
        model_version=(f"google-adk-{agent_result.get('llm_model')}" if str(agent_result.get("agent_mode", "")).startswith("google_adk_") else "deterministic-traffic-ops-v1"),
    )
    db.add(plan)
    db.flush()
    simulation = SimulationRun(
        public_id=str(uuid.uuid4()), junction_id=junction.id, submitted_by_user_id=user.id,
        signal_plan_id=plan.id, name=f"60-minute {payload.scenario.replace('_', ' ')} forecast",
        engine=str(forecast.get("engine") or forecast.get("mode") or "trained-xgboost-60min-scenario")[:80],
        status="completed", baseline=timeline[0] if timeline else {}, proposed_phases=phases,
        results={"mode": forecast.get("mode"), "engine": forecast.get("engine"), "scenario": payload.scenario, "duration_minutes": 60, "summary": summary, "timeline": compact_timeline, "baseline_timeline": forecast.get("baseline_timeline"), "models": forecast.get("models"), "training_data": forecast.get("training_data")},
        caveats=list(forecast.get("notes") or []) + ["No commands are sent to physical traffic signal controllers."],
    )
    db.add(simulation)
    db.flush()
    if forecast.get("mode") == "native_sumo_simulation":
        plan.status = "simulated"
    plan.projected_outcomes = {**plan.projected_outcomes, "simulation_run_id": simulation.id, "forecast_summary": summary, "forecast_engine": simulation.engine, "forecast_type": "native_simulation" if forecast.get("mode") == "native_sumo_simulation" else "traffic_forecast_only"}
    db.commit()
    db.refresh(plan)
    db.refresh(simulation)
    return {
        "success": True, "report_id": saved.public_id, "observation_id": observation_id,
        "plan": {"id": plan.id, "public_id": plan.public_id, "status": plan.status, "cycle_seconds": plan.cycle_seconds, "phases": plan.phases, "rationale": plan.rationale, "junction_id": plan.junction_id, "model_version": plan.model_version},
        "simulation": {"id": simulation.id, "engine": simulation.engine, "status": simulation.status, "name": simulation.name, "summary": summary, "timeline": compact_timeline, "baseline_timeline": forecast.get("baseline_timeline"), "models": forecast.get("models"), "training_data": forecast.get("training_data"), "engine_label": forecast.get("engine") or forecast.get("mode") or simulation.engine, "mode": forecast.get("mode"), "caveats": simulation.caveats},
        "agent": {key: value for key, value in agent_result.items() if key != "tool_results"}, "tools": agent_result.get("tools_called", []),
        "emissions_estimate": estimated_emissions, "human_review_required": True, "physical_dispatch_enabled": False,
    }
