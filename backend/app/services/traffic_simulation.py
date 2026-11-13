"""Prediction service for the supplied SUMO generated traffic dataset and XGBoost model."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
import importlib.util

BASE = Path(__file__).resolve().parents[1] / "ml" / "traffic_simulation"

@lru_cache(maxsize=1)
def _load():
    import pandas as pd
    from xgboost import XGBRegressor
    feature_path = BASE / "features.py"
    spec = importlib.util.spec_from_file_location("urbansaarthi_sumo_features", feature_path)
    features = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(features)
    model = XGBRegressor()
    model.load_model(str(BASE / "models" / "queue_model.json"))
    edge_mean = json.loads((BASE / "models" / "edge_mean.json").read_text())
    metrics = json.loads((BASE / "models" / "metrics.json").read_text())
    model_60 = XGBRegressor()
    model_60.load_model(str(BASE / "models" / "queue_model_60min.json"))
    metrics_60 = json.loads((BASE / "models" / "metrics_60min.json").read_text())
    raw = pd.read_csv(BASE / "data" / "raw.csv")
    return pd, features, model, edge_mean, metrics, raw, model_60, metrics_60

@lru_cache(maxsize=1)
def get_simulation_snapshot() -> dict:
    """Return a deterministic forecast computed from the latest supplied SUMO run."""
    pd, features, model, edge_mean, metrics, raw, _model_60, _metrics_60 = _load()
    run_id = int(raw["run_id"].max())
    history = raw[raw["run_id"] == run_id].copy()
    latest_minute = int(history["time_min"].max())
    history["run_id"] = 0
    if history["time_min"].nunique() < features.MIN_HISTORY:
        raise ValueError("The supplied simulation history is too short for the traffic model")
    built = features.build_features(history, with_target=False, edge_mean=edge_mean)
    latest = built[built["time_min"] == latest_minute].copy()
    predicted = model.predict(latest[features.FEATURE_COLUMNS]).clip(0)
    roads = pd.DataFrame({
        "road": latest["edge_id"].astype(str).values,
        "queue_now": latest["halting"].astype(float).values,
        "predicted_queue_30min": predicted.astype(float),
    })
    roads["level_now"] = [features.LEVEL_NAMES[i] for i in features.queue_to_level(roads["queue_now"].values)]
    roads["level_30min"] = [features.LEVEL_NAMES[i] for i in features.queue_to_level(roads["predicted_queue_30min"].values)]
    roads = roads.sort_values("predicted_queue_30min", ascending=False)
    now_queue = float(roads["queue_now"].sum())
    future_queue = float(roads["predicted_queue_30min"].sum())
    latest_rows = history[history["time_min"] == latest_minute]
    metric = metrics.get("xgboost", {})
    return {
        "mode": "sumo_model", "source": "Supplied SUMO generated dataset and trained XGBoost model",
        "run_id": run_id, "simulation_minute": latest_minute,
        "road_count": int(roads.shape[0]),
        "vehicles_now": int(latest_rows["vehicles"].sum()),
        "queue_now": round(now_queue), "predicted_queue_30min": round(future_queue),
        "queue_change_percent": round((future_queue - now_queue) / max(now_queue, 1) * 100, 1),
        "heavy_roads_now": int((roads["level_now"] == "Heavy").sum()),
        "heavy_roads_30min": int((roads["level_30min"] == "Heavy").sum()),
        "model_metrics": {
            "level_accuracy_percent": round(float(metric.get("level_accuracy", 0)) * 100, 1),
            "mae_vehicles": round(float(metric.get("mae", 0)), 2),
            "r2": round(float(metric.get("r2", 0)), 3),
        },
        "roads": [{
            "road": str(row.road), "queue_now": round(float(row.queue_now)),
            "predicted_queue_30min": round(float(row.predicted_queue_30min), 1),
            "level_now": str(row.level_now), "level_30min": str(row.level_30min),
        } for row in roads.head(12).itertuples(index=False)],
        "note": "This is a historical reference-network forecast, not a live road sensor feed.",
    }



def get_simulation_scenario(minutes: int = 60, step_minutes: int = 5, scenario: str = "baseline") -> dict:
    """Build a 60-minute, 80-road reference-network forecast timeline.

    The timeline is a learned forecast with interpolation between trained horizons,
    not live city telemetry or a microscopic vehicle simulation. The API returns
    five-minute steps so the UI can advance visibly without misrepresenting data.
    """
    pd, features, model_30, edge_mean, metrics_30, raw, model_60, metrics_60 = _load()
    minutes = max(15, min(60, int(minutes)))
    step_minutes = max(1, min(15, int(step_minutes)))
    scenario = scenario if scenario in {"baseline", "demand_surge", "signal_priority"} else "baseline"
    run_id = int(raw["run_id"].max())
    history = raw[raw["run_id"] == run_id].copy()
    latest_minute = int(history["time_min"].max())
    history["run_id"] = 0
    built = features.build_features(history, with_target=False, edge_mean=edge_mean)
    latest = built[built["time_min"] == latest_minute].copy()
    if latest.empty:
        raise ValueError("No usable rows were found at the end of the supplied traffic run")
    q30 = model_30.predict(latest[features.FEATURE_COLUMNS]).clip(0)
    q60 = model_60.predict(latest[features.FEATURE_COLUMNS]).clip(0)
    current = latest["halting"].astype(float).to_numpy()
    roads = latest["edge_id"].astype(str).to_numpy()
    vehicles = latest["vehicles"].astype(float).to_numpy()

    def factor(elapsed: int) -> float:
        progress = elapsed / max(minutes, 1)
        # Sensitivity scenarios are explicit what-if modifiers over trained forecasts.
        if scenario == "demand_surge": return 1.0 + 0.22 * progress
        if scenario == "signal_priority": return max(0.76, 1.0 - 0.14 * progress)
        return 1.0

    def interpolate(elapsed: int):
        if elapsed <= 30:
            ratio = elapsed / 30.0
            values = current + (q30 - current) * ratio
        else:
            ratio = min(1.0, (elapsed - 30.0) / 30.0)
            values = q30 + (q60 - q30) * ratio
        values = (values * factor(elapsed)).clip(0)
        return values

    def level(value: float) -> str:
        return "Free" if value < 3 else "Moderate" if value < 10 else "Heavy"

    snapshot_minutes = sorted(set(list(range(0, minutes + 1, step_minutes)) + [minutes]))
    timeline = []
    for elapsed in snapshot_minutes:
        queues = interpolate(elapsed)
        timeline.append({
            "minute": elapsed,
            "queue_total": round(float(queues.sum())),
            "vehicles": round(float(vehicles.sum())),
            "heavy_roads": int((queues >= 10).sum()),
            "moderate_roads": int(((queues >= 3) & (queues < 10)).sum()),
            "free_roads": int((queues < 3).sum()),
            "roads": [{"road": str(roads[i]), "queue": round(float(queues[i]), 1), "level": level(float(queues[i])), "vehicles": int(round(vehicles[i]))} for i in range(len(roads))],
        })
    initial, final = timeline[0], timeline[-1]
    try:
        from app.services.sumo_runner import NETWORK, _network_geometry
        geometry = _network_geometry(NETWORK)
    except Exception:
        geometry = None
    return {
        "mode": "trained_model_scenario", "scenario": scenario, "duration_minutes": minutes,
        "network_geometry": geometry,
        "step_minutes": step_minutes, "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "training_data": {"records": int(raw.shape[0]), "simulation_runs": int(raw["run_id"].nunique()), "minutes_per_run": int(raw["time_min"].max()), "road_edges": int(raw["edge_id"].nunique())},
        "models": {"horizon_30": {"mae_vehicles": round(float(metrics_30.get("xgboost", {}).get("mae", 0)), 2), "level_accuracy_percent": round(float(metrics_30.get("xgboost", {}).get("level_accuracy", 0))*100, 1)}, "horizon_60": {"mae_vehicles": round(float(metrics_60.get("mae_vehicles", 0)), 2), "level_accuracy_percent": round(float(metrics_60.get("level_accuracy", 0))*100, 1), "r2": round(float(metrics_60.get("r2", 0)), 3)}},
        "summary": {"queue_start": initial["queue_total"], "queue_end": final["queue_total"], "queue_change_percent": round((final["queue_total"]-initial["queue_total"])/max(initial["queue_total"],1)*100,1), "road_count": len(roads), "heavy_roads_start": initial["heavy_roads"], "heavy_roads_end": final["heavy_roads"]},
        "timeline": timeline,
        "notes": ["Forecast trained on 518,400 historical records across 80 reference road segments.", "Minutes 0–30 use the short-horizon forecast; minutes 30–60 use the longer-horizon forecast with interpolation between model horizons.", "This is a model scenario, not a live road-camera feed or a microscopic vehicle simulation."] + (["Demand-surge mode applies a visible +22% queue sensitivity overlay by the selected horizon; this overlay is a what-if assumption, not a separately trained demand model."] if scenario == "demand_surge" else ["Signal-priority mode applies a bounded queue-reduction sensitivity overlay; this is not a measured signal-control outcome."] if scenario == "signal_priority" else []),
    }


def get_xgboost_signal_scenario(
    *, north_south_green_seconds: int, east_west_green_seconds: int,
    yellow_seconds: int, all_red_seconds: int, demand_multiplier: float = 1.0,
    name: str = "Signal timing what-if experiment",
) -> dict:
    """Return a 60-minute forecast with a transparent signal sensitivity overlay.

    The underlying forecast does not learn proposed signal timings. The axis split,
    clearance and demand effects are bounded what-if assumptions layered over the
    forecast, not causal model predictions. No individual vehicle trajectories are made.
    """
    from copy import deepcopy
    from app.services.sumo_runner import NETWORK, _network_geometry

    base = get_simulation_scenario(minutes=60, step_minutes=5, scenario="baseline")
    geometry = _network_geometry(NETWORK)
    axis_by_edge = {}
    for edge in geometry.get("roads", []):
        points = edge.get("points") or []
        if len(points) < 2:
            axis_by_edge[edge.get("id")] = "NS"
            continue
        dx = sum(abs(float(points[i]["x"]) - float(points[i-1]["x"])) for i in range(1, len(points)))
        dy = sum(abs(float(points[i]["y"]) - float(points[i-1]["y"])) for i in range(1, len(points)))
        axis_by_edge[edge.get("id")] = "EW" if dx >= dy else "NS"

    ns_green = max(8, int(north_south_green_seconds))
    ew_green = max(8, int(east_west_green_seconds))
    yellow = max(3, int(yellow_seconds))
    all_red = max(1, int(all_red_seconds))
    demand = max(0.5, min(2.0, float(demand_multiplier)))
    ns_share = ns_green / max(1, ns_green + ew_green)
    ew_share = ew_green / max(1, ns_green + ew_green)
    # A square-root response keeps the sensitivity bounded and avoids claiming a direct
    # microscopic traffic-flow calculation from a queue-only ML model.
    ns_capacity = max(0.72, min(1.38, (0.5 / ns_share) ** 0.5))
    ew_capacity = max(0.72, min(1.38, (0.5 / ew_share) ** 0.5))
    clearance_seconds = 2 * (yellow + all_red)
    clearance_factor = max(0.90, min(1.22, 1 + (clearance_seconds - 8) / 100))

    proposed = []
    for base_frame in base["timeline"]:
        frame = deepcopy(base_frame)
        progress = max(0.0, min(1.0, float(frame.get("minute", 0)) / 60.0))
        updated_roads = []
        for road in frame.get("roads", []):
            axis = axis_by_edge.get(str(road.get("road")), "NS")
            axis_factor = ns_capacity if axis == "NS" else ew_capacity
            multiplier = ((demand ** progress) * (axis_factor ** progress) * (clearance_factor ** progress))
            queue = max(0.0, float(road.get("queue", 0)) * multiplier)
            level = "Free" if queue < 3 else "Moderate" if queue < 10 else "Heavy"
            updated_roads.append({**road, "queue": round(queue, 1), "level": level})
        frame["roads"] = updated_roads
        frame["queue_total"] = round(sum(float(road["queue"]) for road in updated_roads))
        frame["heavy_roads"] = sum(1 for road in updated_roads if road["level"] == "Heavy")
        frame["moderate_roads"] = sum(1 for road in updated_roads if road["level"] == "Moderate")
        frame["free_roads"] = sum(1 for road in updated_roads if road["level"] == "Free")
        proposed.append(frame)

    baseline_timeline = base["timeline"]
    initial, final = proposed[0], proposed[-1]
    baseline_final = baseline_timeline[-1]
    change = round((final["queue_total"] - baseline_final["queue_total"]) / max(baseline_final["queue_total"], 1) * 100, 1)
    return {
        "mode": "xgboost_model_scenario",
        "engine": "60-minute network forecast with signal sensitivity",
        "scenario": "signal_timing_sensitivity", "duration_minutes": 60, "step_minutes": 5,
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "experiment": {"name": name, "signal_timings": {
            "north_south_green_seconds": ns_green, "east_west_green_seconds": ew_green,
            "yellow_seconds": yellow, "all_red_seconds": all_red,
            "cycle_seconds": ns_green + ew_green + 2 * (yellow + all_red),
        }, "demand_multiplier": demand},
        "training_data": base["training_data"], "models": base["models"],
        "network_geometry": geometry,
        "summary": {
            "queue_start": initial["queue_total"], "queue_end": final["queue_total"],
            "queue_change_percent": round((final["queue_total"] - initial["queue_total"]) / max(initial["queue_total"], 1) * 100, 1),
            "road_count": len(final["roads"]), "heavy_roads_start": initial["heavy_roads"],
            "heavy_roads_end": final["heavy_roads"],
            "baseline_queue_end": baseline_final["queue_total"],
        },
        "traffic_comparison": {"queue_at_60m": {
            "baseline": baseline_final["queue_total"], "proposed": final["queue_total"], "change_percent": change,
        }},
        "baseline_timeline": baseline_timeline, "timeline": proposed,
        "notes": [
            "This result uses the 30/60-minute network forecast. It is not a detailed vehicle-by-vehicle simulation.",
            "Signal green split, clearance time and demand are represented by a bounded sensitivity overlay; these effects are assumptions, not causal predictions learned by the model.",
            "The playback colours actual forecasted edge queue estimates on the bundled 80-edge reference network. It does not invent per-vehicle positions or trajectories.",
            "Detailed individual vehicle movement is available only when the detailed simulation capability is enabled.",
        ],
    }
