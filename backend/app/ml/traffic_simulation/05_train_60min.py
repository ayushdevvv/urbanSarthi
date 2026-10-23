"""Train an independent 60-minute queue forecast using the existing SUMO run dataset.
Run from this directory with the dependencies in requirements.txt installed.
The split is by complete run to reduce temporal leakage.
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor
from features import FEATURE_COLUMNS, build_features, queue_to_level

BASE = Path(__file__).resolve().parent
raw = pd.read_csv(BASE / "data/raw.csv")
runs = sorted(raw.run_id.unique())
test_runs = set(runs[-8:])
train_raw = raw[~raw.run_id.isin(test_runs)].copy()
test_raw = raw[raw.run_id.isin(test_runs)].copy()
edge_mean = train_raw.groupby("edge_id").halting.mean().to_dict()
train = build_features(train_raw, True, edge_mean, horizon_min=60)
test = build_features(test_raw, True, edge_mean, horizon_min=60)
target = "target_halting_60min"

model = XGBRegressor(
    n_estimators=320, max_depth=6, learning_rate=0.05, min_child_weight=3,
    subsample=0.8, colsample_bytree=0.8, reg_lambda=1.2, objective="reg:squarederror",
    tree_method="hist", n_jobs=4, random_state=42,
)
model.fit(train[FEATURE_COLUMNS], train[target])
pred = np.clip(model.predict(test[FEATURE_COLUMNS]), 0, None)
y = test[target].to_numpy()
metrics = {
    "horizon_minutes": 60,
    "training_runs": len(runs) - len(test_runs),
    "test_runs": sorted(int(x) for x in test_runs),
    "training_rows": int(len(train)),
    "test_rows": int(len(test)),
    "mae_vehicles": float(mean_absolute_error(y, pred)),
    "rmse_vehicles": float(np.sqrt(mean_squared_error(y, pred))),
    "r2": float(r2_score(y, pred)),
    "level_accuracy": float((queue_to_level(y) == queue_to_level(pred)).mean()),
    "dataset_rows": int(len(raw)),
    "road_edges": int(raw.edge_id.nunique()),
    "simulation_runs": int(raw.run_id.nunique()),
    "minutes_per_run": int(raw.time_min.max()),
}
model.save_model(str(BASE / "models/queue_model_60min.json"))
(BASE / "models/metrics_60min.json").write_text(json.dumps(metrics, indent=2))
print(json.dumps(metrics, indent=2))
