"""Optional, real SUMO/TraCI runner for the bundled 4x4 demo network.

This is deliberately separate from the trained SUMO-data forecasting model: it runs
SUMO from the supplied network only when the SUMO binaries and TraCI tools are installed.
It never sends commands to physical traffic signals.
"""
from __future__ import annotations

import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parents[2]
TRAFFIC_ARTIFACTS = BACKEND_DIR / "models" / "traffic_forecast"
NETWORK_FILE = TRAFFIC_ARTIFACTS / "grid.net.xml"


def _sumo_home() -> str | None:
    configured = settings.sumo_home.strip() or os.getenv("SUMO_HOME")
    if configured and Path(configured).expanduser().is_dir():
        return str(Path(configured).expanduser())
    # `pip install eclipse-sumo` exposes its bundle's root through this module.
    # Discover it automatically so users do not always need to manually set SUMO_HOME.
    try:
        import sumo  # type: ignore
        bundle_home = getattr(sumo, "SUMO_HOME", None)
        if bundle_home and Path(str(bundle_home)).is_dir():
            return str(bundle_home)
    except ImportError:
        pass
    return None


def _find_binary(name: str) -> str | None:
    setting_name = "sumo_binary" if name == "sumo" else "duarouter_binary"
    direct = getattr(settings, setting_name).strip() or os.getenv(f"{name.upper()}_BINARY")
    if direct:
        path = Path(direct).expanduser()
        if path.is_file():
            return str(path)
    sumo_home = _sumo_home()
    if sumo_home:
        for path in (Path(sumo_home) / "bin" / name, Path(sumo_home) / "bin" / f"{name}.exe"):
            if path.is_file():
                return str(path)
    return shutil.which(name) or shutil.which(f"{name}.exe")


def _load_traci() -> tuple[Any | None, str | None]:
    sumo_home = _sumo_home()
    if sumo_home:
        tools_dir = Path(sumo_home) / "tools"
        if tools_dir.is_dir() and str(tools_dir) not in sys.path:
            sys.path.insert(0, str(tools_dir))
    try:
        import traci  # type: ignore
        return traci, None
    except ImportError as exc:
        # Support Python packages that expose TraCI separately from the SUMO tools folder.
        return None, f"TraCI Python module is not available: {exc}"


def runtime_status() -> dict[str, Any]:
    sumo = _find_binary("sumo")
    duarouter = _find_binary("duarouter")
    traci, traci_error = _load_traci()
    ready = bool(sumo and duarouter and traci and NETWORK_FILE.is_file())
    missing = []
    if not sumo:
        missing.append("sumo binary")
    if not duarouter:
        missing.append("duarouter binary")
    if not traci:
        missing.append("TraCI Python tools")
    if not NETWORK_FILE.is_file():
        missing.append("bundled grid.net.xml network")
    return {
        "available": ready,
        "sumo_binary": sumo,
        "duarouter_binary": duarouter,
        "traci_available": traci is not None,
        "network_available": NETWORK_FILE.is_file(),
        "missing": missing,
        "note": "Real SUMO simulation can run with SUMO, duarouter and TraCI installed." if ready else "SUMO executable runtime is unavailable; signal-plan requests use a clearly labelled analytical fallback. The separate bundled XGBoost model still forecasts from historical SUMO-generated data.",
    }


def _axis_green_weights(phases: list[dict]) -> tuple[float, float]:
    north_south = 0.0
    east_west = 0.0
    for phase in phases:
        movement = f"{phase.get('movement', '')} {phase.get('name', '')}".lower().replace("–", "-")
        seconds = max(0.0, float(phase.get("green_seconds", 0) or 0))
        if "north" in movement or "south" in movement or "n/s" in movement:
            north_south += seconds
        elif "east" in movement or "west" in movement or "e/w" in movement:
            east_west += seconds
    if north_south <= 0 or east_west <= 0:
        return 0.5, 0.5
    total = north_south + east_west
    return north_south / total, east_west / total


