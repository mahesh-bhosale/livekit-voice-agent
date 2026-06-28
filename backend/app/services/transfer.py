"""Twilio warm-transfer coordination for human agent handoff."""

import asyncio
import logging
from urllib.parse import quote

from app.config import settings

logger = logging.getLogger("transfer-service")

# room_name -> Future resolving to outcome string
_transfer_futures: dict[str, asyncio.Future[str]] = {}
# Prevent duplicate outbound calls for the same room
_active_transfers: set[str] = set()


def twilio_configured() -> bool:
    return bool(
        settings.TWILIO_ACCOUNT_SID
        and settings.TWILIO_AUTH_TOKEN
        and settings.TWILIO_FROM_NUMBER
        and settings.HUMAN_AGENT_NUMBER
    )


def _public_api_base() -> str:
    return settings.PUBLIC_API_URL.rstrip("/")


def build_transfer_summary(reason: str, transcript_turns: list[dict], booking: dict | None = None) -> str:
    """Build a spoken summary for the human agent phone call."""
    caller_name = booking.get("name") if booking else None
    appt_date = booking.get("date") if booking else None
    appt_time = booking.get("time") if booking else None

    if not caller_name:
        for turn in reversed(transcript_turns):
            if turn.get("speaker") == "caller":
                text = turn.get("text", "")
                if "my name is" in text.lower():
                    caller_name = text.split("my name is", 1)[-1].strip().rstrip(".")
                    break

    parts = []
    if caller_name:
        parts.append(f"The caller is {caller_name}.")
    if appt_date and appt_time:
        parts.append(f"They have an appointment booked for {appt_date} at {appt_time}.")
    parts.append(f"The caller now requires assistance regarding {reason}.")
    parts.append("Would you like to accept the call? Press 1 for yes, or 2 for no.")
    return " ".join(parts)


async def initiate_warm_transfer(room_name: str, reason: str, summary: str) -> str:
    """Dial the human agent and wait for accept/decline. Returns outcome string."""
    if not twilio_configured():
        logger.warning("Twilio not configured — simulating no-answer transfer")
        return "no-answer"

    if room_name in _active_transfers:
        logger.info("Transfer already active for room %s — skipping duplicate dial", room_name)
        return "in_progress"

    _active_transfers.add(room_name)
    loop = asyncio.get_running_loop()
    future: asyncio.Future[str] = loop.create_future()
    _transfer_futures[room_name] = future

    try:
        from twilio.rest import Client

        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        twiml_url = (
            f"{_public_api_base()}/api/transfer/twiml"
            f"?room={quote(room_name)}"
            f"&reason={quote(reason)}"
            f"&summary={quote(summary[:900])}"
        )

        status_callback_url = (
            f"{_public_api_base()}/api/transfer/status"
            f"?room={quote(room_name)}"
        )
        await asyncio.to_thread(
            client.calls.create,
            to=settings.HUMAN_AGENT_NUMBER,
            from_=settings.TWILIO_FROM_NUMBER,
            url=twiml_url,
            method="POST",
            timeout=30,
            status_callback=status_callback_url,
            status_callback_method="POST",
            status_callback_event=["no-answer", "busy", "failed", "canceled", "completed"],
        )
        logger.info("Twilio warm-transfer call initiated for room %s", room_name)

        try:
            outcome = await asyncio.wait_for(future, timeout=45)
            if outcome == "timeout":
                return "no-answer"
            return outcome
        except asyncio.TimeoutError:
            logger.warning("Warm transfer timed out for room %s", room_name)
            return "no-answer"
    except Exception as exc:
        logger.error("Failed to initiate warm transfer: %s", exc)
        return "unavailable"
    finally:
        _transfer_futures.pop(room_name, None)
        _active_transfers.discard(room_name)


def resolve_transfer(room_name: str, outcome: str, only_if_pending: bool = False) -> None:
    future = _transfer_futures.get(room_name)
    if future and not future.done():
        future.set_result(outcome)
