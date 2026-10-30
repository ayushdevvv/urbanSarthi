from app.services.emissions import estimate_from_counts, emissions_for_vehicle_km, FACTOR_VERSION
from app.services.traffic_calibration import emissions_aware_plan, normalize_rois, point_in_polygon


def test_emissions_estimate_is_pollutant_specific_and_traceable():
    result = estimate_from_counts({"car": 10, "motorbike": 4, "bus": 1, "bicycle": 2}, 0.5)
    assert result["factor_version"] == FACTOR_VERSION
    assert result["totals"]["co2_g"] > 0
    assert result["totals"]["nox_g"] > 0
    assert result["totals"]["pm_g"] > 0
    assert result["by_class"]["bicycle"]["co2_g"] == 0
    assert result["segment_distance_km"] == 0.5
    assert "not a local fleet average" in result["factor_source"]["notes"].lower()


def test_emissions_estimator_rejects_invalid_distance():
    try:
        estimate_from_counts({"car": 2}, 0)
    except ValueError as exc:
        assert "segment_distance_km" in str(exc)
    else:
        raise AssertionError("Expected invalid distance to be rejected")


def test_roi_validation_and_polygon_membership():
    rois = normalize_rois([{"id": "north_south_through", "name": "NS", "polygon": [[0, 0], [1, 0], [1, 0.5], [0, 0.5]]}])
    assert point_in_polygon(0.5, 0.25, rois[0]["polygon"])
    assert not point_in_polygon(0.5, 0.75, rois[0]["polygon"])


def test_emissions_aware_optimizer_requires_all_four_calibrated_approaches():
    fallback = emissions_aware_plan({"north_south_through": {"count": 20}}, 90)
    assert fallback["optimized"] is False
    assert sum(p["green_seconds"] + 4 for p in fallback["phases"]) == fallback["cycle_seconds"]

    demand = {
        "north_south_through": {"count": 24, "counts": {"car": 20, "truck": 4}},
        "east_west_through": {"count": 8, "counts": {"car": 8}},
        "north_south_turn": {"count": 10, "counts": {"motorbike": 10}},
        "east_west_turn": {"count": 4, "counts": {"car": 3, "bus": 1}},
    }
    plan = emissions_aware_plan(demand, 90)
    greens = [phase["green_seconds"] for phase in plan["phases"]]
    green_budget = sum(greens)
    assert plan["optimized"] is True
    assert sum(greens) + 16 == plan["cycle_seconds"]
    assert min(greens) >= 8
    assert max(greens) <= int(green_budget * 0.45)
    assert greens[0] > greens[3]


def test_emissions_for_vehicle_km_handles_empty_activity():
    result = emissions_for_vehicle_km({})
    assert result["vehicle_km"] == 0
    assert result["totals"] == {"co2_g": 0.0, "nox_g": 0.0, "pm_g": 0.0, "co_g": 0.0}


