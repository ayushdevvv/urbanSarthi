"""
STEP 3: Train XGBoost, evaluate it, and save it.

What this file does:
1. Loads train.csv and test.csv
2. Trains an XGBoost regressor (predicts queue length in 30 min)
3. Compares it against a simple baseline:
      baseline = "the queue in 30 min will be the same as now"
   If XGBoost cannot beat this, the model is not useful.
4. Prints the scores on days the model has never seen:
      MAE   = average error in vehicles
      RMSE  = like MAE but punishes big mistakes more
      R2    = how much of the ups and downs the model explains (1.0 = perfect)
      Level accuracy = how often it gets Free / Moderate / Heavy right
5. Checks the accuracy target (default 90 percent level accuracy)
6. Saves model artifacts and metrics under backend/models/traffic_forecast/.

Run:  python backend/scripts/traffic_forecast/train_model.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

BACKEND_DIR = Path(__file__).resolve().parents[2]
FEATURES_DIR = BACKEND_DIR / "app" / "ml" / "traffic_forecast"
ARTIFACT_DIR = BACKEND_DIR / "models" / "traffic_forecast"
if str(FEATURES_DIR) not in sys.path:
    sys.path.insert(0, str(FEATURES_DIR))
from features import FEATURE_COLUMNS, TARGET_COLUMN, queue_to_level

TRAIN_CSV = str(ARTIFACT_DIR / "train.csv")
TEST_CSV = str(ARTIFACT_DIR / "test.csv")
MODEL_PATH = str(ARTIFACT_DIR / "queue_model.json")
METRICS_PATH = str(ARTIFACT_DIR / "metrics.json")
TARGET_ACCURACY = 0.90   # the goal: 90 percent congestion level accuracy


def rmse(y_true, y_pred):
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def score(y_true, y_pred):
    """All the scores for one set of predictions."""
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": rmse(y_true, y_pred),
        "r2": float(r2_score(y_true, y_pred)),
        "level_accuracy": float((queue_to_level(y_true) == queue_to_level(y_pred)).mean()),
    }


def show(name, s):
    print("%-24s MAE %.2f | RMSE %.2f | R2 %.3f | Level accuracy %.1f%%" % (
        name, s["mae"], s["rmse"], s["r2"], s["level_accuracy"] * 100))


def main():
    train = pd.read_csv(TRAIN_CSV)
    test = pd.read_csv(TEST_CSV)

    X_train = train[FEATURE_COLUMNS]
    y_train = train[TARGET_COLUMN]
    X_test = test[FEATURE_COLUMNS]
    y_test = test[TARGET_COLUMN].values

    model = XGBRegressor(
        n_estimators=400,      # number of trees
        max_depth=6,           # how deep each tree can go
        learning_rate=0.05,    # how fast it learns
        subsample=0.8,         # each tree sees 80 percent of rows
        colsample_bytree=0.8,  # each tree sees 80 percent of columns
        random_state=42,
    )
    print("Training on %d rows ..." % len(train))
    model.fit(X_train, y_train)

    # A queue cannot be negative
    predictions = np.clip(model.predict(X_test), 0, None)
    baseline = X_test["halting"].values   # queue in 30 min = queue now

    baseline_score = score(y_test, baseline)
    model_score = score(y_test, predictions)

    print()
    print("RESULTS ON UNSEEN TEST DAYS (%d rows)" % len(test))
    print("-" * 78)
    show("Baseline (same as now)", baseline_score)
    show("XGBoost", model_score)

    print()
    print("Feature importance")
    importance = pd.Series(model.feature_importances_, index=FEATURE_COLUMNS)
    print(importance.sort_values(ascending=False).round(3).to_string())

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(MODEL_PATH)
    with open(METRICS_PATH, "w") as f:
        json.dump({"baseline": baseline_score, "xgboost": model_score,
                   "target_level_accuracy": TARGET_ACCURACY}, f, indent=2)
    print()
    print("Saved model to", MODEL_PATH)

    print()
    if model_score["level_accuracy"] >= TARGET_ACCURACY:
        print("TARGET MET: level accuracy %.1f%% (goal %.0f%%)" % (
            model_score["level_accuracy"] * 100, TARGET_ACCURACY * 100))
    else:
        print("TARGET NOT MET: level accuracy %.1f%% (goal %.0f%%)" % (
            model_score["level_accuracy"] * 100, TARGET_ACCURACY * 100))


if __name__ == "__main__":
    main()
