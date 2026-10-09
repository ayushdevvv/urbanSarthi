from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.db import get_db
from app.dependencies import require_roles
from app.models import Junction
from app.schemas import ForecastOut
from app.services.common import audit
from app.services.predictions import engine, latest_forecasts, refresh_forecasts

router = APIRouter(prefix="/predictions", tags=["60-minute traffic forecast"])


class ForecastRefreshIn(BaseModel):
    junction_id: int | None = None


@router.get("/model-status")
def model_status():
    return {"mode": engine.mode, "model_version": engine.model_version,
            "model_loaded": engine.model is not None,
            "model_contract": "If MODEL_PATH is provided, estimator.predict accepts rows [vehicle_count, queue_length_m, average_speed_kmph, average_wait_seconds, lane_density, horizon_minutes] and returns predicted queue_length_m.",
            "warning": "Without a trained and validated estimator, this service uses a bounded trend heuristic and must not be presented as validated AI forecasting."}


@router.post("/refresh")
def refresh(payload: ForecastRefreshIn, request: Request, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    if payload.junction_id is not None and not db.get(Junction, payload.junction_id):
        raise HTTPException(status_code=404, detail="Junction not found")
    rows = refresh_forecasts(db, payload.junction_id)
    audit(db, user.id, "prediction.forecasts_refreshed", "junction", str(payload.junction_id) if payload.junction_id else "all", {"forecast_count": len(rows), "model_version": engine.model_version}, request.client.host if request.client else None)
    db.commit()
    return {"generated_count": len(rows), "junction_count": len({r.junction_id for r in rows}),
            "model_version": engine.model_version, "model_mode": engine.mode,
            "forecasts": [ForecastOut.model_validate(row).model_dump(mode="json") for row in rows]}


@router.get("/junctions/{junction_id}", response_model=list[ForecastOut])
def get_forecasts(junction_id: int, db: Session = Depends(get_db)):
    if not db.get(Junction, junction_id):
        raise HTTPException(status_code=404, detail="Junction not found")
    return latest_forecasts(db, junction_id)
