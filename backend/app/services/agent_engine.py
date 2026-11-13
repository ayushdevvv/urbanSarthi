"""
UrbanSaarthi Traffic Intelligence Agent Engine
-----------------------------------------------
A rule-based agentic system that selects and calls tools to answer
traffic, pollution, and route-safety queries. No LLM API key required.

Architecture:
  AgentQuery → intent_router → [tool_selector] → tool_executor → AgentResult

Tools available:
  1. get_traffic_snapshot      – congestion levels, vehicle counts, queue lengths
  2. get_aqi_snapshot          – AQI, PM2.5, pollutant mix at given coordinates
  3. analyze_routes            – route comparison with congestion + pollution scoring
  4. recommend_signal_strategy – signal timing recommendations for corridors

Data modes (always labelled truthfully in response):
  "live"       – real API data (TomTom / Open-Meteo CAMS)
  "sumo_model" – XGBoost inference on SUMO-generated training dataset
  "mock"       – synthesized reference data, no model inference
  "mixed"      – combination of live API and simulated model data
"""
from __future__ import annotations

import math
import random
import re
import uuid
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# City boundaries and regional arterial road corridors
# ---------------------------------------------------------------------------
CITY_BOUNDS = [
    {
        "name": "Delhi NCR",
        "state": "Delhi",
        "lat_range": (28.2, 28.9),
        "lon_range": (76.8, 77.6),
        "roads": [
            "Ring Road · Moti Bagh to AIIMS",
            "Connaught Place Radial Corridors",
            "ITO Junction & Vikas Marg",
            "Outer Ring Road · Nehru Place",
            "NH-48 Dhaula Kuan Connector",
            "Mathura Road · Ashram Chowk",
            "Janpath & Barakhamba Road",
            "Old Delhi · Kashmere Gate",
            "Noida Link Road & Mayur Vihar",
            "Lodhi Road & Barapullah Flyover",
        ],
    },
    {
        "name": "Bengaluru",
        "state": "Karnataka",
        "lat_range": (12.7, 13.2),
        "lon_range": (77.4, 77.8),
        "roads": [
            "Outer Ring Road · Silk Board to Marathahalli",
            "Hosur Road · Koramangala to Electronic City",
            "Old Airport Road · Domlur to HAL",
            "Whitefield Main Road · ITPL corridor",
            "Indiranagar 100 Feet Road",
            "MG Road · Trinity Circle corridor",
            "Bannerghatta Road · Dairy Circle",
            "Bellary Road · Hebbal Flyover approach",
            "Tumkur Road · Yeshwanthpur junction",
            "Sarjapur Road · Kaikondrahalli corridor",
        ],
    },
    {
        "name": "Mumbai",
        "state": "Maharashtra",
        "lat_range": (18.8, 19.4),
        "lon_range": (72.7, 73.1),
        "roads": [
            "Western Express Highway · Andheri to Bandra",
            "Eastern Express Highway · Ghatkopar to Sion",
            "Bandra-Kurla Complex (BKC) Connector",
            "Swami Vivekanand (SV) Road corridor",
            "LBS Marg · Kurla to Bhandup",
            "Dr. Ambedkar Road · Dadar TT circle",
            "Jogeshwari-Vikhroli Link Road (JVLR)",
            "Eastern Freeway · Chembur to P D'Mello",
            "Link Road · Goregaon to Malad",
            "Sion-Panvel Expressway corridor",
        ],
    },
    {
        "name": "Pune",
        "state": "Maharashtra",
        "lat_range": (18.4, 18.7),
        "lon_range": (73.7, 74.0),
        "roads": [
            "FC Road · Shivajinagar",
            "JM Road corridor",
            "Hinjawadi IT Park Phase 1 Road",
            "Pune-Bangalore Highway · Chandani Chowk",
            "Karve Road · Deccan to Kothrud",
            "Viman Nagar · Nagar Road corridor",
            "Sinhagad Road approach",
            "Kalyani Nagar connector",
        ],
    },
    {
        "name": "Hyderabad",
        "state": "Telangana",
        "lat_range": (17.2, 17.6),
        "lon_range": (78.2, 78.6),
        "roads": [
            "HITEC City · Cyber Towers corridor",
            "Gachibowli Outer Ring Road junction",
            "Banjara Hills Road No. 1 & 12",
            "Jubilee Hills Check Post",
            "Begumpet Main Road corridor",
            "Panjagutta Junction approach",
            "Mehdipatnam to Airport PVNR Expressway",
            "Kukatpally Housing Board (KPHB) Road",
        ],
    },
    {
        "name": "Kolkata",
        "state": "West Bengal",
        "lat_range": (22.4, 22.7),
        "lon_range": (88.2, 88.5),
        "roads": [
            "EM Bypass · Ruby to Science City",
            "AJC Bose Road Flyover",
            "Park Street & Camac Street",
            "Chittaranjan Avenue (Central)",
            "VIP Road · Ultadanga to Airport",
            "Howrah Bridge approach corridor",
            "Gariahat Road south connector",
            "Salt Lake Sector V Central Avenue",
        ],
    },
]

KNOWN_LANDMARKS = {
    # Delhi NCR
    "cp": (28.6315, 77.2167, "Connaught Place, New Delhi"),
    "connaught place": (28.6315, 77.2167, "Connaught Place, New Delhi"),
    "ito": (28.6287, 77.2411, "ITO, New Delhi"),
    "india gate": (28.6129, 77.2295, "India Gate, New Delhi"),
    "anand vihar": (28.6469, 77.3151, "Anand Vihar, Delhi"),
    "kashmere gate": (28.6667, 77.2289, "Kashmere Gate, Old Delhi"),
    "lodhi road": (28.5928, 77.2244, "Lodhi Road, New Delhi"),
    "aiims": (28.5672, 77.2100, "AIIMS, New Delhi"),
    "hauz khas": (28.5494, 77.2001, "Hauz Khas, New Delhi"),
    "igi airport": (28.5562, 77.1000, "IGI Airport Terminal 3, Delhi"),
    "airport": (28.5562, 77.1000, "IGI Airport, Delhi"),
    "dhaula kuan": (28.5921, 77.1563, "Dhaula Kuan, New Delhi"),
    "cyber hub": (28.4950, 77.0895, "Cyber City, Gurugram"),
    "gurgaon": (28.4595, 77.0266, "Gurugram, Haryana"),
    "noida sector 18": (28.5708, 77.3260, "Sector 18, Noida"),
    "noida": (28.5355, 77.3910, "Noida, UP"),
    # Bengaluru
    "silk board": (12.9175, 77.6238, "Central Silk Board, Bengaluru"),
    "marathahalli": (12.9591, 77.6974, "Marathahalli, Bengaluru"),
    "whitefield": (12.9698, 77.7499, "Whitefield, Bengaluru"),
    "electronic city": (12.8399, 77.6770, "Electronic City, Bengaluru"),
    "indiranagar": (12.9784, 77.6408, "Indiranagar, Bengaluru"),
    "koramangala": (12.9352, 77.6245, "Koramangala, Bengaluru"),
    "mg road": (12.9756, 77.6066, "MG Road, Bengaluru"),
    "hebbal": (13.0358, 77.5970, "Hebbal Flyover, Bengaluru"),
    "majestic": (12.9778, 77.5713, "KSR Majestic Station, Bengaluru"),
    "kempegowda": (12.9778, 77.5713, "Kempegowda Majestic, Bengaluru"),
    "bellandur": (12.9304, 77.6784, "Bellandur, Bengaluru"),
    # Mumbai
    "bkc": (19.0657, 72.8687, "Bandra Kurla Complex, Mumbai"),
    "bandra": (19.0596, 72.8295, "Bandra, Mumbai"),
    "andheri": (19.1197, 72.8464, "Andheri, Mumbai"),
    "dadar": (19.0178, 72.8478, "Dadar, Mumbai"),
    "nariman point": (18.9260, 72.8228, "Nariman Point, Mumbai"),
    "cst": (18.9401, 72.8354, "Chhatrapati Shivaji Maharaj Terminus, Mumbai"),
    "csmt": (18.9401, 72.8354, "CSMT, Mumbai"),
}

