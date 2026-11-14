"""LangGraph traffic operations workflow with safe tool execution and a no-key fallback."""
from __future__ import annotations

import json
import os
from typing import Any

from app.services.traffic_simulation import get_simulation_scenario
from app.core.config import settings
from app.services.emissions import estimate_from_counts
from app.services.traffic_calibration import emissions_aware_plan


def build_draft_phases(report: dict[str, Any], cycle_seconds: int = 90) -> dict[str, Any]:
    """Build a safe candidate timing plan, using calibrated ROI data when present."""
    cycle = max(40, min(180, int(cycle_seconds)))
    optimized = emissions_aware_plan(report.get("approach_demand") or {}, cycle)
    phases = optimized.get("phases") or []
    if not phases:
        # Defensive fallback: a valid four-stage equal split.
        movements = ["north_south_through", "east_west_through", "north_south_turn", "east_west_turn"]
        green_budget = max(32, cycle - 16)
        base, remainder = divmod(green_budget, len(movements))
        phases = [{"name": movement.replace("_", " ").title(), "movement": movement,
                   "green_seconds": base + (1 if i < remainder else 0), "yellow_seconds": 3,
                   "all_red_seconds": 1, "demand_weight": 1.0} for i, movement in enumerate(movements)]
    return {
        "plan_type": "adaptive_recommendation",
        "cycle_seconds": sum(int(p["green_seconds"]) + int(p.get("yellow_seconds", 3)) + int(p.get("all_red_seconds", 1)) for p in phases),
        "phases": phases,
        "rationale": optimized.get("rationale") or "Candidate signal plan generated from traffic evidence.",
        "optimization_method": optimized.get("optimization_method"),
        "optimized": bool(optimized.get("optimized")),
        "approach_evidence": optimized.get("approach_evidence", []),
        "video_evidence": {key: report.get(key) for key in ("source_filename", "total_vehicles", "peak_vehicles_in_frame", "mean_vehicles_per_sampled_frame", "congestion_estimate", "congestion_score_heuristic", "tracking_ids_available")},
        "human_review_required": True,
        "physical_dispatch_enabled": False,
    }


