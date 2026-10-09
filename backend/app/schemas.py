from datetime import date, datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Coordinates(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class RoutePlanIn(BaseModel):
    origin_latitude: float = Field(ge=-90, le=90)
    origin_longitude: float = Field(ge=-180, le=180)
    destination_latitude: float = Field(ge=-90, le=90)
    destination_longitude: float = Field(ge=-180, le=180)
    origin_label: str | None = Field(default=None, max_length=180)
    destination_label: str | None = Field(default=None, max_length=180)
    preference: Literal["fastest", "cleanest", "balanced"] = "balanced"
    modes: list[Literal["driving", "walking", "transit", "cycling"]] = Field(default_factory=lambda: ["driving", "transit", "walking"], max_length=4)
    departure_at: datetime | None = None

    @model_validator(mode="after")
    def distinct_points(self):
        if self.origin_latitude == self.destination_latitude and self.origin_longitude == self.destination_longitude:
            raise ValueError("Origin and destination must be different")
        if not self.modes:
            raise ValueError("At least one travel mode is required")
        return self


class RouteOptionOut(ORMModel):
    id: int | None = None
    label: str
    mode: str
    preference_rank: str | None = None
    duration_seconds: int
    distance_meters: float
    traffic_delay_seconds: int = 0
    pollution_score: float | None = None
    estimated_aqi: float | None = None
    estimated_co2_grams: float | None = None
    transfers: int = 0
    provider: str
    data_quality: str
    geometry: dict[str, Any] = Field(default_factory=dict)
    itinerary: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class RoutePlanOut(BaseModel):
    trip_id: int | None
    public_trip_id: str | None
    preference: str
    routes: list[RouteOptionOut]
    data_freshness: dict[str, Any]
    warnings: list[str]


class TripOut(ORMModel):
    id: int
    public_id: str
    origin_label: str | None
    destination_label: str | None
    origin_latitude: float
    origin_longitude: float
    destination_latitude: float
    destination_longitude: float
    preference: str
    status: str
    selected_route_id: int | None
    started_at: datetime | None
    completed_at: datetime | None
    distance_meters: float | None
    duration_seconds: int | None
    created_at: datetime


class TrafficObservationIn(BaseModel):
    junction_id: int | None = None
    external_junction_id: str | None = Field(default=None, max_length=80)
    source: str = Field(default="manual", max_length=80)
    observed_at: datetime | None = None
    vehicle_count: int = Field(default=0, ge=0, le=100000)
    queue_length_m: float = Field(default=0, ge=0, le=100000)
    average_speed_kmph: float | None = Field(default=None, ge=0, le=250)
    average_wait_seconds: float | None = Field(default=None, ge=0, le=86400)
    lane_density: float | None = Field(default=None, ge=0, le=1)
    congestion_score: float | None = Field(default=None, ge=0, le=100)
    lane_demand: dict[str, float] = Field(default_factory=dict)
    detection_summary: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def has_junction(self):
        if self.junction_id is None and not self.external_junction_id:
            raise ValueError("junction_id or external_junction_id is required")
        for name, value in self.lane_demand.items():
            if value < 0 or value > 100000:
                raise ValueError(f"lane demand for {name} must be between 0 and 100000")
        return self


class TrafficObservationOut(ORMModel):
    id: int
    junction_id: int | None
    external_junction_id: str | None
    source: str
    observed_at: datetime
    vehicle_count: int
    queue_length_m: float
    average_speed_kmph: float | None
    average_wait_seconds: float | None
    lane_density: float | None
    congestion_score: float | None
    lane_demand: dict[str, Any]
    detection_summary: dict[str, Any]


class JunctionOut(ORMModel):
    id: int
    external_id: str
    name: str
    cluster_id: int | None
    latitude: float
    longitude: float
    status: str
    lane_count: int
    baseline_cycle_seconds: int
    configuration: dict[str, Any]


class AqiObservationIn(BaseModel):
    external_station_id: str | None = Field(default=None, max_length=100)
    station_name: str = Field(min_length=2, max_length=180)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    source: str = Field(default="manual", max_length=80)
    observed_at: datetime | None = None
    aqi: float | None = Field(default=None, ge=0, le=1000)
    pm25: float | None = Field(default=None, ge=0, le=100000)
    pm10: float | None = Field(default=None, ge=0, le=100000)
    no2: float | None = Field(default=None, ge=0, le=100000)
    o3: float | None = Field(default=None, ge=0, le=100000)
    co: float | None = Field(default=None, ge=0, le=100000)
    category: str | None = Field(default=None, max_length=40)
    raw_payload: dict[str, Any] = Field(default_factory=dict)


class AqiObservationOut(ORMModel):
    id: int
    external_station_id: str | None
    station_name: str
    latitude: float
    longitude: float
    source: str
    observed_at: datetime
    aqi: float | None
    pm25: float | None
    pm10: float | None
    no2: float | None
    o3: float | None
    co: float | None
    category: str | None


class TransitRouteOut(ORMModel):
    id: int
    external_id: str
    short_name: str | None
    long_name: str | None
    mode: str
    agency_name: str | None
    route_color: str | None
    source: str


class TransitStopOut(ORMModel):
    id: int
    external_id: str
    name: str
    latitude: float | None
    longitude: float | None
    wheelchair_boarding: bool | None
    parent_station: str | None
    source: str


class RealtimeArrivalIn(BaseModel):
    stop_external_id: str
    route_external_id: str | None = None
    expected_at: datetime
    delay_seconds: int | None = Field(default=None, ge=-86400, le=86400)
    vehicle_id: str | None = Field(default=None, max_length=100)
    source: str = Field(default="realtime-feed", max_length=80)


class TransitAlertIn(BaseModel):
    external_id: str | None = None
    title: str = Field(min_length=3, max_length=180)
    description: str = Field(default="", max_length=5000)
    severity: Literal["info", "low", "medium", "high", "critical"] = "info"
    status: Literal["active", "resolved"] = "active"
    route_external_ids: list[str] = Field(default_factory=list)
    stop_external_ids: list[str] = Field(default_factory=list)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    source: str = "operator"


class ForecastOut(ORMModel):
    id: int
    junction_id: int
    generated_at: datetime
    horizon_minutes: int
    predicted_queue_length_m: float
    predicted_vehicle_count: int
    predicted_average_wait_seconds: float
    predicted_congestion_score: float
    predicted_aqi: float | None
    predicted_co2_grams_per_minute: float | None
    confidence: float
    model_version: str
    feature_snapshot: dict[str, Any]


class SignalPhaseIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    movement: str = Field(min_length=1, max_length=100)
    green_seconds: int = Field(ge=5, le=120)
    yellow_seconds: int = Field(default=3, ge=3, le=6)
    all_red_seconds: int = Field(default=1, ge=0, le=5)
    demand_weight: float = Field(default=1, ge=0, le=100000)


class SignalPlanCreateIn(BaseModel):
    junction_id: int
    phases: list[SignalPhaseIn] = Field(min_length=2, max_length=12)
    rationale: str = Field(default="Operator-submitted signal plan", max_length=3000)
    plan_type: Literal["adaptive_recommendation", "manual", "scenario"] = "manual"

    @model_validator(mode="after")
    def cycle_limit(self):
        cycle = sum(p.green_seconds + p.yellow_seconds + p.all_red_seconds for p in self.phases)
        if cycle < 30 or cycle > 240:
            raise ValueError("Signal plan cycle must be between 30 and 240 seconds")
        return self


class SignalPlanOut(ORMModel):
    id: int
    public_id: str
    junction_id: int
    created_by_user_id: int | None
    reviewed_by_user_id: int | None
    status: str
    plan_type: str
    cycle_seconds: int
    phases: list[dict[str, Any]]
    rationale: str
    projected_outcomes: dict[str, Any]
    model_version: str
    reviewed_at: datetime | None
    review_note: str | None
    dispatched_at: datetime | None
    created_at: datetime


class ReviewIn(BaseModel):
    note: str | None = Field(default=None, max_length=3000)


class SimulationCreateIn(BaseModel):
    junction_id: int
    name: str = Field(min_length=3, max_length=160)
    proposed_phases: list[SignalPhaseIn] = Field(min_length=2, max_length=12)
    signal_plan_id: int | None = None

    @model_validator(mode="after")
    def cycle_limit(self):
        cycle = sum(p.green_seconds + p.yellow_seconds + p.all_red_seconds for p in self.proposed_phases)
        if cycle < 30 or cycle > 240:
            raise ValueError("Scenario cycle must be between 30 and 240 seconds")
        return self


class CityAlertCreateIn(BaseModel):
    title: str = Field(min_length=3, max_length=180)
    description: str = Field(default="", max_length=5000)
    category: Literal["traffic", "aqi", "transit", "roadwork", "incident", "weather", "system"] = "traffic"
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    junction_id: int | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    ends_at: datetime | None = None


class ResolveAlertIn(BaseModel):
    resolution_note: str = Field(min_length=2, max_length=3000)


class TicketCreateIn(BaseModel):
    mode: Literal["bus", "metro", "train", "ferry", "multimodal"]
    origin_label: str = Field(min_length=1, max_length=180)
    destination_label: str = Field(min_length=1, max_length=180)
    departure_at: datetime | None = None
    passengers: int = Field(default=1, ge=1, le=12)


class TicketOut(ORMModel):
    id: int
    public_id: str
    mode: str
    origin_label: str
    destination_label: str
    departure_at: datetime | None
    passengers: int
    status: str
    provider: str
    provider_reference: str | None
    currency: str
    quoted_amount: float | None
    qr_token: str
    booking_response: dict[str, Any]
    created_at: datetime


class DataSourceOut(ORMModel):
    id: int
    external_id: str
    name: str
    source_type: str
    provider: str
    status: str
    last_success_at: datetime | None
    last_error: str | None
    freshness_seconds: int | None
    safe_config: dict[str, Any]


class ClusterOut(ORMModel):
    id: int
    external_id: str
    name: str
    city: str
    status: str
    config: dict[str, Any]


class JunctionCreateIn(BaseModel):
    external_id: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=2, max_length=160)
    cluster_id: int | None = None
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    status: Literal["online", "degraded", "offline", "unknown"] = "unknown"
    lane_count: int = Field(default=4, ge=1, le=64)
    baseline_cycle_seconds: int = Field(default=90, ge=30, le=240)
    configuration: dict[str, Any] = Field(default_factory=dict)


