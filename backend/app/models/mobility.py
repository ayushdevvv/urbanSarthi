"""Domain-specific SQLAlchemy models."""
from datetime import datetime, timezone
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base
from .base import TimestampMixin, utcnow

class Trip(TimestampMixin, Base):
    __tablename__ = "trips"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    origin_label: Mapped[str | None] = mapped_column(String(180), nullable=True)
    destination_label: Mapped[str | None] = mapped_column(String(180), nullable=True)
    origin_latitude: Mapped[float] = mapped_column(Float, nullable=False)
    origin_longitude: Mapped[float] = mapped_column(Float, nullable=False)
    destination_latitude: Mapped[float] = mapped_column(Float, nullable=False)
    destination_longitude: Mapped[float] = mapped_column(Float, nullable=False)
    preference: Mapped[str] = mapped_column(String(30), default="balanced", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="planned", nullable=False, index=True)
    selected_route_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # RouteOption must belong to this Trip; enforced by API service
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    distance_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actual_metrics: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

class RouteOption(Base):
    __tablename__ = "route_options"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    mode: Mapped[str] = mapped_column(String(40), nullable=False)
    preference_rank: Mapped[str | None] = mapped_column(String(30), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    distance_meters: Mapped[float] = mapped_column(Float, nullable=False)
    traffic_delay_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    pollution_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_aqi: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_co2_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    transfers: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    provider: Mapped[str] = mapped_column(String(80), default="heuristic-estimate", nullable=False)
    data_quality: Mapped[str] = mapped_column(String(40), default="estimated", nullable=False)
    geometry: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    itinerary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    warnings: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
