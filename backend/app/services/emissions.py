"""Transparent prototype road-emissions estimator.

Factors are indicative BS-VI g/km values from an Indian source-apportionment
report. CO2 is derived from explicit, editable per-class fuel-use assumptions.
This is not a local fleet inventory or a speed/load-resolved emissions model.
"""
from __future__ import annotations

from typing import Any

FACTOR_VERSION = "india-bsvi-indicative-v1"
FACTOR_SOURCE = {
    "title": "MPCB, Draft Report: Air Quality Assessment, Emission Inventory & Source Apportionment Study for Nashik City (Feb 2022), Table 7.6",
    "url": "https://www.mpcb.gov.in/sites/default/files/inline-files/Nashik%20%20SA%26EI%20Report_Feb2022.pdf",
    "notes": "BS-VI factors in g/km, with the report citing TransportPolicy.net. The selected values are indicative certification/inventory factors, not a local fleet average and not Kanpur fleet-average on-road measurements.",
}
CO2_SOURCE = {
    "title": "AEEE, Green Vehicle Rating Methodology White Paper (2021), Table 1",
    "url": "https://green-vehicle-rating.aeee.in/wp-content/uploads/2021/06/GVR-White-Paper.pdf",
    "notes": "Fuel carbon factors used for the prototype arithmetic: petrol 2,296.35 g CO2/L and diesel 2,637.07 g CO2/L. Vehicle fuel-use rates below are editable project assumptions, not source measurements. The CNG carbon factor (2,750 g CO2/kg) is an explicit prototype assumption, not sourced from this AEEE table; replace it with a cited local factor before field reporting.",
}

# Values: PM, NOx and CO in g/km. These are pollutant-specific BS-VI indicative
# values from the source report. CO2 is computed from fuel use below.
VEHICLE_PROFILES: dict[str, dict[str, Any]] = {
    "car": {
        "label": "Passenger car · petrol BS-VI proxy", "pm_g_km": 0.005, "nox_g_km": 0.06, "co_g_km": 1.0,
        "fuel": "petrol", "fuel_consumption_per_100km": 6.5, "fuel_unit": "L/100 km", "co2_g_per_fuel_unit": 2296.35,
    },
    "motorbike": {
        "label": "Two-wheeler · petrol BS-VI proxy", "pm_g_km": 0.0045, "nox_g_km": 0.06, "co_g_km": 1.0,
        "fuel": "petrol", "fuel_consumption_per_100km": 2.5, "fuel_unit": "L/100 km", "co2_g_per_fuel_unit": 2296.35,
    },
    "bus": {
        "label": "Bus · CNG BS-VI proxy", "pm_g_km": 0.01, "nox_g_km": 0.46, "co_g_km": 4.0,
        "fuel": "cng", "fuel_consumption_per_100km": 25.0, "fuel_unit": "kg/100 km", "co2_g_per_fuel_unit": 2750.0,
    },
    "truck": {
        "label": "Heavy-duty diesel · BS-VI proxy", "pm_g_km": 0.01, "nox_g_km": 0.4, "co_g_km": 1.5,
        "fuel": "diesel", "fuel_consumption_per_100km": 30.0, "fuel_unit": "L/100 km", "co2_g_per_fuel_unit": 2637.07,
    },
    "bicycle": {
        "label": "Bicycle · zero tailpipe emission", "pm_g_km": 0.0, "nox_g_km": 0.0, "co_g_km": 0.0,
        "fuel": "none", "fuel_consumption_per_100km": 0.0, "fuel_unit": "none", "co2_g_per_fuel_unit": 0.0,
    },
}

ALIASES = {
    "car": "car", "cars": "car", "bus": "bus", "buses": "bus",
    "motorbike": "motorbike", "motorcycle": "motorbike", "motorcycles": "motorbike",
    "two_wheeler": "motorbike", "two_wheelers": "motorbike",
    "truck": "truck", "trucks": "truck", "heavy_vehicle": "truck",
    "bicycle": "bicycle", "bicycles": "bicycle", "bike": "motorbike",
}


