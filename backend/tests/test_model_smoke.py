"""Actual model/service smoke tests, skipped only when required artifacts are absent."""
import io
import pytest
from PIL import Image, ImageDraw
from app.services.aqi_vision import status as aqi_status
from app.services.traffic_detection import status as traffic_status


def _jpeg(color=(120, 140, 110)):
    image = Image.new("RGB", (256, 256), color)
    draw = ImageDraw.Draw(image)
    draw.rectangle((20, 90, 235, 170), fill=(70, 75, 80))
    draw.rectangle((60, 105, 110, 150), fill=(150, 155, 160))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def test_paired_image_aqi_model_runs_through_http_api_when_available(client):
    if not aqi_status()["ready"]:
        pytest.skip("AQI model artifacts or inference dependencies are not installed")
    image = _jpeg()
    response = client.post(
        "/api/v1/aqi-vision/analyze",
        files={
            "front_image": ("front.jpg", image, "image/jpeg"),
            "rear_image": ("rear.jpg", _jpeg((100, 120, 130)), "image/jpeg"),
        },
        data={
            "pm25": "28", "pm10": "44", "temperature": "27", "humidity": "45",
            "season": "Monsoon", "day_or_night": "Day",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "model"
    assert body["predicted_category"] in {"Good", "Moderate", "Poor", "Satisfactory", "Severe", "Very Poor"}
    assert 0 <= body["confidence"] <= 100
    assert len(body["probabilities"]) == 6


def test_traffic_detector_never_fabricates_counts_when_runtime_is_missing(client):
    status = traffic_status()
    if status["ready"]:
        response = client.post(
            "/api/v1/traffic-detection/analyze?confidence=0.25",
            files={"file": ("road.jpg", _jpeg(), "image/jpeg")},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["mode"] == "model"
        assert isinstance(body["counts"], dict)
        assert set(body["counts"]) == {"car", "bus", "motorbike", "bicycle"}
    else:
        response = client.post(
            "/api/v1/traffic-detection/analyze?confidence=0.25",
            files={"file": ("road.jpg", _jpeg(), "image/jpeg")},
        )
        assert response.status_code == 503
        assert "dependencies" in response.json()["detail"].lower()
        assert "counts" not in response.json()
