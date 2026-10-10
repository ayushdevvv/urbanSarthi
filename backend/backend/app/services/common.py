from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from sqlalchemy.orm import Session
from app.models import AuditLog


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_m = 6_371_000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * earth_radius_m * asin(sqrt(min(1.0, a)))


def audit(db: Session, actor_user_id: int | None, action: str, entity_type: str, entity_id: str | None = None, details: dict | None = None, ip_address: str | None = None) -> None:
    db.add(AuditLog(actor_user_id=actor_user_id, action=action, entity_type=entity_type, entity_id=entity_id, details=details or {}, ip_address=ip_address))
