from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
import json
from starlette.concurrency import run_in_threadpool
from app.services.traffic_detection import analyze_image, status

router = APIRouter(prefix="/traffic-detection", tags=["Traffic AI"])
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.get("/status")
def traffic_model_status():
    return status()


@router.post("/analyze")
async def analyze_traffic_image(
    file: UploadFile = File(...),
    confidence: float = Query(default=0.25, ge=0.05, le=0.9),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG, or WebP image.")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large. Maximum upload size is 8 MB.")
    try:
        return analyze_image(raw, confidence=confidence)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Traffic model weights are unavailable on this server.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        # Don't leak filesystem paths or implementation details to public clients.
        raise HTTPException(status_code=503, detail="Traffic model inference is unavailable. Retry after confirming the model dependencies and weights are installed.") from exc

# Video analytics and operator workflow are optional capabilities layered onto the
# existing image endpoint so existing clients remain compatible.
from datetime import datetime, timezone
import uuid
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.db import get_db
from app.dependencies import require_roles
from app.models import Junction, SignalPlan, SimulationRun, TrafficObservation
from app.services.traffic_video import analyze_video, video_status
from app.services.traffic_ops_agent import build_draft_phases, run_forecast, run_ops_agent
from app.services.emissions import estimate_from_counts

MAX_VIDEO_BYTES = 150 * 1024 * 1024
ALLOWED_VIDEO_TYPES = {
    "video/mp4", "video/quicktime", "video/x-msvideo", "video/avi",
    "video/x-matroska", "video/webm", "video/mpeg", "application/octet-stream",
}


class OpsWorkflowIn(BaseModel):
    junction_id: int
    report: dict = Field(..., description="Structured output from the traffic video or image analysis endpoint")
    scenario: str = Field(default="baseline", pattern="^(baseline|demand_surge|signal_priority)$")
    prompt: str = Field(default="Review the footage, propose a safe signal plan and run a 60-minute forecast.", min_length=3, max_length=700)
    cycle_seconds: int = Field(default=90, ge=40, le=180)
    segment_distance_km: float = Field(default=0.5, ge=0.001, le=100, description="Operator-specified camera corridor length used for the video emissions estimate")


@router.get("/video-status")
def traffic_video_status():
    return video_status()


@router.post("/analyze-video")
async def analyze_traffic_video(
    file: UploadFile = File(...),
    confidence: float = Query(default=0.25, ge=0.05, le=0.9),
    sample_every_seconds: int = Query(default=1, ge=1, le=5),
    approach_rois: str | None = Query(default=None, description="JSON array of normalized camera polygons keyed to canonical signal movements"),
):
    if file.content_type not in ALLOWED_VIDEO_TYPES and not (file.filename or "").lower().endswith((".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v")):
        raise HTTPException(status_code=415, detail="Upload an MP4, MOV, AVI, MKV, WebM or M4V traffic video.")
    raw = await file.read(MAX_VIDEO_BYTES + 1)
    filename = file.filename or "traffic-clip.mp4"
    await file.close()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded video is empty.")
    if len(raw) > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="Video is larger than 150 MB. Choose a smaller clip.")
    try:
        parsed_rois = json.loads(approach_rois) if approach_rois else None
        if parsed_rois is not None and not isinstance(parsed_rois, list):
            raise ValueError("approach_rois must be a JSON array")
        return await run_in_threadpool(analyze_video, raw, filename, confidence, sample_every_seconds, parsed_rois)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="YOLO traffic model weights are unavailable. Set TRAFFIC_MODEL_PATH or install backend/models/best.pt.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Video inference failed. Confirm OpenCV, PyTorch, Ultralytics and YOLO weights are installed ({type(exc).__name__}).") from exc


