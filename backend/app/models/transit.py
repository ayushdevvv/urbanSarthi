"""Domain-specific SQLAlchemy models."""
from datetime import datetime, timezone
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base
from .base import TimestampMixin, utcnow

class TransitRoute(TimestampMixin, Base):
    __tablename__ = "transit_routes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    long_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    mode: Mapped[str] = mapped_column(String(30), default="bus", nullable=False, index=True)
    agency_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    route_color: Mapped[str | None] = mapped_column(String(12), nullable=True)
    source: Mapped[str] = mapped_column(String(80), default="gtfs", nullable=False)

class TransitStop(TimestampMixin, Base):
    __tablename__ = "transit_stops"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    wheelchair_boarding: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    parent_station: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source: Mapped[str] = mapped_column(String(80), default="gtfs", nullable=False)
    __table_args__ = (Index("ix_transit_stops_lat_lon", "latitude", "longitude"),)

class TransitTrip(TimestampMixin, Base):
    __tablename__ = "transit_trips"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    route_id: Mapped[int] = mapped_column(ForeignKey("transit_routes.id", ondelete="CASCADE"), nullable=False, index=True)
    service_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    headsign: Mapped[str | None] = mapped_column(String(200), nullable=True)
    direction_id: Mapped[str | None] = mapped_column(String(10), nullable=True)
    wheelchair_accessible: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

class TransitStopTime(Base):
    __tablename__ = "transit_stop_times"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("transit_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    stop_id: Mapped[int] = mapped_column(ForeignKey("transit_stops.id", ondelete="CASCADE"), nullable=False, index=True)
    stop_sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    arrival_time: Mapped[str] = mapped_column(String(16), nullable=False)
    departure_time: Mapped[str] = mapped_column(String(16), nullable=False)
    pickup_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
    drop_off_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
    __table_args__ = (UniqueConstraint("trip_id", "stop_sequence", name="uq_transit_trip_stop_sequence"), Index("ix_stop_times_stop_sequence", "stop_id", "stop_sequence"))

class TransitFrequency(Base):
    __tablename__ = "transit_frequencies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("transit_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    start_time: Mapped[str] = mapped_column(String(16), nullable=False)
    end_time: Mapped[str] = mapped_column(String(16), nullable=False)
    headway_secs: Mapped[int] = mapped_column(Integer, nullable=False)
    exact_times: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    __table_args__ = (UniqueConstraint("trip_id", "start_time", name="uq_transit_frequency_trip_start"), Index("ix_transit_frequency_trip_window", "trip_id", "start_time", "end_time"))

class TransitCalendar(Base):
    __tablename__ = "transit_calendars"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    service_id: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    monday: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    tuesday: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    wednesday: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    thursday: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    friday: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    saturday: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sunday: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    start_date: Mapped[object] = mapped_column(Date, nullable=False)
    end_date: Mapped[object] = mapped_column(Date, nullable=False)

class TransitCalendarDate(Base):
    __tablename__ = "transit_calendar_dates"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    service_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    service_date: Mapped[object] = mapped_column(Date, nullable=False)
    exception_type: Mapped[int] = mapped_column(Integer, nullable=False)  # GTFS: 1 add, 2 remove
    __table_args__ = (UniqueConstraint("service_id", "service_date", name="uq_transit_calendar_date"),)

class TransitRealtimeArrival(Base):
    __tablename__ = "transit_realtime_arrivals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stop_id: Mapped[int] = mapped_column(ForeignKey("transit_stops.id", ondelete="CASCADE"), nullable=False, index=True)
    route_id: Mapped[int | None] = mapped_column(ForeignKey("transit_routes.id", ondelete="SET NULL"), nullable=True, index=True)
    expected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    delay_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vehicle_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source: Mapped[str] = mapped_column(String(80), default="realtime-feed", nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

class TransitAlert(TimestampMixin, Base):
    __tablename__ = "transit_alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    severity: Mapped[str] = mapped_column(String(30), default="info", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False, index=True)
    route_external_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    stop_external_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(80), default="operator", nullable=False)
