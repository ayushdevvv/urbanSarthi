"""
Shared feature code. Used by BOTH training and prediction,
so the model always sees features built the same way.

The model sees three kinds of information:
1. This road right now (queue, speed, occupancy, waiting time)
2. This road in the recent past (lags, 10 minute average, trend)
3. The whole city right now (total queue, trend) plus how busy
   this road usually is (edge_mean)
"""

import pandas as pd

HORIZON_MIN = 30   # we predict 30 minutes ahead (1 row = 1 minute)
MIN_HISTORY = 21   # minutes of history needed before we can predict

# Congestion levels from queue length (vehicles halted on the road)
#   0 = Free      (0 to 2 vehicles)
#   1 = Moderate  (3 to 9 vehicles)
#   2 = Heavy     (10 or more vehicles)
LEVEL_CUTS = [3, 10]
LEVEL_NAMES = ["Free", "Moderate", "Heavy"]

# The model input columns, in a fixed order
FEATURE_COLUMNS = [
    "time_min",
    "vehicles",
    "halting",
    "mean_speed",
    "occupancy",
    "waiting_time",
    "halting_lag5",
    "halting_lag10",
    "halting_lag15",
    "halting_avg10",
    "speed_lag5",
    "vehicles_lag5",
    "halting_change5",
    "net_halt",
    "net_veh",
    "net_halt_l10",
    "net_halt_l20",
    "net_chg10",
    "edge_mean",
]

TARGET_COLUMN = "target_halting_30min"


def queue_to_level(queue):
    """Turn a queue length (number or numpy array) into a level 0, 1 or 2."""
    import numpy as np
    return np.digitize(queue, LEVEL_CUTS)


def add_city_features(df):
    """
    Add whole city numbers for every minute: total queue, total vehicles,
    and how the total queue changed over the last 10 and 20 minutes.
    """
    city = (
        df.groupby(["run_id", "time_min"])
        .agg(net_halt=("halting", "sum"), net_veh=("vehicles", "sum"))
        .reset_index()
        .sort_values(["run_id", "time_min"])
    )
    city_group = city.groupby("run_id")["net_halt"]
    city["net_halt_l10"] = city_group.shift(10)
    city["net_halt_l20"] = city_group.shift(20)
    city["net_chg10"] = city["net_halt"] - city["net_halt_l10"]
    return df.merge(city, on=["run_id", "time_min"], how="left")


def build_features(df, with_target, edge_mean, horizon_min=None):
    """
    Turn raw rows into model features.

    df must have: run_id, time_min, edge_id, vehicles, halting,
                  mean_speed, occupancy, waiting_time
    It must contain ALL roads of the city (the city numbers need them).

    edge_mean: dict {edge_id: average queue of that road in training data}

    Lag features = "what was this road like a few minutes ago".
    The target = queue length (halting) 30 minutes in the future.
    """
    df = df.sort_values(["run_id", "edge_id", "time_min"]).copy()
    group = df.groupby(["run_id", "edge_id"])

    # Past values (shift moves data down, so row t sees row t-5, etc.)
    df["halting_lag5"] = group["halting"].shift(5)
    df["halting_lag10"] = group["halting"].shift(10)
    df["halting_lag15"] = group["halting"].shift(15)
    df["speed_lag5"] = group["mean_speed"].shift(5)
    df["vehicles_lag5"] = group["vehicles"].shift(5)

    # Average queue over the last 10 minutes
    total = df["halting"].copy()
    for k in range(1, 10):
        total = total + group["halting"].shift(k)
    df["halting_avg10"] = total / 10

    # Is the queue growing or shrinking?
    df["halting_change5"] = df["halting"] - df["halting_lag5"]

    # City wide numbers and the usual queue of this road
    df = add_city_features(df)
    df["edge_mean"] = df["edge_id"].map(edge_mean)

    if with_target:
        # Negative shift looks into the future. The 30-minute model keeps its
        # historical default; training can request a distinct 60-minute target.
        target_horizon = int(horizon_min or HORIZON_MIN)
        group = df.groupby(["run_id", "edge_id"])
        target_name = f"target_halting_{target_horizon}min"
        df[target_name] = group["halting"].shift(-target_horizon)
        df = df.dropna(subset=FEATURE_COLUMNS + [target_name])
    else:
        df = df.dropna(subset=FEATURE_COLUMNS)

    return df
