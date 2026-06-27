"""Twilio webhook endpoints and warm-transfer initiation API."""

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.config import settings
from app.services.transfer import initiate_warm_transfer, resolve_transfer

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


@router.get("/transfer/twiml")
async def transfer_twiml(
    room: str = Query(...),
    reason: str = Query("General assistance"),
    summary: str = Query("A caller needs help."),
):
    from urllib.parse import quote

    gather_action = f"{_public_api_base()}/api/transfer/gather?room={quote(room)}"
    spoken = summary or (
        f"A caller needs assistance regarding {reason}. "
        f"Press 1 to accept this call, or press 2 to decline."
    )
    return _twiml(
        f'<Say voice="Polly.Joanna">{spoken}</Say>'
        f'<Gather numDigits="1" action="{gather_action}" method="POST" timeout="15" actionOnEmptyResult="true">'
        f'<Say voice="Polly.Joanna">Press 1 to accept, or 2 to decline.</Say>'
        f"</Gather>"
        f'<Say voice="Polly.Joanna">No response received. Goodbye.</Say>'
    )


@router.post("/transfer/gather")
async def transfer_gather(request: Request, room: str = Query(...)):
    form = await request.form()
    digits = form.get("Digits", "")

    if digits == "1":
        resolve_transfer(room, "accepted")
        return _twiml(
            '<Say voice="Polly.Joanna">'
            "Thank you. The caller is being connected. "
            "Please open the monitor dashboard and speak through your microphone. "
            "Please stay on the line."
            "</Say>"
        )

    if digits == "2":
        resolve_transfer(room, "declined")
        return _twiml(
            '<Say voice="Polly.Joanna">'
            "Understood. We will let the caller know you are unavailable. Goodbye."
            "</Say>"
        )

    # FIX: No digit entered (gather timed out) — treat as no-answer
    resolve_transfer(room, "no-answer")
    return _twiml(
        '<Say voice="Polly.Joanna">'
        "No response detected. We will let the caller know. Goodbye."
        "</Say>"
    )


@router.post("/transfer/status")
async def transfer_status(request: Request, room: str = Query(...)):
    """
    FIX: Twilio calls this webhook when the outbound call changes state.
    Map each terminal Twilio status to the correct outcome so the AI
    knows exactly what happened (no-answer vs busy vs failed).
    """
    form = await request.form()
    call_status = form.get("CallStatus", "")

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
