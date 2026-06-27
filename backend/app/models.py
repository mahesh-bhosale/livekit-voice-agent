from sqlalchemy import Column, Integer, String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from app.db import Base

class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    reason = Column(String, nullable=True)
    date = Column(String, nullable=False)
    time = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    room_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "reason": self.reason,
            "date": self.date,
            "time": self.time,
            "phone": self.phone,
            "room_name": self.room_name,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

class CallSummary(Base):
    __tablename__ = "call_summaries"

    id = Column(Integer, primary_key=True, index=True)
    room_name = Column(String, nullable=False)
    summary = Column(Text, nullable=False)
    transcript = Column(JSONB, nullable=True)  # Stores list of {speaker, text, timestamp} turn objects
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "room_name": self.room_name,
            "summary": self.summary,
            "transcript": self.transcript,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }
