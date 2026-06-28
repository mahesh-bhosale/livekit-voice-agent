"""Twilio webhook endpoints and warm-transfer initiation API."""

import logging

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from urllib.parse import quote

from twilio.twiml.voice_response import VoiceResponse, Dial

from app.config import settings
from app.services.transfer import initiate_warm_transfer, resolve_transfer

logger = logging.getLogger("transfer-routes")

router = APIRouter()


class TransferInitiateRequest(BaseModel):
    room_name: str = Field(..., description="LiveKit room name")
    reason: str = Field(..., description="Why the caller wants a human")
    summary: str = Field(..., description="Spoken summary for the human agent")


@router.post("/transfer/initiate")
async def transfer_initiate(body: TransferInitiateRequest):
    """Start outbound Twilio call and block until the human agent accepts or declines."""
    outcome = await initiate_warm_transfer(body.room_name, body.reason, body.summary)
    return {"outcome": outcome}


def _public_api_base() -> str:
    return settings.PUBLIC_API_URL.rstrip("/")


def _twiml(content: str) -> Response:
    return Response(content=f'<?xml version="1.0" encoding="UTF-8"?><Response>{content}</Response>', media_type="application/xml")


@router.api_route("/transfer/twiml", methods=["GET", "POST"])
async def transfer_twiml(
    room: str = Query(...),
    reason: str = Query("General assistance"),
    summary: str = Query("A caller needs help."),
):
    gather_action = f"{_public_api_base()}/api/transfer/gather?room={quote(room)}"
    spoken = summary or (
        f"A caller needs assistance regarding {reason}. "
        f"Press 1 to accept this call, or press 2 to decline."
    )
    return _twiml(
        f'<Gather numDigits="1" input="dtmf speech" action="{gather_action}" method="POST" timeout="20" actionOnEmptyResult="true" speechTimeout="auto" hints="one,yes,accept,two,no,decline" language="en-IN">'
        f'<Say voice="Polly.Joanna">{spoken}</Say>'
        f'<Say voice="Polly.Joanna">Press 1 to accept, or 2 to decline.</Say>'
        f"</Gather>"
        f'<Say voice="Polly.Joanna">No response received. Goodbye.</Say>'
    )


