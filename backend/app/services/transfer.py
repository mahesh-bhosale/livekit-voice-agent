"""Twilio warm-transfer coordination for human agent handoff."""

import asyncio
import logging
from urllib.parse import quote

from app.config import settings

logger = logging.getLogger("transfer-service")

# room_name -> Future resolving to "accepted" | "declined" | "timeout" | "unavailable"
_transfer_futures: dict[str, asyncio.Future[str]] = {}


def twilio_configured() -> bool:
    return bool(
        settings.TWILIO_ACCOUNT_SID
        and settings.TWILIO_AUTH_TOKEN
        and settings.TWILIO_FROM_NUMBER
        and settings.HUMAN_AGENT_NUMBER
    )


def _public_api_base() -> str:
    return settings.PUBLIC_API_URL.rstrip("/")


def build_transfer_summary(reason: str, transcript_turns: list[dict]) -> str:
    recent = transcript_turns[-6:]
    if not recent:
        return f"The caller requested a human agent. Reason: {reason}."
    lines = [f"{t['speaker']}: {t['text']}" for t in recent]
    return f"Reason for transfer: {reason}. Recent conversation: {' '.join(lines)}"


async def initiate_warm_transfer(room_name: str, reason: str, summary: str) -> str:
    """Dial the human agent and wait for accept/decline. Returns outcome string."""
    if not twilio_configured():
        logger.warning("Twilio not configured — simulating declined transfer")
        return "unavailable"

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
            method="GET",
            timeout=45,
            status_callback=status_callback_url,
            status_callback_method="POST",
            status_callback_event=["initiated", "ringing", "answered", "completed"],
        )
        logger.info("Twilio warm-transfer call initiated for room %s", room_name)

        try:
            return await asyncio.wait_for(future, timeout=60)
        except asyncio.TimeoutError:
            logger.warning("Warm transfer timed out for room %s", room_name)
            return "timeout"
    except Exception as exc:
        logger.error("Failed to initiate warm transfer: %s", exc)
        return "unavailable"
    finally:
        _transfer_futures.pop(room_name, None)


def resolve_transfer(room_name: str, outcome: str) -> None:
    future = _transfer_futures.get(room_name)
    if future and not future.done():
        future.set_result(outcome)
