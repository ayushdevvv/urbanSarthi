"""Domain-specific API request and response schemas."""
from datetime import date, datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from .base import ORMModel

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
