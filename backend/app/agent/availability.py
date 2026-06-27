# Pre-booked clinic appointments for the hackathon availability check
# Format: list of {"date": "YYYY-MM-DD", "time": "HH:MM"} slots
BOOKED_SLOTS = [
    {"date": "2026-06-29", "time": "09:00"},
    {"date": "2026-06-29", "time": "10:30"},
    {"date": "2026-06-29", "time": "14:00"},
    {"date": "2026-06-30", "time": "11:00"},
    {"date": "2026-06-30", "time": "15:30"},
    {"date": "2026-07-01", "time": "10:00"},
]

def is_slot_booked(date: str, time: str) -> bool:
    """
    Checks if a preferred date and time is already booked.
    Both date and time strings are normalized (stripped of whitespace).
    """
    clean_date = date.strip()
    clean_time = time.strip()
    
    for slot in BOOKED_SLOTS:
        if slot["date"] == clean_date and slot["time"] == clean_time:
            return True
    return False
