/*
  Air + Traffic · ESP32 + Plantower PMS5003 air sensor

  Sends PM2.5 / PM10 observations to the existing Air + Traffic HTTP ingestion API.
  The AQI field is intentionally omitted: this sketch does not calculate an
  official AQI. Use a separately validated AQI algorithm or official source.

  Wiring example (ESP32 DevKit):
    PMS5003 VCC  -> 5V (verify your specific breakout requirements)
    PMS5003 GND  -> GND
    PMS5003 TX   -> ESP32 GPIO16 (RX2)
    PMS5003 RX   -> ESP32 GPIO17 (TX2, optional for passive reading)

  Set API_URL to a backend address reachable from the ESP32. For local testing,
  use your computer's LAN IP, not 127.0.0.1. Demo backend ingestion is open;
  add authentication / ingestion keys before exposing a production endpoint.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <HardwareSerial.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* API_URL = "http://192.168.1.10:8000/api/v1/aqi/observations";

const char* STATION_ID = "ESP32-LKO-01";
const char* STATION_NAME = "Gomti Nagar Air Node";
const float STATION_LAT = 26.8467;
const float STATION_LON = 80.9462;
const unsigned long SEND_INTERVAL_MS = 30000;

HardwareSerial pmsSerial(2);
unsigned long lastSentAt = 0;

bool readPms5003(float& pm25, float& pm10) {
  static uint8_t frame[32];
  while (pmsSerial.available() >= 32) {
    if (pmsSerial.peek() != 0x42) {
      pmsSerial.read();
      continue;
    }

    size_t received = pmsSerial.readBytes(frame, sizeof(frame));
    if (received != sizeof(frame) || frame[0] != 0x42 || frame[1] != 0x4D) {
      continue;
    }

    uint16_t checksum = 0;
    for (int i = 0; i < 30; i++) checksum += frame[i];
    uint16_t supplied = (static_cast<uint16_t>(frame[30]) << 8) | frame[31];
    if (checksum != supplied) continue;

    // Atmospheric environment values (µg/m³), not the CF=1 factory values.
    pm25 = static_cast<uint16_t>((frame[12] << 8) | frame[13]);
    pm10 = static_cast<uint16_t>((frame[14] << 8) | frame[15]);
    return true;
  }
  return false;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  Serial.print("Connected. ESP32 IP: ");
  Serial.println(WiFi.localIP());
}

void postObservation(float pm25, float pm10) {
  if (WiFi.status() != WL_CONNECTED) connectWifi();

  HTTPClient http;
  http.begin(API_URL);  // Plain HTTP is intended for a trusted local LAN demo.
  http.addHeader("Content-Type", "application/json");

  String body = "{";
  body += "\"external_station_id\":\"" + String(STATION_ID) + "\",";
  body += "\"station_name\":\"" + String(STATION_NAME) + "\",";
  body += "\"latitude\":" + String(STATION_LAT, 6) + ",";
  body += "\"longitude\":" + String(STATION_LON, 6) + ",";
  body += "\"source\":\"esp32-pms5003\",";
  body += "\"pm25\":" + String(pm25, 1) + ",";
  body += "\"pm10\":" + String(pm10, 1) + ",";
  body += "\"raw_payload\":{";
  body += "\"device\":\"ESP32\",\"sensor\":\"PMS5003\",\"pm_unit\":\"ug/m3\"}";
  body += "}";

  int status = http.POST(body);
  Serial.printf("AQI observation POST status: %d\n", status);
  if (status > 0) Serial.println(http.getString());
  else Serial.println(http.errorToString(status));
  http.end();
}

void setup() {
  Serial.begin(115200);
  pmsSerial.begin(9600, SERIAL_8N1, 16, 17);
  connectWifi();
  Serial.println("Air + Traffic PMS5003 station ready.");
}

void loop() {
  float pm25 = 0;
  float pm10 = 0;
  if (readPms5003(pm25, pm10) && millis() - lastSentAt >= SEND_INTERVAL_MS) {
    Serial.printf("PM2.5: %.1f ug/m3 | PM10: %.1f ug/m3\n", pm25, pm10);
    postObservation(pm25, pm10);
    lastSentAt = millis();
  }
  delay(20);
}
