import secrets
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.dependencies import get_current_user
from app.models import TicketOrder, User
from app.schemas import TicketCreateIn, TicketOut
from app.services.common import audit

router = APIRouter(prefix="/ticketing", tags=["Smart ticketing"])


@router.post("/orders", response_model=TicketOut, status_code=201)
def request_ticket(payload: TicketCreateIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Booking is a request until a real operator/ticketing provider confirms it. No payment data is collected.
    order = TicketOrder(
        public_id=str(uuid.uuid4()), user_id=user.id, mode=payload.mode,
        origin_label=payload.origin_label, destination_label=payload.destination_label,
        departure_at=payload.departure_at, passengers=payload.passengers, status="requested",
        provider="not-configured", provider_reference=None, currency="INR", quoted_amount=None,
        qr_token=secrets.token_urlsafe(24),
        booking_response={"booking_confirmed": False, "provider_connected": False,
                          "message": "Request saved. Connect an authorized transit ticketing provider before issuing a valid ticket or accepting payment."},
    )
    db.add(order)
    db.flush()
    audit(db, user.id, "ticketing.order_requested", "ticket_order", str(order.id), {"mode": order.mode, "provider": order.provider}, request.client.host if request.client else None)
    db.commit()
    db.refresh(order)
    return order


@router.get("/orders", response_model=list[TicketOut])
def list_ticket_orders(db: Session = Depends(get_db), user: User = Depends(get_current_user), limit: int = 50, offset: int = 0):
    return list(db.scalars(select(TicketOrder).where(TicketOrder.user_id == user.id).order_by(TicketOrder.created_at.desc()).offset(max(0, offset)).limit(max(1, min(limit, 100)))))


@router.get("/orders/{order_id}", response_model=TicketOut)
def ticket_order_detail(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    order = db.scalar(select(TicketOrder).where(TicketOrder.id == order_id, TicketOrder.user_id == user.id))
    if not order:
        raise HTTPException(status_code=404, detail="Ticket order not found")
    return order


@router.post("/orders/{order_id}/cancel", response_model=TicketOut)
def cancel_ticket_order(order_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    order = db.scalar(select(TicketOrder).where(TicketOrder.id == order_id, TicketOrder.user_id == user.id))
    if not order:
        raise HTTPException(status_code=404, detail="Ticket order not found")
    if order.status not in {"requested", "pending"}:
        raise HTTPException(status_code=409, detail=f"Order in status {order.status} cannot be cancelled here")
    order.status = "cancelled"
    order.booking_response = {**order.booking_response, "cancelled_by_user": True}
    audit(db, user.id, "ticketing.order_cancelled", "ticket_order", str(order.id), {}, request.client.host if request.client else None)
    db.commit()
    db.refresh(order)
    return order


@router.get("/provider-status")
def ticketing_provider_status(user: User = Depends(get_current_user)):
    return {"connected": False, "provider": "not-configured", "ticket_issuance_enabled": False,
            "payment_processing_enabled": False,
            "message": "Connect an authorized bus/metro operator API before marking orders confirmed. The current API only records journey requests."}