def run_forecast(scenario: str = "baseline", report: dict[str, Any] | None = None, cycle_seconds: int = 90, phases: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    scenario = scenario if scenario in {"baseline", "demand_surge", "signal_priority"} else "baseline"
    native_error = None
    try:
        from app.services.sumo_runner import run_native_sumo_simulation
        native = run_native_sumo_simulation(scenario, report=report, proposed_phases=phases or build_draft_phases(report or {}, cycle_seconds)["phases"])
        if native is not None:
            return native
    except Exception as exc:
        native_error = f"Native SUMO was detected but execution failed ({type(exc).__name__}); the forecast fell back to the trained XGBoost scenario. Check backend logs for details."

    result = get_simulation_scenario(minutes=60, step_minutes=5, scenario=scenario)
    result["engine"] = "trained-xgboost-60min-scenario"
    result["evidence_linkage_note"] = "The forecast uses the bundled SUMO-generated training dataset and trained 30/60-minute XGBoost models. The uploaded clip informs the operator's evidence report and draft plan, but does not directly calibrate the global network forecast. This is not a running SUMO/TraCI process."
    if native_error:
        result["engine_fallback_note"] = native_error
        result.setdefault("notes", []).append(native_error)
    return result


def run_ops_agent(report: dict[str, Any], prompt: str = "Analyze this traffic clip, draft a safe signal plan, and run a 60-minute forecast.", scenario: str = "baseline", cycle_seconds: int = 90) -> dict[str, Any]:
    """Run actual LangGraph tool-calling when Groq credentials are configured.

    All tools are read-only/analytical. Approval and real-world dispatch stay outside the agent.
    """
    scenario = scenario if scenario in {"baseline", "demand_surge", "signal_priority"} else "baseline"
    tool_results: dict[str, Any] = {}
    model = os.getenv("GROQ_MODEL", settings.groq_model).strip() or "openai/gpt-oss-120b"
    api_key = (os.getenv("GROQ_API_KEY", "") or settings.groq_api_key).strip()

    if api_key:
        try:
            from langchain_core.tools import tool
            from langchain_groq import ChatGroq
            from langgraph.prebuilt import create_react_agent

            report_json = json.dumps(report, default=str)

            @tool
            def inspect_video_evidence() -> str:
                """Read the actual structured YOLO/OpenCV report. Use before recommending timing."""
                evidence = {key: report.get(key) for key in (
                    "source_filename", "video", "counts", "total_vehicles", "peak_vehicles_in_frame",
                    "mean_vehicles_per_sampled_frame", "congestion_estimate", "congestion_score_heuristic",
                    "tracking_ids_available", "unique_count_method", "congestion_note",
                )}
                tool_results["inspect_video_evidence"] = evidence
                return json.dumps(evidence)

            @tool
            def calculate_video_emissions() -> str:
                """Estimate CO2, NOx, PM and CO from the detected vehicle mix over the operator-specified corridor distance. Values are estimates, not measured exhaust."""
                counts = report.get("counts") or {}
                distance = float(report.get("segment_distance_km") or 0.5)
                result = estimate_from_counts(counts, distance)
                tool_results["calculate_video_emissions"] = result
                return json.dumps(result, default=str)

            @tool
            def draft_signal_timing() -> str:
                """Generate a validated draft signal phase plan using the operator-selected cycle length. It never sends commands to hardware."""
                result = build_draft_phases(report, cycle_seconds)
                tool_results["draft_signal_timing"] = result
                return json.dumps(result)

            @tool
            def run_60_minute_traffic_forecast(selected_scenario: str = "") -> str:
                """Run a 3,600-second native SUMO baseline/intervention when SUMO is installed, otherwise the bundled trained XGBoost 60-minute scenario. Allowed scenarios: baseline, demand_surge, signal_priority."""
                result = run_forecast(selected_scenario or scenario, report=report, cycle_seconds=cycle_seconds, phases=tool_results.get("draft_signal_timing", {}).get("phases"))
                # Timeline is stored server-side for the API response; keep model context compact.
                compact = {key: value for key, value in result.items() if key != "timeline"}
                compact["timeline_steps"] = len(result.get("timeline", []))
                tool_results["run_60_minute_traffic_forecast"] = result
                return json.dumps(compact, default=str)

            llm = ChatGroq(api_key=api_key, model=model, temperature=0.1, max_retries=1, timeout=35)
            graph = create_react_agent(
                model=llm,
                tools=[inspect_video_evidence, calculate_video_emissions, draft_signal_timing, run_60_minute_traffic_forecast],
                prompt=(
                    "You are UrbanSaarthi's pollution-aware traffic operations analyst. Call inspect_video_evidence, calculate_video_emissions, "
                    "draft_signal_timing, and run_60_minute_traffic_forecast before reporting. Distinguish actual YOLO counts from model forecasts. "
                    "Never claim vehicle counts imply lane direction. Never dispatch physical signals. A human operator must approve the draft. "
                    "Summarize evidence, assumptions, forecast caveats, and the next operator action."
                ),
            )
            inputs = {"messages": [{"role": "user", "content": f"Operator request: {prompt}\nRequested forecast scenario: {scenario}\nActual video report: {report_json[:12000]}"}]}
            state = graph.invoke(inputs, config={"recursion_limit": 8})
            messages = state.get("messages", [])
            final_text = str(getattr(messages[-1], "content", "Traffic analysis completed.")) if messages else "Traffic analysis completed."
            # Ensure the workflow's critical outputs exist even if the model omitted a tool call.
            if "calculate_video_emissions" not in tool_results:
                tool_results["calculate_video_emissions"] = estimate_from_counts(report.get("counts") or {}, float(report.get("segment_distance_km") or 0.5))
            if "draft_signal_timing" not in tool_results:
                tool_results["draft_signal_timing"] = build_draft_phases(report, cycle_seconds)
            if "run_60_minute_traffic_forecast" not in tool_results:
                tool_results["run_60_minute_traffic_forecast"] = run_forecast(scenario, report=report, cycle_seconds=cycle_seconds, phases=tool_results["draft_signal_timing"].get("phases"))
            if "inspect_video_evidence" not in tool_results:
                tool_results["inspect_video_evidence"] = {"counts": report.get("counts", {}), "total_vehicles": report.get("total_vehicles")}
            return {
                "agent_mode": "langgraph_groq_tool_calling",
                "llm_model": model,
                "response": final_text,
                "tools_called": list(tool_results.keys()),
                "tool_results": tool_results,
                "human_review_required": True,
                "physical_dispatch_enabled": False,
            }
        except Exception as exc:
            # Fail open to deterministic analysis, but report the LLM failure transparently.
            llm_error = f"Groq/LangGraph unavailable for this run: {type(exc).__name__}: {str(exc)[:180]}"
    else:
        llm_error = "GROQ_API_KEY is not configured. Deterministic tools still run; add a free Groq API key to enable LLM tool selection and synthesis."

    tool_results["calculate_video_emissions"] = estimate_from_counts(report.get("counts") or {}, float(report.get("segment_distance_km") or 0.5))
    tool_results["inspect_video_evidence"] = {key: report.get(key) for key in (
        "source_filename", "video", "counts", "total_vehicles", "peak_vehicles_in_frame",
        "mean_vehicles_per_sampled_frame", "congestion_estimate", "congestion_score_heuristic", "tracking_ids_available",
    )}
    tool_results["draft_signal_timing"] = build_draft_phases(report, cycle_seconds)
    tool_results["run_60_minute_traffic_forecast"] = run_forecast(scenario, report=report, cycle_seconds=cycle_seconds, phases=tool_results["draft_signal_timing"].get("phases"))
    summary = tool_results["run_60_minute_traffic_forecast"].get("summary", {})
    response = (
        f"Reviewed {report.get('total_vehicles', 0)} tracked/estimated vehicles across "
        f"{(report.get('video') or {}).get('sampled_frames', 0)} sampled frames. "
        f"Estimated tailpipe emissions using {tool_results['calculate_video_emissions'].get('factor_version')} factors. "
        f"Created a {'calibrated emissions-aware' if tool_results['draft_signal_timing'].get('optimized') else 'equal-split'} "
        f"{tool_results['draft_signal_timing']['cycle_seconds']}s draft. "
        f"The 60-minute scenario reports queue change {summary.get('queue_change_vs_baseline_percent', summary.get('queue_change_percent', 'n/a'))}%. "
        "The plan is not deployed; operator review is required."
    )
    return {
        "agent_mode": "deterministic_tool_fallback",
        "llm_model": None,
        "response": response,
        "llm_note": llm_error,
        "tools_called": list(tool_results.keys()),
        "tool_results": tool_results,
        "human_review_required": True,
        "physical_dispatch_enabled": False,
    }
