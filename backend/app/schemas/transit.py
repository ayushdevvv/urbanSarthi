"""Domain-specific API request and response schemas."""
from datetime import date, datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from .base import ORMModel

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

class GtfsImportOut(BaseModel):
    routes_upserted: int
    stops_upserted: int
    trips_upserted: int
    stop_times_upserted: int
    frequencies_upserted: int
    calendars_upserted: int
    calendar_dates_upserted: int
    warnings: list[str]
