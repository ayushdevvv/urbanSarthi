"""Domain-specific API request and response schemas."""
from datetime import date, datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from .base import ORMModel

class TrafficObservationIn(BaseModel):
    junction_id: int | None = None
    external_junction_id: str | None = Field(default=None, max_length=80)
    source: str = Field(default="manual", max_length=80)
    observed_at: datetime | None = None
    vehicle_count: int = Field(default=0, ge=0, le=100000)
    queue_length_m: float | None = Field(default=None, ge=0, le=100000)
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
    queue_length_m: float | None
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

class ForecastOut(ORMModel):
    id: int
    junction_id: int
    generated_at: datetime
    horizon_minutes: int
    predicted_queue_length_m: float | None
    predicted_vehicle_count: int
    predicted_average_wait_seconds: float | None
    predicted_congestion_score: float
    predicted_aqi: float | None
    predicted_co2_grams_per_minute: float | None
    confidence: float
    model_version: str
    feature_snapshot: dict[str, Any]

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
