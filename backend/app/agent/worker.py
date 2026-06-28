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
    "explicitly asking for a person — call the request_human_transfer tool EXACTLY ONCE with a short reason. "
    "CRITICAL: After calling request_human_transfer, NEVER call it again regardless of the outcome. "
    "If the transfer fails (declined, no-answer, or unavailable), say: "
    "'Unfortunately, no human agent is currently available. Please try again later.' "
    "Then offer to help with their issue yourself. Do NOT retry the transfer tool even if the caller asks — "
    "instead say you have already tried and suggest they call back later or leave a message.\n"
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
    def __init__(self, room, transcript_turns: list, on_takeover=None, on_transfer_accept=None):
        super().__init__(instructions=SYSTEM_PROMPT)
        self.room = room
        self.transcript_turns = transcript_turns
        self.on_takeover = on_takeover
        self.on_transfer_accept = on_transfer_accept
        self.last_booking: dict | None = None
        self.transfer_in_progress = False
        self.transfer_attempted = False
        self._transfer_lock = asyncio.Lock()

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
        self.last_booking = {
            "name": name,
            "reason": reason,
            "date": date,
            "time": time,
            "phone": phone,
        }
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
        # Hard block: once a transfer has been attempted and completed (any outcome),
        # refuse all subsequent calls to prevent infinite transfer loops.
        if self.transfer_attempted:
            logger.info("request_human_transfer blocked: transfer already attempted this session")
            return {
                "status": "already_attempted",
                "message": (
                    "A transfer was already attempted this session and could not connect. "
                    "Do NOT call this tool again. Tell the caller: "
                    "'I have already tried to reach a human agent but was unable to connect. "
                    "Please try calling back later or I can try to help you myself.'"
                ),
            }

        async with self._transfer_lock:
            if self.transfer_in_progress:
                logger.info("request_human_transfer ignored: transfer already in progress")
                return {
                    "status": "in_progress",
                    "message": "A transfer is already in progress. Please wait.",
                }
            self.transfer_in_progress = True

        logger.info(f"request_human_transfer: {reason}")

        await send_custom_data(self.room, {"type": "intent", "intent": "transfer_to_human"})
        await send_custom_data(self.room, {"type": "action", "action": "initiating_warm_transfer"})
        await send_call_status(self.room, "transferring")

        summary = build_transfer_summary(reason, self.transcript_turns, self.last_booking)
        outcome = await initiate_transfer_via_api(self.room.name, reason, summary)

        await send_custom_data(self.room, {"type": "action", "action": ""})

        if outcome == "in_progress":
            async with self._transfer_lock:
                self.transfer_in_progress = False
            # Don't set transfer_attempted for in_progress — it's a duplicate guard, not a real attempt
            return {
                "status": "in_progress",
                "message": "Transfer already in progress. Please wait.",
            }

        if outcome == "accepted":
            async with self._transfer_lock:
                self.transfer_in_progress = False
            self.transfer_attempted = True
            await send_call_status(self.room, "transfer_connected")
            await send_custom_data(
                self.room,
                {"type": "transfer_result", "result": "accepted", "message": "Human agent accepted the call."},
            )
            await send_custom_data(self.room, {"type": "supervisor_audio", "enabled": True})
            if self.on_transfer_accept:
                asyncio.create_task(self.on_transfer_accept())
            return {
                "status": "accepted",
                "message": (
                    "The human agent accepted. Tell the caller a specialist is connecting now, "
                    "then say goodbye warmly."
                ),
            }

        async with self._transfer_lock:
            self.transfer_in_progress = False
        self.transfer_attempted = True

        await send_call_status(self.room, "connected")

        if outcome in ("no-answer", "timeout"):
            await send_custom_data(
                self.room,
                {
                    "type": "transfer_result",
                    "result": "no-answer",
                    "message": "Human agent did not answer the phone.",
                },
            )
            return {
                "status": "no-answer",
                "message": (
                    "The human agent did not pick up the phone. "
                    "Say: 'Unfortunately, no human agent is currently available. Please try again later.' "
                    "Offer to help with their issue or take a message. "
                    "Do NOT call the transfer tool again unless they explicitly ask."
                ),
            }

        if outcome == "declined":
            await send_custom_data(
                self.room,
                {
                    "type": "transfer_result",
                    "result": "declined",
                    "message": "Human agent declined the call.",
                },
            )
            return {
                "status": "declined",
                "message": (
                    "The human agent declined. "
                    "Say: 'Unfortunately, no human agent is currently available. Please try again later.' "
                    "Offer alternatives. Do NOT call the transfer tool again unless they explicitly ask."
                ),
            }

        await send_custom_data(
            self.room,
            {
                "type": "transfer_result",
                "result": "unavailable",
                "message": "Could not reach a human agent.",
            },
        )
        return {
            "status": "unavailable",
            "message": (
                "Could not reach a human agent. Apologize and offer to help. "
                "Do NOT call the transfer tool again unless they explicitly ask."
            ),
        }


