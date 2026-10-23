"""Prediction service for the supplied SUMO generated traffic dataset and XGBoost model."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
import importlib.util

APP_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = APP_DIR.parent
FEATURES_DIR = APP_DIR / "ml" / "traffic_forecast"
ARTIFACT_DIR = BACKEND_DIR / "models" / "traffic_forecast"

@lru_cache(maxsize=1)
def _load():
    import pandas as pd
    from xgboost import XGBRegressor
    feature_path = FEATURES_DIR / "features.py"
    spec = importlib.util.spec_from_file_location("urbansaarthi_sumo_features", feature_path)
    features = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(features)
    model = XGBRegressor()
    model.load_model(str(ARTIFACT_DIR / "queue_model.json"))
    edge_mean = json.loads((ARTIFACT_DIR / "edge_mean.json").read_text())
    metrics = json.loads((ARTIFACT_DIR / "metrics.json").read_text())
    raw = pd.read_csv(ARTIFACT_DIR / "raw.csv")
    return pd, features, model, edge_mean, metrics, raw

@lru_cache(maxsize=1)
def get_simulation_snapshot() -> dict:
    """Return a deterministic forecast computed from the latest supplied SUMO run."""
    pd, features, model, edge_mean, metrics, raw = _load()
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