@router.post("/ops-workflow", status_code=201)
def run_traffic_ops_workflow(payload: OpsWorkflowIn, request: Request, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    """Persist measured video evidence, run safe analysis tools, and create a human-reviewed draft."""
    junction = db.get(Junction, payload.junction_id)
    if not junction:
        raise HTTPException(status_code=404, detail="Junction not found. Register or select an existing junction first.")
    report = payload.report
    try:
        total = max(0, min(100000, int(report.get("total_vehicles") or report.get("peak_vehicles_in_frame") or 0)))
        peak = max(0, min(100000, int(report.get("peak_vehicles_in_frame") or total)))
        score = report.get("congestion_score_heuristic")
        score = max(0.0, min(100.0, float(score))) if score is not None else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="The traffic report has invalid vehicle counts or congestion values.")

    # Keep the database payload small. Never persist annotated video frames or full detections.
    evidence = {
        "mode": report.get("mode"), "model": report.get("model"), "source_filename": str(report.get("source_filename") or "uploaded traffic clip")[:180],
        "video": report.get("video") if isinstance(report.get("video"), dict) else {},
        "counts": report.get("counts") if isinstance(report.get("counts"), dict) else {},
        "total_vehicles": total, "peak_vehicles_in_frame": peak,
        "mean_vehicles_per_sampled_frame": report.get("mean_vehicles_per_sampled_frame"),
        "congestion_estimate": report.get("congestion_estimate"), "congestion_score_heuristic": score,
        "tracking_ids_available": bool(report.get("tracking_ids_available")),
        "unique_count_method": report.get("unique_count_method"),
        "approach_calibration": report.get("approach_calibration") if isinstance(report.get("approach_calibration"), dict) else {"enabled": False},
        "approach_demand": report.get("approach_demand") if isinstance(report.get("approach_demand"), dict) else {},
        "congestion_note": report.get("congestion_note"),
        "confidence_threshold": report.get("confidence_threshold"),
        "report_version": report.get("report_version", "traffic-report-v1"),
    }
    distance_km = float(payload.segment_distance_km)
    counts_for_emissions = evidence.get("counts") or {}
    estimated_emissions = estimate_from_counts(counts_for_emissions, distance_km)
    evidence["emissions_estimate"] = estimated_emissions
    evidence["segment_distance_km_assumption"] = distance_km
    evidence["segment_distance_km"] = distance_km  # consumed by the deterministic and LangGraph emissions tools
    observation = TrafficObservation(
        junction_id=junction.id, external_junction_id=junction.external_id,
        source="opencv_yolo_video", observed_at=datetime.now(timezone.utc),
        vehicle_count=peak, queue_length_m=None, average_speed_kmph=None, average_wait_seconds=None,
        lane_density=None, congestion_score=score,
        lane_demand=evidence.get("approach_demand") or {}, detection_summary=evidence,
    )
    db.add(observation)
    junction.status = "online"
    db.flush()

    # LLM chooses/explains tools when configured; safe tools still execute deterministically without a key.
    try:
        agent_result = run_ops_agent(report=evidence, prompt=payload.prompt, scenario=payload.scenario, cycle_seconds=payload.cycle_seconds)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=f"Traffic operations workflow could not run: {type(exc).__name__}: {str(exc)[:180]}") from exc

    draft = agent_result.get("tool_results", {}).get("draft_signal_timing") or build_draft_phases(evidence, payload.cycle_seconds)
    # Respect the operator's cycle setting when the LLM tool did not preserve it.
    phases = draft.get("phases") or build_draft_phases(evidence, payload.cycle_seconds)["phases"]
    cycle = sum(int(item["green_seconds"]) + int(item.get("yellow_seconds", 3)) + int(item.get("all_red_seconds", 1)) for item in phases)
    plan = SignalPlan(
        public_id=str(uuid.uuid4()), junction_id=junction.id, created_by_user_id=user.id,
        status="draft", plan_type="adaptive_recommendation", cycle_seconds=cycle, phases=phases,
        rationale=str(draft.get("rationale") or "Draft generated from video evidence; lane calibration not available.")[:3000],
        projected_outcomes={"video_observation_id": observation.id, "video_evidence": evidence, "human_review_required": True, "physical_dispatch_enabled": False},
        model_version="langgraph-groq-video-ops-v1" if agent_result.get("agent_mode") == "langgraph_groq_tool_calling" else "deterministic-video-ops-v1",
    )
    db.add(plan)
    db.flush()

    forecast = agent_result.get("tool_results", {}).get("run_60_minute_traffic_forecast")
    if not forecast:
        try:
            forecast = run_forecast(payload.scenario)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=503, detail=f"60-minute model forecast unavailable. Check bundled XGBoost model/data files ({type(exc).__name__}).") from exc
    timeline = forecast.get("timeline") or []
    compact_timeline = [{key: point.get(key) for key in ("minute", "queue_total", "vehicles", "heavy_roads", "moderate_roads", "free_roads")} for point in timeline]
    summary = forecast.get("summary") or {}
    simulation = SimulationRun(
        public_id=str(uuid.uuid4()), junction_id=junction.id, submitted_by_user_id=user.id,
        signal_plan_id=plan.id, name=f"60-minute {payload.scenario.replace('_', ' ')} forecast", engine=str(forecast.get("engine") or forecast.get("mode") or "trained-xgboost-60min-scenario")[:80],
        status="completed", baseline=timeline[0] if timeline else {}, proposed_phases=phases,
        results={"mode": forecast.get("mode"), "engine": forecast.get("engine"), "scenario": payload.scenario, "duration_minutes": 60, "summary": summary, "timeline": compact_timeline, "baseline_timeline": forecast.get("baseline_timeline"), "models": forecast.get("models"), "training_data": forecast.get("training_data"), "evidence_linkage_note": forecast.get("evidence_linkage_note")},
        caveats=list(forecast.get("notes") or []) + (["The uploaded video is stored as measured evidence but does not directly calibrate the global XGBoost forecast features."] if forecast.get("mode") != "native_sumo_simulation" else []) + ["No commands are sent to physical traffic signal controllers."],
    )
    db.add(simulation)
    db.flush()
    # A trained XGBoost forecast is not a simulation of this candidate signal plan.
    # Only the native baseline/intervention SUMO run moves the plan to "simulated".
    if forecast.get("mode") == "native_sumo_simulation":
        plan.status = "simulated"
    plan.projected_outcomes = {
        **plan.projected_outcomes,
        "simulation_run_id": simulation.id,
        "forecast_summary": summary,
        "forecast_engine": simulation.engine,
        "forecast_type": "baseline_vs_candidate_simulation" if forecast.get("mode") == "native_sumo_simulation" else "traffic_forecast_only",
        "forecast_caveats": simulation.caveats,
    }
    db.add(simulation)
    db.commit()
    db.refresh(plan)
    db.refresh(simulation)
    return {
        "success": True,
        "observation_id": observation.id,
        "plan": {"id": plan.id, "public_id": plan.public_id, "status": plan.status, "cycle_seconds": plan.cycle_seconds, "phases": plan.phases, "rationale": plan.rationale, "junction_id": plan.junction_id, "model_version": plan.model_version},
        "simulation": {"id": simulation.id, "engine": simulation.engine, "status": simulation.status, "name": simulation.name, "summary": summary, "timeline": compact_timeline, "baseline_timeline": forecast.get("baseline_timeline"), "models": forecast.get("models"), "training_data": forecast.get("training_data"), "emissions_comparison": forecast.get("emissions_comparison"), "traffic_comparison": forecast.get("traffic_comparison"), "engine_label": forecast.get("engine") or forecast.get("mode") or simulation.engine, "mode": forecast.get("mode"), "engine_fallback_note": forecast.get("engine_fallback_note"), "caveats": simulation.caveats},
        "agent": {key: value for key, value in agent_result.items() if key != "tool_results"},
        "tools": agent_result.get("tools_called", []),
        "emissions_estimate": estimated_emissions,
        "human_review_required": True,
        "physical_dispatch_enabled": False,
    }