@router.post("/transfer/gather")
async def transfer_gather(request: Request, room: str = Query(...)):
    """
    Twilio DTMF webhook. Called when human agent presses 1 (accept) or 2 (decline).

    BUG FIX (Bug #1): After accept, the original code returned <Say> then ended,
    hanging up the Twilio call with NO audio bridge to the LiveKit room. The human
    agent's PSTN call died immediately. We now keep their call alive by dialing them
    into the LiveKit room via SIP, creating a real bidirectional audio bridge.
    Falls back to Twilio Conference if LIVEKIT_SIP_DOMAIN is not configured.
    """
    form = await request.form()
    digits = form.get("Digits", "")
    speech_result = form.get("SpeechResult", "")

    # Map speech input to digit equivalents
    if not digits and speech_result:
        speech_lower = speech_result.strip().lower()
        logger.info("[TRANSFER][GATHER] Speech input detected: %r", speech_result)
        if any(word in speech_lower for word in ("1", "one", "yes", "accept", "yeah", "yep", "ok", "okay", "sure")):
            digits = "1"
        elif any(word in speech_lower for word in ("2", "two", "no", "decline", "nah", "nope", "reject")):
            digits = "2"
        else:
            logger.warning("[TRANSFER][GATHER] Unrecognized speech: %r", speech_result)

    logger.info("[TRANSFER][GATHER] room=%s digits=%r speech=%r", room, digits, speech_result)

    response = VoiceResponse()

    if digits == "1":
        resolve_transfer(room, "accepted")
        logger.info("[TRANSFER][GATHER] Resolved ACCEPTED for room=%s", room)

        if settings.LIVEKIT_SIP_DOMAIN:
            # ─────────────────────────────────────────────────────────────
            # FIX: Dial into the LiveKit SIP trunk for this specific room.
            # LiveKit's SIP inbound trunk receives the PSTN call and inserts
            # the human agent as a new SIP audio participant in the LiveKit
            # room. The caller (WebRTC) can then hear the human agent (PSTN
            # via SIP) and vice versa.
            #
            # Prerequisites:
            #   1. Create a LiveKit Inbound SIP Trunk in LiveKit Cloud.
            #   2. Create a SIP Dispatch Rule: header/username → room.
            #   3. Set LIVEKIT_SIP_DOMAIN in .env to the trunk's SIP host.
            # ─────────────────────────────────────────────────────────────
            sip_uri = f"sip:{room}@{settings.LIVEKIT_SIP_DOMAIN}"
            logger.info("[TRANSFER][GATHER] Bridging via SIP → %s", sip_uri)

            response.say(
                "You have accepted. Connecting you to the caller now. Please hold.",
                voice="Polly.Joanna",
            )
            dial = Dial(
                answer_on_bridge=True,
                # Keep human agent's call alive until they hang up
                # or the LiveKit room closes the SIP session
                timeout=300,
            )
            dial.sip(
                sip_uri,
                status_callback=(
                    f"{_public_api_base()}/api/transfer/sip-status"
                    f"?room={quote(room)}"
                ),
                status_callback_event="initiated ringing answered completed",
                status_callback_method="POST",
            )
            response.append(dial)
            # After <Dial> completes (human hangs up), play a farewell
            response.say(
                "The call has ended. Thank you.",
                voice="Polly.Joanna",
            )
        else:
            # ─────────────────────────────────────────────────────────────
            # FALLBACK: SIP not configured.
            # Keep the human agent's call open in a Twilio Conference while
            # the watcher (supervisor) bridges via browser WebRTC.
            # NOTE: This only works if a supervisor is actively watching
            # the monitor dashboard and enables their mic.
            # ─────────────────────────────────────────────────────────────
            logger.warning(
                "[TRANSFER][GATHER] LIVEKIT_SIP_DOMAIN not configured — "
                "falling back to Twilio Conference hold."
            )
            response.say(
                "You have accepted. Please stay on the line while we connect you. "
                "The clinic supervisor will speak with you momentarily.",
                voice="Polly.Joanna",
            )
            dial = Dial()
            dial.conference(
                f"ClinicConnect-{room}",
                start_conference_on_enter=True,
                end_conference_on_exit=True,
                wait_url="http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical",
                muted=False,
                beep=False,
            )
            response.append(dial)

        return Response(content=str(response), media_type="application/xml")

    if digits == "2":
        resolve_transfer(room, "declined")
        logger.info("[TRANSFER][GATHER] Resolved DECLINED for room=%s", room)
        response.say(
            "You have declined the call. Thank you.",
            voice="Polly.Joanna",
        )
        return Response(content=str(response), media_type="application/xml")

    # No digit entered (gather timed out) — treat as no-answer
    resolve_transfer(room, "no-answer")
    logger.info("[TRANSFER][GATHER] No DTMF — resolved NO-ANSWER for room=%s", room)
    response.say(
        "No response detected. We will let the caller know. Goodbye.",
        voice="Polly.Joanna",
    )
    return Response(content=str(response), media_type="application/xml")


@router.post("/transfer/sip-status")
async def transfer_sip_status(request: Request, room: str = Query("")):
    """
    Status webhook for the SIP leg (human agent ↔ LiveKit SIP trunk).
    Allows us to track when the SIP bridge connects/disconnects.
    """
    form = await request.form()
    call_status = str(form.get("CallStatus", ""))
    call_sid = str(form.get("CallSid", ""))

    logger.info(
        "[TRANSFER][SIP-STATUS] room=%s status=%s sid=%s",
        room, call_status, call_sid,
    )

    if call_status in ("completed", "failed", "canceled", "busy", "no-answer"):
        logger.warning(
            "[TRANSFER][SIP-STATUS] Human agent SIP call ended: status=%s room=%s",
            call_status, room,
        )

    return Response(content="<Response/>", media_type="application/xml")


@router.post("/transfer/status")
async def transfer_status(request: Request, room: str = Query(...)):
    """
    Twilio calls this webhook when the outbound call changes state.
    Map each terminal Twilio status to the correct outcome so the AI
    knows exactly what happened (no-answer vs busy vs failed).
    """
    form = await request.form()
    call_status = form.get("CallStatus", "")

    logger.info("[TRANSFER][STATUS] room=%s status=%s", room, call_status)

    # Map Twilio terminal statuses to our outcome vocabulary
    status_map = {
        "no-answer": "no-answer",   # Phone rang, nobody picked up
        "busy": "unavailable",      # Line was busy
        "failed": "unavailable",    # Call could not be placed
        "canceled": "unavailable",  # Call was canceled before connecting
        "completed": None,          # Call completed normally — gather handled it
    }

    if call_status in status_map:
        outcome = status_map[call_status]
        if outcome is not None:
            # Only resolve if not already resolved by /gather
            resolve_transfer(room, outcome, only_if_pending=True)

    return Response(status_code=200)
