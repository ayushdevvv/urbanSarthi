"""
STEP 2: Preprocess the raw data.

What this file does:
1. Loads data/raw.csv
2. Splits into train and test BY SIMULATION RUN.
   Why: if we split random rows, the model would see minute 50 in
   training and minute 51 in test. That is cheating (data leakage).
   Splitting by run means the test set is a completely unseen day.
3. Works out the usual queue of each road (edge_mean) from the
   TRAIN runs only, so nothing from the test days leaks in.
4. Builds features (lags, city numbers) and the 30 minute target
5. Saves data/train.csv, data/test.csv and models/edge_mean.json

Run:  python 02_preprocess.py
"""

import json
import os

import pandas as pd

from features import build_features, FEATURE_COLUMNS, TARGET_COLUMN

RAW_CSV = "data/raw.csv"
TRAIN_CSV = "data/train.csv"
TEST_CSV = "data/test.csv"
EDGE_MEAN_JSON = "models/edge_mean.json"
NUM_TEST_RUNS = 8   # last 8 simulations are kept for testing


def main():
    raw = pd.read_csv(RAW_CSV)
    print("Raw rows:", len(raw))

    run_ids = [int(r) for r in sorted(raw["run_id"].unique())]
    test_runs = run_ids[-NUM_TEST_RUNS:]
    train_runs = run_ids[:-NUM_TEST_RUNS]
    print("Train runs:", len(train_runs), "| Test runs:", test_runs)

    train_raw = raw[raw["run_id"].isin(train_runs)]
    test_raw = raw[raw["run_id"].isin(test_runs)]

    # Usual queue of each road, from training days only
    edge_mean = train_raw.groupby("edge_id")["halting"].mean().to_dict()
    os.makedirs("models", exist_ok=True)
    with open(EDGE_MEAN_JSON, "w") as f:
        json.dump(edge_mean, f)

    keep = ["run_id", "edge_id"] + FEATURE_COLUMNS + [TARGET_COLUMN]
    train = build_features(train_raw, with_target=True, edge_mean=edge_mean)
    test = build_features(test_raw, with_target=True, edge_mean=edge_mean)
    train[keep].to_csv(TRAIN_CSV, index=False)
    test[keep].to_csv(TEST_CSV, index=False)

    print("Train rows:", len(train), "| Test rows:", len(test))
    print("Saved", TRAIN_CSV, ",", TEST_CSV, "and", EDGE_MEAN_JSON)


if __name__ == "__main__":
    main()
