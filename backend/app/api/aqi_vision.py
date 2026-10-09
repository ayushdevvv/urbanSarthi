"""AQI model inference endpoint for paired images and sensor values."""
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from app.services.aqi_vision import analyze, status

router = APIRouter(prefix="/aqi-vision", tags=["AQI AI"])
MAX_IMAGE_BYTES = 8 * 1024 * 1024
TOTAL_UPLOAD_BYTES = 14 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.get("/status")
def aqi_model_status():
    return status()


@router.post("/analyze")
async def analyze_aqi(
    front_image: Annotated[UploadFile, File(description="Front road view: JPG, PNG, or WebP")],
    rear_image: Annotated[UploadFile, File(description="Rear road view: JPG, PNG, or WebP")],
    pm25: Annotated[float, Form(ge=0, le=2000)],
    pm10: Annotated[float, Form(ge=0, le=2000)],
    temperature: Annotated[float, Form(ge=-50, le=70)],
    humidity: Annotated[float, Form(ge=0, le=100)],
    season: Annotated[str, Form()],
    day_or_night: Annotated[str, Form()],
):
    try:
        for image in (front_image, rear_image):
            if image.content_type not in ALLOWED_TYPES:
                raise HTTPException(status_code=415, detail="Both inputs must be JPG, PNG, or WebP images.")
        front_raw = await front_image.read(MAX_IMAGE_BYTES + 1)
        rear_raw = await rear_image.read(MAX_IMAGE_BYTES + 1)
        if len(front_raw) > MAX_IMAGE_BYTES or len(rear_raw) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Each image must be 8 MB or smaller.")
        if not front_raw or not rear_raw:
            raise HTTPException(status_code=400, detail="Capture or upload both a front and rear road image.")
        if len(front_raw) + len(rear_raw) > TOTAL_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="The combined image payload is too large.")
        return await run_in_threadpool(
            analyze, front_raw, rear_raw,
            pm25=pm25, pm10=pm10, temperature=temperature, humidity=humidity,
            season=season, day_or_night=day_or_night,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="AQI model files are unavailable on this server.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="AQI model inference failed. Retry or inspect the sample preview.") from exc
    finally:
        await front_image.close()
        await rear_image.close()
