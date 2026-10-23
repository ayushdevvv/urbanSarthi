"""Domain-specific SQLAlchemy models."""
from datetime import datetime, timezone
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base
from .base import TimestampMixin, utcnow

class CityCluster(TimestampMixin, Base):
    __tablename__ = "city_clusters"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    city: Mapped[str] = mapped_column(String(120), default="Unconfigured city", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="unknown", nullable=False)  # online/degraded/offline/unknown
    config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

class Junction(TimestampMixin, Base):
    __tablename__ = "junctions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    cluster_id: Mapped[int | None] = mapped_column(ForeignKey("city_clusters.id", ondelete="SET NULL"), nullable=True, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="unknown", nullable=False, index=True)
    lane_count: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    baseline_cycle_seconds: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    configuration: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    __table_args__ = (Index("ix_junctions_lat_lon", "latitude", "longitude"),)

class TrafficObservation(Base):
    __tablename__ = "traffic_observations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    junction_id: Mapped[int | None] = mapped_column(ForeignKey("junctions.id", ondelete="SET NULL"), nullable=True, index=True)
    external_junction_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(80), default="manual", nullable=False, index=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    vehicle_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    queue_length_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_speed_kmph: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_wait_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    lane_density: Mapped[float | None] = mapped_column(Float, nullable=True)  # normalized 0..1
    congestion_score: Mapped[float | None] = mapped_column(Float, nullable=True)  # normalized 0..100
    lane_demand: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    detection_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    __table_args__ = (
        Index("ix_traffic_junction_observed", "junction_id", "observed_at"),
        Index("ix_traffic_source_observed", "source", "observed_at"),
    )

class TrafficForecast(Base):
    __tablename__ = "traffic_forecasts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    junction_id: Mapped[int] = mapped_column(ForeignKey("junctions.id", ondelete="CASCADE"), nullable=False, index=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    horizon_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    predicted_queue_length_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    predicted_vehicle_count: Mapped[int] = mapped_column(Integer, nullable=False)
    predicted_average_wait_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    predicted_congestion_score: Mapped[float] = mapped_column(Float, nullable=False)
    predicted_aqi: Mapped[float | None] = mapped_column(Float, nullable=True)
    predicted_co2_grams_per_minute: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    model_version: Mapped[str] = mapped_column(String(100), nullable=False)
    feature_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    __table_args__ = (UniqueConstraint("junction_id", "generated_at", "horizon_minutes", name="uq_forecast_junction_generation_horizon"),)

class SignalPlan(TimestampMixin, Base):
    __tablename__ = "signal_plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    junction_id: Mapped[int] = mapped_column(ForeignKey("junctions.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="draft", nullable=False, index=True)
    plan_type: Mapped[str] = mapped_column(String(40), default="adaptive_recommendation", nullable=False)
    cycle_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    phases: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, default="", nullable=False)
    projected_outcomes: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    model_version: Mapped[str] = mapped_column(String(100), default="demand-weighted-v1", nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class SimulationRun(TimestampMixin, Base):
    __tablename__ = "simulation_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    junction_id: Mapped[int] = mapped_column(ForeignKey("junctions.id", ondelete="CASCADE"), nullable=False, index=True)
    submitted_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    signal_plan_id: Mapped[int | None] = mapped_column(ForeignKey("signal_plans.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    engine: Mapped[str] = mapped_column(String(80), default="analytical-what-if-v1", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="completed", nullable=False)
    baseline: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    proposed_phases: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    results: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    caveats: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
