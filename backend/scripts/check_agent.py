#!/usr/bin/env python3
"""Standalone health check for the UrbanSaarthi Traffic Intelligence Agent.

Needs NOTHING installed beyond Python 3.11+ (no FastAPI, pytest, xgboost or internet required):
the agent engine only uses the standard library and falls back to clearly-labelled mock data
whenever httpx / xgboost / the network are unavailable.

    python scripts/check_agent.py          # run from backend/, or from anywhere

Part A = must-pass checks (exit code 1 if any fail).
Part B = known issues found in review; reported as STILL PRESENT / FIXED but never fail the run.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import agent_engine as ae  # noqa: E402

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((PASS if ok else FAIL, name, detail))
    print(f"  [{PASS if ok else FAIL}] {name}" + (f" -- {detail}" if detail and not ok else ""))


ROUTE = dict(latitude=28.6315, longitude=77.2167, dest_latitude=28.6287, dest_longitude=77.2411)
ALLOWED_MODES = {"live", "sumo_model", "mock"}

print("\nPART A - must-pass checks")

# 1. traffic-only query
r = ae.run_agent("Show me traffic", mode="citizen")
check("traffic query runs traffic tool", "get_traffic_snapshot" in r["tools_called"], str(r["tools_called"]))

# 2. AQI query
r = ae.run_agent("What is the air quality near me?", mode="citizen")
aqi_step = next((s for s in r["agent_steps"] if s["tool"] == "get_aqi_snapshot"), None)
check("AQI query returns AQI value", bool(aqi_step) and aqi_step["status"] == "success"
      and isinstance(aqi_step["result"]["current"].get("us_aqi"), (int, float)))
aqi_mode = aqi_step["data_mode"] if aqi_step else "?"
print(f"        (AQI data source in this run: {aqi_mode} - 'live' needs internet, 'mock' is the offline fallback)")

# 3. route query with coordinates
r = ae.run_agent("Best route from Connaught Place to ITO", mode="citizen", **ROUTE)
rt = next((s for s in r["agent_steps"] if s["tool"] == "analyze_routes"), None)
check("route query runs analyze_routes", bool(rt) and rt["status"] == "success", str(r["tools_called"]))
if rt:
    routes = rt["result"]["routes"]
    check("route tool compares 3 options", len(routes) == 3)
    check("exactly one route is recommended", sum(1 for x in routes if x.get("recommended")) == 1)
    check("recommended id matches flagged route",
          any(x["id"] == rt["result"]["recommended_route_id"] and x.get("recommended") for x in routes))

# 4. authority + signal query
r = ae.run_agent("Suggest signal timing for the congested junction", mode="authority")
sg = next((s for s in r["agent_steps"] if s["tool"] == "recommend_signal_strategy"), None)
check("authority signal query returns a strategy", bool(sg) and sg["status"] == "success")
if sg:
    ph = sg["result"]["phases"]
    check("signal phases have positive green times", all(p["green_seconds"] > 0 for p in ph))
    check("recommended cycle equals sum of phases",
          sg["result"]["recommended_cycle_seconds"] == sum(p["green_seconds"] + p["yellow_seconds"] + p["all_red_seconds"] for p in ph))

# 5. robustness: odd input must never raise, output must be JSON-serialisable (FastAPI requirement)
odd = ["???", "x" * 500, "ट्रैफिक कैसा है", "SELECT * FROM users;--", "   hello   "]
ok_all, bad = True, ""
for q in odd:
    try:
        json.dumps(ae.run_agent(q, latitude=90, longitude=-180, mode="authority"))
    except Exception as exc:  # noqa: BLE001
        ok_all, bad = False, f"{q[:20]!r}: {type(exc).__name__}: {exc}"
        break
check("odd/edge inputs never raise and serialise to JSON", ok_all, bad)

# 6. provenance labelling
r = ae.run_agent("traffic and air quality", mode="citizen")
check("every step carries an allowed data_mode", all(s["data_mode"] in ALLOWED_MODES for s in r["agent_steps"]))
if any(s["data_mode"] == "mock" for s in r["agent_steps"]):
    check("mock steps never report overall 'live'", r["data_mode"] != "live")

# 7. status helpers
check("/tools-style keyword table covers all 4 tools", set(ae._TOOL_KEYWORDS) == {
    "get_traffic_snapshot", "get_aqi_snapshot", "analyze_routes", "recommend_signal_strategy"})

failed = [x for x in results if x[0] == FAIL]
print(f"\n  Part A: {len(results) - len(failed)}/{len(results)} passed")

# ---------------------------------------------------------------------------
print("\nPART B - known issues found in code review (informational)")


def known(name: str, still_present: bool, detail: str) -> None:
    print(f"  [{'STILL PRESENT' if still_present else 'FIXED'}] {name}\n        {detail}")


# K1 keyword router uses substring matching ('co' matches 'Connaught', 'to' matches 'today'/'photo')
sel = ae._select_tools("Tell me about Connaught Place traffic", "citizen")
known("K1 intent router substring matching", "get_aqi_snapshot" in sel,
      f"'...Connaught Place traffic' selects {sel} (AQI is pulled in by the 'co' in 'Connaught')")
sel2 = ae._select_tools("How is the weather today", "citizen")
known("K1b off-topic query triggers route tool", "analyze_routes" in sel2,
      f"'How is the weather today' selects {sel2}")

# K2 route intent without destination is dropped silently
r = ae.run_agent("Best route from Connaught Place to ITO", mode="citizen")
said = "destination" in (r["summary"] + json.dumps(r["recommendations"])).lower()
known("K2 missing destination not reported to the user", ("analyze_routes" not in r["tools_called"]) and not said,
      f"tools_called={r['tools_called']}; response never says a destination is required")

# K3 label vs recommendation thresholds
fake = {"get_traffic_snapshot": {"summary": {"mean_congestion_score": 68.0, "congestion_level": ae._congestion_label(68.0),
                                             "total_vehicles": 100, "heavy_roads_now": 3, "queue_change_percent": 0.0}}}
_, recs = ae._build_summary("traffic", fake, "citizen")
title = recs[0]["title"] if recs else ""
label = ae._congestion_label(68.0)
mismatch = ("Moderate" in title and label != "Moderate") or ("Severe" in title and label != "Severe")
known("K3 congestion label and recommendation disagree", mismatch, f"score 68 -> label '{label}' but recommendation '{title}'")

# K4 route 'alternatives' are fixed multipliers of one AQI/congestion value
ratios = []
for base in (60, 120, 200):
    t = {"summary": {"mean_congestion_score": 50.0}, "data_mode": "mock"}
    a = {"current": {"us_aqi": base}, "data_mode": "mock"}
    eco = next(x for x in ae.analyze_routes(28.63, 77.21, 28.62, 77.24, t, a)["routes"] if x["id"] == "route_eco")
    ratios.append(round(eco["aqi_exposure"] / base, 2))
known("K4 alternative routes are synthetic", len(set(ratios)) == 1,
      f"'Eco route' AQI is always {ratios[0]}x the single input AQI ({ratios}); no real per-route geometry or pollution data")

# K5/K6 need the SUMO branch -> stub the model module (real one needs xgboost). Shape copied from get_simulation_snapshot().
name = "app.services.traffic_simulation"
orig = sys.modules.get(name)
stub = types.ModuleType(name)
stub.get_simulation_snapshot = lambda: {
    "mode": "sumo_model", "run_id": 35, "road_count": 80, "vehicles_now": 410, "queue_now": 210,
    "predicted_queue_30min": 240, "queue_change_percent": 14.3, "heavy_roads_now": 14, "heavy_roads_30min": 18,
    "model_metrics": {}, "roads": [{"road": f"e{i}", "queue_now": q, "predicted_queue_30min": q + 2, "level_now": lv, "level_30min": lv}
                                   for i, (q, lv) in enumerate([(14, "Heavy"), (9, "Moderate"), (1, "Free")] * 4)],
}
sys.modules[name] = stub
real_aqi = ae.get_aqi_snapshot
ae.get_aqi_snapshot = lambda la, lo: {"tool": "get_aqi_snapshot", "data_mode": "mock", "data_mode_label": "mock", "latitude": la, "longitude": lo,
                                       "current": {"us_aqi": 100, "category": "Moderate", "pm25_ug_m3": 20, "dominant_pollutant": "PM2.5"}, "health_advice": ""}
try:
    r1 = ae.run_agent("traffic and air quality", latitude=28.63, longitude=77.21)
    r2 = ae.run_agent("traffic and air quality", latitude=12.97, longitude=77.59)  # Bengaluru
    roads1 = [x["road"] for x in r1["agent_steps"][0]["result"]["roads"]]
    roads2 = [x["road"] for x in r2["agent_steps"][0]["result"]["roads"]]
    known("K5 overall label claims Open-Meteo even when AQI was mock (SUMO stubbed)",
          "Open-Meteo" in r1["data_mode_label"] and any(s["data_mode"] == "mock" for s in r1["agent_steps"]),
          f"AQI step mode=mock, overall label='{r1['data_mode_label']}'")
    known("K6 traffic result ignores the requested coordinates (SUMO stubbed)", roads1 == roads2,
          "Delhi and Bengaluru requests return the same road list - the SUMO data is a fixed synthetic 80-edge grid")
finally:
    ae.get_aqi_snapshot = real_aqi
    if orig is not None:
        sys.modules[name] = orig
    else:
        sys.modules.pop(name, None)

print("\nResult:", "OK - all must-pass checks passed" if not failed else f"{len(failed)} must-pass check(s) FAILED")
sys.exit(1 if failed else 0)
