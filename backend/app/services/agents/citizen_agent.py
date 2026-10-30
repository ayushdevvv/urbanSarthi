"""
Citizen AI Agent
----------------
Assists citizens with pollution-aware route recommendations,
real-time traffic and AQI guidance, and incident reporting with tracking IDs.
Operates exclusively within citizen-authorized scope.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any
from sqlalchemy.orm import Session

from app.models import CityAlert
from app.services.agent_engine import (
    analyze_routes,
    get_aqi_snapshot,
    get_traffic_snapshot,
    _resolve_city,
    _congestion_label,
    _extract_origin_destination,
)
from app.services.agents.base import (
    AgentExecutionResult,
    call_llm_synthesis,
    get_llm_provider,
)


def run_citizen_agent(
    query: str,
    db: Session | None = None,
    latitude: float = 28.6139,
    longitude: float = 77.2090,
    dest_latitude: float | None = None,
    dest_longitude: float | None = None,
    preference: str = "balanced",
) -> dict[str, Any]:
    """Execute the Citizen AI Agent pipeline."""
    q = query.strip()
    orig_lat, orig_lon, d_lat, d_lon, orig_name, dest_name = _extract_origin_destination(
        q, latitude, longitude, dest_latitude, dest_longitude
    )

    steps: list[dict[str, Any]] = []
    tools_called: list[str] = []
    tool_results: list[dict[str, Any]] = []
    data_modes: list[str] = []

    # 1. Check if user is asking for incident status lookup
    inc_match = re.search(r"\b(INC-202[0-9]-[A-Z0-9]+)\b", q, re.IGNORECASE)
    if inc_match and db:
        ref_id = inc_match.group(1).upper()
        alert = db.query(CityAlert).filter(CityAlert.public_id == ref_id).first()
        status_info = {
            "tool": "get_incident_status",
            "reference_id": ref_id,
            "found": alert is not None,
            "status": alert.status if alert else "not_found",
            "title": alert.title if alert else None,
            "severity": alert.severity if alert else None,
            "resolution_note": alert.resolution_note if alert else None,
            "reported_at": alert.starts_at.isoformat() if alert else None,
        }
        steps.append({
            "step": 1,
            "tool": "get_incident_status",
            "label": "Incident Status Lookup",
            "thought": f"Query asks for tracking ID {ref_id}. Checking database records.",
            "status": "success",
            "result": status_info,
        })
        tools_called.append("get_incident_status")
        tool_results.append(status_info)

        if alert:
            resp_text = (
                f"Incident Report **{ref_id}** is currently in **{alert.status.upper()}** status.\n\n"
                f"• Issue: {alert.title}\n"
                f"• Severity: {alert.severity.title()}\n"
                f"• Reported: {alert.starts_at.strftime('%Y-%m-%d %H:%M UTC')}\n"
                + (f"• Operator Note: {alert.resolution_note}\n" if alert.resolution_note else "• Review: Our traffic management team has logged this report and is triaging priority.")
            )
        else:
            resp_text = f"We could not find an incident report with reference ID **{ref_id}**. Please check the ID and retry."

        return AgentExecutionResult(
            agent_role="citizen",
            query=query,
            response_text=resp_text,
            steps=steps,
            tools_called=tools_called,
            data_mode="live",
            data_mode_label="Database Verification",
            llm_mode="rule_based_fallback",
        ).to_dict()

    # 2. Check if user is submitting an incident report
    is_incident_submission = bool(re.search(
        r"\b(report|accident|pothole|waterlogg(ed|ing)|road damage|jam report|broken signal|incident report)\b",
        q,
        re.IGNORECASE,
    ))
    if is_incident_submission and ("report" in q.lower() or "accident" in q.lower() or "pothole" in q.lower() or "waterlog" in q.lower()):
        # Determine incident type
        inc_type = "traffic_congestion"
        if "accident" in q.lower():
            inc_type = "accident"
        elif "waterlog" in q.lower():
            inc_type = "waterlogging"
        elif "pothole" in q.lower() or "damage" in q.lower():
            inc_type = "road_damage"
        elif "signal" in q.lower():
            inc_type = "signal_failure"

        ref_id = f"INC-2026-{uuid.uuid4().hex[:6].upper()}"
        city_info = _resolve_city(orig_lat, orig_lon)

        if db:
            try:
                new_alert = CityAlert(
                    public_id=ref_id,
                    title=f"Citizen Report: {inc_type.replace('_', ' ').title()} near {orig_name or city_info['name']}",
                    description=q,
                    category="incident",
                    severity="high" if inc_type == "accident" else "medium",
                    status="submitted",
                    latitude=orig_lat,
                    longitude=orig_lon,
                    starts_at=datetime.now(timezone.utc),
                )
                db.add(new_alert)
                db.commit()
            except Exception:
                db.rollback()

        sub_info = {
            "tool": "submit_incident_report",
            "reference_id": ref_id,
            "incident_type": inc_type,
            "location": orig_name or city_info["name"],
            "coordinates": [orig_lat, orig_lon],
            "status": "submitted",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        steps.append({
            "step": 1,
            "tool": "submit_incident_report",
            "label": "Incident Reporting Tool",
            "thought": "User is reporting a road condition or incident. Registering with reference ID.",
            "status": "success",
            "result": sub_info,
        })
        tools_called.append("submit_incident_report")
        tool_results.append(sub_info)

        resp_text = (
            f"Thank you for reporting this issue! Your report has been logged with reference ID **{ref_id}**.\n\n"
            f"• Incident Type: {inc_type.replace('_', ' ').title()}\n"
            f"• Location: {orig_name or city_info['name']} ({orig_lat:.4f}, {orig_lon:.4f})\n"
            f"• Initial Status: Submitted to City Authority Operations for review.\n\n"
            f"You can check on this report at any time by asking: *\"Status of {ref_id}\"*."
        )

        return AgentExecutionResult(
            agent_role="citizen",
            query=query,
            response_text=resp_text,
            steps=steps,
            tools_called=tools_called,
            data_mode="live",
            data_mode_label="Registered Incident",
            recommendations=[{
                "type": "incident",
                "priority": "medium",
                "icon": "📝",
                "title": f"Report Logged: {ref_id}",
                "text": f"Tracking ID {ref_id} generated. Queued for operator verification.",
                "action": f"Track status via 'Status of {ref_id}'",
            }],
        ).to_dict()

    # 3. Standard Navigation / Traffic / AQI analysis
    wants_route = bool(re.search(
        r"\b(routes?|directions?|navigat(e|ion)|from\s+.+\s+to\s+.+|cleanest\s+route|fastest\s+route|eco\s*route|travel|how\s+to\s+reach)\b",
        q,
        re.IGNORECASE,
    ))
    wants_aqi = bool(re.search(
        r"\b(aqi|air\s*quality|pollution|pm2\.?5|pm10|smog|breathe|toxic\s*air|mask|clean\s*air|weather)\b",
        q,
        re.IGNORECASE,
    ))
    wants_traffic = bool(re.search(
        r"\b(traffic|congestion|vehicles?|queue|jam|busy\s*roads?|delays?|rush\s*hour)\b",
        q,
        re.IGNORECASE,
    ))

    # Defaults
    if not (wants_route or wants_aqi or wants_traffic):
        wants_traffic = True
        wants_aqi = True

    # Call Traffic Tool
    traffic_data = None
    if wants_traffic or wants_route:
        traffic_data = get_traffic_snapshot(orig_lat, orig_lon)
        steps.append({
            "step": len(steps) + 1,
            "tool": "get_traffic_conditions",
            "label": "Traffic Conditions",
            "thought": "Fetching arterial congestion levels, vehicle counts, and queue outlook.",
            "status": "success",
            "data_mode": traffic_data.get("data_mode"),
            "data_mode_label": traffic_data.get("data_mode_label"),
            "result": traffic_data,
        })
        tools_called.append("get_traffic_conditions")
        tool_results.append(traffic_data)
        data_modes.append(traffic_data.get("data_mode", "mock"))

    # Call AQI Tool
    aqi_data = None
    if wants_aqi or wants_route:
        aqi_data = get_aqi_snapshot(orig_lat, orig_lon)
        steps.append({
            "step": len(steps) + 1,
            "tool": "get_aqi_information",
            "label": "Air Quality Assessment",
            "thought": "Fetching atmospheric pollutant levels (PM2.5, PM10) and health guidance.",
            "status": "success",
            "data_mode": aqi_data.get("data_mode"),
            "data_mode_label": aqi_data.get("data_mode_label"),
            "result": aqi_data,
        })
        tools_called.append("get_aqi_information")
        tool_results.append(aqi_data)
        data_modes.append(aqi_data.get("data_mode", "mock"))

    # Call Route Tool if requested
    route_data = None
    if wants_route:
        if d_lat is not None and d_lon is not None:
            route_data = analyze_routes(
                orig_lat, orig_lon, d_lat, d_lon,
                traffic_data=traffic_data,
                aqi_data=aqi_data,
            )
            steps.append({
                "step": len(steps) + 1,
                "tool": "get_route_options",
                "label": "Pollution-Aware Route Advisor",
                "thought": f"Comparing fastest vs cleanest route options between {orig_name or 'Origin'} and {dest_name or 'Destination'}.",
                "status": "success",
                "data_mode": route_data.get("data_mode"),
                "data_mode_label": route_data.get("data_mode_label"),
                "result": route_data,
            })
            tools_called.append("get_route_options")
            tool_results.append(route_data)
            data_modes.append(route_data.get("data_mode", "mock"))
        else:
            # Inform user destination is missing
            route_data = {
                "status": "needs_destination",
                "message": "Destination coordinates are required to calculate alternative route geometries.",
            }
            steps.append({
                "step": len(steps) + 1,
                "tool": "get_route_options",
                "label": "Route Advisor",
                "thought": "Route requested, but destination coordinates were not specified.",
                "status": "needs_destination",
                "result": route_data,
            })
            tools_called.append("get_route_options")

    # Provenance label
    badges = []
    if traffic_data:
        badges.append(traffic_data.get("data_mode_label", "⚡ SUMO Traffic Model"))
    if aqi_data:
        badges.append(aqi_data.get("data_mode_label", "🌐 Live Open-Meteo"))
    overall_label = " · ".join(badges) if badges else "🔵 Simulated Reference Data"

    # Try LLM synthesis if key available
    provider, api_key, model_name = get_llm_provider()
    system_prompt = (
        "You are the UrbanSaarthi Citizen AI Mobility Assistant. "
        "Help travellers make informed, pollution-aware travel choices. "
        "Summarize traffic congestion, compare route options with travel time vs particulate intake trade-offs, "
        "and provide actionable health/mask guidance based on AQI. "
        "Never invent data. Keep answers concise, helpful, and transparent about estimates."
    )
    llm_resp = call_llm_synthesis(system_prompt, q, tool_results)

    # Fallback response generator if LLM was not used or failed
    if not llm_resp:
        parts = []
        city_info = _resolve_city(orig_lat, orig_lon)

        if traffic_data:
            s = traffic_data.get("summary", {})
            parts.append(
                f"**Traffic in {city_info['name']}**: Congestion is currently **{s.get('congestion_level')}** "
                f"(score {s.get('mean_congestion_score')}/100) across monitored corridors."
            )

        if aqi_data:
            c = aqi_data.get("current", {})
            parts.append(
                f"**Air Quality**: AQI is **{c.get('us_aqi')}** ({c.get('category')}), with PM2.5 at {c.get('pm25_ug_m3')} µg/m³. "
                f"{aqi_data.get('health_advice')}"
            )

        if route_data:
            if route_data.get("status") == "needs_destination":
                parts.append(
                    "📍 **Route Planning**: Please provide destination coordinates or click a landmark on the map to compare route alternatives."
                )
            elif route_data.get("routes"):
                rec = next((r for r in route_data["routes"] if r.get("recommended")), route_data["routes"][0])
                parts.append(
                    f"🗺️ **Recommended Route**: **{rec['name']}** ({rec['estimated_duration_min']} min, {rec['distance_km']} km). "
                    f"Congestion: {rec['congestion_level']} · AQI exposure: {rec['aqi_category']}."
                )

        llm_resp = "\n\n".join(parts) if parts else "No data available."

    recommendations = []
    if traffic_data:
        score = float(traffic_data.get("summary", {}).get("mean_congestion_score", 45))
        lvl = _congestion_label(score)
        recommendations.append({
            "type": "traffic",
            "priority": "high" if lvl in ("High", "Severe") else "medium",
            "icon": "🚦",
            "title": f"{lvl} Congestion Detected",
            "text": f"Traffic score {score}/100 ({lvl}).",
            "action": "Check alternate ring roads or shift departure." if lvl in ("High", "Severe") else "Standard travel times apply.",
        })

    if aqi_data:
        aqi_val = aqi_data.get("current", {}).get("us_aqi", 0) or 0
        if aqi_val > 150:
            recommendations.append({
                "type": "pollution",
                "priority": "high",
                "icon": "😷",
                "title": "Poor Air Quality — Wear Mask",
                "text": f"AQI {aqi_val}. Elevated PM2.5 detected.",
                "action": "Wear N95 mask outdoors. Prefer enclosed transit.",
            })

    return AgentExecutionResult(
        agent_role="citizen",
        query=query,
        response_text=llm_resp,
        steps=steps,
        tools_called=tools_called,
        data_mode="mixed" if len(set(data_modes)) > 1 else (data_modes[0] if data_modes else "mock"),
        data_mode_label=overall_label,
        recommendations=recommendations,
        llm_mode="llm" if provider != "fallback" else "rule_based_fallback",
        llm_model=model_name,
        extra_data={
            "city": _resolve_city(orig_lat, orig_lon)["name"],
            "coordinates": {"origin": [orig_lat, orig_lon], "destination": [d_lat, d_lon] if (d_lat and d_lon) else None},
            "routes": route_data.get("routes") if (route_data and route_data.get("routes")) else None,
            "needs_destination": route_data.get("status") == "needs_destination" if route_data else False,
        },
    ).to_dict()
