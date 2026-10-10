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
