from app.services.sumo_runner import NETWORK, _network_geometry, _read_fcd_frames


def test_bundled_sumo_network_geometry_contains_roads_and_signalized_junctions():
    geometry = _network_geometry(NETWORK)
    assert geometry["source_network"] == "grid.net.xml"
    assert len(geometry["roads"]) == 80
    assert len(geometry["junctions"]) > 0
    assert all(len(road["points"]) >= 2 for road in geometry["roads"])
    assert all(0 <= point["x"] <= 1000 and 0 <= point["y"] <= 1000
               for road in geometry["roads"] for point in road["points"])


def test_fcd_parser_returns_real_position_heading_speed_and_bounded_render_count(tmp_path):
    fcd_path = tmp_path / "sample.fcd.xml"
    vehicles = "".join(
        f'<vehicle id="veh-{i}" type="car" x="{i}" y="500" angle="90" speed="10" lane="edge_0"/>'
        for i in range(300)
    )
    fcd_path.write_text(
        '<fcd-export>'
        '<timestep time="0"><vehicle id="veh-start" type="bus" x="200" y="800" angle="180" speed="5"/></timestep>'
        f'<timestep time="30">{vehicles}</timestep>'
        '<timestep time="45"><vehicle id="not-sampled" x="10" y="10" speed="0"/></timestep>'
        '</fcd-export>',
        encoding="utf-8",
    )
    frames = _read_fcd_frames(fcd_path, _network_geometry(NETWORK), max_vehicles_per_frame=240)
    assert set(frames) == {0, 30}
    first = frames[0]["vehicles"][0]
    assert first["id"] == "veh-start"
    assert first["type"] == "bus"
    assert first["speed_kmph"] == 18.0
    assert first["angle"] == 180.0
    assert 0 <= first["map_x"] <= 1000 and 0 <= first["map_y"] <= 1000
    assert frames[30]["vehicle_count_actual"] == 300
    assert frames[30]["vehicle_count_rendered"] == 240


def test_native_vehicle_playback_does_not_fall_back_when_sumo_omits_fcd(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import pytest
    from app.services import sumo_runner

    def fake_run(command, **kwargs):
        summary_path = command[command.index('--summary-output') + 1]
        Path(summary_path).write_text(
            '<summary><step time="3600" halting="0" running="0" loaded="0" inserted="0" ended="0" meanSpeed="0" waiting="0"/></summary>',
            encoding='utf-8',
        )
        return SimpleNamespace(returncode=0, stdout='', stderr='')

    from pathlib import Path
    monkeypatch.setattr(sumo_runner.subprocess, 'run', fake_run)
    route_path = tmp_path / 'routes.rou.xml'
    route_path.write_text('<routes/>', encoding='utf-8')

    with pytest.raises(RuntimeError, match='did not produce Floating Car Data snapshots'):
        sumo_runner._run_one(
            'sumo', NETWORK, route_path, tmp_path, 'candidate', capture_fcd=True
        )


def test_sumo_binary_discovers_official_python_wheel_when_legacy_paths_are_stale(tmp_path, monkeypatch):
    import os
    import sys
    from types import SimpleNamespace
    from app.services import sumo_runner

    home = tmp_path / "eclipse-sumo"
    binary = home / "bin" / "sumo"
    binary.parent.mkdir(parents=True)
    binary.write_text("#!/bin/sh\necho SUMO test binary\n", encoding="utf-8")
    binary.chmod(0o755)

    monkeypatch.setitem(sys.modules, "sumo", SimpleNamespace(SUMO_HOME=str(home)))
    monkeypatch.setenv("SUMO_BINARY", "/usr/bin/sumo")
    monkeypatch.setenv("SUMO_HOME", "/usr/share/sumo")
    monkeypatch.setattr(sumo_runner.shutil, "which", lambda _name: None)

    assert sumo_runner.sumo_binary() == str(binary)
    assert os.environ["SUMO_HOME"] == str(home)
    assert str(home / "bin") in os.environ["PATH"].split(os.pathsep)
