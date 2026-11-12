"""Small, dependency-free HS256 access tokens for the first-party API."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from app.core.config import settings


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_access_token(user_id: int, email: str, role: str) -> tuple[str, int]:
    if not settings.jwt_secret or len(settings.jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET must contain at least 32 characters before authentication can be enabled.")
    now = int(time.time())
    ttl = max(5, int(settings.jwt_ttl_minutes)) * 60
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"sub": str(user_id), "email": email, "role": role, "iat": now, "exp": now + ttl}
    unsigned = f"{_b64encode(json.dumps(header, separators=(',', ':')).encode())}.{_b64encode(json.dumps(payload, separators=(',', ':')).encode())}"
    signature = hmac.new(settings.jwt_secret.encode(), unsigned.encode(), hashlib.sha256).digest()
    return f"{unsigned}.{_b64encode(signature)}", ttl


def decode_access_token(token: str) -> dict[str, Any] | None:
    if not settings.jwt_secret or len(settings.jwt_secret) < 32:
        return None
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".", 2)
        header = json.loads(_b64decode(encoded_header))
        if header.get("alg") != "HS256" or header.get("typ") != "JWT":
            return None
        unsigned = f"{encoded_header}.{encoded_payload}"
        expected = hmac.new(settings.jwt_secret.encode(), unsigned.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(encoded_signature)):
            return None
        payload = json.loads(_b64decode(encoded_payload))
        if int(payload.get("exp", 0)) <= int(time.time()):
            return None
        if not str(payload.get("sub", "")).isdigit():
            return None
        return payload
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return None
