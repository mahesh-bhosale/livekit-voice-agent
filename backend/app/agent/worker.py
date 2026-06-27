import asyncio
import json
import logging
import os

from datetime import datetime
from dotenv import load_dotenv

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    AgentStateChangedEvent,
    AutoSubscribe,
    ConversationItemAddedEvent,
    JobContext,
    WorkerOptions,
    cli,
    function_tool,
)
from livekit.agents.llm import ChatMessage
from livekit.plugins import cartesia, deepgram, groq, silero
from livekit.agents.voice.agent_activity import TurnDetectionMode

from app.services.transfer import build_transfer_summary

load_dotenv(override=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-agent-worker")

AGENT_NAME = "Alex"
CLINIC_NAME = "Sunrise Clinic"

SYSTEM_PROMPT = (
    f"You are {AGENT_NAME}, a friendly virtual receptionist for {CLINIC_NAME}. Your job:\n"
    "1. Greet the caller warmly.\n"
    "2. If they want to book an appointment, collect: full name, reason for visit, preferred date and time, "
    "and a contact phone number — one at a time, naturally, don't interrogate.\n"
    "3. Once you have all 4 details, call the check_availability tool.\n"
    "4. If available, confirm with the caller, then call the book_appointment tool, then read back the full booking details.\n"
    "5. If the caller says anything indicating they want a human — billing issue, complaint, frustration, "
    "explicitly asking for a person — call the request_human_transfer tool immediately with a short reason. "
    "If the transfer fails (declined or unavailable), explain that the representative is not available right now, "
    "and do NOT automatically retry the transfer. Wait for the user to explicitly request it again.\n"
    "6. Keep responses brief and conversational, like a real phone call."
)


async def send_custom_data(room, data_dict):
    if not room or not room.local_participant:
        return
    try:
        payload = json.dumps(data_dict)
        await room.local_participant.publish_data(payload=payload)
    except Exception as e:
        logger.error(f"Error publishing data channel message: {e}")


async def send_call_status(room, status: str):
    await send_custom_data(room, {"type": "call_status", "status": status})


def db_book_appointment(name: str, reason: str, date: str, time: str, phone: str, room_name: str | None) -> dict:
    from app.db import SessionLocal
    from app.models import Appointment

    db = SessionLocal()
    try:
        appt = Appointment(
            name=name,
            reason=reason,
            date=date,
            time=time,
            phone=phone,
            room_name=room_name,
        )
        db.add(appt)
        db.commit()
        db.refresh(appt)
        logger.info(f"Booked appointment ID {appt.id} for {name}")
        return {"success": True, "appointment_id": appt.id}
    except Exception as e:
        db.rollback()
        logger.error(f"DB Error booking appointment: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()


def db_save_call_summary(room_name: str, summary: str, transcript: list) -> dict:
    from app.db import SessionLocal
    from app.models import CallSummary

    db = SessionLocal()
    try:
        call_sum = CallSummary(
            room_name=room_name,
            summary=summary,
            transcript=transcript,
        )
        db.add(call_sum)
        db.commit()
        db.refresh(call_sum)
        logger.info(f"Saved CallSummary ID {call_sum.id} for room {room_name}")
        return {"success": True, "summary_id": call_sum.id}
    except Exception as e:
        db.rollback()
        logger.error(f"DB Error saving call summary: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()


async def initiate_transfer_via_api(room_name: str, reason: str, summary: str) -> str:
    """Call the FastAPI server so Twilio webhooks resolve in the same process."""
    import httpx

    from app.config import settings

    api_base = settings.BACKEND_API_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=70.0) as client:
            response = await client.post(
                f"{api_base}/api/transfer/initiate",
                json={"room_name": room_name, "reason": reason, "summary": summary},
            )
            response.raise_for_status()
            return response.json().get("outcome", "unavailable")
    except Exception as exc:
        logger.error("Transfer API call failed: %s", exc)
        return "unavailable"


class ClinicBookingAssistant(Agent):
    def __init__(self, room, transcript_turns: list, takeover_event: asyncio.Event, on_takeover=None, on_transfer_accept=None):
        super().__init__(instructions=SYSTEM_PROMPT)
        self.room = room
        self.transcript_turns = transcript_turns
        self.takeover_event = takeover_event
        self.on_takeover = on_takeover
        self.on_transfer_accept = on_transfer_accept
        self.transfer_in_progress = False

    @function_tool
    async def check_availability(self, date: str, time: str) -> dict:
        """Check whether a preferred date and time slot is available for booking."""
        logger.info(f"check_availability: {date} at {time}")

        await send_custom_data(self.room, {"type": "intent", "intent": "booking"})
        await send_custom_data(self.room, {"type": "action", "action": "checking_availability"})

        from app.agent.availability import is_slot_booked

        booked = is_slot_booked(date, time)

        await send_custom_data(self.room, {"type": "action", "action": ""})

        if booked:
            return {
                "available": False,
                "alternative": "That slot is not available. How about 11:30 AM or 2:00 PM instead?",
            }
        return {"available": True, "alternative": None}

    @function_tool
    async def book_appointment(self, name: str, reason: str, date: str, time: str, phone: str) -> dict:
        """Book a clinic appointment after availability is confirmed and details are collected."""
        logger.info(f"book_appointment: {name} on {date} at {time}")

        await send_custom_data(self.room, {"type": "intent", "intent": "booking"})
        await send_custom_data(self.room, {"type": "action", "action": "booking"})

        res = await asyncio.to_thread(
            db_book_appointment,
            name=name,
            reason=reason,
            date=date,
            time=time,
            phone=phone,
            room_name=self.room.name,
        )

        await send_custom_data(self.room, {"type": "action", "action": ""})
        await send_custom_data(
            self.room,
            {
                "type": "booking_data",
                "name": name,
                "reason": reason,
                "date": date,
                "time": time,
                "phone": phone,
            },
        )
        return res

    @function_tool
    async def request_human_transfer(self, reason: str) -> dict:
        """Transfer the caller to a human agent when they ask for a person or have billing/complaint issues."""
        if self.transfer_in_progress:
            logger.info("request_human_transfer ignored: transfer already in progress")
            return {
                "status": "in_progress",
                "message": "A transfer call is already active. Please wait.",
            }
        self.transfer_in_progress = True
        logger.info(f"request_human_transfer: {reason}")

        await send_custom_data(self.room, {"type": "intent", "intent": "transfer_request"})
        await send_custom_data(self.room, {"type": "action", "action": "transferring"})
        await send_call_status(self.room, "transferring")

        summary = build_transfer_summary(reason, self.transcript_turns)
        outcome = await initiate_transfer_via_api(self.room.name, reason, summary)

        await send_custom_data(self.room, {"type": "action", "action": ""})

        if outcome == "accepted":
            await send_call_status(self.room, "transfer_connected")
            await send_custom_data(
                self.room,
                {"type": "transfer_result", "result": "accepted", "message": "Human agent accepted the call."},
            )
            if self.on_transfer_accept:
                asyncio.create_task(self.on_transfer_accept())
            return {
                "status": "accepted",
                "message": (
                    "The human agent accepted. Tell the caller you are connecting them now "
                    "and that a team member will join shortly."
                ),
            }

        # Clear flag as transfer failed
        self.transfer_in_progress = False

        await send_call_status(self.room, "connected")
        await send_custom_data(
            self.room,
            {
                "type": "transfer_result",
                "result": outcome,
                "message": "Human agent was not available.",
            },
        )

        if outcome == "declined":
            return {
                "status": "declined",
                "message": (
                    "The human agent is unavailable right now. Apologize, offer to take a message, "
                    "or help with booking instead."
                ),
            }

        return {
            "status": "unavailable",
            "message": (
                "Could not reach a human agent at this time. Apologize and offer to help "
                "or schedule a callback."
            ),
        }


async def entrypoint(ctx: JobContext):
    logger.info(f"Connecting to room {ctx.room.name}")

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    await send_call_status(ctx.room, "connected")

    stt = deepgram.STT(model="nova-2", language="en")

    cartesia_key = os.getenv("CARTESIA_API_KEY") or os.getenv("TTS_API_KEY")
    tts = cartesia.TTS(
        api_key=cartesia_key,
        model="sonic-3",
        voice="f786b574-daa5-4673-aa0c-cbe3e8534c02",
    )

    llm = groq.LLM(api_key=os.getenv("GROQ_API_KEY"), model="llama-3.3-70b-versatile")
    vad = silero.VAD.load()

    session = AgentSession(stt=stt, vad=vad, llm=llm, tts=tts)

    transcript_turns: list[dict] = []
    has_finalized = False
    takeover_event = asyncio.Event()
    agent_paused = False

    @session.on("agent_state_changed")
    def on_agent_state_changed(event: AgentStateChangedEvent):
        if agent_paused:
            return
        state_str = str(event.new_state).lower()
        if state_str in ["listening", "thinking", "speaking"]:
            asyncio.create_task(send_custom_data(ctx.room, {"type": "agent_state", "state": state_str}))

    @session.on("conversation_item_added")
    def on_conversation_item_added(event: ConversationItemAddedEvent):
        if agent_paused:
            return
        item = event.item
        if isinstance(item, ChatMessage) and item.role in ("user", "assistant"):
            role_label = "caller" if item.role == "user" else "agent"
            text = item.text_content
            if text:
                transcript_turns.append(
                    {
                        "speaker": role_label,
                        "text": text,
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                )
                asyncio.create_task(
                    send_custom_data(
                        ctx.room,
                        {"type": "transcript", "speaker": role_label, "text": text},
                    )
                )

    async def handle_takeover():
        nonlocal agent_paused
        if agent_paused:
            return
        agent_paused = True
        takeover_event.set()
        logger.info("Take-over requested — pausing AI agent VAD")

        try:
            session.update_options(turn_detection="manual")
            session.interrupt()
        except Exception as e:
            logger.error(f"Failed to pause VAD: {e}")

        await send_call_status(ctx.room, "takeover")
        await send_custom_data(ctx.room, {"type": "agent_state", "state": "idle"})
        await send_custom_data(ctx.room, {"type": "action", "action": ""})

    async def handle_resume():
        nonlocal agent_paused
        if not agent_paused:
            return
        agent_paused = False
        logger.info("Resume requested — resuming AI agent VAD")

        try:
            session.update_options(turn_detection="vad")
        except Exception as e:
            logger.error(f"Failed to resume VAD: {e}")

        await send_call_status(ctx.room, "connected")

    async def handle_transfer_accept():
        nonlocal agent_paused
        agent_paused = True
        takeover_event.set()
        logger.info("Transfer accepted — permanently closing AI agent session")

        try:
            await session.aclose()
        except Exception:
            pass

    @ctx.room.on("data_received")
    def on_data_received(data: rtc.DataPacket):
        try:
            payload = json.loads(data.data.decode("utf-8"))
            if payload.get("type") == "takeover_request":
                asyncio.create_task(handle_takeover())
            elif payload.get("type") == "resume_request":
                asyncio.create_task(handle_resume())
        except Exception:
            pass

    async def finalize_call():
        nonlocal has_finalized
        if has_finalized:
            return
        has_finalized = True

        await send_call_status(ctx.room, "ended")

        if not transcript_turns:
            logger.info("Call ended with no transcript.")
            return

        logger.info("Generating post-call summary...")
        transcript_text = "\n".join([f"{t['speaker']}: {t['text']}" for t in transcript_turns])

        summary_text = ""
        try:
            import groq as groq_client_lib

            client = groq_client_lib.Groq(api_key=os.getenv("GROQ_API_KEY"))
            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Summarize this call in 2-3 sentences: what the caller wanted, "
                            "what was resolved, and any follow-up needed."
                        ),
                    },
                    {"role": "user", "content": transcript_text},
                ],
            )
            summary_text = completion.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"Failed to generate call summary: {e}")
            summary_text = "Call completed. Summary generation failed."

        await asyncio.to_thread(db_save_call_summary, ctx.room.name, summary_text, transcript_turns)
        await send_custom_data(ctx.room, {"type": "summary", "text": summary_text})

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant):
        if participant.identity != "agent" and not participant.identity.startswith("watcher"):
            logger.info(f"Caller left: {participant.identity}")
            asyncio.create_task(finalize_call())

    agent = ClinicBookingAssistant(
        ctx.room,
        transcript_turns,
        takeover_event,
        on_takeover=handle_takeover,
        on_transfer_accept=handle_transfer_accept
    )

    logger.info("Starting AgentSession pipeline...")
    await session.start(agent=agent, room=ctx.room)

    await asyncio.sleep(1.5)
    if not agent_paused:
        await session.say(
            f"Hello! Thank you for calling {CLINIC_NAME}. My name is {AGENT_NAME}, your virtual receptionist. "
            "How can I help you today?",
            allow_interruptions=True,
        )

    disconnect_future = asyncio.Future()

    @ctx.room.on("disconnected")
    def trigger_exit():
        if not disconnect_future.done():
            disconnect_future.set_result(True)

    await disconnect_future
    await finalize_call()
    logger.info("Worker task complete.")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
