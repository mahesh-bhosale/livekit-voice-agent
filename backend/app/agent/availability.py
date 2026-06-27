import re

from app.db import SessionLocal
from app.models import Appointment

# Hardcoded demo slots (hackathon prototype)
BOOKED_SLOTS = [
    {"date": "2026-06-29", "time": "09:00"},
    {"date": "2026-06-29", "time": "10:30"},
    {"date": "2026-06-29", "time": "14:00"},
    {"date": "2026-06-30", "time": "11:00"},
    {"date": "2026-06-30", "time": "15:30"},
    {"date": "2026-07-01", "time": "10:00"},
]


def normalize_time(time_str: str) -> str:
    """Best-effort normalize to HH:MM (24h) for slot comparison."""
    clean = time_str.strip().upper()
    match = re.match(r"^(\d{1,2}):(\d{2})\s*(AM|PM)?$", clean)
    if not match:
        return clean
    hour, minute, meridiem = int(match.group(1)), match.group(2), match.group(3)
    if meridiem == "PM" and hour != 12:
        hour += 12
    if meridiem == "AM" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute}"


def is_slot_booked(date: str, time: str) -> bool:
    clean_date = date.strip()
    clean_time = normalize_time(time)

    for slot in BOOKED_SLOTS:
        if slot["date"] == clean_date and slot["time"] == clean_time:
            return True

    db = SessionLocal()
    try:
        rows = (
            db.query(Appointment)
            .filter(Appointment.date == clean_date)
            .all()
        )
        for row in rows:
            if normalize_time(row.time) == clean_time:
                return True
        return False
    finally:
        db.close()
