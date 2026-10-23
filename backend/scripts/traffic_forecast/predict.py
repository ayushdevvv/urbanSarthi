"""
STEP 4: Use the saved model to predict.

What this file does:
1. Loads model artifacts from backend/models/traffic_forecast/.
2. Defines predict_network(history): give it the last 21+ minutes of
   data for ALL roads, it returns the predicted queue 30 minutes
   later for every road, plus a level (Free / Moderate / Heavy).
   You can import this function in your FastAPI backend.
3. Runs a demo on a test simulation: predicts at a few moments, then
   shows what really happened 30 minutes later.

Run:  python backend/scripts/traffic_forecast/predict.py
"""

import json
import sys
from pathlib import Path

import pandas as pd
from xgboost import XGBRegressor

BACKEND_DIR = Path(__file__).resolve().parents[2]
FEATURES_DIR = BACKEND_DIR / "app" / "ml" / "traffic_forecast"
ARTIFACT_DIR = BACKEND_DIR / "models" / "traffic_forecast"
if str(FEATURES_DIR) not in sys.path:
    sys.path.insert(0, str(FEATURES_DIR))
from features import (
    build_features, queue_to_level, FEATURE_COLUMNS, LEVEL_NAMES, MIN_HISTORY,
)

MODEL_PATH = str(ARTIFACT_DIR / "queue_model.json")
EDGE_MEAN_JSON = str(ARTIFACT_DIR / "edge_mean.json")
RAW_CSV = str(ARTIFACT_DIR / "raw.csv")

model = XGBRegressor()
model.load_model(MODEL_PATH)
with open(EDGE_MEAN_JSON) as f:
    EDGE_MEAN = json.load(f)


def predict_network(history):
    """
    history: DataFrame with one row per road per minute, oldest first,
    covering ALL roads and at least the last 21 minutes. Columns:
      time_min, edge_id, vehicles, halting, mean_speed,
      occupancy, waiting_time
    Returns: DataFrame with one row per road for the latest minute:
      edge_id, queue_now, predicted_30min, level_now, level_30min
    """
    history = history.copy()
    history["run_id"] = 0   # features.py expects this column

    if history["time_min"].nunique() < MIN_HISTORY:
        raise ValueError("Need at least %d minutes of history" % MIN_HISTORY)

    features = build_features(history, with_target=False, edge_mean=EDGE_MEAN)
    latest = features[features["time_min"] == features["time_min"].max()].copy()

    predicted = model.predict(latest[FEATURE_COLUMNS]).clip(0)
    result = pd.DataFrame({
        "edge_id": latest["edge_id"].values,
        "queue_now": latest["halting"].values,
        "predicted_30min": predicted.round(1),
    })
    result["level_now"] = [LEVEL_NAMES[i] for i in queue_to_level(result["queue_now"].values)]
    result["level_30min"] = [LEVEL_NAMES[i] for i in queue_to_level(result["predicted_30min"].values)]
    return result


def main():
    raw = pd.read_csv(RAW_CSV)

    # Use the last simulation run (the model never trained on it)
    last_run = raw["run_id"].max()
    run_data = raw[raw["run_id"] == last_run]

    print("Whole city, simulation run", last_run)
    print("Minute now | Total queue now | Predicted in 30 min | Actual in 30 min | Roads with right level")
    for now in range(40, 150, 20):
        history = run_data[run_data["time_min"] <= now]
        result = predict_network(history)

        actual = run_data[run_data["time_min"] == now + 30].set_index("edge_id")["halting"]
        actual = actual.reindex(result["edge_id"]).values
        right = (queue_to_level(actual) == queue_to_level(result["predicted_30min"].values)).mean()

        print("%10d | %15d | %19.0f | %16d | %21.0f%%" % (
            now, result["queue_now"].sum(), result["predicted_30min"].sum(),
            actual.sum(), right * 100))

    # Show the full output for one moment, the 5 roads expected to be worst
    print()
    print("Top 5 roads expected to be worst 30 minutes after minute 90:")
    history = run_data[run_data["time_min"] <= 90]
    result = predict_network(history).sort_values("predicted_30min", ascending=False)
    print(result.head(5).to_string(index=False))


if __name__ == "__main__":
    main()
