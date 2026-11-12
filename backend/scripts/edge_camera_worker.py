"""RTSP camera edge worker that posts measured YOLO snapshots to UrbanSaarthi.

Run this on an authorized camera-network machine, not in a public web dyno:
  python scripts/edge_camera_worker.py \
    --rtsp-url "$CAMERA_RTSP_URL" --junction-id JUNC-001 \
    --source-id camera-junc-001 --api-url https://api.example.com/api/v1

Secrets are provided through environment variables and never written to disk.
"""
from __future__ import annotations

import argparse
import os
import signal
import time
from datetime import datetime, timezone
from typing import Any

import cv2
import requests
from ultralytics import YOLO

RUNNING = True
VEHICLE_ALIASES = {
    "car": "car", "bus": "bus", "motorbike": "motorbike",
    "motorcycle": "motorbike", "bicycle": "bicycle", "bike": "motorbike", "truck": "truck",
}


def stop_worker(*_args):
    global RUNNING
    RUNNING = False


def post_json(session: requests.Session, url: str, payload: dict[str, Any], timeout: int = 10):
    response = session.post(url, json=payload, timeout=timeout)
    response.raise_for_status()
    return response.json()


def main():
    parser = argparse.ArgumentParser(description="Stream YOLO vehicle evidence from an authorized RTSP camera")
    parser.add_argument("--rtsp-url", default=os.getenv("CAMERA_RTSP_URL", ""))
    parser.add_argument("--junction-id", required=True, help="Registered UrbanSaarthi Junction.external_id")
    parser.add_argument("--source-id", required=True, help="Registered DataSource.external_id")
    parser.add_argument("--api-url", default=os.getenv("URBANSAARTHI_API_URL", "http://127.0.0.1:8000/api/v1"))
    parser.add_argument("--camera-id", default=os.getenv("CAMERA_ID", "camera-edge-01"))
    parser.add_argument("--model", default=os.getenv("TRAFFIC_MODEL_PATH", "models/best.pt"))
    parser.add_argument("--sample-seconds", type=float, default=5.0)
    parser.add_argument("--confidence", type=float, default=0.3)
    parser.add_argument("--device", default=os.getenv("YOLO_DEVICE", ""), help="Optional cpu, 0, or CUDA device selector")
    args = parser.parse_args()

    if not args.rtsp_url:
        parser.error("Set CAMERA_RTSP_URL or pass --rtsp-url. Do not commit credentials in this argument or source code.")
    api_key = os.getenv("INGESTION_API_KEY", "").strip()
    if len(api_key) < 32:
        parser.error("INGESTION_API_KEY must be configured with the same high-entropy key as the backend.")
    if args.sample_seconds < 1 or args.sample_seconds > 60:
        parser.error("--sample-seconds must be between 1 and 60.")

    signal.signal(signal.SIGINT, stop_worker)
    signal.signal(signal.SIGTERM, stop_worker)
    base = args.api_url.rstrip("/")
    session = requests.Session()
    session.headers.update({"X-Ingestion-Key": api_key, "Accept": "application/json"})
    print(f"Loading YOLO model: {args.model}")
    model = YOLO(args.model)
    print(f"Connecting camera {args.camera_id} -> {args.junction_id}")

    last_heartbeat = 0.0
    while RUNNING:
        capture = cv2.VideoCapture(args.rtsp_url, cv2.CAP_FFMPEG)
        if not capture.isOpened():
            print("Camera stream unavailable; retrying in 5 seconds.")
            capture.release()
            time.sleep(5)
            continue
        # Reduce stale-frame backlog when the FFmpeg backend supports this hint.
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        while RUNNING:
            started = time.monotonic()
            ok, frame = capture.read()
            if not ok or frame is None:
                print("Camera frame read failed; reconnecting.")
                break
            kwargs = {"source": frame, "conf": args.confidence, "imgsz": 640, "verbose": False}
            if args.device:
                kwargs["device"] = args.device
            results = model.predict(**kwargs)
            counts = {"car": 0, "bus": 0, "motorbike": 0, "bicycle": 0, "truck": 0}
            detected = 0
            confidences = []
            if results:
                names = model.names
                if isinstance(names, list):
                    names = {index: name for index, name in enumerate(names)}
                boxes = getattr(results[0], "boxes", None)
                if boxes is not None:
                    for box in boxes:
                        cls_id = int(box.cls.item())
                        class_name = str(names.get(cls_id, cls_id)).strip().lower()
                        normalized = VEHICLE_ALIASES.get(class_name)
                        if normalized:
                            counts[normalized] += 1
                        detected += 1
                        confidences.append(float(box.conf.item()))
            event = {
                "external_junction_id": args.junction_id,
                "source": f"camera:{args.camera_id}"[:80],
                "observed_at": datetime.now(timezone.utc).isoformat(),
                "vehicle_count": sum(counts.values()),
                "queue_length_m": None,
                "average_speed_kmph": None,
                "average_wait_seconds": None,
                "lane_density": None,
                "congestion_score": None,
                "lane_demand": {},
                "detection_summary": {
                    "camera_id": args.camera_id,
                    "model": "YOLO edge inference",
                    "confidence_threshold": args.confidence,
                    "counts": counts,
                    "total_detections": detected,
                    "mean_confidence": round(sum(confidences) / len(confidences), 4) if confidences else None,
                    "frame_width": int(frame.shape[1]),
                    "frame_height": int(frame.shape[0]),
                    "measurement_kind": "single_sampled_frame_vehicle_count",
                    "calibrated_queue_or_speed": False,
                },
            }
            try:
                post_json(session, f"{base}/ingestion/vision-events", event)
                if time.monotonic() - last_heartbeat >= 30:
                    post_json(session, f"{base}/ingestion/source-heartbeat", {"external_id": args.source_id, "device": args.camera_id})
                    last_heartbeat = time.monotonic()
                print(f"{datetime.now().isoformat(timespec='seconds')} vehicles={event['vehicle_count']} source={args.camera_id}")
            except requests.RequestException as exc:
                print(f"Ingestion failed: {type(exc).__name__}. Will retry on the next sample.")
            elapsed = time.monotonic() - started
            time.sleep(max(0, args.sample_seconds - elapsed))
        capture.release()
        if RUNNING:
            time.sleep(2)
    session.close()
    print("Camera worker stopped.")


if __name__ == "__main__":
    main()
