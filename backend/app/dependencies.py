"""Demo-mode identity helpers. Authentication is intentionally disabled for this prototype.

WARNING: This makes every API endpoint, including authority write actions, publicly accessible.
Do not use this configuration with real operational data or in a production deployment.
"""
from collections.abc import Callable
from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import User

DEMO_EMAIL = "demo-admin@urbansaarthi.local"


def _demo_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user is None:
        user = User(
            email=DEMO_EMAIL,
            full_name="UrbanSaarthi Demo Operator",
            password_hash="authentication-disabled-demo-mode",
            role="admin",
            is_active=True,
            preferences={"demo_mode": True},
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif user.role != "admin" or not user.is_active:
        user.role = "admin"
        user.is_active = True
        db.commit()
        db.refresh(user)
    return user


def get_optional_user(db: Session = Depends(get_db)) -> User:
    """Return one shared demo identity without requiring an Authorization header."""
    return _demo_user(db)


def get_current_user(user: User = Depends(get_optional_user)) -> User:
    return user


def require_roles(*allowed_roles: str) -> Callable:
    def _require_role(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This action is not available for the current workspace access level.")
        return user
    return _require_role


def require_ingestion_access(user: User = Depends(get_optional_user)) -> User:
    """In demo mode, ingestion is open like the rest of the API; no key is required."""
    return user
