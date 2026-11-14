"""OpenCV + YOLO video analytics for uploaded traffic footage.

The endpoint samples decoded frames to bound CPU cost, then uses Ultralytics tracking
when IDs are available. The output is an evidence report, not a calibrated lane model.
"""
from __future__ import annotations

import base64
import os
import tempfile
from contextlib import suppress
from collections import defaultdict
from pathlib import Path
from typing import Any

from app.services.traffic_detection import _load_model, VEHICLE_ALIASES
from app.services.traffic_calibration import normalize_rois, point_in_polygon

MAX_VIDEO_SECONDS = 600
MAX_SAMPLED_FRAMES = 180
MAX_SIDE = 1280


def video_status() -> dict[str, Any]:
    """Report actual import/runtime health instead of only checking package metadata."""
    opencv_available = False
    opencv_version = None
    opencv_ffmpeg_enabled = False
    opencv_note = None
    try:
        import cv2
        opencv_available = True
        opencv_version = getattr(cv2, "__version__", None)
        with suppress(Exception):
            build_info = cv2.getBuildInformation()
            opencv_ffmpeg_enabled = "FFMPEG:                      YES" in build_info or "FFMPEG: YES" in build_info
    except Exception as exc:
        opencv_note = f"OpenCV could not be imported ({type(exc).__name__})."

    ffmpeg_fallback_available = False
    try:
        from importlib.util import find_spec
        ffmpeg_fallback_available = find_spec("imageio_ffmpeg") is not None
    except (ImportError, ValueError):
        pass

    model_status = __import__("app.services.traffic_detection", fromlist=["status"]).status()
    try:
        from app.services.sumo_runner import sumo_binary
        native_sumo_path = sumo_binary()
    except Exception:
        native_sumo_path = None
    from app.core.config import settings
    from app.services.traffic_simulation import BASE as simulation_base
    try:
        from importlib.util import find_spec
        xgboost_available = find_spec("xgboost") is not None
    except (ImportError, ValueError):
        xgboost_available = False
    forecast_artifacts_present = all((simulation_base / "models" / name).is_file() for name in ("queue_model.json", "queue_model_60min.json", "metrics.json", "metrics_60min.json", "edge_mean.json")) and (simulation_base / "data" / "raw.csv").is_file()
    agent_packages_available = all(find_spec(name) is not None for name in ("langgraph", "langchain_core", "langchain_groq"))
    if not model_status.get("weights_present"):
        readiness_note = "YOLO traffic weights are missing. Restore backend/models/best.pt or set TRAFFIC_MODEL_PATH."
    elif not model_status.get("inference_dependency_available"):
        readiness_note = "Ultralytics is not installed. Install backend/requirements.txt and restart the API."
    elif not opencv_available:
        readiness_note = opencv_note or "OpenCV is not installed or could not be imported."
    elif not (opencv_ffmpeg_enabled or ffmpeg_fallback_available):
        readiness_note = "OpenCV is installed but no supported video decoder was detected. Install imageio-ffmpeg."
    else:
        readiness_note = "YOLO, OpenCV and a video decoder are ready."
    return {
        **model_status,
        "opencv_available": opencv_available,
        "opencv_version": opencv_version,
        "opencv_ffmpeg_enabled": opencv_ffmpeg_enabled,
        "ffmpeg_fallback_available": ffmpeg_fallback_available,
        "decoder_ready": opencv_available or ffmpeg_fallback_available,
        "opencv_note": opencv_note,
        "readiness_note": readiness_note,
        "native_sumo_available": bool(native_sumo_path),
        "native_sumo_binary": Path(native_sumo_path).name if native_sumo_path else None,
        "forecast_artifacts_present": forecast_artifacts_present,
        "forecast_ready": bool(forecast_artifacts_present and xgboost_available) or bool(native_sumo_path),
        "agent_tools_ready": True,
        "llm_tool_calling_ready": bool(agent_packages_available and settings.groq_api_key.strip() or agent_packages_available and os.getenv("GROQ_API_KEY", "").strip()),
        "video_analysis_ready": bool(model_status.get("ready") and opencv_available and (opencv_ffmpeg_enabled or ffmpeg_fallback_available)),
        "video_max_seconds": MAX_VIDEO_SECONDS,
        "video_max_sampled_frames": MAX_SAMPLED_FRAMES,
        "video_sampling_note": "Frames are sampled from the uploaded clip. Results represent the sampled segment, not continuous live CCTV monitoring.",
        "note": readiness_note,
    }


