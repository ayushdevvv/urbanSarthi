from app.api import aqi


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def test_openweather_forecast_is_limited_to_the_next_24_hours(monkeypatch):
    current_epoch = 1_800_000_000
    current_payload = {
        "list": [{
            "dt": current_epoch,
            "main": {"aqi": 3},
            "components": {"pm2_5": 24.0, "pm10": 38.0, "no2": 12.0, "o3": 20.0},
        }]
    }
    forecast_items = [
        {
            "dt": current_epoch + hours * 3600,
            "main": {"aqi": 2 if hours < 12 else 3},
            "components": {"pm2_5": 20.0 + hours, "pm10": 35.0},
        }
        for hours in range(3, 73, 3)
    ]
    forecast_payload = {"list": forecast_items}
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse(current_payload if url.endswith("/air_pollution") else forecast_payload)

    monkeypatch.setattr(aqi.settings, "weather_api_key", "test-key")
    monkeypatch.setattr(aqi.httpx, "get", fake_get)

    result = aqi.location_aqi_forecast(26.45, 80.33)

    assert result["status"] == "available"
    assert result["aqi_scale"] == "OpenWeather 1–5"
    assert len(result["forecast"]) == 8
    assert all(row["openweather_index"] in {2, 3} for row in result["forecast"])
    assert len(calls) == 2