def _is_session_alive(session: AgentSession) -> bool:
    """Check if the AgentSession is still running and safe to call methods on."""
    try:
        # AgentSession sets an internal flag when closed/stopped.
        # If the session has been finalized, accessing certain properties
        # or calling methods will raise RuntimeError.
        # We do a lightweight probe here.
        if hasattr(session, '_closed') and session._closed:
            return False
        if hasattr(session, '_running') and not session._running:
            return False
        return True
    except Exception:
        return False


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

    agent_paused = False
    manual_takeover_active = False
    transfer_permanent = False
    agent_session_stopped = False
    agent_paused_lock = asyncio.Lock()

    # Event set when the human SIP participant joins the LiveKit room
    human_sip_joined = asyncio.Event()

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
        nonlocal agent_paused, manual_takeover_active
        async with agent_paused_lock:
            if agent_paused and manual_takeover_active:
                logger.info("Takeover ignored: already in manual takeover")
                return
            if transfer_permanent:
                logger.info("Takeover ignored: permanent transfer active")
                return
            agent_paused = True
            manual_takeover_active = True

        logger.info("Take-over requested — pausing AI agent")

        try:
            session.interrupt()
            await asyncio.sleep(0.2)
            session.update_options(turn_detection="manual")
        except Exception as e:
            logger.error(f"Failed to pause agent: {e}")

        await send_call_status(ctx.room, "takeover")
        await send_custom_data(ctx.room, {"type": "agent_state", "state": "idle"})
        await send_custom_data(ctx.room, {"type": "action", "action": ""})

    async def handle_resume():
        nonlocal agent_paused, manual_takeover_active
        async with agent_paused_lock:
            if transfer_permanent:
                logger.info("[RESUME] Ignored: permanent transfer active")
                return
            if not manual_takeover_active:
                logger.info("[RESUME] Ignored: not in manual takeover")
                return
            agent_paused = False
            manual_takeover_active = False

        logger.info("[RESUME] Resuming AI agent — checking session health")

        # BUG #2 FIX: Check if session is still alive before touching it.
        # The session can be destroyed if finalize_call() ran due to a watcher
        # disconnect (now fixed by caller identity check, but this is defense-in-depth).
        session_alive = _is_session_alive(session)
        logger.info("[RESUME] session_alive=%s", session_alive)

        if not session_alive:
            logger.error(
                "[RESUME] AgentSession is dead — cannot resume. "
                "Sending 'ended' to frontend so it can recover."
            )
            await send_call_status(ctx.room, "ended")
            await send_custom_data(ctx.room, {
                "type": "agent_state",
                "state": "ended",
            })
            await send_custom_data(ctx.room, {
                "type": "resume_failed",
                "reason": "session_dead",
            })
            return

        # Send status FIRST so the frontend gets confirmation immediately
        # (before the TTS speak call which can take seconds)
        await send_call_status(ctx.room, "connected")
        await send_custom_data(ctx.room, {"type": "agent_state", "state": "listening"})

        try:
            session.update_options(turn_detection="vad")
            await asyncio.sleep(0.3)
            await session.say(
                "I'm back. How can I continue to help you?",
                allow_interruptions=True,
            )
        except Exception as e:
            logger.error(f"[RESUME] Failed to resume agent: {e}")
            # Notify frontend so it doesn't get stuck in takeover state
            await send_call_status(ctx.room, "ended")
            await send_custom_data(ctx.room, {
                "type": "resume_failed",
                "reason": str(e),
            })

    async def handle_transfer_accept():
        nonlocal agent_paused, transfer_permanent, manual_takeover_active
        async with agent_paused_lock:
            transfer_permanent = True
            manual_takeover_active = True
            agent_paused = True

        logger.info("[TRANSFER][ACCEPT] Agent paused, waiting for SIP participant")

        try:
            session.interrupt()
            await asyncio.sleep(0.2)
            session.update_options(turn_detection="manual")
        except Exception as e:
            logger.error(f"[TRANSFER][ACCEPT] Failed to pause agent: {e}")

        await send_call_status(ctx.room, "transfer_connected")
        await send_custom_data(ctx.room, {"type": "transfer_result", "result": "accepted"})
        await send_custom_data(ctx.room, {"type": "supervisor_audio", "enabled": True})
        await send_custom_data(ctx.room, {
            "type": "action",
            "action": "sip_bridge_connecting",
        })
        await send_custom_data(ctx.room, {"type": "agent_state", "state": "idle"})

        # Schedule the agent disconnect — waits for the human SIP participant
        # to join, lets the AI say a brief goodbye, then stops the session
        # so only caller (WebRTC) ↔ human (SIP) remain for direct audio.
        asyncio.create_task(disconnect_agent_after_sip_join())

    async def disconnect_agent_after_sip_join():
        """Wait for the human SIP participant to join the room, then stop the
        AgentSession and mute the agent's audio tracks so only caller ↔ human
        remain for direct bidirectional audio bridging.

        The agent participant stays connected (for data channel / monitoring)
        but its audio pipeline is fully shut down."""
        nonlocal agent_session_stopped

        logger.info("[TRANSFER][DISCONNECT] Waiting for human SIP participant to join...")

        try:
            await asyncio.wait_for(human_sip_joined.wait(), timeout=30)
        except asyncio.TimeoutError:
            logger.warning(
                "[TRANSFER][DISCONNECT] Human SIP participant did not join within 30s. "
                "Agent remains paused; caller and human may still be bridged if "
                "SIP connection succeeded outside our detection window."
            )
            # Even on timeout, try to stop the session — the SIP participant
            # might have joined with an unexpected identity.

        logger.info("[TRANSFER][DISCONNECT] Human SIP participant detected (or timeout). "
                     "Giving AI a moment to finish any goodbye utterance...")

        # Brief delay so any in-flight AI goodbye speech finishes
        await asyncio.sleep(3)

        # --- Stop the AgentSession (kills STT/LLM/TTS pipeline) ---
        logger.info("[TRANSFER][DISCONNECT] Stopping AgentSession...")
        try:
            await session.aclose()
            agent_session_stopped = True
            logger.info("[TRANSFER][DISCONNECT] AgentSession stopped successfully")
        except Exception as e:
            logger.error(f"[TRANSFER][DISCONNECT] Error stopping session: {e}")
            agent_session_stopped = True  # Mark stopped even on error

        # --- Mute and unpublish agent's audio tracks ---
        logger.info("[TRANSFER][DISCONNECT] Muting agent audio tracks...")
        try:
            local = ctx.room.local_participant
            if local:
                for pub in local.track_publications.values():
                    if pub.track and pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                        await local.set_microphone_enabled(False)
                        logger.info("[TRANSFER][DISCONNECT] Agent microphone disabled")
                        break
        except Exception as e:
            logger.error(f"[TRANSFER][DISCONNECT] Error muting agent tracks: {e}")

        await send_custom_data(ctx.room, {
            "type": "action",
            "action": "",
        })
        await send_custom_data(ctx.room, {
            "type": "transfer_bridge_active",
            "message": "Caller and human are now directly connected.",
        })

        logger.info(
            "[TRANSFER][DISCONNECT] Agent audio pipeline fully stopped. "
            "Room now contains only caller (WebRTC) ↔ human (SIP) for direct bridging."
        )

    async def handle_end_call_from_watcher():
        """Handle watcher clicking End Call — say goodbye and finalize."""
        nonlocal agent_paused
        logger.info("End call requested by watcher")
        if not agent_paused:
            try:
                await session.say(
                    "The call is being ended by the supervisor. Thank you for calling. Goodbye!",
                    allow_interruptions=False,
                )
            except Exception as e:
                logger.error(f"Failed to say goodbye: {e}")
        await finalize_call()

    @ctx.room.on("data_received")
    def on_data_received(data: rtc.DataPacket):
        try:
            payload = json.loads(data.data.decode("utf-8"))
            msg_type = payload.get("type")

            if msg_type == "takeover_request":
                asyncio.create_task(handle_takeover())
            elif msg_type == "resume_request":
                asyncio.create_task(handle_resume())
            elif msg_type == "end_call_request":
                asyncio.create_task(handle_end_call_from_watcher())
        except Exception as e:
            logger.error(f"Error parsing data_received: {e}")

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
            # Check if this is a rate limit error
            error_str = str(e)
            if "429" in error_str or "rate_limit" in error_str.lower():
                logger.warning(f"Rate limit reached - skipping summary generation: {e}")
                summary_text = f"Call completed. Summary generation skipped due to API rate limit. Transcript has {len(transcript_turns)} turns."
            else:
                logger.error(f"Failed to generate call summary: {e}")
                summary_text = "Call completed. Summary generation failed."

        await asyncio.to_thread(db_save_call_summary, ctx.room.name, summary_text, transcript_turns)
        await send_custom_data(ctx.room, {"type": "summary", "text": summary_text})

    # BUG #2 FIX: Track the caller's identity so we only finalize when the
    # actual caller disconnects, not when the watcher/supervisor leaves.
    caller_participant_identity: str | None = None

    def _is_sip_participant(participant: rtc.RemoteParticipant) -> bool:
        """Detect if a participant joined via SIP trunk (the human agent).
        LiveKit SIP participants typically have kind=SIP or an identity
        starting with 'sip_' or containing a phone number pattern."""
        identity = participant.identity or ""
        # Check participant kind if available (livekit-agents >= 0.8)
        try:
            if hasattr(participant, 'kind'):
                from livekit.rtc import ParticipantKind
                if participant.kind == ParticipantKind.PARTICIPANT_KIND_SIP:
                    return True
        except (ImportError, AttributeError):
            pass
        # Fallback: check identity patterns
        if identity.lower().startswith("sip_"):
            return True
        if identity.startswith("+") or identity.startswith("phone_"):
            return True
        return False

    @ctx.room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        nonlocal caller_participant_identity

        # Detect SIP participant (human agent joining via SIP trunk)
        if _is_sip_participant(participant):
            logger.info(
                "[WORKER] Human SIP participant joined: identity=%s",
                participant.identity,
            )
            human_sip_joined.set()
            return

        # The first non-agent, non-watcher participant is the caller
        if (
            caller_participant_identity is None
            and participant.identity != "agent"
            and not participant.identity.startswith("watcher")
        ):
            caller_participant_identity = participant.identity
            logger.info("[WORKER] Caller identity captured: %s", caller_participant_identity)
        else:
            logger.info(
                "[WORKER] Additional participant connected: %s (caller=%s)",
                participant.identity, caller_participant_identity,
            )

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        logger.info(
            "[WORKER] participant_disconnected: identity=%s caller=%s",
            participant.identity,
            caller_participant_identity,
        )
        if participant.identity == caller_participant_identity:
            logger.info(
                "[WORKER] Caller (%s) disconnected — finalizing call",
                participant.identity,
            )
            asyncio.create_task(finalize_call())
        elif _is_sip_participant(participant):
            logger.info(
                "[WORKER] Human SIP participant (%s) disconnected — "
                "human hung up, finalizing call",
                participant.identity,
            )
            asyncio.create_task(finalize_call())
        else:
            logger.info(
                "[WORKER] Non-caller participant (%s) disconnected — ignoring, "
                "call continues",
                participant.identity,
            )

    agent = ClinicBookingAssistant(
        ctx.room,
        transcript_turns,
        on_takeover=handle_takeover,
        on_transfer_accept=handle_transfer_accept,
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