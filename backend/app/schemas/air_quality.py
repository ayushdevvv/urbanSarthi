"""Domain-specific API request and response schemas."""
from datetime import date, datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from .base import ORMModel

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