def _open_video_reader(cv2: Any, path: Path):
    """Open a clip with OpenCV first, then fall back to bundled FFmpeg decoding.

    Some phone-recorded MOV/MP4/WebM clips are accepted by the browser but fail
    OpenCV's VideoCapture codec path on cloud Linux builds. The fallback still
    feeds decoded BGR frames through the same OpenCV resize/YOLO pipeline.
    """
    capture = cv2.VideoCapture(str(path))
    if capture.isOpened():
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
        total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        first_ok, first_frame = capture.read()
        if first_ok and first_frame is not None:
            pending = [first_frame]

            def read_next():
                if pending:
                    return True, pending.pop()
                return capture.read()

            duration = (total_frames / fps) if fps > 0 and total_frames > 0 else 0
            return read_next, capture.release, fps, total_frames, width, height, duration, "opencv"
        capture.release()

    # `imageio-ffmpeg` ships a portable FFmpeg executable with its wheel. It is
    # a decoder fallback only; detection and annotation still use OpenCV + YOLO.
    try:
        import numpy as np
        import imageio_ffmpeg
        reader = imageio_ffmpeg.read_frames(str(path), pix_fmt="bgr24")
        metadata = next(reader)
        width, height = [int(value) for value in metadata.get("size", (0, 0))]
        fps = float(metadata.get("fps") or 0)
        duration = float(metadata.get("duration") or 0)
        total_frames = int(round(duration * fps)) if duration > 0 and fps > 0 else 0
        if width <= 0 or height <= 0:
            reader.close()
            raise ValueError("FFmpeg could not read the video dimensions.")

        def read_ffmpeg_frame():
            try:
                payload = next(reader)
            except StopIteration:
                return False, None
            frame = np.frombuffer(payload, dtype=np.uint8)
            expected = width * height * 3
            if frame.size != expected:
                return False, None
            return True, frame.reshape((height, width, 3)).copy()

        return read_ffmpeg_frame, reader.close, fps, total_frames, width, height, duration, "ffmpeg_fallback"
    except Exception as exc:
        raise ValueError(
            "This video could not be decoded by OpenCV. Export it as MP4 (H.264) and retry. "
            "The server's FFmpeg fallback is unavailable or could not decode this file."
        ) from exc


