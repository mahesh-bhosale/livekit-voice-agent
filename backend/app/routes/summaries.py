from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import CallSummary

router = APIRouter()


@router.get("/summaries/by-room/{room_name}")
async def get_summary_by_room(room_name: str):
    db: Session = SessionLocal()
    try:
        row = (
            db.query(CallSummary)
            .filter(CallSummary.room_name == room_name)
            .order_by(CallSummary.created_at.desc())
            .first()
        )
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Summary not found")
        return row.to_dict()
    finally:
        db.close()


@router.get("/summaries")
async def get_all_summaries():
    db: Session = SessionLocal()
    try:
        rows = db.query(CallSummary).order_by(CallSummary.created_at.desc()).all()
        return [row.to_dict() for row in rows]
    finally:
        db.close()