def test_video_analysis_initializes_timeline_and_reports_roi_counts(monkeypatch):
    """Exercise the real video orchestration without requiring a webcam/YOLO install."""
    import sys
    from types import SimpleNamespace
    import numpy as np

    from app.services import traffic_video

    class FakeCapture:
        def __init__(self, _path):
            self.frames = 0
            self.released = False

        def isOpened(self):
            return True

        def get(self, key):
            values = {
                1: 1.0,   # CAP_PROP_FPS
                2: 2.0,   # CAP_PROP_FRAME_COUNT
                3: 100.0, # CAP_PROP_FRAME_WIDTH
                4: 100.0, # CAP_PROP_FRAME_HEIGHT
            }
            return values.get(key, 0)

        def read(self):
            if self.frames >= 2:
                return False, None
            self.frames += 1
            return True, np.zeros((100, 100, 3), dtype=np.uint8)

        def release(self):
            self.released = True

    class Scalar:
        def __init__(self, value): self.value = value
        def item(self): return self.value

    class FakeBox:
        cls = Scalar(2)
        conf = Scalar(0.91)
        xyxy = [SimpleNamespace(tolist=lambda: [40.0, 40.0, 60.0, 60.0])]

    class FakeBoxes:
        id = None
        def __iter__(self): return iter([FakeBox()])

    class FakeResult:
        boxes = FakeBoxes()
        def plot(self): return np.zeros((100, 100, 3), dtype=np.uint8)

    class FakeModel:
        names = {2: "car"}
        def track(self, *_args, **_kwargs): return [FakeResult()]
        def predict(self, *_args, **_kwargs): return [FakeResult()]

    fake_cv2 = SimpleNamespace(
        VideoCapture=FakeCapture,
        CAP_PROP_FPS=1,
        CAP_PROP_FRAME_COUNT=2,
        CAP_PROP_FRAME_WIDTH=3,
        CAP_PROP_FRAME_HEIGHT=4,
        INTER_AREA=1,
        IMWRITE_JPEG_QUALITY=1,
        resize=lambda frame, _size, interpolation=None: frame,
        imencode=lambda *_args, **_kwargs: (True, SimpleNamespace(tobytes=lambda: b"jpeg")),
    )
    monkeypatch.setitem(sys.modules, "cv2", fake_cv2)
    monkeypatch.setattr(traffic_video, "_load_model", lambda: FakeModel())

    rois = [
        {"id": "north_south_through", "polygon": [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]},
        {"id": "east_west_through", "polygon": [[0.0, 0.0], [0.2, 0.0], [0.2, 0.2], [0.0, 0.2]]},
        {"id": "north_south_turn", "polygon": [[0.8, 0.0], [1.0, 0.0], [1.0, 0.2], [0.8, 0.2]]},
        {"id": "east_west_turn", "polygon": [[0.0, 0.8], [0.2, 0.8], [0.2, 1.0], [0.0, 1.0]]},
    ]
    result = traffic_video.analyze_video(b"not-a-real-file-but-capture-is-mocked", "sample.mp4", approach_rois=rois)

    assert result["report_version"] == "traffic-video-report-v2"
    assert len(result["timeline"]) == 2
    assert result["counts"]["car"] == 1
    assert result["approach_demand"]["north_south_through"]["counts"]["car"] == 1
    assert set(result["approach_demand"]) == {
        "north_south_through", "east_west_through", "north_south_turn", "east_west_turn"
    }


def test_air_intelligence_api_exposes_factor_catalog_and_estimator(client):
    catalog = client.get("/api/v1/air-intelligence/factors")
    assert catalog.status_code == 200
    assert catalog.json()["factor_version"] == FACTOR_VERSION

    response = client.post("/api/v1/air-intelligence/emissions/estimate", json={
        "vehicle_counts": {"car": 2, "bus": 1},
        "segment_distance_km": 1.25,
    })
    assert response.status_code == 200
    body = response.json()
    assert body["totals"]["nox_g"] > 0
    assert body["segment_distance_km"] == 1.25


def test_air_intelligence_hotspots_returns_empty_state_without_observations(client):
    response = client.get("/api/v1/air-intelligence/hotspots")
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_sumo_route_builder_preserves_video_vehicle_mix(tmp_path):
    import xml.etree.ElementTree as ET
    from app.services.sumo_runner import _write_routes

    route_file = tmp_path / "sample.rou.xml"
    mix = _write_routes(
        route_file,
        [["edge_a", "edge_b", "edge_c", "edge_d"]],
        1.0,
        report={"counts": {"car": 3, "motorbike": 1, "bus": 1}},
    )
    root = ET.parse(route_file).getroot()
    assert mix == {"car": 0.6, "motorbike": 0.2, "bus": 0.2}
    assert {item.get("id") for item in root.findall("vType")} == {"car", "motorbike", "bus"}
    assert len(root.findall("flow")) == 3


def test_sumo_signal_patch_keeps_the_candidate_cycle_duration(tmp_path):
    import xml.etree.ElementTree as ET
    from app.services.sumo_runner import NETWORK, _patch_signal_cycles

    candidate = [
        {"green_seconds": 24, "yellow_seconds": 3, "all_red_seconds": 1},
        {"green_seconds": 8, "yellow_seconds": 3, "all_red_seconds": 1},
        {"green_seconds": 20, "yellow_seconds": 3, "all_red_seconds": 1},
        {"green_seconds": 12, "yellow_seconds": 3, "all_red_seconds": 1},
    ]
    expected_cycle = sum(item["green_seconds"] + item["yellow_seconds"] + item["all_red_seconds"] for item in candidate)
    output = tmp_path / "patched.net.xml"
    _patch_signal_cycles(NETWORK, output, candidate)
    root = ET.parse(output).getroot()
    patched = root.findall("tlLogic")
    assert patched
    updated = [logic for logic in patched if len(logic.findall("phase")) >= 6]
    assert updated
    assert all(len(logic.findall("phase")) == 6 for logic in updated)
    assert all(sum(int(phase.get("duration")) for phase in logic.findall("phase")) == expected_cycle for logic in updated)