def analyze_video(raw: bytes, filename: str, confidence: float = 0.25, sample_every_seconds: int = 1, approach_rois: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OpenCV is not installed. Install backend/requirements-vision.txt to enable video analysis.") from exc
    if not raw:
        raise ValueError("The uploaded video is empty.")
    suffix = Path(filename or "traffic.mp4").suffix.lower()
    if suffix not in {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}:
        suffix = ".mp4"
    if not 1 <= int(sample_every_seconds) <= 5:
        raise ValueError("Sampling interval must be between 1 and 5 seconds.")
    rois = normalize_rois(approach_rois)

    with tempfile.TemporaryDirectory(prefix="urbansarthi-video-") as temp_dir:
        path = Path(temp_dir) / f"upload{suffix}"
        path.write_bytes(raw)
        read_frame, close_reader, fps, total_frames, width, height, duration, decoder_backend = _open_video_reader(cv2, path)
        if duration and duration > MAX_VIDEO_SECONDS:
            close_reader()
            raise ValueError(f"Video is {duration / 60:.1f} minutes long. The current limit is 10 minutes.")

        effective_interval = max(int(sample_every_seconds), int((duration or 1) / MAX_SAMPLED_FRAMES) + 1)
        try:
            model = _load_model()
        except Exception:
            close_reader()
            raise
        names = model.names
        if isinstance(names, list):
            names = {index: name for index, name in enumerate(names)}

        per_class_tracks: dict[str, set[int]] = defaultdict(set)
        peak_frame = None
        peak_vehicles = -1
        peak_counts_summary: dict[str, int] = {key: 0 for key in ("car", "bus", "motorbike", "bicycle", "truck")}
        peak_detections: list[dict[str, Any]] = []
        analyzed_frames = 0
        frame_index = 0
        last_sample_frame = -1
        frame_counts: list[int] = []
        timeline: list[dict[str, Any]] = []  # sampled-frame series used by the report chart
        tracking_ids_seen = False
        approach_track_ids: dict[str, set[int]] = {roi["id"]: set() for roi in rois}
        approach_track_class_ids: dict[str, dict[str, set[int]]] = {
            roi["id"]: {key: set() for key in ("car", "bus", "motorbike", "bicycle", "truck")} for roi in rois
        }
        approach_peak_counts: dict[str, dict[str, int]] = {
            roi["id"]: {key: 0 for key in ("car", "bus", "motorbike", "bicycle", "truck")} for roi in rois
        }
        approach_peak_totals: dict[str, int] = {roi["id"]: 0 for roi in rois}

        while True:
            ok, frame = read_frame()
            if not ok:
                break
            if fps > 0:
                timestamp_seconds = frame_index / fps
                should_sample = timestamp_seconds + 1e-6 >= (last_sample_frame / fps if last_sample_frame >= 0 else 0) + effective_interval
                # Always sample the first readable frame.
                should_sample = should_sample or (frame_index == 0 and analyzed_frames == 0)
            else:
                timestamp_seconds = float(frame_index)
                should_sample = frame_index % max(1, effective_interval) == 0
            if should_sample and analyzed_frames < MAX_SAMPLED_FRAMES:
                last_sample_frame = frame_index
                scale = min(1.0, MAX_SIDE / max(frame.shape[1], frame.shape[0], 1))
                if scale < 1:
                    frame = cv2.resize(frame, (int(frame.shape[1] * scale), int(frame.shape[0] * scale)), interpolation=cv2.INTER_AREA)
                try:
                    predicted = model.track(frame, persist=True, tracker="bytetrack.yaml", imgsz=640, conf=confidence, verbose=False)
                except Exception:
                    # Inference is still real YOLO; this fallback only disables the tracker config if unsupported.
                    predicted = model.predict(frame, imgsz=640, conf=confidence, verbose=False)
                if not predicted:
                    frame_index += 1
                    continue
                result = predicted[0]
                counts = {"car": 0, "bus": 0, "motorbike": 0, "bicycle": 0, "truck": 0}
                detections = []
                roi_frame_counts = {roi["id"]: {key: 0 for key in ("car", "bus", "motorbike", "bicycle", "truck")} for roi in rois}
                boxes = getattr(result, "boxes", None)
                if boxes is not None:
                    ids = getattr(boxes, "id", None)
                    id_values = ids.tolist() if ids is not None else None
                    if id_values is not None:
                        tracking_ids_seen = True
                    for idx, box in enumerate(boxes):
                        class_id = int(box.cls.item())
                        class_name = str(names.get(class_id, class_id)).strip().lower()
                        normalized = VEHICLE_ALIASES.get(class_name)
                        if class_name == "truck":
                            normalized = "truck"
                        confidence_value = round(float(box.conf.item()), 4)
                        coordinates = [round(float(value), 1) for value in box.xyxy[0].tolist()]
                        track_id = int(id_values[idx]) if id_values is not None and idx < len(id_values) and id_values[idx] is not None else None
                        if normalized:
                            counts[normalized] += 1
                            if track_id is not None:
                                per_class_tracks[normalized].add(track_id)
                            if rois and len(coordinates) == 4:
                                center_x = ((coordinates[0] + coordinates[2]) / 2) / max(frame.shape[1], 1)
                                center_y = ((coordinates[1] + coordinates[3]) / 2) / max(frame.shape[0], 1)
                                for roi in rois:
                                    if point_in_polygon(center_x, center_y, roi["polygon"]):
                                        roi_frame_counts[roi["id"]][normalized] += 1
                                        if track_id is not None:
                                            approach_track_ids[roi["id"]].add(track_id)
                                            approach_track_class_ids[roi["id"]][normalized].add(track_id)
                                        break
                        detections.append({"class_name": class_name, "vehicle_type": normalized, "confidence": confidence_value, "track_id": track_id, "box": coordinates})
                for roi in rois:
                    roi_id = roi["id"]
                    frame_counts_for_roi = roi_frame_counts[roi_id]
                    frame_total = sum(frame_counts_for_roi.values())
                    if frame_total > approach_peak_totals[roi_id]:
                        approach_peak_totals[roi_id] = frame_total
                        approach_peak_counts[roi_id] = dict(frame_counts_for_roi)
                vehicle_count = sum(counts.values())
                frame_counts.append(vehicle_count)
                timeline.append({"second": round(timestamp_seconds, 1), "vehicles_in_frame": vehicle_count, "counts": counts})
                analyzed_frames += 1
                if vehicle_count > peak_vehicles:
                    peak_vehicles = vehicle_count
                    peak_counts_summary = dict(counts)
                    peak_frame = result.plot()  # BGR frame with detector annotations
                    peak_detections = detections[:100]
            frame_index += 1
        close_reader()

        if analyzed_frames == 0:
            raise ValueError("No frames could be sampled from the video. Try a different clip.")

        counts_summary = {key: len(per_class_tracks.get(key, set())) for key in ["car", "bus", "motorbike", "bicycle", "truck"]}
        if not tracking_ids_seen:
            # Use the exact class counts from the single busiest sampled frame. Summing each
            # class's independent maximum would combine detections from different moments.
            counts_summary = dict(peak_counts_summary)
        unique_vehicles = int(sum(counts_summary.values()))
        mean_vehicles = round(sum(frame_counts) / max(len(frame_counts), 1), 2)
        peak_vehicles = max(peak_vehicles, 0)
        congestion = "Low" if mean_vehicles < 4 else "Moderate" if mean_vehicles < 10 else "High"
        annotated_base64 = None
        if peak_frame is not None:
            # JPEG encoding keeps API response size manageable and avoids persisting uploaded footage.
            ok, encoded = cv2.imencode(".jpg", peak_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
            if ok:
                annotated_base64 = base64.b64encode(encoded.tobytes()).decode("ascii")

        # Keep the chart responsive for clips sampled at the one-second interval.
        chart_stride = max(1, len(timeline) // 45)
        chart_timeline = timeline[::chart_stride]
        if chart_timeline[-1] is not timeline[-1]:
            chart_timeline.append(timeline[-1])
        approach_demand: dict[str, Any] = {}
        for roi in rois:
            roi_id = roi["id"]
            if tracking_ids_seen:
                class_counts = {key: len(ids) for key, ids in approach_track_class_ids[roi_id].items()}
                total_count = len(approach_track_ids[roi_id])
                count_method = "unique_tracked_ids_inside_roi"
            else:
                class_counts = dict(approach_peak_counts[roi_id])
                total_count = sum(class_counts.values())
                count_method = "peak_simultaneous_detections_inside_roi"
            approach_demand[roi_id] = {
                "name": roi["name"], "count": total_count, "counts": class_counts,
                "count_method": count_method, "calibration_source": "operator_defined_normalized_polygon",
            }
        return {
            "mode": "model_video",
            "model": "YOLO11 + OpenCV + ByteTrack (tracking when IDs are available)",
            "source_filename": Path(filename or "traffic-video").name,
            "video": {"width": width, "height": height, "fps": round(fps, 2) if fps else None, "duration_seconds": round(duration, 2) if duration else None, "decoded_frames": frame_index, "sampled_frames": analyzed_frames, "sampling_interval_seconds": effective_interval, "decoder": decoder_backend},
            "counts": counts_summary,
            "unique_vehicles": unique_vehicles if tracking_ids_seen else None,
            "total_vehicles": unique_vehicles,
            "peak_vehicles_in_frame": peak_vehicles,
            "mean_vehicles_per_sampled_frame": mean_vehicles,
            "congestion_estimate": congestion,
            "congestion_score_heuristic": min(100, round(mean_vehicles * 8, 1)),
            "congestion_note": "The level is a scene-count heuristic. Camera geometry, lane calibration, ground-truth queue lengths, and speed measurements are not available from this clip alone.",
            "confidence_threshold": confidence,
            "tracking_ids_available": tracking_ids_seen,
            "unique_count_method": "unique ByteTrack IDs by vehicle class" if tracking_ids_seen else "peak simultaneous class counts because tracking IDs were unavailable",
            "detections_at_peak_frame": peak_detections,
            "annotated_frame": annotated_base64,
            "timeline": chart_timeline,
            "approach_calibration": {"enabled": bool(rois), "coordinate_space": "normalized_0_to_1", "regions": rois},
            "approach_demand": approach_demand,
            "report_version": "traffic-video-report-v2",
        }
