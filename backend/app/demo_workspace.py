"""Internal shared demo workspace owner used only for legacy database relations.

There is no login, password verification, session, bearer token, or role enforcement.
The database schema still keeps nullable/required user foreign keys for trip/ticket
records, so the demo build uses one technical owner record for shared sample data.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import User

DEMO_WORKSPACE_EMAIL = "demo-admin@urbansaarthi.local"


def get_demo_workspace_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == DEMO_WORKSPACE_EMAIL))
    if user is None:
        user = User(
            email=DEMO_WORKSPACE_EMAIL,
            full_name="UrbanSaarthi Shared Demo Workspace",
            password_hash="not-used-authentication-disabled",
            role="demo",
            is_active=True,
            preferences={"demo_workspace": True, "authentication_enabled": False},
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user
