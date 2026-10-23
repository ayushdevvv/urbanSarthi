from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from app.services.traffic_detection import analyze_image, analyze_video_file, status

router = APIRouter(prefix="/traffic-detection", tags=["Traffic AI"])
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_VIDEO_BYTES = 100 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
VIDEO_TYPES = {"video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "application/octet-stream"}


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
        raise HTTPException(status_code=503, detail="Traffic model inference is unavailable. Retry after confirming the model dependencies and weights are installed.") from exc


@router.post("/analyze-video")
async def analyze_traffic_video(
    file: UploadFile = File(...),
    confidence: float = Query(default=0.25, ge=0.05, le=0.9),
    sample_frames: int = Query(default=18, ge=4, le=36),
):
    """Sample a video and run YOLO on selected frames; the upload is processed in memory/temp storage and then discarded."""
    content_type = (file.content_type or "application/octet-stream").lower()
    if content_type not in VIDEO_TYPES and not (file.filename or "").lower().endswith((".mp4", ".webm", ".mov", ".avi", ".m4v")):
        raise HTTPException(status_code=415, detail="Upload an MP4, WebM, MOV or AVI video.")
    raw = await file.read(MAX_VIDEO_BYTES + 1)
    await file.close()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded video is empty.")
    if len(raw) > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="Video is larger than 100 MB. Choose a smaller clip.")
    try:
        return analyze_video_file(raw, confidence=confidence, sample_frames=sample_frames)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Traffic model weights are unavailable on this server.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Video inference is unavailable. Confirm the video codec and YOLO dependencies, then retry.") from exc
