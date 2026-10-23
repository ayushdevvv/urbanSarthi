"""AQI model inference endpoint for paired images and sensor values."""
from typing import Annotated
from io import BytesIO

from PIL import Image

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
        raise HTTPException(status_code=503, detail="AQI model inference is unavailable. Retry after confirming the model dependencies and weights are installed.") from exc
    finally:
        await front_image.close()
        await rear_image.close()


@router.post("/predict-form")
async def predict_aqi_from_form(
    pm25: Annotated[float, Form(ge=0, le=2000)],
    pm10: Annotated[float, Form(ge=0, le=2000)],
    temperature: Annotated[float, Form(ge=-50, le=70)],
    humidity: Annotated[float, Form(ge=0, le=100)],
    season: Annotated[str, Form()],
    day_or_night: Annotated[str, Form()],
    city: Annotated[str, Form()] = "Unknown city",
    latitude: Annotated[float | None, Form()] = None,
    longitude: Annotated[float | None, Form()] = None,
):
    """Form only inference. Neutral image tensors preserve the supplied model's multimodal interface."""
    try:
        # The supplied checkpoint was trained with two images plus tabular values.
        # Use neutral placeholders rather than requesting camera images, and disclose this limitation.
        buffer = BytesIO()
        Image.new("RGB", (128, 128), (238, 241, 235)).save(buffer, format="PNG")
        neutral_image = buffer.getvalue()
        result = await run_in_threadpool(
            analyze, neutral_image, neutral_image, pm25=pm25, pm10=pm10,
            temperature=temperature, humidity=humidity, season=season, day_or_night=day_or_night,
        )
        result["location"] = {"city": city[:120], "latitude": latitude, "longitude": longitude}
        result["data_quality"] = "form_prediction_with_neutral_image_inputs"
        result["note"] = "Predicted from the supplied form fields using the trained multimodal model with neutral image placeholders. The checkpoint was trained with road images too, so this form only result is an approximation, not an official AQI measurement. Location identifies the city but is not a trained model feature."
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="AQI model files are unavailable on this server.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="AQI model inference failed.") from exc
