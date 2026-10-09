from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.security import create_access_token, hash_password, verify_password
from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import LoginIn, RegisterIn, TokenOut, UserOut, UserUpdateIn
from app.services.common import audit

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, request: Request, db: Session = Depends(get_db)):
    email = str(payload.email).strip().lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(email=email, full_name=payload.full_name.strip(), password_hash=hash_password(payload.password), role="citizen")
    db.add(user)
    db.flush()
    audit(db, user.id, "user.registered", "user", str(user.id), {"role": user.role}, request.client.host if request.client else None)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    email = str(payload.email).strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(payload.password, user.password_hash) or not user.is_active:
        # Same response for unknown email and wrong password avoids account enumeration.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password", headers={"WWW-Authenticate": "Bearer"})
    token, expires_at = create_access_token(user.id, user.role)
    audit(db, user.id, "user.login", "user", str(user.id), {}, request.client.host if request.client else None)
    db.commit()
    return TokenOut(access_token=token, expires_at=expires_at, user=user)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(payload: UserUpdateIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    changes = payload.model_dump(exclude_unset=True)
    if "full_name" in changes and changes["full_name"] is not None:
        user.full_name = changes["full_name"].strip()
    if "preferences" in changes and changes["preferences"] is not None:
        user.preferences = {**(user.preferences or {}), **changes["preferences"]}
    audit(db, user.id, "user.profile_updated", "user", str(user.id), {"fields": sorted(changes)}, request.client.host if request.client else None)
    db.commit()
    db.refresh(user)
    return user
