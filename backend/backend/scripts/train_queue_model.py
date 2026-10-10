"""Train an optional scikit-learn queue-length estimator from validated CSV data.

CSV columns required:
vehicle_count,queue_length_m,average_speed_kmph,average_wait_seconds,lane_density,
horizon_minutes,target_queue_length_m

Do not present performance from synthetic/demo records as real-world model validation.
"""
import argparse
from pathlib import Path
import json
import numpy as np
import pandas as pd
from joblib import dump
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split

FEATURES = ["vehicle_count", "queue_length_m", "average_speed_kmph", "average_wait_seconds", "lane_density", "horizon_minutes"]
TARGET = "target_queue_length_m"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path, help="CSV of observed features and future queue targets")
    parser.add_argument("--output", type=Path, default=Path("models/queue_length.joblib"))
    parser.add_argument("--test-size", type=float, default=0.2)
    args = parser.parse_args()
    data = pd.read_csv(args.csv_path)
    missing = sorted(set(FEATURES + [TARGET]) - set(data.columns))
    if missing:
        raise SystemExit(f"CSV is missing required columns: {', '.join(missing)}")
    data = data[FEATURES + [TARGET]].replace([np.inf, -np.inf], np.nan).dropna()
    if len(data) < 30:
        raise SystemExit("At least 30 valid rows are required; more varied historical/simulation data is strongly recommended.")
    if (data[TARGET] < 0).any() or (data["queue_length_m"] < 0).any() or (data["vehicle_count"] < 0).any():
        raise SystemExit("Queue length and vehicle count values cannot be negative.")
    x_train, x_test, y_train, y_test = train_test_split(data[FEATURES], data[TARGET], test_size=args.test_size, random_state=42)
    model = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.06, max_leaf_nodes=15, l2_regularization=1.0, random_state=42)
    model.fit(x_train, y_train)
    predictions = np.maximum(0, model.predict(x_test))
    metrics = {"rows_used": int(len(data)), "train_rows": int(len(x_train)), "test_rows": int(len(x_test)),
               "mae_meters": round(float(mean_absolute_error(y_test, predictions)), 4),
               "rmse_meters": round(float(np.sqrt(mean_squared_error(y_test, predictions))), 4),
               "features": FEATURES, "target": TARGET,
               "warning": "Hold out different junctions/time periods for honest validation before production use."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    dump(model, args.output)
    args.output.with_suffix(".metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps({"model_path": str(args.output), **metrics}, indent=2))


if __name__ == "__main__":
    main()