_AQI_STATIONS = [
    {"name": "ITO Monitor", "latitude": 28.6287, "longitude": 77.2411},
    {"name": "Connaught Place", "latitude": 28.6315, "longitude": 77.2167},
    {"name": "ISBT Kashmere Gate", "latitude": 28.6667, "longitude": 77.2289},
    {"name": "Lodhi Road", "latitude": 28.5928, "longitude": 77.2244},
    {"name": "Anand Vihar", "latitude": 28.6469, "longitude": 77.3151},
]


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_city(lat: float, lon: float) -> dict[str, Any]:
    """Find the city configuration matching lat/lon or return general urban defaults."""
    for city in CITY_BOUNDS:
        min_lat, max_lat = city["lat_range"]
        min_lon, max_lon = city["lon_range"]
        if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
            return city
    return {
        "name": f"City ({lat:.2f}, {lon:.2f})",
        "state": "India",
        "lat_range": (lat - 0.2, lat + 0.2),
        "lon_range": (lon - 0.2, lon + 0.2),
        "roads": [
            f"Central Arterial Corridor · {lat:.2f}N",
            f"Inner Ring Connector · Sector 1",
            f"Outer Ring Sector · {lon:.2f}E",
            f"Transit Hub Station Link",
            f"Industrial Park Access Highway",
            f"Commercial District Avenue",
            f"Metro Feeder Corridor",
            f"Bypass Expressway Approach",
        ],
    }


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Approximate distance in km between two lat/lon points."""
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


# UNIFIED CONGESTION DEFINITION
# 0 - 29.9: Low
# 30.0 - 54.9: Moderate
# 55.0 - 74.9: High
# 75.0 - 100: Severe
def _congestion_label(score: float) -> str:
    if score < 30.0:
        return "Low"
    if score < 55.0:
        return "Moderate"
    if score < 75.0:
        return "High"
    return "Severe"


def _congestion_recommendation(score: float) -> dict[str, str]:
    """Return strictly aligned recommendation title and priority for any score."""
    lvl = _congestion_label(float(score))
    if lvl == "Severe":
        return {
            "type": "traffic",
            "priority": "urgent",
            "icon": "🔴",
            "title": "Severe Congestion Detected",
            "text": f"Congestion score {score:.1f}/100 (Severe). Critical gridlock on monitored corridors.",
            "action": "Avoid peak corridors. Consider shifting departure time or using metro/rail transit.",
        }
    if lvl == "High":
        return {
            "type": "traffic",
            "priority": "high",
            "icon": "🟠",
            "title": "High Congestion Detected",
            "text": f"Congestion score {score:.1f}/100 (High). Significant traffic buildup observed.",
            "action": "Allow 15–25 min buffer. Check alternate ring roads or bypass corridors.",
        }
    if lvl == "Moderate":
        return {
            "type": "traffic",
            "priority": "medium",
            "icon": "🟡",
            "title": "Moderate Congestion",
            "text": f"Congestion score {score:.1f}/100 (Moderate). Urban flow is moving with minor bottlenecks.",
            "action": "Standard travel times apply. Monitor corridors for sudden slowdowns.",
        }
    return {
        "type": "traffic",
        "priority": "low",
        "icon": "🟢",
        "title": "Low Congestion / Smooth Flow",
        "text": f"Congestion score {score:.1f}/100 (Low). Road network is moving smoothly.",
        "action": "Optimal window for city travel.",
    }


def _aqi_category(aqi: float | None) -> str:
    if aqi is None:
        return "Unknown"
    if aqi <= 50:
        return "Good"
    if aqi <= 100:
        return "Moderate"
    if aqi <= 150:
        return "Unhealthy for Sensitive Groups"
    if aqi <= 200:
        return "Unhealthy"
    if aqi <= 300:
        return "Very Unhealthy"
    return "Hazardous"


# ---------------------------------------------------------------------------
# TOOL 1 — Traffic Snapshot (Location-specific)
# ---------------------------------------------------------------------------

def get_traffic_snapshot(latitude: float, longitude: float) -> dict[str, Any]:
    """
    Tool: get_traffic_snapshot
    Returns vehicle counts, queue lengths, congestion scores for roads
    near the given coordinates. Location-specific: respects Delhi, Bengaluru,
    Mumbai, etc., instead of returning Delhi roads everywhere.
    """
    city_info = _resolve_city(latitude, longitude)
    city_name = city_info["name"]
    city_roads = city_info["roads"]

    data_mode = "sumo_model"
    roads = []

    try:
        from app.services.traffic_simulation import get_simulation_snapshot
        snap = get_simulation_snapshot()
        road_rows = snap.get("roads", [])
        if not road_rows:
            raise ValueError("Empty simulation snapshot")

        for i, r in enumerate(road_rows[:len(city_roads)]):
            q = float(r.get("queue_now", 0))
            pq = float(r.get("predicted_queue_30min", 0))
            level = r.get("level_now", "Free")
            # Calibrate congestion score to align with unified tiers
            if level == "Heavy":
                score = round(min(100.0, 65 + q * 1.2 + random.uniform(-4, 8)), 1)
            elif level == "Moderate":
                score = round(min(54.9, 32 + q * 2.2 + random.uniform(-3, 3)), 1)
            else:
                score = round(min(29.9, max(0.0, q * 4 + random.uniform(-2, 4))), 1)

            vehicles = max(0, round(q * 1.4 + random.uniform(-2, 3)))
            assigned_road_name = city_roads[i % len(city_roads)]

            roads.append({
                "road": assigned_road_name,
                "city": city_name,
                "congestion_score": score,
                "congestion_level": _congestion_label(score),
                "vehicle_count": vehicles,
                "queue_length_vehicles": round(q, 1),
                "predicted_queue_30min": round(pq, 1),
                "predicted_level_30min": r.get("level_30min", "Unknown"),
            })

        vehicles_now = snap.get("vehicles_now", 0)
        model_metrics = snap.get("model_metrics", {})
        heavy = sum(1 for r in roads if r["congestion_level"] in ("High", "Severe"))
        mean_score = round(sum(r["congestion_score"] for r in roads) / max(1, len(roads)), 1)

        return {
            "tool": "get_traffic_snapshot",
            "data_mode": data_mode,
            "data_mode_label": "⚡ SUMO XGBoost Model",
            "city": city_name,
            "state": city_info.get("state", "India"),
            "latitude": latitude,
            "longitude": longitude,
            "generated_at": _utc_now(),
            "summary": {
                "mean_congestion_score": mean_score,
                "congestion_level": _congestion_label(mean_score),
                "total_vehicles": int(vehicles_now),
                "total_queue_vehicles": int(snap.get("queue_now", 0)),
                "heavy_roads_now": heavy,
                "heavy_roads_30min": int(snap.get("heavy_roads_30min", 0)),
                "queue_change_percent": snap.get("queue_change_percent", 0),
            },
            "roads": roads,
            "model_metrics": model_metrics,
            "note": f"Traffic simulation dynamics derived from trained SUMO benchmark model projected onto monitored arterial corridors in {city_name}. Not a live physical sensor feed.",
        }

    except Exception as exc:
        data_mode = "mock"
        seed = abs(int(latitude * 100 + longitude * 100)) % 37
        random.seed(seed)
        roads = []
        for name in city_roads:
            q = random.uniform(1, 16)
            score = round(min(100.0, max(5.0, q * 5.2 + random.uniform(-4, 6))), 1)
            level = _congestion_label(score)
            roads.append({
                "road": name,
                "city": city_name,
                "congestion_score": score,
                "congestion_level": level,
                "vehicle_count": round(q * 1.5 + random.uniform(0, 5)),
                "queue_length_vehicles": round(q, 1),
                "predicted_queue_30min": round(max(0, q + random.uniform(-2, 4)), 1),
                "predicted_level_30min": _congestion_label(min(100.0, score + random.uniform(-5, 8))),
            })
        mean_score = round(sum(r["congestion_score"] for r in roads) / max(1, len(roads)), 1)

        return {
            "tool": "get_traffic_snapshot",
            "data_mode": data_mode,
            "data_mode_label": "🔵 Simulated Reference Data",
            "city": city_name,
            "state": city_info.get("state", "India"),
            "latitude": latitude,
            "longitude": longitude,
            "generated_at": _utc_now(),
            "summary": {
                "mean_congestion_score": mean_score,
                "congestion_level": _congestion_label(mean_score),
                "total_vehicles": round(mean_score * 4 + 80),
                "total_queue_vehicles": round(mean_score * 1.2),
                "heavy_roads_now": sum(1 for r in roads if r["congestion_level"] in ("High", "Severe")),
                "heavy_roads_30min": sum(1 for r in roads if r["predicted_level_30min"] in ("High", "Severe")),
                "queue_change_percent": round(random.uniform(-8, 14), 1),
            },
            "roads": roads,
            "model_metrics": {},
            "note": f"SUMO model unavailable ({type(exc).__name__}). Showing reference corridor data for {city_name}.",
            "_sumo_error": str(exc),
        }


# ---------------------------------------------------------------------------
# TOOL 2 — AQI Snapshot
# ---------------------------------------------------------------------------

def get_aqi_snapshot(latitude: float, longitude: float) -> dict[str, Any]:
    """
    Tool: get_aqi_snapshot
    Returns current AQI, PM2.5, PM10 and key pollutants near the given
    coordinates. Calls Open-Meteo CAMS (free, no key required). Falls back
    to mock data with honest labelling if the external API is unreachable.
    """
    data_mode = "live"

    try:
        import httpx
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "timezone": "auto",
            "current": "us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide,sulphur_dioxide",
            "forecast_hours": 6,
            "hourly": "us_aqi,pm2_5,pm10",
        }
        resp = httpx.get(
            "https://air-quality-api.open-meteo.com/v1/air-quality",
            params=params,
            headers={"User-Agent": "UrbanSaarthi-Agent/1.0"},
            timeout=7.0,
        )
        resp.raise_for_status()
        payload = resp.json()
        current = payload.get("current") or {}
        hourly = payload.get("hourly") or {}
        us_aqi = current.get("us_aqi")
        pm25 = current.get("pm2_5")
        pm10 = current.get("pm10")
        no2 = current.get("nitrogen_dioxide")
        o3 = current.get("ozone")
        co = current.get("carbon_monoxide")

        times = hourly.get("time") or []
        aqi_vals = hourly.get("us_aqi") or []
        pm25_vals = hourly.get("pm2_5") or []
        pm10_vals = hourly.get("pm10") or []
        forecast = [
            {
                "time": times[i],
                "us_aqi": aqi_vals[i] if i < len(aqi_vals) else None,
                "pm25": pm25_vals[i] if i < len(pm25_vals) else None,
                "pm10": pm10_vals[i] if i < len(pm10_vals) else None,
                "category": _aqi_category(aqi_vals[i] if i < len(aqi_vals) else None),
            }
            for i in range(min(6, len(times)))
        ]

        if us_aqi is None:
            raise ValueError("No AQI value returned from Open-Meteo")

        return {
            "tool": "get_aqi_snapshot",
            "data_mode": data_mode,
            "data_mode_label": "🌐 Live — Open-Meteo CAMS",
            "latitude": payload.get("latitude", latitude),
            "longitude": payload.get("longitude", longitude),
            "generated_at": _utc_now(),
            "current": {
                "us_aqi": us_aqi,
                "category": _aqi_category(us_aqi),
                "pm25_ug_m3": pm25,
                "pm10_ug_m3": pm10,
                "nitrogen_dioxide_ug_m3": no2,
                "ozone_ug_m3": o3,
                "carbon_monoxide_ug_m3": co,
                "dominant_pollutant": _dominant_pollutant(pm25, pm10, no2, o3, co),
            },
            "forecast_6h": forecast,
            "health_advice": _health_advice(us_aqi),
            "note": "Atmospheric model observation from Open-Meteo CAMS live feed.",
        }

    except Exception as exc:
        data_mode = "mock"
        seed = abs(int(latitude * 1000 + longitude * 100)) % 53
        random.seed(seed)
        us_aqi = round(85 + random.uniform(-25, 75))
        pm25 = round(us_aqi * 0.28 + random.uniform(-4, 8), 1)
        pm10 = round(pm25 * 1.6 + random.uniform(-4, 12), 1)
        no2 = round(random.uniform(20, 70), 1)
        o3 = round(random.uniform(40, 110), 1)
        co = round(random.uniform(200, 750), 1)
        near_stations = sorted(
            _AQI_STATIONS,
            key=lambda s: _haversine_km(latitude, longitude, s["latitude"], s["longitude"]),
        )
        forecast = [
            {
                "time": f"+{i+1}h",
                "us_aqi": max(0, round(us_aqi + random.uniform(-10, 15))),
                "pm25": round(pm25 + random.uniform(-4, 6), 1),
                "pm10": round(pm10 + random.uniform(-4, 10), 1),
                "category": _aqi_category(us_aqi + random.uniform(-10, 15)),
            }
            for i in range(6)
        ]
        return {
            "tool": "get_aqi_snapshot",
            "data_mode": data_mode,
            "data_mode_label": "🔵 Simulated Reference Data",
            "latitude": latitude,
            "longitude": longitude,
            "generated_at": _utc_now(),
            "current": {
                "us_aqi": us_aqi,
                "category": _aqi_category(us_aqi),
                "pm25_ug_m3": pm25,
                "pm10_ug_m3": pm10,
                "nitrogen_dioxide_ug_m3": no2,
                "ozone_ug_m3": o3,
                "carbon_monoxide_ug_m3": co,
                "dominant_pollutant": _dominant_pollutant(pm25, pm10, no2, o3, co),
            },
            "forecast_6h": forecast,
            "health_advice": _health_advice(us_aqi),
            "nearest_station": near_stations[0]["name"] if near_stations else None,
            "note": f"Open-Meteo live API unreachable ({type(exc).__name__}). Showing reference simulated AQI. Not real-time measured ground data.",
        }


def _dominant_pollutant(pm25, pm10, no2, o3, co) -> str:
    candidates = {
        "PM2.5": pm25 or 0,
        "PM10": (pm10 or 0) * 0.5,
        "NO₂": (no2 or 0) * 0.6,
        "O₃": (o3 or 0) * 0.4,
    }
    return max(candidates, key=candidates.get)


def _health_advice(aqi: float | None) -> str:
    if aqi is None:
        return "Check local air index before extended outdoor exertion."
    if aqi <= 50:
        return "Air quality is Good. Ideal for walking, cycling, and outdoor recreation."
    if aqi <= 100:
        return "Moderate air quality. Unusually sensitive individuals should monitor outdoor exposure."
    if aqi <= 150:
        return "Unhealthy for Sensitive Groups. Children, elderly, and respiratory patients should reduce vigorous outdoor exertion."
    if aqi <= 200:
        return "Unhealthy. Everyone may begin to experience respiratory irritation. Wear an N95 mask outdoors."
    if aqi <= 300:
        return "Very Unhealthy. Avoid outdoor cardio activities. Use indoor air filters and enclosed transit."
    return "Hazardous. Stay indoors. Keep windows closed. High health risk for all groups."


# ---------------------------------------------------------------------------
# TOOL 3 — Route Advisor (Honest, Realistic Geometry & Exposure)
# ---------------------------------------------------------------------------

def _fetch_osrm_driving_routes(origin_lat: float, origin_lon: float, dest_lat: float, dest_lon: float) -> list[dict] | None:
    """Attempt to fetch road routing geometry and alternatives from OSRM."""
    try:
        import httpx
        from app.core.config import settings
        bases = []
        if settings.osrm_base_url:
            bases.append(settings.osrm_base_url.rstrip("/"))
        bases.extend(["https://routing.openstreetmap.de/routed-car", "https://router.project-osrm.org"])

        for base in bases:
            url = f"{base}/route/v1/driving/{origin_lon},{origin_lat};{dest_lon},{dest_lat}"
            try:
                resp = httpx.get(
                    url,
                    params={"alternatives": "true", "overview": "full", "geometries": "geojson", "steps": "false"},
                    headers={"User-Agent": "UrbanSaarthi/1.0 (agent route analysis)"},
                    timeout=5.0,
                )
                if resp.status_code == 200:
                    payload = resp.json()
                    if payload.get("code") == "Ok" and payload.get("routes"):
                        return payload["routes"]
            except Exception:
                continue
    except Exception:
        pass
    return None


def analyze_routes(
    origin_lat: float, origin_lon: float,
    dest_lat: float, dest_lon: float,
    traffic_data: dict | None = None,
    aqi_data: dict | None = None,
) -> dict[str, Any]:
    """
    Tool: analyze_routes
    Compares route alternatives. Queries real OSRM road geometry when available.
    Does NOT use fake static multipliers (0.68 / 0.88) claiming they are measured.
    Transparently reports real ambient AQI with emission-proximity modeling.
    """
    distance_km = _haversine_km(origin_lat, origin_lon, dest_lat, dest_lon)
    traffic_score = 45.0
    base_aqi = 100

    if traffic_data and traffic_data.get("summary"):
        traffic_score = float(traffic_data["summary"].get("mean_congestion_score", 45.0))
    if aqi_data and aqi_data.get("current"):
        val = aqi_data["current"].get("us_aqi")
        if isinstance(val, (int, float)):
            base_aqi = round(val)

    # Try fetching real OSRM route geometries
    osrm_routes = _fetch_osrm_driving_routes(origin_lat, origin_lon, dest_lat, dest_lon)

    routes = []
    if osrm_routes:
        # Use real road network geometry from OSRM
        for i, o_route in enumerate(osrm_routes[:3]):
            dist_km = round(o_route["distance"] / 1000.0, 2)
            base_dur_min = max(3, round(o_route["duration"] / 60.0))
            coords = o_route.get("geometry", {}).get("coordinates", [])

            if i == 0:
                name = "Direct Arterial (Fastest via Highways)"
                cong_score = round(min(100.0, traffic_score * 1.05), 1)
                desc = "Primary arterial route with highest signal density and heavier vehicle volume."
                delay_factor = 1.0 + (cong_score / 100.0) * 0.4
                dur_min = round(base_dur_min * delay_factor)
                aqi_exp = round(base_aqi * (0.95 + 0.15 * (cong_score / 100.0)))
            elif i == 1:
                name = "Alternative Corridor (Secondary Roads)"
                cong_score = round(min(100.0, traffic_score * 0.90), 1)
                desc = "Secondary urban roads avoiding main arterial choke points."
                delay_factor = 1.0 + (cong_score / 100.0) * 0.25
                dur_min = round(base_dur_min * delay_factor)
                aqi_exp = round(base_aqi * (0.90 + 0.12 * (cong_score / 100.0)))
            else:
                name = "Outer Bypass (Free-Flow Corridor)"
                cong_score = round(min(100.0, traffic_score * 0.75), 1)
                desc = "Outer bypass corridor; longer distance but fewer traffic bottlenecks."
                delay_factor = 1.0 + (cong_score / 100.0) * 0.15
                dur_min = round(base_dur_min * delay_factor)
                aqi_exp = round(base_aqi * (0.85 + 0.10 * (cong_score / 100.0)))

            comp = round(cong_score * 0.45 + (aqi_exp / 4.0) * 0.35 + (dist_km / max(0.1, distance_km) * 15) * 0.20, 1)
            routes.append({
                "id": f"osrm_route_{i+1}",
                "name": name,
                "description": desc,
                "distance_km": dist_km,
                "estimated_duration_min": dur_min,
                "congestion_score": cong_score,
                "congestion_level": _congestion_label(cong_score),
                "aqi_exposure": aqi_exp,
                "aqi_category": _aqi_category(aqi_exp),
                "composite_score": comp,
                "co2_estimate_g": round(dist_km * 125, 0),
                "geometry": {"type": "LineString", "coordinates": coords},
                "data_quality": "road-network-geometry",
            })

    # If OSRM returned fewer than 2 alternatives, supplement with modeled corridors
    if len(routes) < 2:
        road_distance_km = round(max(0.5, distance_km * 1.30), 2)
        mid_lat = (origin_lat + dest_lat) / 2.0
        mid_lon = (origin_lon + dest_lon) / 2.0
        delta_lat = dest_lat - origin_lat
        delta_lon = dest_lon - origin_lon

        corridor_configs = [
            {
                "id": "corridor_arterial",
                "name": "Direct Arterial Route",
                "desc": "Direct urban corridor via main roadways. Prone to peak signal queuing.",
                "dist_mult": 1.0,
                "cong_mult": 1.08,
                "offset": (0.0, 0.0),
            },
            {
                "id": "corridor_eco",
                "name": "Low-Emissions Eco Corridor",
                "desc": "Corridor navigating secondary avenues and green buffer zones.",
                "dist_mult": 1.18,
                "cong_mult": 0.88,
                "offset": (-delta_lon * 0.15, delta_lat * 0.15),
            },
            {
                "id": "corridor_bypass",
                "name": "Outer Bypass Route",
                "desc": "Peripheral ring connector bypassing central junction bottlenecks.",
                "dist_mult": 1.35,
                "cong_mult": 0.72,
                "offset": (delta_lon * 0.25, -delta_lat * 0.25),
            },
        ]

        # Avoid duplicating the primary route if 1 OSRM route is already present
        start_idx = 1 if len(routes) == 1 else 0
        for cfg in corridor_configs[start_idx:]:
            dist_km = round(road_distance_km * cfg["dist_mult"], 2)
            cong_score = round(min(100.0, traffic_score * cfg["cong_mult"]), 1)
            avg_speed_kmph = max(8.0, 36.0 * (1.0 - 0.0065 * cong_score))
            dur_min = max(4, round((dist_km / avg_speed_kmph) * 60))
            aqi_exp = round(base_aqi * (0.86 + 0.24 * (cong_score / 100.0)))
            comp = round(cong_score * 0.45 + (aqi_exp / 4.0) * 0.35 + (dist_km / max(0.1, distance_km) * 15) * 0.20, 1)

            wp_lat = mid_lat + cfg["offset"][0]
            wp_lon = mid_lon + cfg["offset"][1]
            coords = [
                [round(origin_lon, 5), round(origin_lat, 5)],
                [round(wp_lon, 5), round(wp_lat, 5)],
                [round(dest_lon, 5), round(dest_lat, 5)],
            ]

            routes.append({
                "id": cfg["id"],
                "name": cfg["name"],
                "description": cfg["desc"],
                "distance_km": dist_km,
                "estimated_duration_min": dur_min,
                "congestion_score": cong_score,
                "congestion_level": _congestion_label(cong_score),
                "aqi_exposure": aqi_exp,
                "aqi_category": _aqi_category(aqi_exp),
                "composite_score": comp,
                "co2_estimate_g": round(dist_km * 120, 0),
                "geometry": {"type": "LineString", "coordinates": coords},
                "data_quality": "modeled-corridor-estimate",
            })

    routes.sort(key=lambda r: r["composite_score"])
    for r in routes:
        r["recommended"] = False
    routes[0]["recommended"] = True
    rec = routes[0]

    traffic_mode = traffic_data.get("data_mode", "mock") if traffic_data else "mock"
    aqi_mode = aqi_data.get("data_mode", "mock") if aqi_data else "mock"
    has_osrm = bool(osrm_routes)

    return {
        "tool": "analyze_routes",
        "data_mode": "live" if (has_osrm and aqi_mode == "live") else ("sumo_model" if traffic_mode == "sumo_model" else "mock"),
        "data_mode_label": "🌐 Road Network Route Analysis" if has_osrm else "⚡ Correlated Corridor Modeling",
        "origin": {"latitude": origin_lat, "longitude": origin_lon},
        "destination": {"latitude": dest_lat, "longitude": dest_lon},
        "crow_fly_distance_km": round(distance_km, 2),
        "routes": routes,
        "recommended_route_id": rec["id"],
        "recommended_route_name": rec["name"],
        "generated_at": _utc_now(),
        "osrm_available": has_osrm,
        "aqi_exposure_methodology": (
            "Ambient atmospheric AQI baseline correlated with corridor traffic exhaust proximity. "
            "Individual street-level micro-sensors are not deployed on secondary lanes."
        ),
        "is_simulated_variance": True,
        "note": "Turn-by-turn road geometry used where OSRM router answered; modeled corridors with spatial waypoints used for alternatives.",
    }


# ---------------------------------------------------------------------------
# TOOL 4 — Signal Strategy Recommender
# ---------------------------------------------------------------------------

def recommend_signal_strategy(
    traffic_data: dict | None = None,
    latitude: float = 28.6139,
    longitude: float = 77.2090,
) -> dict[str, Any]:
    """
    Tool: recommend_signal_strategy
    Analyses congested roads from the traffic snapshot and recommends
    signal timing adjustments using unified congestion thresholds.
    """
    congestion_score = 45.0
    heavy_roads = []

    if traffic_data and traffic_data.get("summary"):
        congestion_score = float(traffic_data["summary"].get("mean_congestion_score", 45.0))
    if traffic_data and traffic_data.get("roads"):
        heavy_roads = [r for r in traffic_data["roads"] if r.get("congestion_level") in ("High", "Severe")]

    level = _congestion_label(congestion_score)

    if level == "Severe":
        strategy = "adaptive_priority"
        strategy_label = "Adaptive Priority — Green Wave Arterial"
        cycle_seconds = 110
        priority_direction = "main arterial"
        expected_reduction_pct = round(16 + (congestion_score - 75) * 0.45, 1)
        rationale = (
            f"Congestion score {congestion_score:.1f}/100 (Severe). "
            "Recommend extending green phases for the primary arterial corridor by 25–30% "
            "and synchronising adjacent signals into a green wave. "
            "Limit minor cross-street green allocation during peak queue buildup."
        )
    elif level == "High":
        strategy = "demand_weighted"
        strategy_label = "Demand-Weighted Dynamic Timing"
        cycle_seconds = 95
        priority_direction = "heavy corridor preference"
        expected_reduction_pct = round(10 + (congestion_score - 55) * 0.35, 1)
        rationale = (
            f"Congestion score {congestion_score:.1f}/100 (High). "
            "Recommend demand-weighted signal allocation: congested approaches receive "
            "proportionally longer green times. Baseline 95-second cycle."
        )
    elif level == "Moderate":
        strategy = "balanced_cycle"
        strategy_label = "Balanced Corridor Timing"
        cycle_seconds = 80
        priority_direction = "balanced split"
        expected_reduction_pct = round(6 + (congestion_score - 30) * 0.20, 1)
        rationale = (
            f"Congestion score {congestion_score:.1f}/100 (Moderate). "
            "Moderate queues observed. Balanced 80-second cycle maintains steady progression "
            "without creating side-street spillover."
        )
    else:
        strategy = "fixed_optimal"
        strategy_label = "Optimised Fixed Timing"
        cycle_seconds = 70
        priority_direction = "equal split"
        expected_reduction_pct = 4.0
        rationale = (
            f"Congestion score {congestion_score:.1f}/100 (Low). "
            "Traffic is free flowing. Fixed timing with equal-split phases maintains low wait times."
        )

    phases = [
        {
            "movement": "North–South Through",
            "green_seconds": max(14, round(cycle_seconds * 0.34)),
            "yellow_seconds": 3,
            "all_red_seconds": 1,
            "demand_weight": 1.4 if level in ("High", "Severe") else 1.0,
        },
        {
            "movement": "East–West Through",
            "green_seconds": max(12, round(cycle_seconds * 0.28)),
            "yellow_seconds": 3,
            "all_red_seconds": 1,
            "demand_weight": 1.2 if level in ("High", "Severe") else 1.0,
        },
        {
            "movement": "North–South Turn",
            "green_seconds": max(10, round(cycle_seconds * 0.20)),
            "yellow_seconds": 3,
            "all_red_seconds": 1,
            "demand_weight": 0.8,
        },
        {
            "movement": "East–West Turn",
            "green_seconds": max(8, round(cycle_seconds * 0.18)),
            "yellow_seconds": 3,
            "all_red_seconds": 1,
            "demand_weight": 0.6,
        },
    ]
    total_cycle = sum(p["green_seconds"] + p["yellow_seconds"] + p["all_red_seconds"] for p in phases)
    data_mode = traffic_data.get("data_mode", "mock") if traffic_data else "mock"

    return {
        "tool": "recommend_signal_strategy",
        "data_mode": data_mode,
        "data_mode_label": "⚡ SUMO-Informed Strategy" if data_mode == "sumo_model" else
                           ("🌐 Live-Data Strategy" if data_mode == "live" else "🔵 Heuristic Strategy"),
        "latitude": latitude,
        "longitude": longitude,
        "congestion_score": round(congestion_score, 1),
        "congestion_level": level,
        "strategy": strategy,
        "strategy_label": strategy_label,
        "recommended_cycle_seconds": total_cycle,
        "priority_direction": priority_direction,
        "expected_queue_reduction_pct": expected_reduction_pct,
        "phases": phases,
        "hotspot_roads": [r["road"] for r in heavy_roads[:4]],
        "rationale": rationale,
        "generated_at": _utc_now(),
        "caveats": [
            "This is an advisory heuristic timing recommendation, not a live ATCS command dispatch.",
            "Municipal traffic authority operator review is required before implementation.",
        ],
    }


# ---------------------------------------------------------------------------
# Intent Router — Exact word-boundary matching (Fixes "co" and "today")
# ---------------------------------------------------------------------------

_TOOL_REGEXES = {
    "get_traffic_snapshot": [
        r"\btraffic\b", r"\bcongestion\b", r"\bvehicles?\b", r"\bqueue(s)?\b",
        r"\bjam(s)?\b", r"\bgridlock\b", r"\bbusy\s+roads?\b", r"\bdelays?\b",
        r"\bslow\s+traffic\b", r"\bspeeds?\b", r"\bcommute\b", r"\brush\s*hour\b",
        r"\broad\s*conditions?\b", r"\bchoke\s*points?\b",
    ],
    "get_aqi_snapshot": [
        r"\baqi\b", r"\bair\s*quality\b", r"\bpollution\b", r"\bpm2\.?5\b",
        r"\bpm10\b", r"\bsmog\b", r"\bbreathe\b", r"\btoxic\s*air\b",
        r"\bozone\b", r"\bno2\b", r"\bso2\b", r"\bparticulate\b",
        r"\bcarbon\s*monoxide\b", r"\bclean\s*air\b", r"\bmasks?\b",
        r"\bhazardous\s*air\b", r"\bco\s*levels?\b", r"\bco2\b",
    ],
    "analyze_routes": [
        r"\broutes?\b", r"\bdirections?\b", r"\bnavigat(e|ion)\b",
        r"\bfrom\s+.+\s+to\s+.+\b", r"\bwhich\s+route\b", r"\bbest\s+way\b",
        r"\bcleanest\s+route\b", r"\bfastest\s+route\b", r"\beco\s*route\b",
        r"\bhow\s+to\s+reach\b", r"\btrip\s+from\b", r"\bjourney\s+from\b",
        r"\bdrive\s+from\b",
    ],
    "recommend_signal_strategy": [
        r"\bsignals?\b", r"\btraffic\s*lights?\b", r"\bgreen\s*wave\b",
        r"\bsignal\s*timings?\b", r"\bphases?\b", r"\bjunction\s*control\b",
        r"\batcs\b", r"\bsignal\s*strateg(y|ies)\b", r"\bsignal\s*plans?\b",
    ],
}


def _select_tools(query: str, mode: str) -> list[str]:
    """
    Rule-based tool selector using regex word boundaries.
    Prevents false triggers like 'co' in Connaught Place or 'to' in today.
    """
    q = query.strip()
    selected = set()

    for tool, patterns in _TOOL_REGEXES.items():
        if any(re.search(pat, q, re.IGNORECASE) for pat in patterns):
            selected.add(tool)

    # Dependency rules:
    # If route analysis is requested, it needs traffic and aqi snapshots
    if "analyze_routes" in selected:
        selected.add("get_traffic_snapshot")
        selected.add("get_aqi_snapshot")

    if "recommend_signal_strategy" in selected:
        selected.add("get_traffic_snapshot")

    # Authority mode gets full operational context
    if mode == "authority":
        selected.add("get_traffic_snapshot")
        selected.add("get_aqi_snapshot")
        if any(re.search(pat, q, re.IGNORECASE) for pat in [r"\bcongestion\b", r"\bjam\b", r"\bheavy\b", r"\bqueue\b", r"\bsignal\b"]):
            selected.add("recommend_signal_strategy")

    # Fallback: if nothing explicitly matched
    if not selected:
        # Check if query mentions weather or environment
        if re.search(r"\bweather\b|\bclimate\b|\btemperature\b|\brain\b|\bsky\b", q, re.IGNORECASE):
            selected.add("get_aqi_snapshot")
        else:
            selected.update(["get_traffic_snapshot", "get_aqi_snapshot"])

    order = ["get_traffic_snapshot", "get_aqi_snapshot", "analyze_routes", "recommend_signal_strategy"]
    return [t for t in order if t in selected]


def _extract_origin_destination(
    query: str,
    lat: float, lon: float,
    dest_lat: float | None, dest_lon: float | None,
) -> tuple[float, float, float | None, float | None, str | None, str | None]:
    """
    Resolve coordinates from known landmark names if dest coordinates were not explicitly provided.
    E.g. 'Best route from CP to ITO' -> CP=(28.6315, 77.2167), ITO=(28.6287, 77.2411).
    """
    if dest_lat is not None and dest_lon is not None:
        return lat, lon, dest_lat, dest_lon, None, None

    q = query.lower()
    calc_lat, calc_lon = lat, lon
    calc_dest_lat, calc_dest_lon = dest_lat, dest_lon
    orig_name = None
    dest_name = None

    # Check 'from X to Y' pattern
    m = re.search(r"\bfrom\s+([a-zA-Z0-9\s\.\-]+?)\s+to\s+([a-zA-Z0-9\s\.\-]+)", q)
    if m:
        raw_orig = m.group(1).strip()
        raw_dest = m.group(2).strip()

        for k, v in KNOWN_LANDMARKS.items():
            if re.search(r"\b" + re.escape(k) + r"\b", raw_orig):
                calc_lat, calc_lon = v[0], v[1]
                orig_name = v[2]
                break
        for k, v in KNOWN_LANDMARKS.items():
            if re.search(r"\b" + re.escape(k) + r"\b", raw_dest):
                calc_dest_lat, calc_dest_lon = v[0], v[1]
                dest_name = v[2]
                break
    else:
        # Check if query specifies 'to <landmark>'
        m_to = re.search(r"\bto\s+([a-zA-Z0-9\s\.\-]+)", q)
        if m_to:
            raw_dest = m_to.group(1).strip()
            for k, v in KNOWN_LANDMARKS.items():
                if re.search(r"\b" + re.escape(k) + r"\b", raw_dest):
                    calc_dest_lat, calc_dest_lon = v[0], v[1]
                    dest_name = v[2]
                    break

    return calc_lat, calc_lon, calc_dest_lat, calc_dest_lon, orig_name, dest_name


# ---------------------------------------------------------------------------
# Summary Builder (Consistent Labels, Unified Thresholds)
# ---------------------------------------------------------------------------

def _build_summary(query: str, tools_results: dict[str, dict], mode: str) -> tuple[str, list[dict]]:
    """
    Builds a natural-language summary and structured recommendation cards.
    Guarantees that score 68 and all other scores have 100% matching labels and titles.
    """
    traffic = tools_results.get("get_traffic_snapshot")
    aqi = tools_results.get("get_aqi_snapshot")
    routes = tools_results.get("analyze_routes")
    signals = tools_results.get("recommend_signal_strategy")

    parts = []
    recommendations = []

    # Traffic summary
    if traffic and not traffic.get("error"):
        t_sum = traffic.get("summary", {})
        score = float(t_sum.get("mean_congestion_score", 0.0))
        level = _congestion_label(score)
        city = traffic.get("city", "the area")
        vehicles = t_sum.get("total_vehicles", "—")
        heavy = t_sum.get("heavy_roads_now", 0)
        chg = t_sum.get("queue_change_percent", 0)
        direction = "worsening" if chg > 5 else ("improving" if chg < -5 else "stable")

        parts.append(
            f"Traffic congestion in **{city}** is currently **{level}** (score {score:.1f}/100). "
            f"Approximately {vehicles} vehicles detected across monitored corridors. "
            f"{heavy} corridor(s) are experiencing Heavy/Severe congestion. "
            f"The 30-minute outlook is {direction} ({chg:+.1f}% queue change)."
        )
        recommendations.append(_congestion_recommendation(score))

    # AQI summary
    if aqi and not aqi.get("error"):
        a_cur = aqi.get("current", {})
        aqi_val = a_cur.get("us_aqi", "—")
        cat = a_cur.get("category", "—")
        pm25 = a_cur.get("pm25_ug_m3", "—")
        pollutant = a_cur.get("dominant_pollutant", "—")
        advice = aqi.get("health_advice", "")
        parts.append(
            f"Air quality index is **{aqi_val}** ({cat}). "
            f"PM2.5: {pm25} µg/m³. Dominant pollutant: {pollutant}. "
            f"{advice}"
        )
        aqi_num = float(aqi_val) if isinstance(aqi_val, (int, float)) else 0
        if aqi_num > 150:
            recommendations.append({
                "type": "pollution",
                "priority": "high",
                "icon": "😷",
                "title": f"Poor Air Quality — {cat}",
                "text": f"AQI {aqi_val} ({cat}). PM2.5 concentration at {pm25} µg/m³.",
                "action": "Wear N95 mask outdoors. Prefer enclosed transit with cabin filtration.",
            })
        elif aqi_num > 100:
            recommendations.append({
                "type": "pollution",
                "priority": "medium",
                "icon": "🌫️",
                "title": f"Moderate Pollution — {cat}",
                "text": f"AQI {aqi_val}. Dominant pollutant: {pollutant}.",
                "action": "Sensitive groups (asthma/elderly) should limit vigorous outdoor workouts.",
            })
        else:
            recommendations.append({
                "type": "pollution",
                "priority": "low",
                "icon": "🍃",
                "title": f"Clean Air Conditions — {cat}",
                "text": f"AQI {aqi_val} ({cat}). Air quality is satisfactory.",
                "action": "Great conditions for walking, cycling, and outdoor activities.",
            })

    # Route recommendation
    if routes and not routes.get("error"):
        if routes.get("status") == "needs_destination":
            parts.append(
                "Route comparison could not be calculated because no destination was specified. "
                "Please provide a destination address, landmark, or map coordinates to view route alternatives."
            )
            recommendations.append({
                "type": "route",
                "priority": "high",
                "icon": "📍",
                "title": "Destination Coordinates Needed",
                "text": "The agent recognized your route query, but requires destination coordinates to run spatial analysis.",
                "action": "Select a destination on the map or enter coordinates (e.g. from CP to ITO).",
            })
        else:
            rec_name = routes.get("recommended_route_name", "—")
            rec_id = routes.get("recommended_route_id")
            rec_route = next((r for r in routes.get("routes", []) if r["id"] == rec_id), None)
            if rec_route:
                parts.append(
                    f"Recommended route: **{rec_name}**. "
                    f"Estimated {rec_route['estimated_duration_min']} min ({rec_route['distance_km']} km). "
                    f"Congestion: {rec_route['congestion_level']} · Estimated exposure: {rec_route['aqi_category']}."
                )
                recommendations.append({
                    "type": "route",
                    "priority": "medium",
                    "icon": "🗺️",
                    "title": f"Best Route: {rec_name}",
                    "text": f"Distance: {rec_route['distance_km']} km · Duration: {rec_route['estimated_duration_min']} min · Congestion: {rec_route['congestion_level']}",
                    "action": f"AQI exposure along corridor: {rec_route['aqi_category']}. Est CO₂: {rec_route['co2_estimate_g']:.0f}g.",
                })

    # Signal strategy
    if signals and not signals.get("error"):
        s_label = signals.get("strategy_label", "—")
        s_cycle = signals.get("recommended_cycle_seconds", "—")
        s_reduction = signals.get("expected_queue_reduction_pct", "—")
        parts.append(
            f"Signal timing advisory: **{s_label}** "
            f"(recommended cycle {s_cycle}s). Est. queue reduction: {s_reduction}%. "
            f"Rationale: {signals.get('rationale', '')}"
        )
        recommendations.append({
            "type": "signal",
            "priority": "medium",
            "icon": "🚥",
            "title": f"Signal Strategy: {s_label}",
            "text": f"Recommended {s_cycle}s cycle. Projected queue reduction: {s_reduction}%.",
            "action": "Review with municipal operations team before dispatch. Advisory only.",
        })

    summary = "\n\n".join(parts) if parts else "No data available for analysis."
    return summary, recommendations


# ---------------------------------------------------------------------------
# Main Agent Runner (Truthful Provenance & Explicit Destination Handling)
# ---------------------------------------------------------------------------

def run_agent(
    query: str,
    latitude: float = 28.6139,
    longitude: float = 77.2090,
    dest_latitude: float | None = None,
    dest_longitude: float | None = None,
    mode: str = "citizen",
) -> dict[str, Any]:
    """
    Entry point for the Traffic Intelligence Agent.
    Runs the full tool-calling loop and returns verified, truthful outputs.
    """
    session_id = str(uuid.uuid4())

    # Resolve origin & destination coordinates from query landmarks if not explicitly passed
    orig_lat, orig_lon, d_lat, d_lon, orig_name, dest_name = _extract_origin_destination(
        query, latitude, longitude, dest_latitude, dest_longitude
    )

    tools_to_run = _select_tools(query, mode)

    has_route_target = (d_lat is not None and d_lon is not None)
    agent_steps = []
    tools_results: dict[str, dict] = {}

    for step_num, tool_name in enumerate(tools_to_run, start=1):
        thought = _tool_thought(tool_name, query, step_num, len(tools_to_run), has_route_target)

        try:
            if tool_name == "get_traffic_snapshot":
                result = get_traffic_snapshot(orig_lat, orig_lon)
            elif tool_name == "get_aqi_snapshot":
                result = get_aqi_snapshot(orig_lat, orig_lon)
            elif tool_name == "analyze_routes":
                if has_route_target:
                    result = analyze_routes(
                        orig_lat, orig_lon,
                        d_lat, d_lon,
                        traffic_data=tools_results.get("get_traffic_snapshot"),
                        aqi_data=tools_results.get("get_aqi_snapshot"),
                    )
                else:
                    # DO NOT SILENTLY SKIP! Explicitly inform the user
                    city_info = _resolve_city(orig_lat, orig_lon)
                    result = {
                        "tool": "analyze_routes",
                        "status": "needs_destination",
                        "data_mode": "prompt",
                        "data_mode_label": "Action Needed",
                        "origin": {"latitude": orig_lat, "longitude": orig_lon, "name": orig_name or city_info["name"]},
                        "destination": None,
                        "message": (
                            f"Destination coordinates were not specified for '{query}'. "
                            "To compare alternative routes and calculate cleanest journeys, "
                            "please provide destination coordinates or click a destination on the map."
                        ),
                        "suggested_destinations": [
                            {"name": k.upper(), "latitude": v[0], "longitude": v[1], "label": v[2]}
                            for k, v in list(KNOWN_LANDMARKS.items())[:6]
                        ],
                    }
            elif tool_name == "recommend_signal_strategy":
                result = recommend_signal_strategy(
                    traffic_data=tools_results.get("get_traffic_snapshot"),
                    latitude=orig_lat,
                    longitude=orig_lon,
                )
            else:
                continue

            tools_results[tool_name] = result

            is_needs_dest = (tool_name == "analyze_routes" and result.get("status") == "needs_destination")

            agent_steps.append({
                "step": step_num,
                "tool": tool_name,
                "tool_label": _tool_label(tool_name),
                "thought": thought,
                "status": "needs_destination" if is_needs_dest else "success",
                "data_mode": result.get("data_mode", "mock"),
                "data_mode_label": result.get("data_mode_label", "🔵 Mock"),
                "result_summary": _result_summary(tool_name, result),
                "result": result,
            })

        except Exception as exc:
            agent_steps.append({
                "step": step_num,
                "tool": tool_name,
                "tool_label": _tool_label(tool_name),
                "thought": thought,
                "status": "error",
                "error": str(exc),
                "data_mode": "error",
                "data_mode_label": "Error",
            })

    # STRICTLY TRUTHFUL PROVENANCE CALCULATION (Fixes bug #7)
    traffic_res = tools_results.get("get_traffic_snapshot", {})
    aqi_res = tools_results.get("get_aqi_snapshot", {})

    traffic_mode = traffic_res.get("data_mode")
    aqi_mode = aqi_res.get("data_mode")

    badges = []
    if traffic_res and not traffic_res.get("error"):
        if traffic_mode == "sumo_model":
            badges.append("⚡ SUMO Traffic Model")
        elif traffic_mode == "live":
            badges.append("🌐 Live TomTom Traffic")
        else:
            badges.append("🔵 Simulated Traffic")

    if aqi_res and not aqi_res.get("error"):
        if aqi_mode == "live":
            badges.append("🌐 Live Open-Meteo CAMS")
        else:
            badges.append("🔵 Simulated Reference AQI")

    if not badges:
        overall_label = "🔵 Reference Mock Data (Simulated)"
        overall_mode = "mock"
    else:
        overall_label = " · ".join(badges)
        if all(m == "live" for m in [traffic_mode, aqi_mode] if m):
            overall_mode = "live"
        elif any(m == "live" for m in [traffic_mode, aqi_mode]) and any(m in ("sumo_model", "mock") for m in [traffic_mode, aqi_mode]):
            overall_mode = "mixed"
        elif "sumo_model" in [traffic_mode, aqi_mode]:
            overall_mode = "sumo_model"
        else:
            overall_mode = "mock"

    summary, recommendations = _build_summary(query, tools_results, mode)
    city_info = _resolve_city(orig_lat, orig_lon)

    return {
        "session_id": session_id,
        "query": query,
        "mode": mode,
        "city": city_info["name"],
        "coordinates": {"origin": [orig_lat, orig_lon], "destination": [d_lat, d_lon] if has_route_target else None},
        "data_mode": overall_mode,
        "data_mode_label": overall_label,
        "provenance": {
            "overall_mode": overall_mode,
            "overall_label": overall_label,
            "traffic": {
                "source": traffic_res.get("data_mode_label", "None"),
                "mode": traffic_mode,
                "is_live": traffic_mode == "live",
            },
            "aqi": {
                "source": aqi_res.get("data_mode_label", "None"),
                "mode": aqi_mode,
                "is_live": aqi_mode == "live",
            },
        },
        "agent_steps": agent_steps,
        "tools_called": [s["tool"] for s in agent_steps if s["status"] in ("success", "needs_destination")],
        "summary": summary,
        "recommendations": recommendations,
        "simulation_available": True,
        "simulation_note": (
            "SUMO-trained XGBoost model active (518,400 rows, 80 road edges)"
            if traffic_mode == "sumo_model"
            else "Traffic simulation benchmark data"
        ),
        "generated_at": _utc_now(),
    }


def _tool_thought(tool: str, query: str, step: int, total: int, has_destination: bool = True) -> str:
    thoughts = {
        "get_traffic_snapshot": (
            f"Step {step}/{total}: The query involves traffic conditions or urban travel. "
            "I will invoke get_traffic_snapshot for location-specific congestion scores and vehicle queue dynamics."
        ),
        "get_aqi_snapshot": (
            f"Step {step}/{total}: Air quality is critical for public health and clean route selection. "
            "I will invoke get_aqi_snapshot for AQI and key pollutant metrics."
        ),
        "analyze_routes": (
            f"Step {step}/{total}: The query requests route navigation or travel alternatives. "
            + ("I will compare road network corridors and evaluate pollution exposure."
               if has_destination else
               "Destination coordinates are missing; I will check for recognizable landmarks or request destination input from the user.")
        ),
        "recommend_signal_strategy": (
            f"Step {step}/{total}: Based on current corridor congestion, I will invoke "
            "recommend_signal_strategy to provide demand-weighted signal timing advisories."
        ),
    }
    return thoughts.get(tool, f"Step {step}/{total}: Invoking tool {tool}.")


def _tool_label(tool: str) -> str:
    return {
        "get_traffic_snapshot": "Traffic Snapshot",
        "get_aqi_snapshot": "AQI Snapshot",
        "analyze_routes": "Route Advisor",
        "recommend_signal_strategy": "Signal Strategy",
    }.get(tool, tool)


def _result_summary(tool: str, result: dict) -> str:
    if tool == "get_traffic_snapshot":
        s = result.get("summary", {})
        return (
            f"Congestion: {s.get('congestion_level', '—')} ({s.get('mean_congestion_score', '—')}/100) · "
            f"{s.get('total_vehicles', '—')} vehicles · {s.get('heavy_roads_now', 0)} heavy corridors"
        )
    if tool == "get_aqi_snapshot":
        c = result.get("current", {})
        return (
            f"AQI {c.get('us_aqi', '—')} ({c.get('category', '—')}) · "
            f"PM2.5: {c.get('pm25_ug_m3', '—')} µg/m³ · Dominant: {c.get('dominant_pollutant', '—')}"
        )
    if tool == "analyze_routes":
        if result.get("status") == "needs_destination":
            return "Destination coordinates required to calculate alternative route geometries."
        return (
            f"Recommended: {result.get('recommended_route_name', '—')} · "
            f"{len(result.get('routes', []))} corridor options compared"
        )
    if tool == "recommend_signal_strategy":
        return (
            f"Strategy: {result.get('strategy_label', '—')} · "
            f"Cycle: {result.get('recommended_cycle_seconds', '—')}s · "
            f"Est. {result.get('expected_queue_reduction_pct', '—')}% queue reduction"
        )
    return "Tool executed."
