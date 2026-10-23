from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from app.services.traffic_detection import analyze_image, status

router = APIRouter(prefix="/traffic-detection", tags=["Traffic AI"])
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.get("/status")
def traffic_model_status():
    return status()


@router.post("/analyze")
async def analyze_traffic_image(
    file: UploadFile = File(...),
    confidence: float = Query(default=0.25, ge=0.05, le=0.9),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG, or WebP image.")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large. Maximum upload size is 8 MB.")
    try:
        return analyze_image(raw, confidence=confidence)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Traffic model weights are unavailable on this server.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        # Don't leak filesystem paths or implementation details to public clients.
        raise HTTPException(status_code=503, detail="Traffic model inference failed. You can retry or use the sample preview.") from exc
