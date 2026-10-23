"""Regression checks for the organized domain package and model-artifact layout."""
from pathlib import Path

from app.models import AqiObservation, CityCluster, PriorityQueueItem, TransitRoute, TrafficObservation
from app.schemas import AqiObservationIn, RoutePlanIn, SignalPlanCreateIn, TrafficObservationIn
from app.services.sumo_runner import NETWORK_FILE
from app.services.traffic_detection import DEFAULT_MODEL_PATH


def test_domain_packages_keep_public_model_and_schema_imports_stable():
    assert AqiObservation.__module__ == "app.models.air_quality"
    assert CityCluster.__module__ == "app.models.traffic"
    assert TrafficObservation.__module__ == "app.models.traffic"
    assert TransitRoute.__module__ == "app.models.transit"
    assert PriorityQueueItem.__module__ == "app.models.operations"
    assert AqiObservationIn.__module__ == "app.schemas.air_quality"
    assert RoutePlanIn.__module__ == "app.schemas.mobility"
    assert TrafficObservationIn.__module__ == "app.schemas.traffic"
    assert SignalPlanCreateIn.__module__ == "app.schemas.signals"


def test_domain_model_artifacts_live_outside_the_application_source_tree():
    assert NETWORK_FILE.is_file()
    assert DEFAULT_MODEL_PATH.is_file()
    backend_models = Path(__file__).resolve().parents[1] / "models"
    assert (backend_models / "aqi" / "model_config.json").is_file()
    assert (backend_models / "traffic_forecast" / "queue_model.json").is_file()
    assert (backend_models / "traffic_forecast" / "raw.csv").is_file()
    assert (backend_models / "traffic_detection" / "best.pt").is_file()


def test_model_and_sumo_path_overrides_read_typed_settings(monkeypatch, tmp_path):
    from app.core.config import settings
    from app.services.aqi_vision import DEFAULT_MODEL_DIR, model_dir
    from app.services.sumo_runner import _find_binary
    from app.services.traffic_detection import model_path

    assert model_path() == DEFAULT_MODEL_PATH
    assert model_dir() == DEFAULT_MODEL_DIR

    custom_detector = tmp_path / "custom-detector.pt"
    custom_detector.write_bytes(b"test weights placeholder")
    monkeypatch.setattr(settings, "traffic_model_path", str(custom_detector))
    assert model_path() == custom_detector

    custom_aqi_dir = tmp_path / "aqi-model"
    custom_aqi_dir.mkdir()
    monkeypatch.setattr(settings, "aqi_model_dir", str(custom_aqi_dir))
    assert model_dir() == custom_aqi_dir

    custom_sumo = tmp_path / "sumo"
    custom_sumo.write_text("executable placeholder", encoding="utf-8")
    monkeypatch.setattr(settings, "sumo_binary", str(custom_sumo))
    assert _find_binary("sumo") == str(custom_sumo)
