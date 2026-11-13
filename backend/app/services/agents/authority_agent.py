"""
Authority AI Agent
------------------
Dedicated AI Assistant and Dashboard Engine for City Traffic Operators and Administrators.
Provides traffic intelligence with YOLO vehicle counting, SUMO intervention simulation,
AQI monitoring, and incident triage with status updates.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from sqlalchemy.orm import Session

from app.models import CityAlert
from app.services.agent_engine import (
    get_aqi_snapshot,
    get_traffic_snapshot,
    recommend_signal_strategy,
    _resolve_city,
)
from app.services.traffic_detection import status as yolo_status
from app.services.traffic_simulation import get_simulation_scenario, get_simulation_snapshot
from app.services.agents.base import (
    AgentExecutionResult,
    call_llm_synthesis_with_info,
    get_llm_provider,
)


def run_authority_agent(
    query: str,
    db: Session | None = None,
    latitude: float = 28.6139,
    longitude: float = 77.2090,
    action_type: str | None = None,
    action_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute the Authority AI Agent pipeline."""
    q = query.strip()
    steps: list[dict[str, Any]] = []
    tools_called: list[str] = []
    tool_results: list[dict[str, Any]] = []

    # 1. Action Execution: Status update on an incident
    if action_type == "update_incident_status" and action_payload and db:
        report_id = action_payload.get("report_id")
        new_status = action_payload.get("new_status", "reviewing")
        operator_notes = action_payload.get("notes", "Reviewed by municipal operator.")

        alert = db.query(CityAlert).filter(CityAlert.public_id == report_id).first()
        if alert:
            alert.status = new_status
            alert.resolution_note = operator_notes
            db.commit()
            res_info = {
                "tool": "update_incident_status",
                "reference_id": report_id,
                "old_status": alert.status,
                "new_status": new_status,
                "notes": operator_notes,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        else:
            res_info = {"tool": "update_incident_status", "error": f"Report {report_id} not found"}

        steps.append({
            "step": 1,
            "tool": "update_incident_status",
            "label": "Incident Status Update",
            "thought": f"Operator requested status change to '{new_status}' for {report_id}.",
            "status": "success" if alert else "error",
            "result": res_info,
        })
        tools_called.append("update_incident_status")

        return AgentExecutionResult(
            agent_role="authority",
            query=query,
            response_text=f"Incident **{report_id}** status successfully updated to **{new_status.upper()}**.",
            steps=steps,
            tools_called=tools_called,
            data_mode="live",
            data_mode_label="Database Audit Log",
        ).to_dict()

    # Intent analysis for authority queries
    wants_incidents = bool(re.search(r"\b(incidents?|reports?|triage|complaints?|pothole|accident)\b", q, re.IGNORECASE))
    wants_simulation = bool(re.search(r"\b(simulat(e|ion)|intervention|scenario|what[\s\-]if|green[\s\-]wave|demand[\s\-]surge)\b", q, re.IGNORECASE))
    wants_signals = bool(re.search(r"\b(signal|timing|phase|junction|light|cycle)\b", q, re.IGNORECASE))
    wants_yolo = bool(re.search(r"\b(yolo|camera|vision|vehicle\s*count|detection)\b", q, re.IGNORECASE))
    wants_aqi = bool(re.search(r"\b(aqi|air|pollution|pm2\.?5|emissions?)\b", q, re.IGNORECASE))
    wants_traffic = bool(re.search(r"\b(traffic|congestion|queue|hotspot|speed|capacity)\b", q, re.IGNORECASE))

    if not any([wants_incidents, wants_simulation, wants_signals, wants_yolo, wants_aqi, wants_traffic]):
        # Default authority overview: traffic + simulation + incidents
        wants_traffic = True
        wants_incidents = True

    traffic_intel = None
    if wants_traffic or wants_signals:
        traffic_snapshot = get_traffic_snapshot(latitude, longitude)
        yolo_inf = yolo_status()

        traffic_intel = {
            "tool": "get_traffic_intelligence",
            "simulation_snapshot": traffic_snapshot,
            "yolo_detection_model": yolo_inf,
            "hotspot_count": traffic_snapshot.get("summary", {}).get("heavy_roads_now", 0),
            "data_mode": traffic_snapshot.get("data_mode", "unavailable"),
        }
        steps.append({
            "step": len(steps) + 1,
            "tool": "get_traffic_intelligence",
            "label": "Traffic & Detection Intelligence",
            "thought": "Combining traffic forecasts, camera evidence and city observations.",
            "status": "success",
            "data_mode": traffic_snapshot.get("data_mode", "unavailable"),
            "data_mode_label": traffic_snapshot.get("data_mode_label", "60-minute traffic forecast"),
            "result": traffic_intel,
        })
        tools_called.append("get_traffic_intelligence")
        tool_results.append(traffic_intel)

    sim_result = None
    if wants_simulation:
        scenario_name = "signal_priority" if "signal" in q.lower() or "priority" in q.lower() else "demand_surge"
        try:
            scenario_data = get_simulation_scenario(minutes=30, step_minutes=5, scenario=scenario_name)
            timeline = scenario_data.get("timeline") or []
            initial_queue = timeline[0].get("queue_total") if timeline else None
            final_queue = timeline[-1].get("queue_total") if timeline else None
            delta_pct = (
                round((float(final_queue) - float(initial_queue)) / max(float(initial_queue), 1) * 100, 1)
                if initial_queue is not None and final_queue is not None else None
            )

            sim_result = {
                "tool": "simulate_traffic_intervention",
                "status": "available" if delta_pct is not None else "unavailable",
                "scenario": scenario_name,
                "duration_minutes": 30,
                "initial_queue_vehicles": initial_queue,
                "projected_queue_vehicles": final_queue,
                "projected_queue_delta_pct": delta_pct,
                "model_accuracy": scenario_data.get("models", {}).get("horizon_30", {}).get("level_accuracy_percent"),
                "data_mode": scenario_data.get("mode", "trained_model_scenario"),
                "caveat": "Trained-model forecast with a documented what-if sensitivity overlay, not a calibrated signal-control experiment or observed live traffic. Human review is required.",
            }
        except Exception as exc:
            sim_result = {
                "tool": "simulate_traffic_intervention",
                "status": "unavailable",
                "scenario": scenario_name,
                "projected_queue_delta_pct": None,
                "error_type": type(exc).__name__,
                "note": "The simulation service did not return a result. No performance improvement is claimed.",
            }

        steps.append({
            "step": len(steps) + 1,
            "tool": "simulate_traffic_intervention",
            "label": "Traffic Scenario Evaluation",
            "thought": f"Evaluating the available 30-minute scenario '{scenario_name}'.",
            "status": "success" if sim_result.get("status") == "available" else "unavailable",
            "data_mode": sim_result.get("data_mode", "unavailable"),
            "data_mode_label": "Model forecast" if sim_result.get("status") == "available" else "Unavailable",
            "result": sim_result,
        })
        tools_called.append("simulate_traffic_intervention")
        tool_results.append(sim_result)

    incidents_list = None
    if wants_incidents and db:
        try:
            alerts = db.query(CityAlert).filter(CityAlert.category == "incident").order_by(CityAlert.starts_at.desc()).limit(8).all()
            incidents_list = [
                {
                    "reference_id": a.public_id,
                    "title": a.title,
                    "severity": a.severity,
                    "status": a.status,
                    "reported_at": a.starts_at.strftime("%Y-%m-%d %H:%M"),
                    "priority_rank": 1 if a.severity in ("critical", "high") else (2 if a.status == "submitted" else 3),
                }
                for a in alerts
            ]
            incidents_list.sort(key=lambda x: (x["priority_rank"], x["status"] != "submitted"))
        except Exception:
            incidents_list = []

        step_res = {
            "tool": "list_incident_reports",
            "total_incidents": len(incidents_list),
            "pending_review": sum(1 for i in incidents_list if i["status"] == "submitted"),
            "incidents": incidents_list,
        }
        steps.append({
            "step": len(steps) + 1,
            "tool": "list_incident_reports",
            "label": "Incident Triage Queue",
            "thought": f"Retrieved {len(incidents_list)} citizen incident reports prioritized by severity and status.",
            "status": "success",
            "data_mode": "live",
            "data_mode_label": "Live Operator Queue",
            "result": step_res,
        })
        tools_called.append("list_incident_reports")
        tool_results.append(step_res)

    signal_strategy_res = None
    if wants_signals:
        signal_strategy_res = recommend_signal_strategy(
            traffic_data=traffic_intel.get("simulation_snapshot") if traffic_intel else None,
            latitude=latitude,
            longitude=longitude,
        )
        steps.append({
            "step": len(steps) + 1,
            "tool": "recommend_signal_strategy",
            "label": "Adaptive Signal Optimization",
            "thought": "Generating demand-weighted cycle times and phase splits.",
            "status": "success",
            "data_mode": signal_strategy_res.get("data_mode", "sumo_model"),
            "data_mode_label": signal_strategy_res.get("data_mode_label", "Forecast-informed strategy"),
            "result": signal_strategy_res,
        })
        tools_called.append("recommend_signal_strategy")
        tool_results.append(signal_strategy_res)

    # LLM Synthesis
    provider, api_key, model_name = get_llm_provider()
    system_prompt = (
        "You are the UrbanSaarthi Authority AI Operations Assistant for traffic engineers and municipal controllers. "
        "Provide rigorous, actionable intelligence. Distinguish between live sensor observations, trained SUMO model forecasts, "
        "and analytical simulations. Prioritize safety and incident triage. Never pretend simulations guarantee real-world outcomes."
    )
    llm_resp, llm_used_model = call_llm_synthesis_with_info(system_prompt, q, tool_results)

    if not llm_resp:
        parts = []
        city_info = _resolve_city(latitude, longitude)
        parts.append(f"### Authority Intelligence Brief · {city_info['name']}")

        if traffic_intel:
            s = traffic_intel["simulation_snapshot"].get("summary", {})
            parts.append(
                f"• **Corridor State**: Congestion is **{s.get('congestion_level')}** (score {s.get('mean_congestion_score')}/100). "
                f"{s.get('heavy_roads_now')} corridor(s) at Heavy/Severe saturation. "
                f"Vehicle detection weights are {'loaded' if traffic_intel['yolo_detection_model'].get('ready') else 'available via manual weights path'}."
            )

        if sim_result:
            delta = sim_result.get("projected_queue_delta_pct")
            if sim_result.get("status") == "available" and isinstance(delta, (int, float)):
                parts.append(
                    f"• **Traffic Scenario ({sim_result.get('scenario')})**: "
                    f"The modelled 30-minute queue change is **{delta:+.1f}%**. "
                    f"*{sim_result.get('caveat')}*"
                )
            else:
                parts.append(
                    f"• **Traffic Scenario ({sim_result.get('scenario')})**: The scenario result is unavailable. "
                    "No queue-improvement figure is being reported."
                )

        if incidents_list is not None:
            pending = sum(1 for i in incidents_list if i["status"] == "submitted")
            parts.append(
                f"• **Citizen Incidents**: {len(incidents_list)} total reports on file, **{pending} pending operator triage**. "
                + (f"Top issue: {incidents_list[0]['title']} ({incidents_list[0]['severity'].upper()})" if incidents_list else "No active citizen incidents logged.")
            )

        if signal_strategy_res:
            parts.append(
                f"• **Signal Recommendation**: **{signal_strategy_res.get('strategy_label')}** "
                f"(Cycle: {signal_strategy_res.get('recommended_cycle_seconds')}s, Est queue reduction: {signal_strategy_res.get('expected_queue_reduction_pct')}%)."
            )

        llm_resp = "\n\n".join(parts)

    recommendations = []
    if sim_result and sim_result.get("status") == "available" and isinstance(sim_result.get("projected_queue_delta_pct"), (int, float)):
        recommendations.append({
            "type": "intervention",
            "priority": "high",
            "icon": "⚡",
            "title": f"Review scenario: {sim_result.get('scenario', 'Strategy').replace('_', ' ').title()}",
            "text": f"Modelled {sim_result['projected_queue_delta_pct']:+.1f}% queue change over 30 minutes; validate against field conditions.",
            "action": "Operator review required. No physical signal commands are sent.",
        })

    if incidents_list and any(i["status"] == "submitted" for i in incidents_list):
        pending = sum(1 for i in incidents_list if i["status"] == "submitted")
        recommendations.append({
            "type": "triage",
            "priority": "urgent" if any(i["severity"] in ("critical", "high") for i in incidents_list) else "medium",
            "icon": "🛡️",
            "title": f"{pending} Citizen Reports Awaiting Review",
            "text": "New hazards or congestion reports submitted by citizens.",
            "action": "Review in Incident Triage tab.",
        })

    return AgentExecutionResult(
        agent_role="authority",
        query=query,
        response_text=llm_resp,
        steps=steps,
        tools_called=tools_called,
        data_mode=(
            "mixed" if traffic_intel and sim_result and sim_result.get("status") == "available"
            else sim_result.get("data_mode", "forecast") if sim_result and sim_result.get("status") == "available"
            else traffic_intel.get("data_mode", "unavailable") if traffic_intel
            else "live" if incidents_list is not None
            else "unavailable"
        ),
        data_mode_label="Traffic forecast and operator records" if sim_result and sim_result.get("status") == "available" else "Available operator data",
        recommendations=recommendations,
        llm_mode=("google_gemma" if llm_used_model and llm_used_model.startswith("gemma-") else "google_gemini") if llm_resp else "rule_based_fallback",
        llm_model=llm_used_model,
        extra_data={
            "incidents": incidents_list,
            "simulation": sim_result,
            "signal_strategy": signal_strategy_res,
        },
    ).to_dict()
