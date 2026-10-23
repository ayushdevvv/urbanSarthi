from datetime import datetime, timezone
import uuid
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, func
from sqlalchemy.orm import Session
from app.db import get_db
from app.dependencies import require_roles
from app.models import PriorityQueueItem, User
from app.services.common import audit
from app.services.priority_triage import triage

router = APIRouter(prefix="/priority-queue", tags=["AI priority queue"])

class QueueCreateIn(BaseModel):
    title: str = Field(min_length=4, max_length=180)
    description: str = Field(default="", max_length=2500)
    category: str = Field(default="operations", max_length=50)
    source: str = Field(default="operator", max_length=80)
    location: str | None = Field(default=None, max_length=180)

class QueueUpdateIn(BaseModel):
    status: Literal["open", "in_progress", "resolved", "dismissed"] | None = None
    assigned_to: str | None = Field(default=None, max_length=160)
    re_triage: bool = False

def serialise(row: PriorityQueueItem) -> dict:
    return {"id":row.id,"public_id":row.public_id,"title":row.title,"description":row.description,"category":row.category,"source":row.source,"location":row.location,"status":row.status,"priority":row.priority,"priority_score":row.priority_score,"urgency":row.urgency,"ai_provider":row.ai_provider,"ai_rationale":row.ai_rationale,"suggested_actions":row.suggested_actions,"assigned_to":row.assigned_to,"created_at":row.created_at.isoformat() if row.created_at else None,"updated_at":row.updated_at.isoformat() if row.updated_at else None,"resolved_at":row.resolved_at.isoformat() if row.resolved_at else None}

@router.get("/meta")
def queue_meta(_user: User = Depends(require_roles("operator", "admin"))):
    from app.core.config import settings
    return {"groq_configured": bool(settings.groq_api_key), "model": settings.groq_model if settings.groq_api_key else None, "fallback": "Explainable rules-based classification", "human_review_required": True}

@router.get("")
def list_queue(status_filter: str | None = Query(default=None, alias="status"), priority_filter: str | None = Query(default=None, alias="priority"), search: str | None = Query(default=None, max_length=120), limit: int = Query(default=100, ge=1, le=250), offset: int = Query(default=0, ge=0), db: Session = Depends(get_db), _user: User = Depends(require_roles("operator", "admin"))):
    query = select(PriorityQueueItem).order_by(desc(PriorityQueueItem.priority_score), PriorityQueueItem.created_at.asc())
    if status_filter == "active": query = query.where(PriorityQueueItem.status.in_(["open", "in_progress"]))
    elif status_filter: query = query.where(PriorityQueueItem.status == status_filter)
    if priority_filter: query = query.where(PriorityQueueItem.priority == priority_filter)
    if search: query = query.where((PriorityQueueItem.title.ilike(f"%{search}%")) | (PriorityQueueItem.description.ilike(f"%{search}%")) | (PriorityQueueItem.location.ilike(f"%{search}%")))
    rows = list(db.scalars(query.offset(offset).limit(limit)))
    counts = {key: db.scalar(select(func.count(PriorityQueueItem.id)).where(PriorityQueueItem.status == key)) or 0 for key in ("open", "in_progress", "resolved", "dismissed")}
    return {"items":[serialise(row) for row in rows], "counts":counts, "total": sum(counts.values()), "offset":offset, "limit":limit}

@router.post("", status_code=201)
def create_queue_item(payload: QueueCreateIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require_roles("operator", "admin"))):
    data = payload.model_dump()
    classified = triage(data)
    row = PriorityQueueItem(public_id=str(uuid.uuid4()), **data, status="open", priority=classified["priority"], priority_score=classified["priority_score"], urgency=classified["urgency"], ai_provider=classified["provider"], ai_rationale=classified["rationale"], suggested_actions=classified["suggested_actions"], created_by_user_id=user.id)
    db.add(row); db.flush()
    audit(db, user.id, "priority_queue.created", "priority_queue_item", row.public_id, {"priority":row.priority,"score":row.priority_score,"provider":row.ai_provider}, request.client.host if request.client else None)
    db.commit(); db.refresh(row)
    return serialise(row)

@router.patch("/{item_id}")
def update_queue_item(item_id: int, payload: QueueUpdateIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require_roles("operator", "admin"))):
    row = db.get(PriorityQueueItem, item_id)
    if not row: raise HTTPException(status_code=404, detail="Queue item not found")
    updates = payload.model_dump(exclude_unset=True)
    retriage = updates.pop("re_triage", False)
    for field, value in updates.items(): setattr(row, field, value)
    if payload.status == "resolved": row.resolved_at = datetime.now(timezone.utc)
    elif payload.status in {"open", "in_progress"}: row.resolved_at = None
    if retriage:
        result = triage({"title":row.title,"description":row.description,"category":row.category,"source":row.source,"location":row.location})
        row.priority=result["priority"]; row.priority_score=result["priority_score"]; row.urgency=result["urgency"]; row.ai_provider=result["provider"]; row.ai_rationale=result["rationale"]; row.suggested_actions=result["suggested_actions"]
    audit(db, user.id, "priority_queue.updated", "priority_queue_item", row.public_id, updates, request.client.host if request.client else None)
    db.commit(); db.refresh(row)
    return serialise(row)
