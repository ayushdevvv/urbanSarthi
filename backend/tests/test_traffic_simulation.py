from app.services.traffic_simulation import get_xgboost_signal_scenario


def test_xgboost_signal_experiment_returns_network_forecast_and_responds_to_timing():
    result = get_xgboost_signal_scenario(
        north_south_green_seconds=60,
        east_west_green_seconds=30,
        yellow_seconds=3,
        all_red_seconds=1,
        demand_multiplier=1.2,
        name="Test signal split",
    )

    assert result["mode"] == "xgboost_model_scenario"
    assert result["duration_minutes"] == 60
    assert len(result["timeline"]) == 13
    assert len(result["baseline_timeline"]) == 13
    assert len(result["timeline"][0]["roads"]) == 80
    assert len(result["network_geometry"]["roads"]) == 80
    assert result["experiment"]["signal_timings"]["north_south_green_seconds"] == 60
    assert result["experiment"]["signal_timings"]["east_west_green_seconds"] == 30
    assert result["traffic_comparison"]["queue_at_60m"]["proposed"] != result["traffic_comparison"]["queue_at_60m"]["baseline"]
    assert any("not a native SUMO run" in note for note in result["notes"])
    assert all("vehicle_positions" not in frame for frame in result["timeline"])
