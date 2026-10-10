# UrbanSaarthi SUMO traffic forecast model

This directory contains the supplied SUMO generated road network observations, the trained XGBoost queue forecast model, its feature builder, and the original data generation, preprocessing, training, and prediction scripts.

The FastAPI route `GET /api/v1/traffic/simulation` loads the included model and predicts queue counts 30 minutes ahead for the 80 road segments in the latest included simulation run. It does not need SUMO installed at request time because the simulation data is already included. Recreating new scenarios requires SUMO, TraCI, and the tools in `requirements.txt`.

The included held out run evaluation reports 83.4% congestion level accuracy, MAE 1.84 vehicles, and R² 0.718. These are results on the supplied simulated network, not a claim of accuracy on live roads.
