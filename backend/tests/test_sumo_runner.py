from pathlib import Path
import xml.etree.ElementTree as ET

from app.services.sumo_runner import NETWORK_FILE, _write_adaptive_network, _write_trips, runtime_status


def test_bundled_network_can_generate_deterministic_synthetic_demand(tmp_path):
    first = tmp_path / "one.trips.xml"
    second = tmp_path / "two.trips.xml"
    assert _write_trips(NETWORK_FILE, first, seed=5, num_trips=24, last_depart=30) == 24
    assert _write_trips(NETWORK_FILE, second, seed=5, num_trips=24, last_depart=30) == 24
    assert first.read_bytes() == second.read_bytes()
    root = ET.parse(first).getroot()
    trips = root.findall("trip")
    assert len(trips) == 24
    assert all(item.get("from") and item.get("to") and item.get("from") != item.get("to") for item in trips)


def test_adaptive_sumo_network_changes_green_split_without_changing_green_budget(tmp_path):
    target = tmp_path / "adaptive.net.xml"
    phases = [
        {"name": "North South Through", "movement": "north_south_through", "green_seconds": 50},
        {"name": "North South Turn", "movement": "north_south_turn", "green_seconds": 20},
        {"name": "East West Through", "movement": "east_west_through", "green_seconds": 10},
        {"name": "East West Turn", "movement": "east_west_turn", "green_seconds": 5},
    ]
    summary = _write_adaptive_network(NETWORK_FILE, target, phases)
    original = {logic.get("id"): logic for logic in ET.parse(NETWORK_FILE).getroot().findall("tlLogic")}
    updated = {logic.get("id"): logic for logic in ET.parse(target).getroot().findall("tlLogic")}
    assert summary["traffic_light_programs_modified"] == 16
    assert summary["programs_retained"] == 16
    changed_green = 0
    for logic_id, baseline_logic in original.items():
        def green_values(logic):
            return [int(float(phase.get("duration", "0"))) for phase in logic.findall("phase") if any(c in (phase.get("state") or "") for c in "Gg") and not any(c in (phase.get("state") or "") for c in "yY")]
        before = green_values(baseline_logic)
        after = green_values(updated[logic_id])
        if len(before) >= 2:
            assert sum(before) == sum(after)
            if before != after:
                changed_green += 1
        else:
            assert before == after
    assert changed_green == 16


def test_sumo_status_is_explicit_about_runtime_requirements():
    status = runtime_status()
    assert isinstance(status["available"], bool)
    assert isinstance(status["missing"], list)
    assert "network_available" in status
