"""Camera ROI calibration and fair emissions-aware phase allocation."""
from __future__ import annotations

from typing import Any

from app.services.emissions import normalize_vehicle_counts, VEHICLE_PROFILES

MOVEMENTS = ["north_south_through", "east_west_through", "north_south_turn", "east_west_turn"]


def point_in_polygon(x: float, y: float, polygon: list[list[float]]) -> bool:
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        intersects = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi)
        if intersects:
            inside = not inside
        j = i
    return inside


def normalize_rois(approach_rois: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not approach_rois:
        return []
    if len(approach_rois) > 8:
        raise ValueError("A maximum of 8 approach regions is supported")
    cleaned = []
    seen = set()
    for index, item in enumerate(approach_rois):
        identifier = str(item.get("id") or f"approach_{index + 1}").strip()[:40]
        name = str(item.get("name") or identifier).strip()[:60]
        if not identifier or identifier in seen:
            raise ValueError("Approach region IDs must be non-empty and unique")
        polygon = item.get("polygon")
        if not isinstance(polygon, list) or not 3 <= len(polygon) <= 20:
            raise ValueError(f"Approach '{identifier}' must have 3 to 20 polygon points")
        points = []
        for point in polygon:
            if not isinstance(point, (list, tuple)) or len(point) != 2:
                raise ValueError("Each polygon point must be [x, y]")
            x, y = float(point[0]), float(point[1])
            if not (0 <= x <= 1 and 0 <= y <= 1):
                raise ValueError("ROI coordinates must be normalized between 0 and 1")
            points.append([x, y])
        cleaned.append({"id": identifier, "name": name, "polygon": points})
        seen.add(identifier)
    return cleaned


def allocate_greens(weights: list[float], cycle_seconds: int, min_green: int = 8, max_share: float = 0.45) -> list[int]:
    count = len(weights)
    if not count:
        return []
    clearance = count * 4
    green_budget = max(count * min_green, int(cycle_seconds) - clearance)
    greens = [min_green] * count
    remaining = max(0, green_budget - sum(greens))
    normalized = [max(0.01, float(weight)) for weight in weights]
    active = set(range(count))
    while remaining > 0 and active:
        total_weight = sum(normalized[index] for index in active)
        if total_weight <= 0:
            total_weight = len(active)
            normalized = [1.0 if index in active else normalized[index] for index in range(count)]
        allocated = 0
        for index in list(active):
            share = normalized[index] / total_weight
            max_green = max(min_green, int(green_budget * max_share))
            capacity = max(0, max_green - greens[index])
            addition = min(capacity, int(remaining * share))
            if addition:
                greens[index] += addition
                allocated += addition
            if greens[index] >= max_green:
                active.discard(index)
        remaining -= allocated
        if allocated == 0:
            for index in list(active):
                if remaining <= 0:
                    break
                max_green = max(min_green, int(green_budget * max_share))
                if greens[index] < max_green:
                    greens[index] += 1
                    remaining -= 1
                else:
                    active.discard(index)
    # If max-share caps leave slack, distribute it round-robin without exceeding cap.
    index = 0
    while remaining > 0 and any(g < max(min_green, int(green_budget * max_share)) for g in greens):
        target = index % count
        if greens[target] < max(min_green, int(green_budget * max_share)):
            greens[target] += 1
            remaining -= 1
        index += 1
    return greens


def emissions_aware_plan(approach_demand: dict[str, Any] | None, cycle_seconds: int = 90) -> dict[str, Any]:
    cycle = max(40, min(180, int(cycle_seconds)))
    demand = approach_demand or {}
    if not all(key in demand for key in MOVEMENTS):
        fallback_greens = allocate_greens([1.0] * len(MOVEMENTS), cycle)
        fallback_phases = [{"name": movement.replace("_", " ").title(), "movement": movement, "green_seconds": fallback_greens[index], "yellow_seconds": 3, "all_red_seconds": 1, "demand_weight": 1.0} for index, movement in enumerate(MOVEMENTS)]
        actual_cycle = sum(item["green_seconds"] + item["yellow_seconds"] + item["all_red_seconds"] for item in fallback_phases)
        return {
            "cycle_seconds": actual_cycle,
            "phases": fallback_phases,
            "optimized": False,
            "optimization_method": "equal_split_no_camera_roi",
            "rationale": "No camera approach regions were calibrated. An equal-split review draft is provided; no directional optimization is claimed.",
        }
    keys = ["north_south_through", "east_west_through", "north_south_turn", "east_west_turn"]
    # Accept the four canonical movements or names mapped from ROI labels.
    values = []
    per_approach = []
    for key in keys:
        item = demand.get(key) or {}
        if isinstance(item, (int, float)):
            counts = {"car": int(item)}
        else:
            counts = normalize_vehicle_counts(item.get("counts") if isinstance(item, dict) else {})
            total = item.get("count") if isinstance(item, dict) else None
            if total is not None and not any(counts.values()):
                counts["car"] = max(0, int(total))
        vehicle_count = sum(counts.values())
        # Local-pollutant intensity proxy (NOx + PM + CO), excluding climate CO2.
        # This is a relative weighting signal, not a measured junction emission rate.
        intensity = 0.0
        for vehicle_class, count in counts.items():
            profile = VEHICLE_PROFILES[vehicle_class]
            intensity += count * (float(profile["nox_g_km"]) + float(profile["pm_g_km"]) + float(profile["co_g_km"]))
        values.append({"movement": key, "vehicle_count": vehicle_count, "emission_intensity_proxy": intensity, "counts": counts})
        per_approach.append((vehicle_count, intensity))
    max_count = max([item[0] for item in per_approach] + [1])
    max_emission = max([item[1] for item in per_approach] + [1.0])
    weights = []
    for count, emission in per_approach:
        volume_component = count / max_count
        emission_component = emission / max_emission
        weights.append(max(0.05, 0.70 * volume_component + 0.30 * emission_component))
    greens = allocate_greens(weights, cycle)
    phases = []
    for index, movement in enumerate(keys):
        phases.append({
            "name": movement.replace("_", " ").title(), "movement": movement,
            "green_seconds": greens[index], "yellow_seconds": 3, "all_red_seconds": 1,
            "demand_weight": round(weights[index], 4),
            "observed_vehicle_count": values[index]["vehicle_count"],
            "emission_intensity_proxy": round(values[index]["emission_intensity_proxy"], 3),
        })
    final_cycle = sum(item["green_seconds"] + item["yellow_seconds"] + item["all_red_seconds"] for item in phases)
    return {
        "cycle_seconds": final_cycle,
        "phases": phases,
        "optimized": True,
        "optimization_method": "volume_70_percent_plus_nox_pm_co_proxy_30_percent_with_min_green_and_45_percent_cap",
        "rationale": "Green time is allocated using calibrated approach-level vehicle counts (70%) and a relative NOx + PM + CO vehicle-class intensity proxy (30%); CO2 is excluded from this local-air-pollutant weighting. Each approach keeps a minimum green and no approach receives more than 45% of the green budget. This is a candidate plan for simulation and human review, not a certified signal controller plan.",
        "approach_evidence": values,
    }
