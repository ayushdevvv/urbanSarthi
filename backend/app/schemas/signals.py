"""Domain-specific API request and response schemas."""
from datetime import date, datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from .base import ORMModel

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
