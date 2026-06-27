import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from dotenv import load_dotenv

# Import LiveKit Agent SDK modules
from livekit.agents import (
    Agent,
    AgentSession,
    AgentStateChangedEvent,
    AutoSubscribe,
    ConversationItemAddedEvent,
    JobContext,
    UserInputTranscribedEvent,
    WorkerOptions,
    cli,
    function_tool,
)
from livekit.agents.llm import ChatMessage, ChatRole
from livekit.plugins import cartesia, deepgram, groq, silero

# Ensure environment variables are loaded
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-agent-worker")

# Define the system instructions for the LLM
SYSTEM_PROMPT = (
    "You are a friendly appointment booking assistant for a small clinic. Your job:\n"
    "1. Greet the caller warmly.\n"
    "2. If they want to book an appointment, collect: full name, reason for visit, preferred date and time, "
    "and a contact phone number — one at a time, naturally, don't interrogate.\n"
    "3. Once you have all 4 details, call the check_availability tool.\n"
    "4. If available, confirm with the caller, then call the book_appointment tool, then read back the full booking details.\n"
    "5. If the caller says anything indicating they want a human — billing issue, complaint, frustration, "
    "explicitly asking for a person — call the request_human_transfer tool immediately with a short reason.\n"
    "6. Keep responses brief and conversational, like a real phone call."
)

# Helper function to send JSON messages over the LiveKit data channel
async def send_custom_data(room, data_dict):
    if not room or not room.local_participant:
        return
    try:
        payload = json.dumps(data_dict)
        await room.local_participant.publish_data(payload=payload)
        logger.debug(f"Broadcasted data channel message: {payload}")
    except Exception as e:
        logger.error(f"Error publishing data channel message: {e}")

