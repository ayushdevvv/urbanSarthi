"""Forecast contract: optional joblib estimator predicts queue length (metres).
Without a validated model, a bounded baseline heuristic is used and is labeled as such.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import mean
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models import AqiObservation, Junction, TrafficForecast, TrafficObservation

HORIZONS = (0, 15, 30, 45, 60)


class PredictionEngine:
    def __init__(self) -> None:
        self.model = None
        self.model_version = "baseline-heuristic-v1"
        if settings.model_path:
            try:
                import joblib
                candidate = Path(settings.model_path)
                if candidate.is_file():
                    self.model = joblib.load(candidate)
                    self.model_version = f"joblib:{candidate.stem}"
            except Exception:
                # Fall back rather than taking down the API; the model status endpoint reports fallback.
                self.model = None
                self.model_version = "baseline-heuristic-v1:model-load-failed"

    @property
    def mode(self) -> str:
        return "trained-estimator" if self.model is not None else "baseline-heuristic"

    def generate_for_junction(self, db: Session, junction: Junction) -> list[TrafficForecast]:
        now = datetime.now(timezone.utc)
        observations = list(db.scalars(
            select(TrafficObservation)
            .where(TrafficObservation.junction_id == junction.id)
            .order_by(TrafficObservation.observed_at.desc())
            .limit(6)
        ))
        current = observations[0] if observations else None
        previous = observations[1] if len(observations) > 1 else None
        # If a junction has not reported traffic yet, use explicit baseline estimates
        # rather than displaying zero as though it were a measured queue/count.
        queue_now = float(current.queue_length_m if current and current.queue_length_m is not None else 18.0)
        vehicles_now = int(current.vehicle_count if current and current.vehicle_count is not None else max(28, junction.lane_count * 14))
        speed_now = float(current.average_speed_kmph) if current and current.average_speed_kmph is not None else 25.0
        wait_now = float(current.average_wait_seconds) if current and current.average_wait_seconds is not None else max(5.0, queue_now * 0.55)
        density_now = float(current.lane_density) if current and current.lane_density is not None else min(1.0, vehicles_now / max(1, junction.lane_count * 25))
        congestion_now = float(current.congestion_score) if current and current.congestion_score is not None else min(100.0, density_now * 100)
        if previous and current and previous.observed_at and current.observed_at:
            dt = max(1.0, (current.observed_at - previous.observed_at).total_seconds())
            queue_trend_per_min = (current.queue_length_m - previous.queue_length_m) / (dt / 60.0)
            vehicle_trend_per_min = (current.vehicle_count - previous.vehicle_count) / (dt / 60.0)
        else:
            queue_trend_per_min, vehicle_trend_per_min = 0.0, 0.0
        nearest_aqi = db.scalars(select(AqiObservation).order_by(
            (AqiObservation.latitude - junction.latitude) * (AqiObservation.latitude - junction.latitude)
            + (AqiObservation.longitude - junction.longitude) * (AqiObservation.longitude - junction.longitude)
        ).limit(1)).first()
        current_aqi = nearest_aqi.aqi if nearest_aqi else None
        generation = now
        rows: list[TrafficForecast] = []
        for horizon in HORIZONS:
            queue_est = max(0.0, queue_now + queue_trend_per_min * horizon * 0.65)
            vehicles_est = max(0, round(vehicles_now + vehicle_trend_per_min * horizon * 0.5))
            feature_vector = [vehicles_now, queue_now, speed_now, wait_now, density_now, float(horizon)]
            confidence = 0.40 if not observations else 0.52
            if self.model is not None:
                try:
                    predicted = float(self.model.predict([feature_vector])[0])
                    if predicted >= 0:
                        queue_est = predicted
                        confidence = 0.72
                except Exception:
                    # Preserve transparent heuristic behavior when a model's feature contract differs.
                    confidence = 0.35
            congestion_est = max(0.0, min(100.0, congestion_now + max(-10, min(20, queue_trend_per_min * horizon * 0.15))))
            wait_est = max(0.0, wait_now + max(-15, min(180, queue_trend_per_min * horizon * 0.8)))
            # kg/km conversion is intentionally a simple estimate, not emissions inventory data.
            co2 = round(vehicles_est * max(0.0, 1.0 - speed_now / 200.0) * 18.0, 2)
            row = TrafficForecast(
                junction_id=junction.id,
                generated_at=generation,
                horizon_minutes=horizon,
                predicted_queue_length_m=round(queue_est, 2),
                predicted_vehicle_count=vehicles_est,
                predicted_average_wait_seconds=round(wait_est, 2),
                predicted_congestion_score=round(congestion_est, 2),
                predicted_aqi=current_aqi,
                predicted_co2_grams_per_minute=co2,
                confidence=confidence,
                model_version=self.model_version,
                feature_snapshot={
                    "current_observation_id": current.id if current else None,
                    "observation_count_used": len(observations),
                    "features": ["vehicle_count", "queue_length_m", "average_speed_kmph", "average_wait_seconds", "lane_density", "horizon_minutes"],
                    "feature_values": feature_vector,
                    "estimation": "model_prediction" if self.model is not None and confidence > 0.7 else "bounded_trend_heuristic",
                    "current_data_quality": "observed" if current else "baseline-estimate",
                    "aqi_method": "nearest_station_current_value_not_a_forecast" if nearest_aqi else "unavailable",
                },
            )
            rows.append(row)
        return rows


engine = PredictionEngine()


def refresh_forecasts(db: Session, junction_id: int | None = None) -> list[TrafficForecast]:
    query = select(Junction).order_by(Junction.id)
    if junction_id is not None:
        query = query.where(Junction.id == junction_id)
    junctions = list(db.scalars(query))
    if junction_id is not None and not junctions:
        return []
    rows: list[TrafficForecast] = []
    for junction in junctions:
        rows.extend(engine.generate_for_junction(db, junction))
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


def latest_forecasts(db: Session, junction_id: int) -> list[TrafficForecast]:
    latest_generation = db.scalar(select(TrafficForecast.generated_at).where(TrafficForecast.junction_id == junction_id).order_by(TrafficForecast.generated_at.desc()).limit(1))
    if latest_generation is None:
        return refresh_forecasts(db, junction_id)
    return list(db.scalars(select(TrafficForecast).where(TrafficForecast.junction_id == junction_id, TrafficForecast.generated_at == latest_generation).order_by(TrafficForecast.horizon_minutes)))


def maybe_refresh_forecasts(db: Session, junction_id: int) -> int:
    """Rate-limited refresh when new sensor data arrives; returns number of rows created."""
    from app.core.config import settings
    if not settings.auto_refresh_forecasts:
        return 0
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=max(30, settings.forecast_refresh_min_interval_seconds))
    recent = db.scalar(select(TrafficForecast.id).where(TrafficForecast.junction_id == junction_id, TrafficForecast.generated_at >= cutoff).limit(1))
    if recent:
        return 0
    return len(refresh_forecasts(db, junction_id))
