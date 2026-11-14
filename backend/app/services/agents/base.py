"""
Base LLM-Agentic Orchestrator for UrbanSaarthi
----------------------------------------------
Coordinates tool selection, execution, and response synthesis.
When GEMINI_API_KEY or OPENAI_API_KEY is configured in the environment,
it uses the configured model for tool selection & reasoning.
When no API key is present, it executes via a deterministic rule-based tool-use
fallback, explicitly labelled so as never to misrepresent its capability.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable
import httpx
from app.core.config import settings

logger = logging.getLogger("urbansaarthi.agents")


class AgentExecutionResult:
    def __init__(
        self,
        agent_role: str,
        query: str,
        response_text: str,
        steps: list[dict[str, Any]],
        tools_called: list[str],
        data_mode: str,
        data_mode_label: str,
        recommendations: list[dict[str, Any]] | None = None,
        llm_mode: str = "rule_based_fallback",
        llm_model: str | None = None,
        extra_data: dict[str, Any] | None = None,
    ):
        self.agent_role = agent_role
        self.query = query
        self.response_text = response_text
        self.steps = steps
        self.tools_called = tools_called
        self.data_mode = data_mode
        self.data_mode_label = data_mode_label
        self.recommendations = recommendations or []
        self.llm_mode = llm_mode
        self.llm_model = llm_model
        self.extra_data = extra_data or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent_role": self.agent_role,
            "query": self.query,
            "response": self.response_text,
            "steps": self.steps,
            "tools_called": self.tools_called,
            "data_mode": self.data_mode,
            "data_mode_label": self.data_mode_label,
            "recommendations": self.recommendations,
            "llm_engine": {
                "mode": self.llm_mode,
                "model": self.llm_model,
                "is_active": self.llm_mode == "llm",
                "note": (
                    f"LLM tool-use active via {self.llm_model}"
                    if self.llm_mode == "llm"
                    else "Deterministic rule-based agent fallback active. Configure GEMINI_API_KEY or OPENAI_API_KEY in backend/.env for LLM reasoning."
                ),
            },
            **self.extra_data,
        }


def get_llm_provider() -> tuple[str, str | None, str | None]:
    """Returns (provider, api_key, model_name)."""
    gemini_key = os.getenv("GEMINI_API_KEY", settings.gemini_api_key).strip()
    if gemini_key:
        return "gemini", gemini_key, "gemini-1.5-flash"

    openai_key = os.getenv("OPENAI_API_KEY", settings.openai_api_key).strip()
    if openai_key:
        return "openai", openai_key, "gpt-4o-mini"

    return "fallback", None, None


def call_llm_synthesis(
    system_prompt: str,
    user_prompt: str,
    tool_results: list[dict[str, Any]],
) -> str | None:
    """Attempt synthesis using configured LLM provider if key exists."""
    provider, api_key, model_name = get_llm_provider()
    if provider == "fallback" or not api_key:
        return None

    try:
        if provider == "gemini":
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
            payload = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {"text": f"{system_prompt}\n\nUser Question: {user_prompt}\n\nTool Results:\n{json.dumps(tool_results, default=str)}"}
                        ],
                    }
                ],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 800},
            }
            resp = httpx.post(url, json=payload, timeout=12.0)
            if resp.status_code == 200:
                data = resp.json()
                return data["candidates"][0]["content"]["parts"][0]["text"].strip()

        elif provider == "openai":
            url = "https://api.openai.com/v1/chat/completions"
            payload = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": f"User Question: {user_prompt}\n\nTool Results:\n{json.dumps(tool_results, default=str)}",
                    },
                ],
                "temperature": 0.2,
                "max_tokens": 800,
            }
            resp = httpx.post(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
                timeout=12.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()

    except Exception as exc:
        logger.warning(f"LLM synthesis call failed: {exc}")

    return None
