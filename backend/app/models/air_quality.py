"""Domain-specific SQLAlchemy models."""
from datetime import datetime, timezone
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base
from .base import TimestampMixin, utcnow

class AqiObservation(Base):
    __tablename__ = "aqi_observations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_station_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    station_name: Mapped[str] = mapped_column(String(180), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(80), default="manual", nullable=False, index=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    aqi: Mapped[float | None] = mapped_column(Float, nullable=True)
    pm25: Mapped[float | None] = mapped_column(Float, nullable=True)
    pm10: Mapped[float | None] = mapped_column(Float, nullable=True)
    no2: Mapped[float | None] = mapped_column(Float, nullable=True)
    o3: Mapped[float | None] = mapped_column(Float, nullable=True)
    co: Mapped[float | None] = mapped_column(Float, nullable=True)
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    raw_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    __table_args__ = (Index("ix_aqi_lat_lon", "latitude", "longitude"), Index("ix_aqi_source_observed", "source", "observed_at"))
