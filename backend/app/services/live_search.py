"""Server-side, source-attributed live search for citizen mobility intelligence.

Google News RSS provides source-linked reporting; it is not traffic telemetry.
"""
from __future__ import annotations

from datetime import datetime, timezone
from copy import deepcopy
import threading
import time
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET

import httpx

_NEWS_CACHE: dict[tuple[str, int, str], tuple[float, dict]] = {}
_NEWS_CACHE_LOCK = threading.Lock()
_NEWS_CACHE_TTL_SECONDS = 300



def _iso(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        try:
            return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError, OverflowError):
            return None


def search_live_news(query: str, *, limit: int = 8, topic: str = "news") -> dict:
    clean = " ".join(str(query or "").split())[:400]
    if not clean:
        return {"status": "unavailable", "provider": None, "items": [], "query": clean,
                "updated_at": datetime.now(timezone.utc).isoformat(), "note": "A search query is required."}

    cache_key = (clean.casefold(), max(1, min(limit, 12)), topic)
    now = time.monotonic()
    with _NEWS_CACHE_LOCK:
        cached = _NEWS_CACHE.get(cache_key)
        if cached and cached[0] > now:
            result = deepcopy(cached[1])
            result["served_from_cache"] = True
            return result
        if cached:
            _NEWS_CACHE.pop(cache_key, None)

    def remember(result: dict) -> dict:
        if result.get("status") in {"available", "no_results"}:
            with _NEWS_CACHE_LOCK:
                _NEWS_CACHE[cache_key] = (time.monotonic() + _NEWS_CACHE_TTL_SECONDS, deepcopy(result))
        result["served_from_cache"] = False
        return result

    try:
        response = httpx.get(
            "https://news.google.com/rss/search",
            params={"q": clean, "hl": "en-IN", "gl": "IN", "ceid": "IN:en"},
            headers={"User-Agent": "UrbanSaarthi/1.0 (citizen mobility news)"},
            timeout=2.5,
        )
        response.raise_for_status()
        root = ET.fromstring(response.content)
        items = []
        for item in root.findall("./channel/item")[:limit]:
            title = (item.findtext("title") or "").strip()
            url = (item.findtext("link") or "").strip()
            pub = (item.findtext("pubDate") or "").strip()
            source_node = item.find("source")
            source = (source_node.text or "").strip() if source_node is not None else "Google News"
            if title and url.startswith(("https://", "http://")):
                items.append({"title": title[:300], "url": url, "snippet": "",
                              "source": source[:160], "published_at": _iso(pub)})
        return remember({"status": "available" if items else "no_results", "provider": "Google News RSS",
                "items": items, "query": clean, "updated_at": datetime.now(timezone.utc).isoformat(),
                "note": "Recent news index. Article publication time is shown when supplied by the publisher; this is not live transit telemetry."})
    except (httpx.HTTPError, ET.ParseError, ValueError, TypeError):
        return {"status": "unavailable", "provider": None, "items": [], "query": clean,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "note": "Google News could not be reached. Retry when connectivity returns."}
