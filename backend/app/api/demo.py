"""Public, truthful diagnostics for the no-login hackathon demo."""
from fastapi import APIRouter
from app.core.config import settings
from app.services.traffic_detection import status as traffic_detection_status
from app.services.aqi_vision import status as aqi_vision_status
from app.services.sumo_runner import runtime_status as sumo_runtime_status
from app.services.traffic_forecast import get_simulation_snapshot

router = APIRouter(prefix="/demo", tags=["Hackathon demo"])


def _forecast_status() -> dict:
    try:
        snapshot = get_simulation_snapshot()
        return {
            "ready": True,
            "mode": snapshot.get("mode"),
            "road_count": snapshot.get("road_count"),
            "source": snapshot.get("source"),
            "note": snapshot.get("note"),
        }
    except Exception as exc:
        return {"ready": False, "mode": "unavailable", "error": str(exc)}


@router.get("/status")
def demo_status():
    camera = traffic_detection_status()
    aqi_model = aqi_vision_status()
    sumo = sumo_runtime_status()
    forecast = _forecast_status()
    return {
        "mode": "open-demo" if settings.demo_mode else "unavailable",
        "authentication_required": False,
        "shared_demo_data": True,
        "real_personal_data_allowed": False,
        "message": "Open hackathon demo. Citizens and authorities share one synthetic workspace. Do not enter real personal or sensitive operational data.",
        "providers": {
            "tomtom_traffic_configured": bool(settings.tomtom_api_key),
            "openaq_configured": bool(settings.openaq_api_key),
            "groq_configured": bool(settings.groq_api_key),
            "osrm_configured": bool(settings.osrm_base_url),
        },
        "runtime": {
            "traffic_camera_detection": camera,
            "aqi_image_model": aqi_model,
            "traffic_forecast_model": forecast,
            "real_sumo_simulator": sumo,
        },
        "features": {
            "aqi_station_observations": "requires imported observations or a configured provider",
            "aqi_image_model": "paired-image model inference; output is not official AQI",
            "traffic_image_model": "requires YOLO runtime and shipped weights",
            "traffic_forecast": "trained XGBoost model on bundled SUMO-generated scenario data",
            "signal_plan_simulation": "runs SUMO when SUMO + TraCI are installed; otherwise uses a labelled heuristic fallback",
            "physical_signal_control": "disabled",
            "ticketing": "journey request only; no ticket or payment issued",
        },
    }
