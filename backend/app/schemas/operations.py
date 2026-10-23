"""Domain-specific API request and response schemas."""
from datetime import date, datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from .base import ORMModel

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
    qr_token: str | None
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
