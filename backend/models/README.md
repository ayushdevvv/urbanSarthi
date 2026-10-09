# Optional trained models

Place a validated model here as `queue_length.joblib` after running `scripts/train_queue_model.py` on real historical or calibrated simulation data. The trained artifact is intentionally not shipped with this backend. Set `MODEL_PATH=models/queue_length.joblib` when running locally, or mount this directory into the API container as the Compose file does.

Do not train/evaluate using synthetic demo telemetry and then report its scores as field accuracy. Keep the model's dataset provenance, holdout MAE/RMSE, feature schema, and validation date with your deployment records.