def _write_adaptive_network(source: Path, target: Path, phases: list[dict]) -> dict[str, int]:
    tree = ET.parse(source)
    root = tree.getroot()
    ns_share, ew_share = _axis_green_weights(phases)
    modified = 0
    retained = 0
    for logic in root.findall("tlLogic"):
        greens = [phase for phase in logic.findall("phase") if ("G" in (phase.get("state") or "") or "g" in (phase.get("state") or "")) and not any(letter in (phase.get("state") or "") for letter in "yY")]
        if len(greens) < 2:
            # Boundary signals in this network have a green + yellow + red program.
            retained += 1
            continue
        original = [max(1, int(float(phase.get("duration", "1")))) for phase in greens]
        budget = sum(original)
        # The included grid uses two axis phases. Preserve the total green budget while
        # applying the operator proposal's N/S vs E/W split; avoid unsafe tiny greens.
        ns_seconds = max(8, min(budget - 8, round(budget * ns_share)))
        ew_seconds = budget - ns_seconds
        green_values = [ns_seconds, ew_seconds]
        if len(greens) > 2:
            shares = [ns_share if index % 2 == 0 else ew_share for index in range(len(greens))]
            total_shares = sum(shares)
            green_values = [max(4, round(budget * share / total_shares)) for share in shares]
            # Correct rounding while conserving the total, without dropping below 4 s.
            diff = budget - sum(green_values)
            green_values[0] += diff
        for phase, seconds in zip(greens, green_values):
            phase.set("duration", str(int(seconds)))
        modified += 1
    tree.write(target, encoding="utf-8", xml_declaration=True)
    return {"traffic_light_programs_modified": modified, "programs_retained": retained}


def _write_trips(net_file: Path, trips_file: Path, *, seed: int = 41, num_trips: int = 420, last_depart: int = 480) -> int:
    root = ET.parse(net_file).getroot()
    edges = [edge for edge in root.findall("edge") if edge.get("function") != "internal" and edge.get("id")]
    ids = [edge.get("id") for edge in edges]
    if len(ids) < 4:
        raise RuntimeError("Bundled SUMO network has too few routable edges")
    rng = random.Random(seed)
    trips_root = ET.Element("routes")
    for index in range(num_trips):
        origin, destination = rng.sample(ids, 2)
        depart = round(rng.random() * last_depart, 1)
        ET.SubElement(trips_root, "trip", {"id": f"veh{index:04d}", "depart": str(depart), "from": str(origin), "to": str(destination), "departLane": "best", "departSpeed": "max"})
    ET.ElementTree(trips_root).write(trips_file, encoding="utf-8", xml_declaration=True)
    return num_trips


def _resolve_routes(duarouter: str, net_file: Path, trips_file: Path, routes_file: Path) -> int:
    command = [duarouter, "--net-file", str(net_file), "--route-files", str(trips_file), "--output-file", str(routes_file), "--ignore-errors", "true", "--no-warnings", "true"]
    result = subprocess.run(command, capture_output=True, text=True, timeout=90, check=False)
    if result.returncode != 0 or not routes_file.is_file():
        detail = (result.stderr or result.stdout or "duarouter did not produce routes")[-1200:]
        raise RuntimeError(f"SUMO route generation failed: {detail}")
    route_tree = ET.parse(routes_file).getroot()
    count = len(route_tree.findall("vehicle")) + len(route_tree.findall("flow"))
    if count < 20:
        raise RuntimeError(f"SUMO could route only {count} trips; at least 20 are required for a useful demo")
    return count


