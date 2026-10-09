from collections.abc import Callable
from hmac import compare_digest
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
import jwt
from app.core.config import settings
from app.core.security import decode_access_token
from app.db import get_db
from app.models import User

_bearer = HTTPBearer(auto_error=False)


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User | None:
    if credentials is None:
        return None
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload.get("sub", ""))
    except (jwt.PyJWTError, TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired access token")
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is inactive or does not exist")
    return user


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required", headers={"WWW-Authenticate": "Bearer"})
    return user


def require_roles(*allowed_roles: str) -> Callable:
    def _require_role(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role for this action")
        return user
    return _require_role


def require_ingestion_access(
    x_ingestion_key: str | None = Header(default=None, alias="X-Ingestion-Key"),
    user: User | None = Depends(get_optional_user),
) -> User | None:
    if user is not None and user.role in {"operator", "admin"}:
        return user
    configured_key = settings.ingestion_api_key
    if configured_key and x_ingestion_key and compare_digest(configured_key, x_ingestion_key):
        return None
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Use an operator/admin account or a valid X-Ingestion-Key")
