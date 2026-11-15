import pytest

from app.api.traffic import _closest_point_on_road


def test_nearby_road_projection_uses_segment_not_only_osm_vertices():
    geometry = [
        {"lat": 0.0, "lon": 0.0},
        {"lat": 0.0, "lon": 0.02},
    ]

    closest = _closest_point_on_road(0.005, 0.01, geometry)

    assert closest is not None
    distance, latitude, longitude = closest
    assert distance == pytest.approx(555.97, abs=2.0)
    assert latitude == pytest.approx(0.0, abs=1e-8)
    assert longitude == pytest.approx(0.01, abs=1e-8)


def test_nearby_road_projection_handles_single_point_geometry():
    closest = _closest_point_on_road(28.61, 77.20, [{"lat": 28.61, "lon": 77.20}])

    assert closest is not None
    distance, latitude, longitude = closest
    assert distance == pytest.approx(0.0, abs=1e-6)
    assert latitude == pytest.approx(28.61)
    assert longitude == pytest.approx(77.20)
