"""Lazy YOLO11 inference service for the supplied UrbanSaarthi traffic model."""
from __future__ import annotations

import base64
import io
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "best.pt"
MAX_IMAGE_SIDE = 1600
VEHICLE_ALIASES = {
    "car": "car",
    "bus": "bus",
    "motorbike": "motorbike",
    "motorcycle": "motorbike",
    "bicycle": "bicycle",
    "bike": "motorbike",
}


def model_path() -> Path:
    env_override = os.getenv("TRAFFIC_MODEL_PATH", "").strip()
    try:
        from app.core.config import settings
        configured = settings.traffic_model_path.strip()
    except Exception:
        configured = ""
    return Path(env_override or configured or str(DEFAULT_MODEL_PATH)).expanduser()


@lru_cache(maxsize=1)
def _load_model() -> Any:
    path = model_path()
    if not path.is_file():
        raise FileNotFoundError(
            f"Traffic model weights were not found at {path}. Set TRAFFIC_MODEL_PATH or include backend/models/best.pt."
        )
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError("Traffic inference dependencies are missing. Install backend/requirements.txt.") from exc
    return YOLO(str(path))


def status() -> dict[str, Any]:
    path = model_path()
    installed = False
    try:
        from importlib.util import find_spec
        installed = find_spec("ultralytics") is not None
    except (ImportError, ValueError):
        pass
    return {
        "model": "YOLO11 traffic detector",
        "weights_present": path.is_file(),
        "inference_dependency_available": installed,
        "ready": path.is_file() and installed,
        "model_file": path.name if path.is_file() else None,
        "input_modes": ["image upload", "browser camera snapshot"],
        "classes_counted_as_vehicles": ["car", "bus", "motorbike", "bicycle"],
        "note": "Congestion level is a preliminary vehicle-count heuristic, not a validated measure of real-world traffic flow.",
    }


def analyze_image(raw: bytes, confidence: float = 0.25) -> dict[str, Any]:
    try:
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.load()
    except Exception as exc:
        raise ValueError("This image could not be decoded. Please try a JPG, PNG, or WebP image.") from exc

    original_size = image.size
    image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
    model = _load_model()
    results = model.predict(source=image, imgsz=640, conf=confidence, verbose=False)
    if not results:
        raise RuntimeError("The model returned no inference result. Please try another image.")

    result = results[0]
    names = model.names
    if isinstance(names, list):
        names = {i: name for i, name in enumerate(names)}
    counts = {"car": 0, "bus": 0, "motorbike": 0, "bicycle": 0}
    detections = []
    boxes = getattr(result, "boxes", None)
    if boxes is not None:
        for box in boxes:
            class_id = int(box.cls.item())
            class_name = str(names.get(class_id, class_id)).strip().lower()
            normalized = VEHICLE_ALIASES.get(class_name)
            xyxy = [round(float(v), 1) for v in box.xyxy[0].tolist()]
            confidence_value = round(float(box.conf.item()), 4)
            if normalized:
                counts[normalized] += 1
            detections.append({
                "class_name": class_name,
                "vehicle_type": normalized,
                "confidence": confidence_value,
                "box": xyxy,
            })

    total = sum(counts.values())
    # Preserve the thresholds used in the supplied notebook. They are explicitly preliminary.
    level = "Low" if total <= 3 else "Medium" if total <= 8 else "High"
    plotted = result.plot()  # Ultralytics returns a BGR NumPy image.
    annotated = Image.fromarray(plotted[:, :, ::-1])
    annotated.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    annotated.save(buffer, format="JPEG", quality=82, optimize=True)

    return {
        "mode": "model",
        "model": "YOLO11",
        "image_size": {"width": original_size[0], "height": original_size[1]},
        "counts": counts,
        "total_vehicles": total,
        "total_detections": len(detections),
        "congestion_estimate": level,
        "congestion_note": "Preliminary image-count heuristic from the supplied notebook; not a validated live congestion measurement.",
        "confidence_threshold": confidence,
        "detections": detections,
        "annotated_image": base64.b64encode(buffer.getvalue()).decode("ascii"),
    }
