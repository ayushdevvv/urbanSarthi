"""
STEP 1: Generate the SUMO traffic dataset.

What this file does:
1. Builds a small 4x4 city grid with traffic lights (netgenerate).
2. Runs several simulations. Each run has a different random seed,
   a different demand level and a different rush hour time.
3. Every 60 simulated seconds, it records traffic stats for every road
   using TraCI (SUMO's Python control interface).
4. Saves the generated dataset to backend/models/traffic_forecast/raw.csv.

Run:  python backend/scripts/traffic_forecast/generate_data.py
"""

import os
import random
import subprocess
from pathlib import Path
from multiprocessing import Pool

import pandas as pd
import sumolib
import traci

# ---------- Settings you can change ----------
NUM_RUNS = 36         # number of simulations (more runs = more data)
WORKERS = 2           # simulations running at the same time
SIM_SECONDS = 10800    # each simulation is 3 hours
LOG_EVERY = 60         # record data every 60 seconds
BACKEND_DIR = Path(__file__).resolve().parents[2]
ARTIFACT_DIR = BACKEND_DIR / "models" / "traffic_forecast"
OUT_DIR = str(ARTIFACT_DIR)
NET_FILE = str(ARTIFACT_DIR / "grid.net.xml")
RAW_CSV = str(ARTIFACT_DIR / "raw.csv")
# ---------------------------------------------


def make_network():
    """Create a 4x4 grid road network with traffic lights."""
    netgenerate = sumolib.checkBinary("netgenerate")
    subprocess.run(
        [
            netgenerate,
            "--grid",
            "--grid.number", "4",
            "--grid.length", "200",
            "--grid.attach-length", "200",
            "--default-junction-type", "traffic_light",
            "--output-file", NET_FILE,
            "--no-warnings",
        ],
        check=True,
    )


def get_edge_ids():
    """Return the ids of all normal roads (not internal junction pieces)."""
    net = sumolib.net.readNet(NET_FILE)
    edge_ids = []
    for edge in net.getEdges():
        edge_ids.append(edge.getID())
    return edge_ids


def make_routes(route_file, edge_ids, seed):
    """
    Create vehicle trips with a rush hour pattern.
    Demand is low at the start, peaks once, then falls.
    Each run gets a random demand scale and a random peak time.
    """
    rng = random.Random(seed)
    scale = rng.uniform(0.9, 1.4)            # busier or quieter day
    peak_minute = rng.uniform(70, 110)      # when the rush hour happens
    total_minutes = SIM_SECONDS // 60

    trips = []
    for minute in range(total_minutes):
        # vehicles per minute: base traffic + a bump around the peak
        distance = (minute - peak_minute) / 30.0
        rate = scale * (14 + 46 * (2.718 ** (-(distance ** 2))))
        count = int(rate)
        if rng.random() < rate - count:
            count = count + 1

        for i in range(count):
            depart = minute * 60 + rng.uniform(0, 59)
            origin = rng.choice(edge_ids)
            destination = rng.choice(edge_ids)
            while destination == origin:
                destination = rng.choice(edge_ids)
            trips.append((depart, origin, destination))

    trips.sort()  # SUMO needs trips sorted by departure time

    with open(route_file, "w") as f:
        f.write("<routes>\n")
        for idx, trip in enumerate(trips):
            f.write(
                '  <trip id="v%d" depart="%.1f" from="%s" to="%s"/>\n'
                % (idx, trip[0], trip[1], trip[2])
            )
        f.write("</routes>\n")


def run_one_simulation(run_id, edge_ids):
    """Run SUMO once and return a list of data rows."""
    route_file = os.path.join(OUT_DIR, "routes_%d.rou.xml" % run_id)
    make_routes(route_file, edge_ids, seed=run_id)

    sumo = sumolib.checkBinary("sumo")
    traci.start([
        sumo,
        "-n", NET_FILE,
        "-r", route_file,
        "--seed", str(run_id),
        "--no-warnings",
        "--no-step-log",
    ])

    rows = []
    for step in range(1, SIM_SECONDS + 1):
        traci.simulationStep()

        if step % LOG_EVERY == 0:
            minute = step // 60
            for edge_id in edge_ids:
                rows.append({
                    "run_id": run_id,
                    "time_min": minute,
                    "edge_id": edge_id,
                    # how many vehicles are on this road
                    "vehicles": traci.edge.getLastStepVehicleNumber(edge_id),
                    # QUEUE LENGTH: vehicles that are almost stopped
                    "halting": traci.edge.getLastStepHaltingNumber(edge_id),
                    "mean_speed": traci.edge.getLastStepMeanSpeed(edge_id),
                    "occupancy": traci.edge.getLastStepOccupancy(edge_id),
                    "waiting_time": traci.edge.getWaitingTime(edge_id),
                })

    traci.close()
    os.remove(route_file)  # routes are big and we do not need them anymore
    return rows


def run_job(job):
    """Small wrapper so Pool can call run_one_simulation."""
    run_id, edge_ids = job
    return run_one_simulation(run_id, edge_ids)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    make_network()
    edge_ids = get_edge_ids()
    print("Roads in the network:", len(edge_ids))

    # Run WORKERS simulations at the same time to save waiting time.
    # Each run uses its own SUMO process, so they do not disturb each other.
    jobs = [(run_id, edge_ids) for run_id in range(NUM_RUNS)]
    all_rows = []
    with Pool(WORKERS) as pool:
        for done, rows in enumerate(pool.imap(run_job, jobs), start=1):
            print("Finished simulation %d of %d" % (done, NUM_RUNS))
            all_rows.extend(rows)

    df = pd.DataFrame(all_rows)
    df.to_csv(RAW_CSV, index=False)
    print("Saved", len(df), "rows to", RAW_CSV)
    print(df.describe().T[["mean", "max"]])


if __name__ == "__main__":
    main()