def normalize_vehicle_counts(counts: dict[str, Any] | None) -> dict[str, int]:
    result = {key: 0 for key in VEHICLE_PROFILES}
    for raw_key, raw_value in (counts or {}).items():
        key = ALIASES.get(str(raw_key).strip().lower())
        if not key:
            continue
        try:
            value = int(raw_value)
        except (TypeError, ValueError):
            continue
        result[key] += max(0, min(value, 1_000_000))
    return result


def emissions_for_vehicle_km(vehicle_km_by_class: dict[str, float]) -> dict[str, Any]:
    """Calculate pollutant totals from actual/estimated vehicle-km by class."""
    totals = {"co2_g": 0.0, "nox_g": 0.0, "pm_g": 0.0, "co_g": 0.0}
    breakdown: dict[str, Any] = {}
    normalized_km: dict[str, float] = {}
    for raw_key, raw_value in (vehicle_km_by_class or {}).items():
        key = ALIASES.get(str(raw_key).strip().lower())
        if not key:
            continue
        try:
            km = max(0.0, min(float(raw_value), 10_000_000.0))
        except (TypeError, ValueError):
            continue
        normalized_km[key] = normalized_km.get(key, 0.0) + km
    for vehicle_class, km in normalized_km.items():
        profile = VEHICLE_PROFILES[vehicle_class]
        co2_rate = float(profile["fuel_consumption_per_100km"]) / 100.0 * float(profile["co2_g_per_fuel_unit"])
        item = {
            "vehicle_km": round(km, 4),
            "co2_g": round(km * co2_rate, 4),
            "nox_g": round(km * float(profile["nox_g_km"]), 4),
            "pm_g": round(km * float(profile["pm_g_km"]), 4),
            "co_g": round(km * float(profile["co_g_km"]), 4),
            "profile": profile["label"],
        }
        breakdown[vehicle_class] = item
        for metric in totals:
            totals[metric] += item[metric]
    return {
        "factor_version": FACTOR_VERSION,
        "factor_source": FACTOR_SOURCE,
        "co2_method_source": CO2_SOURCE,
        "totals": {key: round(value, 4) for key, value in totals.items()},
        "vehicle_km": round(sum(normalized_km.values()), 4),
        "vehicle_km_by_class": {key: round(value, 4) for key, value in normalized_km.items()},
        "by_class": breakdown,
        "units": {"vehicle_km": "vehicle-km", "co2_g": "g", "nox_g": "g", "pm_g": "g", "co_g": "g"},
        "assumptions": [
            "BS-VI pollutant factors are indicative g/km values; actual emissions vary by age, fuel, maintenance, speed, load and driving cycle.",
            "Default fuel consumption rates are project assumptions and should be replaced with local fleet data where available.",
            "This estimate covers tailpipe activity only; it excludes brake/tyre/road dust, cold starts and atmospheric chemistry.",
            "Ambient AQI is independent and must not be inferred directly from these emissions totals.",
        ],
    }


def estimate_from_counts(vehicle_counts: dict[str, Any], segment_distance_km: float) -> dict[str, Any]:
    distance = float(segment_distance_km)
    if not 0.001 <= distance <= 100:
        raise ValueError("segment_distance_km must be between 0.001 and 100 km")
    counts = normalize_vehicle_counts(vehicle_counts)
    vehicle_km = {key: count * distance for key, count in counts.items()}
    result = emissions_for_vehicle_km(vehicle_km)
    result.update({
        "method": "vehicle count × operator-specified corridor distance × indicative factor",
        "vehicle_counts": counts,
        "segment_distance_km": distance,
        "source_quality": "estimated_from_video_counts_and_operator_distance_assumption",
    })
    return result


def public_factor_catalog() -> dict[str, Any]:
    return {
        "factor_version": FACTOR_VERSION,
        "factor_source": FACTOR_SOURCE,
        "co2_method_source": CO2_SOURCE,
        "profiles": VEHICLE_PROFILES,
        "method_note": "CO2 is derived from the displayed fuel-consumption assumptions. PM/NOx/CO use the cited indicative BS-VI g/km values. This profile is for prototype comparison only and is not a Kanpur fleet inventory.",
    }
