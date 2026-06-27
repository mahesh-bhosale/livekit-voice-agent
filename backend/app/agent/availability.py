import re
from datetime import datetime

from app.db import SessionLocal
from app.models import Appointment

# Hardcoded demo slots (hackathon prototype)
BOOKED_SLOTS = [
    {"date": "2026-06-29", "time": "09:00"},
    {"date": "2026-06-29", "time": "10:30"},
    {"date": "2026-06-30", "time": "11:00"},
    {"date": "2026-06-30", "time": "15:30"},
    {"date": "2026-07-01", "time": "10:00"},
]


def normalize_date(date_str: str) -> str:
    """Best-effort normalize to YYYY-MM-DD for slot comparison."""
    clean = date_str.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", clean):
        return clean

    for fmt in (
        "%B %d, %Y",
        "%b %d, %Y",
        "%B %d %Y",
        "%b %d %Y",
        "%m/%d/%Y",
        "%m-%d-%Y",
        "%Y/%m/%d",
    ):
        try:
            return datetime.strptime(clean, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass

    # Strip ordinal suffixes: "June 29th" -> "June 29"
    no_ordinal = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", clean, flags=re.IGNORECASE)
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%b %d %Y"):
        try:
            return datetime.strptime(no_ordinal, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass

    # Month name without year — assume demo year 2026
    for fmt in ("%B %d", "%b %d"):
        try:
            parsed = datetime.strptime(no_ordinal, fmt)
            return parsed.replace(year=2026).strftime("%Y-%m-%d")
        except ValueError:
            pass

    return clean


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
    clean_date = normalize_date(date)
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