class DataSourceUpsertIn(BaseModel):
    external_id: str = Field(min_length=2, max_length=100)
    name: str = Field(min_length=2, max_length=160)
    source_type: Literal["camera", "cpcb", "openaq", "gtfs", "osm", "atcs", "sumo", "transit", "other"]
    provider: str = Field(min_length=1, max_length=100)
    status: Literal["online", "degraded", "offline", "not_configured", "unknown"] = "not_configured"
    freshness_seconds: int | None = Field(default=None, ge=0, le=604800)
    safe_config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("safe_config")
    @classmethod
    def forbid_secret_material(cls, value: dict[str, Any]):
        forbidden = ("password", "secret", "token", "api_key", "authorization", "credential", "rtsp_url", "private_key")
        def walk(item, path="safe_config"):
            if isinstance(item, dict):
                for key, child in item.items():
                    normalized = str(key).lower().replace("-", "_")
                    if any(term in normalized for term in forbidden):
                        raise ValueError(f"Do not store secrets or stream credentials in {path}.{key}; use environment/secret storage")
                    walk(child, f"{path}.{key}")
            elif isinstance(item, list):
                for index, child in enumerate(item):
                    walk(child, f"{path}[{index}]")
        walk(value)
        return value


class GtfsImportOut(BaseModel):
    routes_upserted: int
    stops_upserted: int
    trips_upserted: int
    stop_times_upserted: int
    frequencies_upserted: int
    calendars_upserted: int
    calendar_dates_upserted: int
    warnings: list[str]
