"""Authentication and role/edge-ingestion dependencies.

Unauthenticated demo identity is supported only outside production. Production
requires signed bearer tokens for people and a separate edge key for devices.
"""
from collections.abc import Callable
import hmac
from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.tokens import decode_access_token
from app.db import get_db
from app.models import User

DEMO_EMAIL = "demo-admin@urbansaarthi.local"


def _demo_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user is None:
        user = User(email=DEMO_EMAIL, full_name="UrbanSaarthi Local Demo Operator",
                    password_hash="local-demo-only-no-password-login", role="admin", is_active=True,
                    preferences={"demo_mode": True})
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def _user_from_token(token: str | None, db: Session) -> User | None:
    if not token or not token.lower().startswith("bearer "):
        return None
    payload = decode_access_token(token.split(" ", 1)[1].strip())
    if not payload:
        return None
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        return None
    # Roles are read from the current database record, not trusted from the token.
    return user


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    """Allow public route planning; attach a user only for a valid session."""
    if settings.auth_enabled:
        return _user_from_token(request.headers.get("authorization"), db)
    if settings.app_env.lower() == "production":
        return None
    return _demo_user(db)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    if settings.auth_enabled:
        user = _user_from_token(request.headers.get("authorization"), db)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in with an authorized UrbanSaarthi account.", headers={"WWW-Authenticate": "Bearer"})
        return user
    if settings.app_env.lower() == "production":
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Authentication is not configured. The authority workspace is locked.")
    return _demo_user(db)


def require_roles(*allowed_roles: str) -> Callable:
    def _require_role(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This action is not available for the current workspace access level.")
        return user
    return _require_role


def require_ingestion_access(request: Request, db: Session = Depends(get_db)) -> User | None:
    """Device ingestion accepts a dedicated high-entropy key or an operator token."""
    if not settings.auth_enabled:
        if settings.app_env.lower() == "production":
            raise HTTPException(status_code=503, detail="Secure ingestion is not configured.")
        return _demo_user(db)
    supplied = request.headers.get("x-ingestion-key", "")
    if settings.ingestion_api_key and supplied and hmac.compare_digest(supplied, settings.ingestion_api_key):
        return None  # service actor; audit actor_user_id remains nullable
    user = _user_from_token(request.headers.get("authorization"), db)
    if user and user.role in {"operator", "admin"}:
        return user
    raise HTTPException(status_code=401, detail="Provide a valid edge ingestion key or an operator bearer token.", headers={"WWW-Authenticate": "Bearer"})