def _run_one(sumo: str, traci: Any, net_file: Path, routes_file: Path, run_label: str, end_seconds: int = 900) -> dict[str, Any]:
    command = [sumo, "--net-file", str(net_file), "--route-files", str(routes_file), "--begin", "0", "--end", str(end_seconds), "--seed", "41", "--time-to-teleport", "-1", "--no-step-log", "true", "--no-warnings", "true", "--duration-log.disable", "true"]
    traci.start(command, label=run_label)
    conn = traci.getConnection(run_label)
    halting_samples: list[int] = []
    vehicle_samples: list[int] = []
    waiting_samples: list[float] = []
    max_steps = end_seconds + 5
    try:
        for _ in range(max_steps):
            if conn.simulation.getMinExpectedNumber() <= 0 and conn.simulation.getTime() > 2:
                break
            conn.simulationStep()
            if int(conn.simulation.getTime()) % 5 == 0:
                edge_ids = [edge_id for edge_id in conn.edge.getIDList() if not edge_id.startswith(":")]
                halting_samples.append(sum(conn.edge.getLastStepHaltingNumber(edge_id) for edge_id in edge_ids))
                vehicle_ids = list(conn.vehicle.getIDList())
                vehicle_samples.append(len(vehicle_ids))
                if vehicle_ids:
                    waits = [conn.vehicle.getWaitingTime(vehicle_id) for vehicle_id in vehicle_ids]
                    waiting_samples.append(sum(waits) / len(waits))
        arrived = int(conn.simulation.getArrivedNumber())
        departed = int(conn.simulation.getDepartedNumber())
        time_end = float(conn.simulation.getTime())
        return {
            "simulation_seconds": round(time_end, 1),
            "arrived_vehicles": arrived,
            "departed_vehicles": departed,
            "unfinished_vehicles": max(0, departed - arrived),
            "mean_halting_vehicles": round(sum(halting_samples) / len(halting_samples), 2) if halting_samples else 0.0,
            "peak_halting_vehicles": max(halting_samples, default=0),
            "mean_active_vehicles": round(sum(vehicle_samples) / len(vehicle_samples), 2) if vehicle_samples else 0.0,
            "mean_wait_per_active_vehicle_seconds": round(sum(waiting_samples) / len(waiting_samples), 2) if waiting_samples else 0.0,
            "samples": len(halting_samples),
        }
    finally:
        try:
            conn.close()
        except Exception:
            pass


def run_signal_plan_comparison(phases: list[dict], *, seed: int = 41, num_trips: int = 420, last_depart: int = 480, end_seconds: int = 900) -> dict[str, Any]:
    """Execute baseline and proposed timings on the same generated demand.

    Raises RuntimeError if the external SUMO runtime is missing or fails. Caller should
    transparently choose the analytical fallback in that case.
    """
    status = runtime_status()
    if not status["available"]:
        raise RuntimeError("SUMO runtime unavailable: " + ", ".join(status["missing"]))
    sumo = str(status["sumo_binary"])
    duarouter = str(status["duarouter_binary"])
    traci, traci_error = _load_traci()
    if not traci:
        raise RuntimeError(traci_error or "TraCI unavailable")

    with tempfile.TemporaryDirectory(prefix="urbansaarthi-sumo-") as temp_dir:
        work = Path(temp_dir)
        baseline_net = work / "baseline.net.xml"
        adaptive_net = work / "adaptive.net.xml"
        trips_file = work / "demand.trips.xml"
        routes_file = work / "demand.rou.xml"
        import shutil as _shutil
        _shutil.copy2(NETWORK_FILE, baseline_net)
        change_summary = _write_adaptive_network(NETWORK_FILE, adaptive_net, phases)
        generated = _write_trips(NETWORK_FILE, trips_file, seed=seed, num_trips=num_trips, last_depart=last_depart)
        routed = _resolve_routes(duarouter, baseline_net, trips_file, routes_file)
        # Reset default labels and close old sessions; each run receives identical demand.
        baseline = _run_one(sumo, traci, baseline_net, routes_file, f"urban-base-{time.time_ns()}", end_seconds)
        proposed = _run_one(sumo, traci, adaptive_net, routes_file, f"urban-adaptive-{time.time_ns()}", end_seconds)
        def change(before: float, after: float) -> float | None:
            return round((after - before) / before * 100, 2) if before else None
        return {
            "engine": "sumo-traci-v1",
            "sumo_run": True,
            "network": NETWORK_FILE.name,
            "demand_seed": seed,
            "generated_trip_count": generated,
            "routed_trip_count": routed,
            "adaptive_network_changes": change_summary,
            "baseline": baseline,
            "proposed": proposed,
            "comparison": {
                "mean_halting_vehicles_change_percent": change(baseline["mean_halting_vehicles"], proposed["mean_halting_vehicles"]),
                "mean_wait_per_active_vehicle_change_percent": change(baseline["mean_wait_per_active_vehicle_seconds"], proposed["mean_wait_per_active_vehicle_seconds"]),
                "arrived_vehicles_change": proposed["arrived_vehicles"] - baseline["arrived_vehicles"],
            },
            "caveats": [
                "This is a generated-demand simulation on the bundled demo road network, not a calibration to a real city junction.",
                "Both plans used the same routed trips and random seed; results may still vary by SUMO version.",
                "No command was sent to physical traffic signals.",
            ],
        }