# Synchronous DB operation helpers run in worker threads
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
            room_name=room_name
        )
        db.add(appt)
        db.commit()
        db.refresh(appt)
        logger.info(f"DB Insert: Booked appointment ID {appt.id} for {name}")
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
            transcript=transcript
        )
        db.add(call_sum)
        db.commit()
        db.refresh(call_sum)
        logger.info(f"DB Insert: Saved CallSummary ID {call_sum.id} for room {room_name}")
        return {"success": True, "summary_id": call_sum.id}
    except Exception as e:
        db.rollback()
        logger.error(f"DB Error saving call summary: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()

# Define the Agent logic class subclassing livekit.agents.Agent
class ClinicBookingAssistant(Agent):
    def __init__(self, room):
        super().__init__(
            instructions=SYSTEM_PROMPT,
        )
        self.room = room

    @function_tool
    async def check_availability(self, date: str, time: str) -> dict:
        """Called to check availability of a preferred date and time slot for an appointment."""
        logger.info(f"Tool call check_availability: {date} at {time}")
        
        # Publish intent and action indicators
        await send_custom_data(self.room, {"type": "intent", "intent": "booking"})
        await send_custom_data(self.room, {"type": "action", "action": "checking_availability"})

        from app.agent.availability import is_slot_booked
        booked = is_slot_booked(date, time)
        
        if booked:
            alt_suggestion = "11:30 AM or 2:00 PM instead"
            logger.info(f"Slot {date} {time} is booked. Suggesting alternative: {alt_suggestion}")
            return {
                "available": False,
                "alternative": f"That slot is not available. How about {alt_suggestion}?"
            }
        else:
            logger.info(f"Slot {date} {time} is available.")
            return {"available": True, "alternative": None}

    @function_tool
    async def book_appointment(self, name: str, reason: str, date: str, time: str, phone: str) -> dict:
        """Called to book a clinic appointment once the slot availability is confirmed and details are gathered."""
        logger.info(f"Tool call book_appointment: Name={name}, Date={date}, Time={time}")
        
        await send_custom_data(self.room, {"type": "intent", "intent": "booking"})
        await send_custom_data(self.room, {"type": "action", "action": "booking"})

        # Wrap blocking database insert in asyncio.to_thread
        res = await asyncio.to_thread(
            db_book_appointment,
            name=name,
            reason=reason,
            date=date,
            time=time,
            phone=phone,
            room_name=self.room.name
        )
        return res

    @function_tool
    async def request_human_transfer(self, reason: str) -> dict:
        """Called when the caller expresses frustration, complains, has a billing issue, or explicitly asks for a human agent."""
        logger.info(f"Tool call request_human_transfer. Reason: {reason}")
        
        await send_custom_data(self.room, {"type": "intent", "intent": "transfer_request"})
        await send_custom_data(self.room, {"type": "action", "action": "transferring"})

        # In a real app this would route to a SIP trunk or Twilio conference call
        return {
            "status": "transferring",
            "message": "Understood. I will route your call to a human coordinator immediately. Please hold."
        }

async def entrypoint(ctx: JobContext):
    logger.info(f"Entrypoint dispatched: connecting to room {ctx.room.name}")
    
    # Connect and subscribe only to participant audio
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    
    # Setup speech components
    stt = deepgram.STT(model="nova-2", language="en")
    
    cartesia_key = os.getenv("CARTESIA_API_KEY") or os.getenv("TTS_API_KEY")
    tts = cartesia.TTS(api_key=cartesia_key, model="sonic-english", voice="f786b574-daa5-4673-aa0c-cbe3e8534c02")
    
    llm = groq.LLM(
        api_key=os.getenv("GROQ_API_KEY"),
        model="llama-3.3-70b-versatile"
    )
    
    vad = silero.VAD.load()

    # Instantiate the unified AgentSession
    session = AgentSession(
        stt=stt,
        vad=vad,
        llm=llm,
        tts=tts,
    )

    # Local transcript history cache
    transcript_turns = []
    has_finalized = False

    # 1. Handle live state broadcasts (Listening / Thinking / Speaking)
    @session.on("agent_state_changed")
    def on_agent_state_changed(event: AgentStateChangedEvent):
        state_str = str(event.new_state).lower()
        # Map LiveKit states to front-end states
        if state_str in ["listening", "thinking", "speaking"]:
            asyncio.create_task(send_custom_data(ctx.room, {
                "type": "agent_state",
                "state": state_str
            }))

    # 2. Handle transcription broadcast & recording
    @session.on("conversation_item_added")
    def on_conversation_item_added(event: ConversationItemAddedEvent):
        item = event.item
        if isinstance(item, ChatMessage):
            # Only record spoken turns
            if item.role in [ChatRole.USER, ChatRole.ASSISTANT]:
                role_label = "caller" if item.role == ChatRole.USER else "agent"
                text = item.text_content
                if text:
                    # Append to transcript history
                    transcript_turns.append({
                        "speaker": role_label,
                        "text": text,
                        "timestamp": datetime.utcnow().isoformat()
                    })
                    # Send live transcript update
                    asyncio.create_task(send_custom_data(ctx.room, {
                        "type": "transcript",
                        "speaker": role_label,
                        "text": text
                    }))

    # Setup cleanup/summary function to run at call end
    async def finalize_call():
        nonlocal has_finalized
        if has_finalized:
            return
        has_finalized = True
        
        if not transcript_turns:
            logger.info("Call ended: No transcript data recorded to summarize.")
            return

        logger.info("Call ended: Generating AI conversation summary via Groq...")
        
        # Format the full turn history
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
                        "content": "Summarize this call in 2-3 sentences: what the caller wanted, what was resolved, any follow-up needed."
                    },
                    {"role": "user", "content": transcript_text}
                ]
            )
            summary_text = completion.choices[0].message.content
            logger.info(f"Summary generated successfully: {summary_text}")
        except Exception as e:
            logger.error(f"Failed to generate call summary: {e}")
            summary_text = "Call completed. Summary generation failed."

        # Save call summary to PostgreSQL synchronously via thread pooling
        db_res = await asyncio.to_thread(db_save_call_summary, ctx.room.name, summary_text, transcript_turns)
        logger.info(f"Database summary write result: {db_res}")

        # Send final data package to the room data channel (watcher is notified)
        await send_custom_data(ctx.room, {
            "type": "summary",
            "text": summary_text
        })

    # Hook finalize callback on participant leaving or room disconnection
    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant):
        logger.info(f"Caller participant left: {participant.identity}. Initiating finalization.")
        asyncio.create_task(finalize_call())

    @ctx.room.on("disconnected")
    def on_disconnected():
        logger.info("Room connection disconnected. Triggering finalization.")
        asyncio.create_task(finalize_call())

    # Initialize clinical booking assistant
    agent = ClinicBookingAssistant(ctx.room)

    # Start the agent session loop
    logger.info("Starting AgentSession pipeline...")
    await session.start(agent=agent, room=ctx.room)
    logger.info("AgentSession started successfully.")
    
    # Greet participant
    await asyncio.sleep(1.5)
    await session.say("Hello! Thank you for calling the clinic today. My name is Antigravity. How can I help you?", allow_interruptions=True)

    # Keep entrypoint alive while connected
    disconnect_future = asyncio.Future()
    @ctx.room.on("disconnected")
    def trigger_exit():
        if not disconnect_future.done():
            disconnect_future.set_result(True)

    await disconnect_future
    # Fallback finalize call in case events were missed
    await finalize_call()
    logger.info("Entrypoint run complete. Exiting worker task.")

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
