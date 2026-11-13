from __future__ import annotations

from types import SimpleNamespace

from app.services.agents import base as google_base
from app.services.agents import authority_agent
from app.services import traffic_ops_agent
from app.api import agent as agent_api


class FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _candidate(text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def test_google_model_defaults_and_environment_overrides(monkeypatch):
    monkeypatch.delenv("GOOGLE_AI_PRIMARY_MODEL", raising=False)
    monkeypatch.delenv("GOOGLE_AI_FALLBACK_MODEL", raising=False)
    primary, fallback = google_base.get_google_models()
    assert primary == "gemini-3.8-flash"
    assert fallback == "gemma-4-26b-a4b-it"

    monkeypatch.setenv("GOOGLE_AI_PRIMARY_MODEL", "gemini-test-primary")
    monkeypatch.setenv("GOOGLE_AI_FALLBACK_MODEL", "gemma-test-fallback")
    assert google_base.get_google_models() == ("gemini-test-primary", "gemma-test-fallback")


def test_google_api_key_is_server_side_and_optional(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(google_base.settings, "gemini_api_key", "")
    assert google_base.get_google_api_key() == ""
    assert google_base.get_llm_provider() == ("fallback", None, None)

    monkeypatch.setenv("GEMINI_API_KEY", "server-secret")
    assert google_base.get_google_api_key() == "server-secret"
    provider, key, model = google_base.get_llm_provider()
    assert (provider, key, model) == ("google", "server-secret", google_base.get_google_models()[0])


def test_gemini_primary_model_returns_actual_model_used(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GOOGLE_AI_PRIMARY_MODEL", "gemini-3.8-flash")
    calls = []

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        return FakeResponse(200, _candidate("Evidence-based answer"))

    monkeypatch.setattr(google_base.httpx, "post", fake_post)
    text, model = google_base.call_llm_synthesis_with_info("system", "question", [{"queue": 7}])
    assert text == "Evidence-based answer"
    assert model == "gemini-3.8-flash"
    assert len(calls) == 1
    assert calls[0][0].endswith("/gemini-3.8-flash:generateContent")
    assert calls[0][1]["headers"]["x-goog-api-key"] == "test-key"
    assert "systemInstruction" in calls[0][1]["json"]
    assert "evidence_json" in calls[0][1]["json"]["contents"][0]["parts"][0]["text"]


def test_gemma_fallback_is_used_when_gemini_is_rate_limited(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GOOGLE_AI_PRIMARY_MODEL", "gemini-3.8-flash")
    monkeypatch.setenv("GOOGLE_AI_FALLBACK_MODEL", "gemma-4-26b-a4b-it")
    urls = []

    def fake_post(url, **kwargs):
        urls.append(url)
        if "gemini-3.8-flash" in url:
            return FakeResponse(429, {"error": {"message": "rate limited"}})
        return FakeResponse(200, _candidate("Fallback answer"))

    monkeypatch.setattr(google_base.httpx, "post", fake_post)
    text, model = google_base.call_llm_synthesis_with_info("system", "question", [])
    assert text == "Fallback answer"
    assert model == "gemma-4-26b-a4b-it"
    assert len(urls) == 2


def test_google_ai_failure_fails_open_to_deterministic_mode(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(google_base.settings, "gemini_api_key", "")
    monkeypatch.setattr(google_base.httpx, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not call provider")))
    text, model = google_base.call_llm_synthesis_with_info("system", "question", [])
    assert text is None and model is None

    result = google_base.AgentExecutionResult(
        agent_role="citizen", query="test", response_text="deterministic result", steps=[],
        tools_called=[], data_mode="unavailable", data_mode_label="No provider data",
    ).to_dict()
    assert result["llm_engine"]["provider"] == "deterministic"
    assert result["llm_engine"]["is_active"] is False


def test_traffic_ops_agent_uses_complete_deterministic_tools_when_ai_unavailable(monkeypatch):
    monkeypatch.setattr(traffic_ops_agent, "_run_google_adk", lambda *args, **kwargs: (None, None, {}, "quota unavailable"))
    monkeypatch.setattr(traffic_ops_agent, "run_forecast", lambda *args, **kwargs: {
        "mode": "xgboost_model_scenario", "engine": "trained-xgboost-60min-scenario",
        "timeline": [{"minute": 0, "queue_total": 12}, {"minute": 60, "queue_total": 10}],
        "summary": {"queue_change_vs_baseline_percent": -2.0},
        "training_data": {"records": 100},
        "notes": ["Forecast, not a native vehicle simulation."],
    })
    result = traffic_ops_agent.run_ops_agent(
        report={"total_vehicles": 25, "video": {"sampled_frames": 10}, "counts": {"car": 20, "bus": 2, "truck": 3}},
        prompt="review this clip", scenario="baseline", cycle_seconds=90,
    )
    assert result["agent_mode"] == "deterministic_tool_fallback"
    assert set(result["tools_called"]) == {
        "inspect_video_evidence", "calculate_video_emissions", "draft_signal_timing", "run_60_minute_traffic_forecast"
    }
    assert result["human_review_required"] is True
    assert result["physical_dispatch_enabled"] is False
    assert result["tool_results"]["run_60_minute_traffic_forecast"]["mode"] == "xgboost_model_scenario"


def test_traffic_ops_agent_reports_google_adk_model_and_fills_skipped_tools(monkeypatch):
    monkeypatch.setattr(traffic_ops_agent, "_run_google_adk", lambda *args, **kwargs: (
        "Reviewed evidence and created a safe draft.", "gemini-3.8-flash", {"inspect_video_evidence": {"total_vehicles": 5}}, None
    ))
    monkeypatch.setattr(traffic_ops_agent, "run_forecast", lambda *args, **kwargs: {
        "mode": "xgboost_model_scenario", "engine": "forecast", "timeline": [], "summary": {}
    })
    result = traffic_ops_agent.run_ops_agent(
        report={"total_vehicles": 5, "counts": {"car": 5}}, prompt="review", scenario="baseline"
    )
    assert result["agent_mode"] == "google_adk_gemini_tool_calling"
    assert result["llm_provider"] == "Google AI"
    assert result["llm_model"] == "gemini-3.8-flash"
    assert "draft_signal_timing" in result["tool_results"]
    assert result["physical_dispatch_enabled"] is False


def test_authority_agent_never_invents_improvement_when_scenario_fails(monkeypatch):
    monkeypatch.setattr(authority_agent, "get_simulation_scenario", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("offline")))
    monkeypatch.setattr(authority_agent, "call_llm_synthesis_with_info", lambda *args, **kwargs: (None, None))
    result = authority_agent.run_authority_agent("simulate a signal intervention")
    assert result["simulation"]["status"] == "unavailable"
    assert result["simulation"]["projected_queue_delta_pct"] is None
    assert "14.5" not in result["response"]
    assert all("14.5" not in str(item) for item in result["recommendations"])


def test_authority_agent_uses_actual_forecast_queue_fields(monkeypatch):
    monkeypatch.setattr(authority_agent, "get_simulation_scenario", lambda **kwargs: {
        "mode": "trained_model_scenario",
        "timeline": [{"minute": 0, "queue_total": 120}, {"minute": 30, "queue_total": 90}],
        "models": {"horizon_30": {"level_accuracy_percent": 81.2}},
    })
    monkeypatch.setattr(authority_agent, "call_llm_synthesis_with_info", lambda *args, **kwargs: (None, None))
    result = authority_agent.run_authority_agent("simulate demand surge")
    assert result["simulation"]["status"] == "available"
    assert result["simulation"]["initial_queue_vehicles"] == 120
    assert result["simulation"]["projected_queue_vehicles"] == 90
    assert result["simulation"]["projected_queue_delta_pct"] == -25.0
    assert result["simulation"]["model_accuracy"] == 81.2


def test_agent_status_does_not_claim_live_google_connectivity_from_key_alone(monkeypatch):
    from app.services import traffic_simulation

    monkeypatch.setattr(traffic_simulation, "get_simulation_snapshot", lambda: {"mode": "sumo_model", "road_count": 80})
    monkeypatch.setattr(agent_api, "get_llm_provider", lambda: ("google", "test-key", "gemini-3.8-flash"))
    monkeypatch.setattr(agent_api, "get_google_api_key", lambda: "test-key")
    monkeypatch.setattr(agent_api, "get_google_models", lambda: ("gemini-3.8-flash", "gemma-4-26b-a4b-it"))
    monkeypatch.setattr(agent_api, "_google_adk_ready", lambda: True)

    result = agent_api.agent_status()
    assert result["llm_engine"]["credentials_configured"] is True
    assert result["llm_engine"]["connectivity"] == "not_checked"
    assert result["llm_engine"]["is_live_llm"] is False
    assert result["llm_engine"]["adk_tool_calling_ready"] is True


def test_deterministic_fallback_note_matches_google_key_state(monkeypatch):
    result_args = dict(
        agent_role="citizen", query="test", response_text="rules result", steps=[],
        tools_called=[], data_mode="forecast", data_mode_label="Forecast",
    )
    monkeypatch.setenv("GEMINI_API_KEY", "configured-key")
    configured = google_base.AgentExecutionResult(**result_args).to_dict()
    assert "credentials are configured" in configured["llm_engine"]["note"]
    assert "Configure GEMINI_API_KEY" not in configured["llm_engine"]["note"]

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(google_base.settings, "gemini_api_key", "")
    unconfigured = google_base.AgentExecutionResult(**result_args).to_dict()
    assert "not configured" in unconfigured["llm_engine"]["note"]
