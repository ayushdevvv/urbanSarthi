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
        "note": "Forecast is generated from the supplied SUMO simulation dataset. It is a model scenario, not a live road sensor feed.",
    }



def get_simulation_scenario(minutes: int = 60, step_minutes: int = 5, scenario: str = "baseline") -> dict:
    """Build a 60-minute, 80-road forecast timeline from 30/60-minute XGBoost models.

    The timeline is model inference + interpolation between trained horizons, not a
    running SUMO process. SUMO-generated training data has 36 runs x 180 minutes x 80
    edges (518,400 records). The API returns every simulated step so the UI can advance
    visibly without pretending to receive live city sensors.
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
    return {
        "mode": "trained_model_scenario", "scenario": scenario, "duration_minutes": minutes,
        "step_minutes": step_minutes, "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "training_data": {"records": int(raw.shape[0]), "simulation_runs": int(raw["run_id"].nunique()), "minutes_per_run": int(raw["time_min"].max()), "road_edges": int(raw["edge_id"].nunique())},
        "models": {"horizon_30": {"mae_vehicles": round(float(metrics_30.get("xgboost", {}).get("mae", 0)), 2), "level_accuracy_percent": round(float(metrics_30.get("xgboost", {}).get("level_accuracy", 0))*100, 1)}, "horizon_60": {"mae_vehicles": round(float(metrics_60.get("mae_vehicles", 0)), 2), "level_accuracy_percent": round(float(metrics_60.get("level_accuracy", 0))*100, 1), "r2": round(float(metrics_60.get("r2", 0)), 3)}},
        "summary": {"queue_start": initial["queue_total"], "queue_end": final["queue_total"], "queue_change_percent": round((final["queue_total"]-initial["queue_total"])/max(initial["queue_total"],1)*100,1), "road_count": len(roads), "heavy_roads_start": initial["heavy_roads"], "heavy_roads_end": final["heavy_roads"]},
        "timeline": timeline,
        "notes": ["Forecast trained on 518,400 rows from 36 SUMO-generated runs across 80 road edges.", "Minutes 0–30 use the trained 30-minute model horizon; minutes 30–60 are guided by the independently trained 60-minute model with interpolation between model horizons.", "This is a model scenario, not a live road-camera feed or a running SUMO/TraCI process."] + (["Demand-surge mode applies a visible +22% queue sensitivity overlay by the selected horizon; this overlay is a what-if assumption, not a separately trained demand model."] if scenario == "demand_surge" else ["Signal-priority mode applies a bounded queue-reduction sensitivity overlay; this is not a measured signal-control outcome."] if scenario == "signal_priority" else []),
    }
