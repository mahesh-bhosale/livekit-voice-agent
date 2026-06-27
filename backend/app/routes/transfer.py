"""Twilio webhook endpoints for warm-transfer DTMF accept/decline."""

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from app.services.transfer import resolve_transfer

router = APIRouter()


def _twiml(content: str) -> Response:
    return Response(content=f'<?xml version="1.0" encoding="UTF-8"?><Response>{content}</Response>', media_type="application/xml")


@router.get("/transfer/twiml")
async def transfer_twiml(
    room: str = Query(...),
    reason: str = Query("General assistance"),
    summary: str = Query("A caller needs help."),
):
    gather_action = f"/api/transfer/gather?room={room}"
    spoken = (
        f"Hello, this is ClinicConnect Voice. "
        f"A caller needs assistance. {reason}. "
        f"Call summary: {summary}. "
        f"Press 1 to accept this call, or press 2 to decline."
    )
    return _twiml(
        f'<Say voice="Polly.Joanna">{spoken}</Say>'
        f'<Gather numDigits="1" action="{gather_action}" method="POST" timeout="12">'
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
            '<Say voice="Polly.Joanna">Thank you. The caller is being connected. Please stay on the line.</Say>'
        )

    resolve_transfer(room, "declined")
    return _twiml('<Say voice="Polly.Joanna">Understood. We will let the caller know you are unavailable.</Say>')
