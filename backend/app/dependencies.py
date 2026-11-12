"""Public hackathon demo identities and protected edge-device ingestion."""
from collections.abc import Callable
import hmac
import re
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db import get_db
from app.models import User

DEMO_EMAIL = "demo-admin@urbansaarthi.local"
VISITOR_ID_PATTERN = re.compile(r"^[a-fA-F0-9-]{16,64}$")


def _demo_operator(db: Session) -> User:
    """Shared operator actor for the intentionally public hackathon console."""
    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user is None:
        user = User(email=DEMO_EMAIL, full_name="UrbanSaarthi Demo Operator",
                    password_hash="public-demo-no-login", role="admin", is_active=True,
                    preferences={"demo_mode": True})
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def _anonymous_user(request: Request, db: Session) -> User:
    """Give each browser a separate guest identity without an account or login."""
    visitor_id = (request.headers.get("x-visitor-id") or "").strip()
    if not VISITOR_ID_PATTERN.fullmatch(visitor_id):
        visitor_id = "public-demo-visitor"
    safe_id = re.sub(r"[^a-fA-F0-9]", "", visitor_id).lower() or "publicdemo"
    email = f"visitor-{safe_id[:48]}@visitor.urbansaarthi.local"
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, full_name="Guest traveller",
                    password_hash="anonymous-session-no-login", role="citizen", is_active=True,
                    preferences={"anonymous_demo": True})
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User:
    return _anonymous_user(request, db)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    return _anonymous_user(request, db)


def require_roles(*allowed_roles: str) -> Callable:
    def _require_role(db: Session = Depends(get_db)) -> User:
        # Human login is removed in this public hackathon release. Admin operations
        # use a shared demo actor; do not connect this mode to physical city controls.
        user = _demo_operator(db)
        if user.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="This action is not available for the current workspace access level.")
        return user
    return _require_role


def require_ingestion_access(request: Request, db: Session = Depends(get_db)) -> User | None:
    """Sensor and edge ingestion remains protected by a separate high-entropy key."""
    supplied = request.headers.get("x-ingestion-key", "")
    if settings.ingestion_api_key and supplied and hmac.compare_digest(supplied, settings.ingestion_api_key):
        return None
    if settings.app_env.lower() != "production":
        return _demo_operator(db)
    raise HTTPException(status_code=401, detail="Provide the configured X-Ingestion-Key for device ingestion.")
