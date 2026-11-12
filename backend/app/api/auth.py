from pydantic import BaseModel, EmailStr, Field
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.security import needs_rehash, hash_password, verify_password
from app.core.tokens import create_access_token
from app.db import get_db
from app.dependencies import get_current_user
from app.models import User

router = APIRouter(prefix="/auth", tags=["Authentication"])


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


@router.post("/login")
def login(payload: LoginInput, db: Session = Depends(get_db)):
    if not settings.auth_enabled and settings.app_env.lower() == "production":
        raise HTTPException(status_code=503, detail="Authentication is not configured.")
    user = db.scalar(select(User).where(func.lower(User.email) == str(payload.email).lower()))
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email or password is incorrect.", headers={"WWW-Authenticate": "Bearer"})
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
        db.commit()
    if not settings.auth_enabled:
        raise HTTPException(status_code=409, detail="Authentication is disabled in local demo mode. Enable AUTH_ENABLED to use account sign-in.")
    token, expires_in = create_access_token(user.id, user.email, user.role)
    return {"access_token": token, "token_type": "bearer", "expires_in": expires_in,
            "user": {"id": user.id, "email": user.email, "full_name": user.full_name, "role": user.role}}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "full_name": user.full_name, "role": user.role}


class RegisterInput(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=256)


@router.post("/register", status_code=201)
def register(payload: RegisterInput, db: Session = Depends(get_db)):
    """Create a citizen account. Privileged roles are never accepted from public input."""
    if not settings.auth_enabled:
        raise HTTPException(status_code=409, detail="Account registration is available when AUTH_ENABLED=true.")
    email = str(payload.email).strip().lower()
    existing = db.scalar(select(User.id).where(func.lower(User.email) == email))
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(email=email, full_name=payload.full_name.strip(), password_hash=hash_password(payload.password), role="citizen", is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    token, expires_in = create_access_token(user.id, user.email, user.role)
    return {"access_token": token, "token_type": "bearer", "expires_in": expires_in,
            "user": {"id": user.id, "email": user.email, "full_name": user.full_name, "role": user.role}}
