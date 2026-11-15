from app.services.routing import _sort_route_options


def _route(identifier, distance, duration, preference_match=None):
    return {
        "id": identifier,
        "distance_meters": distance,
        "duration_seconds": duration,
        "estimated_co2_grams": distance * 1.5,
        "preference_match": preference_match,
    }


def test_active_preference_path_is_not_overwritten_by_generic_metric_sorting():
    generic_short = _route("generic-short", 3500, 900)
    preferred_clean = _route("clean-profile", 3900, 650, "cleanest")
    preferred_balanced = _route("balanced-profile", 4100, 620, "balanced")
    preferred_short = _route("short-profile", 3000, 820, "shortest")

    assert _sort_route_options([generic_short, preferred_clean], "cleanest")[0]["id"] == "clean-profile"
    assert _sort_route_options([generic_short, preferred_balanced], "balanced")[0]["id"] == "balanced-profile"
    assert _sort_route_options([generic_short, preferred_short], "shortest")[0]["id"] == "short-profile"
