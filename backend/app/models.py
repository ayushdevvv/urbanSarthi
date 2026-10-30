"""SQLAlchemy 2.x models for UrbanSaarthi.

JSON columns use SQLAlchemy's portable JSON type so the same schema works on SQLite
(development/tests) and PostgreSQL (deployment). Schema changes are managed by Alembic.
"""
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[str] = mapped_column(String(30), default="citizen", nullable=False, index=True)  # citizen/operator/admin
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


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


class TrafficForecast(Base):
    __tablename__ = "traffic_forecasts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    junction_id: Mapped[int] = mapped_column(ForeignKey("junctions.id", ondelete="CASCADE"), nullable=False, index=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    horizon_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    predicted_queue_length_m: Mapped[float] = mapped_column(Float, nullable=False)
    predicted_vehicle_count: Mapped[int] = mapped_column(Integer, nullable=False)
    predicted_average_wait_seconds: Mapped[float] = mapped_column(Float, nullable=False)
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


class TicketOrder(TimestampMixin, Base):
    __tablename__ = "ticket_orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(30), nullable=False)
    origin_label: Mapped[str] = mapped_column(String(180), nullable=False)
    destination_label: Mapped[str] = mapped_column(String(180), nullable=False)
    departure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    passengers: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="requested", nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(100), default="not-configured", nullable=False)
    provider_reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    quoted_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    qr_token: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    booking_response: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    __table_args__ = (Index("ix_ticket_user_created", "user_id", "created_at"),)


class CityAlert(TimestampMixin, Base):
    __tablename__ = "city_alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="traffic", nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(30), default="medium", nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False, index=True)
    junction_id: Mapped[int | None] = mapped_column(ForeignKey("junctions.id", ondelete="SET NULL"), nullable=True, index=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class DataSource(TimestampMixin, Base):
    __tablename__ = "data_sources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # camera/cpcb/openaq/gtfs/osm/atcs/sumo
    provider: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="not_configured", nullable=False, index=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    freshness_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    safe_config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)  # never put API keys or RTSP credentials here


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    entity_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
