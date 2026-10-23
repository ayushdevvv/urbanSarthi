def test_aqi_vision_status_describes_multimodal_model(client):
    response = client.get('/api/v1/aqi-vision/status')
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['model'] == 'UrbanSarthi Multimodal AQI Model'
    assert body['input_images'] == ['front', 'rear']
    assert body['tabular_columns'] == ['PM2.5', 'PM10', 'Temperature', 'Humidity', 'Season', 'Day_or_Night']
    assert body['output_type'].startswith('predicted category')
    assert body['artifacts_present']['urban_sarthi_best_model.pth'] is True


def test_aqi_vision_rejects_non_image_uploads(client):
    response = client.post(
        '/api/v1/aqi-vision/analyze',
        files={
            'front_image': ('front.txt', b'not an image', 'text/plain'),
            'rear_image': ('rear.txt', b'not an image', 'text/plain'),
        },
        data={
            'pm25': '26.1', 'pm10': '41', 'temperature': '27', 'humidity': '43',
            'season': 'Monsoon', 'day_or_night': 'Day',
        },
    )
    assert response.status_code == 415


def test_aqi_vision_rejects_unknown_season_before_model_loading(client):
    response = client.post(
        '/api/v1/aqi-vision/analyze',
        files={
            'front_image': ('front.jpg', b'fake', 'image/jpeg'),
            'rear_image': ('rear.jpg', b'fake', 'image/jpeg'),
        },
        data={
            'pm25': '26.1', 'pm10': '41', 'temperature': '27', 'humidity': '43',
            'season': 'Monsoon-ish', 'day_or_night': 'Day',
        },
    )
    assert response.status_code == 422, response.text
    assert 'Season must be' in response.json()['detail']


def test_location_forecast_prefers_openweather_without_leaking_secret(monkeypatch):
    from app.api import aqi as aqi_api
    from app.core.config import settings

    monkeypatch.setattr(settings, "weather_api_key", "test-openweather-secret")

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    responses = [
        FakeResponse({"list": [{"dt": 1792758000, "main": {"aqi": 3}, "components": {
            "pm2_5": 34.2, "pm10": 48.5, "no2": 17.0, "o3": 21.0, "co": 260.0, "so2": 4.0,
        }}]}),
        FakeResponse({"list": [{"dt": 1792768800, "main": {"aqi": 4}, "components": {"pm2_5": 42.0, "pm10": 57.0}}]}),
    ]
    calls = []

    def fake_get(url, params, headers, timeout):
        calls.append((url, params, timeout))
        return responses.pop(0)

    monkeypatch.setattr(aqi_api.httpx, "get", fake_get)
    body = aqi_api.location_aqi_forecast(28.61, 77.20)

    assert body["provider"] == "OpenWeather Air Pollution API"
    assert body["aqi_scale"] == "OpenWeather 1–5"
    assert body["current"]["openweather_index"] == 3
    assert body["current"]["us_aqi"] is None
    assert body["current"]["category"] == "Moderate"
    assert body["forecast"][0]["openweather_index"] == 4
    assert all(call[1]["appid"] == "test-openweather-secret" for call in calls)
    assert "test-openweather-secret" not in str(body)
