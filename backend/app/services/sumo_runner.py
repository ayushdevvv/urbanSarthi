"""Optional native SUMO runner for the bundled synthetic grid network.

When the SUMO CLI is installed, run a real 3,600-second traffic simulation using
explicit synthetic flows on the supplied grid network. The uploaded video does not
geospatially identify edges, so the report controls scenario context, not map matching.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from collections import deque
from pathlib import Path
from typing import Any
from app.services.emissions import emissions_for_vehicle_km, normalize_vehicle_counts

BASE = Path(__file__).resolve().parents[1] / "ml" / "traffic_simulation"
NETWORK = BASE / "data" / "grid.net.xml"
DURATION_SECONDS = 3600
STEP_SECONDS = 300


def sumo_binary() -> str | None:
    configured = os.getenv("SUMO_BINARY", "").strip()
    if not configured:
        try:
            from app.core.config import settings
            configured = settings.sumo_binary.strip()
        except Exception:
            configured = ""
    if configured and Path(configured).exists():
        return configured
    return shutil.which("sumo") or shutil.which("sumo.exe")


def _routes_from_network(network_root: ET.Element, wanted: int = 8) -> list[list[str]]:
    edges = {edge.get("id"): edge for edge in network_root.findall("edge") if edge.get("function") != "internal" and edge.get("id")}
    # The supplied network names its perimeter connectors left*, right*, top* and bottom*.
    def outer(node: str | None) -> bool:
        value = (node or "").lower()
        return value.startswith(("left", "right", "top", "bottom"))

    entries = [eid for eid, edge in edges.items() if outer(edge.get("from")) and not outer(edge.get("to"))]
    exits = {eid for eid, edge in edges.items() if not outer(edge.get("from")) and outer(edge.get("to"))}
    transitions: dict[str, list[str]] = {eid: [] for eid in edges}
    for conn in network_root.findall("connection"):
        source, target = conn.get("from"), conn.get("to")
        if source in edges and target in edges:
            transitions[source].append(target)

    found: list[list[str]] = []
    used_exits: set[str] = set()
    for entry in sorted(entries):
        start_boundary = edges[entry].get("from")
        queue = deque([(entry, [entry])])
        seen = {entry}
        best = None
        while queue:
            current, route = queue.popleft()
            if current in exits and len(route) >= 4 and current not in used_exits and edges[current].get("to") != start_boundary:
                best = route
                break
            for next_edge in transitions.get(current, []):
                if next_edge in seen:
                    continue
                seen.add(next_edge)
                queue.append((next_edge, route + [next_edge]))
        if best:
            found.append(best)
            used_exits.add(best[-1])
            if len(found) >= wanted:
                break
    # Guarantee route diversity by allowing exit reuse only if necessary.
    if len(found) < 4:
        for entry in sorted(entries):
            queue = deque([(entry, [entry])]); seen = {entry}; best = None
            while queue:
                current, route = queue.popleft()
                if current in exits and len(route) >= 4:
                    best = route; break
                for nxt in transitions.get(current, []):
                    if nxt not in seen:
                        seen.add(nxt); queue.append((nxt, route + [nxt]))
            if best and best not in found:
                found.append(best)
            if len(found) >= wanted: break
    if len(found) < 4:
        raise RuntimeError("The bundled SUMO grid did not yield enough valid through routes")
    return found


def _patch_signal_cycles(source: Path, destination: Path, proposed_phases: list[dict[str, Any]] | None) -> None:
    tree = ET.parse(source)
    root = tree.getroot()
    phases = proposed_phases or []
    if len(phases) >= 4:
        ns_weight = max(1, int(phases[0].get("green_seconds", 19)) + int(phases[2].get("green_seconds", 19)))
        ew_weight = max(1, int(phases[1].get("green_seconds", 18)) + int(phases[3].get("green_seconds", 18)))
        target_cycle = sum(int(item.get("green_seconds", 18)) + int(item.get("yellow_seconds", 3)) + int(item.get("all_red_seconds", 1)) for item in phases)
    elif len(phases) >= 2:
        ns_weight = max(1, int(phases[0].get("green_seconds", 42)))
        ew_weight = max(1, int(phases[1].get("green_seconds", 42)))
        target_cycle = ns_weight + ew_weight + int(phases[0].get("yellow_seconds", 3)) + int(phases[1].get("yellow_seconds", 3)) + int(phases[0].get("all_red_seconds", 1)) + int(phases[1].get("all_red_seconds", 1))
    else:
        ns_weight = ew_weight = 1
        target_cycle = 90
    yellow_ns = max(3, int(phases[0].get("yellow_seconds", 3))) if phases else 3
    yellow_ew = max(3, int(phases[1].get("yellow_seconds", 3))) if len(phases) > 1 else 3
    all_red_ns = max(1, int(phases[0].get("all_red_seconds", 1))) if phases else 1
    all_red_ew = max(1, int(phases[1].get("all_red_seconds", 1))) if len(phases) > 1 else 1
    green_budget = max(16, target_cycle - yellow_ns - yellow_ew - all_red_ns - all_red_ew)
    weight_sum = ns_weight + ew_weight
    green_ns = max(8, round(green_budget * ns_weight / weight_sum))
    green_ew = max(8, green_budget - green_ns)
    # The supplied network exposes two axis-wide stages (north/south, east/west),
    # not four calibrated turning groups. Aggregate the UI draft by axis and explicitly
    # insert all-red clearance between opposing green stages. The cycle still sums to the
    # proposed cycle duration; phase-level turn separation is not claimed.
    for logic in root.findall("tlLogic"):
        current = logic.findall("phase")
        if len(current) < 4:
            continue
        ns_green_state = current[0].get("state", "")
        ns_yellow_state = current[1].get("state", "")
        ew_green_state = current[2].get("state", "")
        ew_yellow_state = current[3].get("state", "")
        state_size = max(len(ns_green_state), len(ns_yellow_state), len(ew_green_state), len(ew_yellow_state))
        all_red_state = "r" * state_size
        for phase in current:
            logic.remove(phase)
        for duration, state in (
            (green_ns, ns_green_state), (yellow_ns, ns_yellow_state), (all_red_ns, all_red_state),
            (green_ew, ew_green_state), (yellow_ew, ew_yellow_state), (all_red_ew, all_red_state),
        ):
            ET.SubElement(logic, "phase", {"duration": str(duration), "state": state})
    tree.write(destination, encoding="utf-8", xml_declaration=True)


def _vehicle_mix_from_report(report: dict[str, Any] | None) -> dict[str, float]:
    counts = normalize_vehicle_counts((report or {}).get("counts") or {})
    total = sum(counts.values())
    if total <= 0:
        return {"car": 1.0}
    return {key: value / total for key, value in counts.items() if value > 0}


def _write_routes(route_path: Path, routes: list[list[str]], demand_multiplier: float, report: dict[str, Any] | None = None) -> dict[str, float]:
    """Create deterministic multi-class demand from measured YOLO class proportions."""
    root = ET.Element("routes")
    type_specs = {
        "car": {"vClass": "passenger", "length": "5.0", "minGap": "2.5", "maxSpeed": "13.9", "accel": "2.6", "decel": "4.5"},
        "motorbike": {"vClass": "motorcycle", "length": "2.2", "minGap": "1.0", "maxSpeed": "16.7", "accel": "3.0", "decel": "4.5"},
        "bus": {"vClass": "bus", "length": "12.0", "minGap": "2.5", "maxSpeed": "11.1", "accel": "1.2", "decel": "4.0"},
        "truck": {"vClass": "truck", "length": "9.0", "minGap": "2.5", "maxSpeed": "11.1", "accel": "1.3", "decel": "4.0"},
        "bicycle": {"vClass": "bicycle", "length": "1.8", "minGap": "0.5", "maxSpeed": "5.5", "accel": "1.0", "decel": "2.0"},
    }
    mix = _vehicle_mix_from_report(report)
    active_mix = {key: mix.get(key, 0.0) for key in type_specs if mix.get(key, 0.0) > 0}
    if not active_mix:
        active_mix = {"car": 1.0}
    for vehicle_type in active_mix:
        ET.SubElement(root, "vType", {"id": vehicle_type, "sigma": "0.0", "speedFactor": "1.0", **type_specs[vehicle_type]})
    total_vehicles_per_hour = max(180, int(900 * max(0.5, min(2.0, demand_multiplier))))
    route_rate = total_vehicles_per_hour / max(len(routes), 1)
    for index, edges in enumerate(routes):
        route_id = f"grid_route_{index}"
        ET.SubElement(root, "route", {"id": route_id, "edges": " ".join(edges)})
        for vehicle_type, share in active_mix.items():
            rate = route_rate * share
            if rate < 0.01:
                continue
            ET.SubElement(root, "flow", {
                "id": f"grid_flow_{index}_{vehicle_type}", "type": vehicle_type, "route": route_id,
                "begin": "0", "end": str(DURATION_SECONDS), "vehsPerHour": f"{rate:.4f}",
                "departLane": "best", "departSpeed": "max",
            })
    ET.ElementTree(root).write(route_path, encoding="utf-8", xml_declaration=True)
    return active_mix


def _write_edge_data(additional_path: Path, data_path: Path) -> None:
    root = ET.Element("additional")
    ET.SubElement(root, "edgeData", {
        "id": "urban_edge_data", "file": str(data_path), "begin": "0",
        "end": str(DURATION_SECONDS), "freq": str(STEP_SECONDS), "excludeEmpty": "false",
    })
    ET.ElementTree(root).write(additional_path, encoding="utf-8", xml_declaration=True)


def _run_one(binary: str, network_source: Path, route_path: Path, work_dir: Path, tag: str) -> dict[str, Any]:
    network_path = work_dir / f"{tag}.net.xml"
    if network_source != network_path:
        shutil.copy2(network_source, network_path)
    additional_path = work_dir / f"{tag}.add.xml"
    edge_data_path = work_dir / f"{tag}.edge-data.xml"
    summary_path = work_dir / f"{tag}.summary.xml"
    tripinfo_path = work_dir / f"{tag}.tripinfo.xml"
    _write_edge_data(additional_path, edge_data_path)
    command = [
        binary, "-n", str(network_path), "-r", str(route_path), "-a", str(additional_path),
        "--begin", "0", "--end", str(DURATION_SECONDS), "--step-length", "1",
        "--summary-output", str(summary_path), "--summary-output.period", str(STEP_SECONDS),
        "--tripinfo-output", str(tripinfo_path), "--tripinfo-output.write-unfinished", "true",
        "--seed", "42", "--time-to-teleport", "-1",
        "--no-step-log", "true", "--duration-log.disable", "true", "--ignore-route-errors", "false",
    ]
    started = time.monotonic()
    completed = subprocess.run(command, capture_output=True, text=True, timeout=240, check=False)
    if completed.returncode != 0 or not summary_path.exists():
        detail = (completed.stderr or completed.stdout or "SUMO exited without producing summary data").strip()
        raise RuntimeError(f"SUMO execution failed: {detail[-900:]}")
    summary_root = ET.parse(summary_path).getroot()
    steps = []
    for item in summary_root.findall("step"):
        try: second = int(float(item.get("time", "0")))
        except ValueError: continue
        steps.append({
            "second": second,
            "halting": int(float(item.get("halting", "0"))),
            "running": int(float(item.get("running", "0"))),
            "loaded": int(float(item.get("loaded", "0"))),
            "inserted": int(float(item.get("inserted", "0"))),
            "ended": int(float(item.get("ended", "0"))),
            "mean_speed_mps": float(item.get("meanSpeed", "0")),
            "waiting": float(item.get("waiting", "0")),
        })
    if not steps:
        raise RuntimeError("SUMO completed but no summary time steps were written")

    edge_by_second: dict[int, list[dict[str, float]]] = {}
    if edge_data_path.exists():
        edge_root = ET.parse(edge_data_path).getroot()
        for interval in edge_root.findall("interval"):
            try: second = int(float(interval.get("end", interval.get("begin", "0"))))
            except ValueError: continue
            values = []
            for edge in interval.findall("edge"):
                try:
                    density = float(edge.get("density", "0"))
                    occupancy = float(edge.get("occupancy", "0"))
                    speed = float(edge.get("speed", "0"))
                    values.append({"density": density, "occupancy": occupancy, "speed": speed})
                except ValueError: pass
            edge_by_second[second] = values

    timeline = []
    for target_second in range(0, DURATION_SECONDS + 1, STEP_SECONDS):
        snap = min(steps, key=lambda item: abs(item["second"] - target_second))
        edge_values = edge_by_second.get(target_second, [])
        if not edge_values and edge_by_second:
            nearest = min(edge_by_second, key=lambda second: abs(second - target_second))
            edge_values = edge_by_second[nearest]
        heavy = sum(1 for item in edge_values if item["density"] >= 20 or item["occupancy"] >= 35)
        moderate = sum(1 for item in edge_values if 7 <= item["density"] < 20 or 15 <= item["occupancy"] < 35)
        timeline.append({
            "minute": round(target_second / 60), "queue_total": snap["halting"],
            "vehicles": snap["running"], "heavy_roads": heavy,
            "moderate_roads": moderate, "free_roads": max(0, len(edge_values) - heavy - moderate),
            "mean_speed_kmph": round(snap["mean_speed_mps"] * 3.6, 2),
            "waiting_vehicle_seconds": round(snap["waiting"], 2),
            "vehicles_inserted": snap["inserted"], "vehicles_completed": snap["ended"],
        })

    trips = []
    if tripinfo_path.exists():
        try:
            for trip in ET.parse(tripinfo_path).getroot().findall("tripinfo"):
                try:
                    trips.append({
                        "type": str(trip.get("type") or "car"),
                        "duration": float(trip.get("duration", "0")),
                        "waiting": float(trip.get("waitingTime", "0")),
                        "time_loss": float(trip.get("timeLoss", "0")),
                        "route_length_km": max(0.0, float(trip.get("routeLength", "0"))) / 1000.0,
                    })
                except ValueError:
                    continue
        except ET.ParseError:
            trips = []
    km_by_class: dict[str, float] = {"car": 0.0, "motorbike": 0.0, "bus": 0.0, "truck": 0.0, "bicycle": 0.0}
    trip_type_aliases = {"car": "car", "motorbike": "motorbike", "bus": "bus", "truck": "truck", "bicycle": "bicycle"}
    for trip in trips:
        class_name = trip_type_aliases.get(trip["type"], "car")
        km_by_class[class_name] += trip["route_length_km"]
    trip_emissions = emissions_for_vehicle_km(km_by_class) if trips else None
    return {
        "timeline": timeline,
        "summary": {
            "queue_start": timeline[0]["queue_total"], "queue_end": timeline[-1]["queue_total"],
            "queue_change_percent": round((timeline[-1]["queue_total"] - timeline[0]["queue_total"]) / max(timeline[0]["queue_total"], 1) * 100, 1),
            "road_count": len(edge_by_second.get(DURATION_SECONDS, [])) or 80,
            "heavy_roads_start": timeline[0]["heavy_roads"], "heavy_roads_end": timeline[-1]["heavy_roads"],
            "vehicles_inserted": timeline[-1]["vehicles_inserted"], "vehicles_completed": timeline[-1]["vehicles_completed"],
            "mean_speed_kmph_final": timeline[-1]["mean_speed_kmph"],
            "avg_trip_duration_seconds": round(sum(t["duration"] for t in trips) / len(trips), 2) if trips else None,
            "avg_trip_waiting_seconds": round(sum(t["waiting"] for t in trips) / len(trips), 2) if trips else None,
            "avg_trip_time_loss_seconds": round(sum(t["time_loss"] for t in trips) / len(trips), 2) if trips else None,
            "mean_trip_distance_km": round(sum(t["route_length_km"] for t in trips) / len(trips), 3) if trips else None,
            "total_vehicle_km": round(sum(km_by_class.values()), 3) if trips else None,
            "trip_emissions": trip_emissions,
            "trip_records_including_unfinished": len(trips),
            "runtime_seconds": round(time.monotonic() - started, 2),
        },
    }


def _percent_delta(base: float | None, proposed: float | None) -> float | None:
    if base is None or proposed is None or abs(base) < 1e-9:
        return None
    return round((proposed - base) / abs(base) * 100.0, 2)


def run_native_sumo_simulation(scenario: str, report: dict[str, Any] | None = None, proposed_phases: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    """Run baseline and proposed 3,600-second SUMO scenarios on identical demand."""
    binary = sumo_binary()
    if not binary or not NETWORK.exists():
        return None
    scenario = scenario if scenario in {"baseline", "demand_surge", "signal_priority"} else "baseline"
    mean_count = float((report or {}).get("mean_vehicles_per_sampled_frame") or 5)
    demand_multiplier = max(0.5, min(2.0, mean_count / 5.0))
    if scenario == "demand_surge":
        demand_multiplier = min(2.0, demand_multiplier * 1.25)
    network_tree = ET.parse(NETWORK)
    routes = _routes_from_network(network_tree.getroot(), wanted=8)

    with tempfile.TemporaryDirectory(prefix="urbansaarthi-sumo-") as temp:
        root = Path(temp)
        route_path = root / "traffic.rou.xml"
        vehicle_mix = _write_routes(route_path, routes, demand_multiplier, report=report)
        baseline = _run_one(binary, NETWORK, route_path, root, "baseline")
        intervention_net = root / "intervention.net.xml"
        _patch_signal_cycles(NETWORK, intervention_net, proposed_phases)
        intervention = _run_one(binary, intervention_net, route_path, root, "intervention")
        base_summary = baseline["summary"]
        proposed_summary = intervention["summary"]
        base_queue = base_summary["queue_end"]
        proposed_queue = proposed_summary["queue_end"]
        emissions_base = base_summary.get("trip_emissions")
        emissions_proposed = proposed_summary.get("trip_emissions")
        pollutant_changes = {}
        if emissions_base and emissions_proposed:
            for key in ("co2_g", "nox_g", "pm_g", "co_g"):
                pollutant_changes[key] = _percent_delta(emissions_base["totals"].get(key), emissions_proposed["totals"].get(key))
        traffic_comparison = {
            "average_wait_seconds": {"baseline": base_summary.get("avg_trip_waiting_seconds"), "proposed": proposed_summary.get("avg_trip_waiting_seconds"), "change_percent": _percent_delta(base_summary.get("avg_trip_waiting_seconds"), proposed_summary.get("avg_trip_waiting_seconds"))},
            "average_trip_duration_seconds": {"baseline": base_summary.get("avg_trip_duration_seconds"), "proposed": proposed_summary.get("avg_trip_duration_seconds"), "change_percent": _percent_delta(base_summary.get("avg_trip_duration_seconds"), proposed_summary.get("avg_trip_duration_seconds"))},
            "queue_at_60m": {"baseline": base_queue, "proposed": proposed_queue, "change_percent": _percent_delta(base_queue, proposed_queue)},
            "vehicles_completed": {"baseline": base_summary.get("vehicles_completed"), "proposed": proposed_summary.get("vehicles_completed"), "change_percent": _percent_delta(base_summary.get("vehicles_completed"), proposed_summary.get("vehicles_completed"))},
            "mean_speed_kmph_final": {"baseline": base_summary.get("mean_speed_kmph_final"), "proposed": proposed_summary.get("mean_speed_kmph_final")},
        }
        emissions_comparison = {
            "available": bool(emissions_base and emissions_proposed),
            "method": "SUMO tripinfo routeLength × versioned vehicle-class emission factors",
            "baseline": emissions_base,
            "proposed": emissions_proposed,
            "change_percent": pollutant_changes,
            "interpretation": "Negative percentages indicate lower estimated emissions in the proposed run." if pollutant_changes else "SUMO trip-distance records were not available; emissions comparison is unavailable.",
        }
        summary = {
            **proposed_summary,
            "baseline_queue_end": base_queue,
            "proposed_queue_end": proposed_queue,
            "queue_change_vs_baseline_percent": _percent_delta(base_queue, proposed_queue),
            "baseline_mean_speed_kmph_final": base_summary.get("mean_speed_kmph_final"),
            "proposed_mean_speed_kmph_final": proposed_summary.get("mean_speed_kmph_final"),
            "demand_multiplier": round(demand_multiplier, 2),
        }
        return {
            "mode": "native_sumo_simulation", "engine": "SUMO CLI / 3,600-second baseline + intervention",
            "scenario": scenario, "duration_minutes": 60, "step_minutes": 5,
            "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            "summary": summary, "timeline": intervention["timeline"], "baseline_timeline": baseline["timeline"],
            "traffic_comparison": traffic_comparison, "emissions_comparison": emissions_comparison,
            "training_data": {"road_edges": 80, "network_file": "grid.net.xml", "demand_source": "same deterministic multi-class synthetic flows for both runs; proportions derived from YOLO class counts", "routes": len(routes), "vehicle_mix": vehicle_mix},
            "models": {"engine": "native SUMO execution", "simulated_seconds": DURATION_SECONDS, "seed": 42},
            "notes": [
                "This is a real 3,600-second SUMO execution on the bundled synthetic grid network with generated vehicle routes.",
                "Baseline and candidate runs use identical generated demand and a fixed seed. The bundled network is synthetic and is not a mapped Kanpur junction.",
                "Video detections inform vehicle-class proportions and demand scaling; footage is not geospatially map-matched to the network.",
                "Emissions use trip routeLength and indicative vehicle-class factors. SUMO does not model speed/load-specific engine emissions in this prototype; fuel-use assumptions are not local fleet measurements.",
                "Ambient AQI is not inferred from tailpipe emissions. The report's AQI observations, if any, remain separate.",
                "This is a simulated experiment, not a field deployment or authorization to control physical signals.",
            ],
        }
