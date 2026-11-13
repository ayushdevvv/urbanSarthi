from fastapi.testclient import TestClient

import app.main as main_module


def test_cloud_run_spa_routes_and_static_assets(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html><div id='root'></div></html>", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("window.appReady = true;", encoding="utf-8")
    monkeypatch.setattr(main_module, "STATIC_DIR", tmp_path)
    client = TestClient(main_module.app)

    page = client.get("/authority/traffic-lab")
    assert page.status_code == 200
    assert "id='root'" in page.text

    asset = client.get("/assets/app.js")
    assert asset.status_code == 200
    assert "appReady" in asset.text


def test_cloud_run_unknown_api_route_is_not_spa_fallback(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html>app</html>", encoding="utf-8")
    monkeypatch.setattr(main_module, "STATIC_DIR", tmp_path)
    client = TestClient(main_module.app)

    response = client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json().get("detail") == "API route not found."
