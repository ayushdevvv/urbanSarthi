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
    return Path(os.getenv("TRAFFIC_MODEL_PATH", str(DEFAULT_MODEL_PATH))).expanduser()


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
        "input_modes": ["image upload", "sampled video upload", "browser camera snapshot", "browser-compatible CCTV feed"],
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


def analyze_video_file(raw: bytes, confidence: float = 0.25, sample_frames: int = 18) -> dict[str, Any]:
    """Run the configured YOLO model on a bounded set of frames from a submitted video."""
    import tempfile
    import cv2

    temporary_path = None
    capture = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".video", delete=False) as handle:
            handle.write(raw)
            temporary_path = handle.name
        capture = cv2.VideoCapture(temporary_path)
        if not capture.isOpened():
            raise ValueError("This video could not be opened. Try an MP4 or WebM file encoded with a browser-friendly codec.")
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        if frame_count <= 0 or width <= 0 or height <= 0:
            raise ValueError("The uploaded video has no readable frames.")
        sample_count = max(1, min(int(sample_frames), frame_count))
        indices = sorted(set(int(round(i * (frame_count - 1) / max(sample_count - 1, 1))) for i in range(sample_count)))
        model = _load_model()
        names = model.names
        if isinstance(names, list):
            names = {i: name for i, name in enumerate(names)}
        totals = {"car": 0, "bus": 0, "motorbike": 0, "bicycle": 0}
        frames = []
        peak = 0
        annotated_b64 = None
        frame_step = frame_count / max(fps, 1) / max(len(indices), 1)
        for sample_idx, frame_index in enumerate(indices):
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, bgr = capture.read()
            if not ok:
                continue
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            image = Image.fromarray(rgb)
            image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
            predictions = model.predict(source=image, imgsz=640, conf=confidence, verbose=False)
            if not predictions:
                continue
            result = predictions[0]
            frame_counts = {key: 0 for key in totals}
            detections = 0
            boxes = getattr(result, "boxes", None)
            if boxes is not None:
                for box in boxes:
                    class_id = int(box.cls.item())
                    class_name = str(names.get(class_id, class_id)).strip().lower()
                    normalized = VEHICLE_ALIASES.get(class_name)
                    detections += 1
                    if normalized:
                        frame_counts[normalized] += 1
            for key in totals:
                totals[key] += frame_counts[key]
            visible = sum(frame_counts.values())
            peak = max(peak, visible)
            frames.append({
                "sample": sample_idx + 1, "frame": frame_index,
                "timestamp_seconds": round(frame_index / fps, 2) if fps > 0 else None,
                "vehicle_counts": frame_counts, "vehicles": visible, "objects": detections,
            })
            if sample_idx == len(indices) - 1 or annotated_b64 is None:
                plotted = result.plot()
                annotated = Image.fromarray(plotted[:, :, ::-1])
                annotated.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
                buffer = io.BytesIO()
                annotated.save(buffer, format="JPEG", quality=78, optimize=True)
                annotated_b64 = base64.b64encode(buffer.getvalue()).decode("ascii")
        if not frames:
            raise ValueError("The model did not return usable frames. Try a different clip.")
        avg = {key: round(totals[key] / len(frames), 1) for key in totals}
        mean_vehicles = sum(f["vehicles"] for f in frames) / len(frames)
        level = "Low" if mean_vehicles <= 3 else "Medium" if mean_vehicles <= 8 else "High"
        third = max(1, len(frames) // 3)
        early_mean = sum(f["vehicles"] for f in frames[:third]) / len(frames[:third])
        late_mean = sum(f["vehicles"] for f in frames[-third:]) / len(frames[-third:])
        trend_change = round((late_mean - early_mean) / max(early_mean, 1) * 100, 1)
        trend_direction = "rising" if trend_change >= 15 else "falling" if trend_change <= -15 else "stable"
        return {
            "mode": "video_model", "model": "YOLO11", "video": {
                "width": width, "height": height, "fps": round(fps, 2) if fps > 0 else None,
                "duration_seconds": round(frame_count / fps, 2) if fps > 0 else None,
                "source_frames": frame_count, "sampled_frames": len(frames),
            },
            "counts": avg, "total_vehicles": round(mean_vehicles, 1), "peak_vehicles_in_sample": peak,
            "total_detections": sum(f["objects"] for f in frames), "congestion_estimate": level,
            "congestion_note": "Frame-sampled YOLO counts. The clip is sampled at intervals; this is not a continuous vehicle-track count, calibrated queue length, or live traffic-flow measurement.",
            "confidence_threshold": confidence, "frames": frames, "annotated_image": annotated_b64,
            "short_clip_trend": {"direction": trend_direction, "change_percent": trend_change,
                "early_sample_mean_vehicles": round(early_mean, 1), "late_sample_mean_vehicles": round(late_mean, 1),
                "note": "Exploratory comparison of early and late sampled frames. It is not a validated future forecast or continuous vehicle tracking."},
        }
    finally:
        if capture is not None:
            capture.release()
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass
