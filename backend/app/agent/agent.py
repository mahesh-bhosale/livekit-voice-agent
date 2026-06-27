import asyncio
import logging
import os
from datetime import datetime
from dotenv import load_dotenv
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, llm
from livekit.agents.voice_assistant import VoiceAssistant
from livekit.plugins import deepgram, cartesia, groq, silero

# Ensure env variables are loaded
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-agent")

class AssistantFunctionContext(llm.FunctionContext):
    def __init__(self):
        super().__init__()
        self.assistant = None

    def set_assistant(self, assistant: VoiceAssistant):
        self.assistant = assistant
        
    @llm.ai_callable(description="Schedule a medical appointment for a patient.")
    def schedule_appointment(
        self, 
        name: str, 
        reason: str, 
        date: str, 
        time: str, 
        phone: str | None = None,
        room_name: str | None = None
    ) -> str:
        from app.db import SessionLocal
        from app.models import Appointment
        
        logger.info(f"LLM Tool Call: Scheduling appointment for {name} on {date} at {time} (reason: {reason})")
        db = SessionLocal()
        try:
            appointment = Appointment(
                name=name,
                reason=reason,
                date=date,
                time=time,
                phone=phone,
                room_name=room_name
            )
            db.add(appointment)
            db.commit()
            db.refresh(appointment)
            return f"Success! Created appointment ID {appointment.id} for {name} on {date} at {time}."
        except Exception as e:
            logger.error(f"Error scheduling appointment: {e}")
            return f"Error: Failed to schedule appointment: {str(e)}"
        finally:
            db.close()

    @llm.ai_callable(description="Save the conversation summary in the database.")
    def save_conversation_summary(self, room_name: str, summary: str) -> str:
        from app.db import SessionLocal
        from app.models import CallSummary
        
        logger.info(f"LLM Tool Call: Saving call summary for room {room_name}")
        
        # Automatically extract transcript turns from the live voice assistant chat context
        transcript_turns = []
        if self.assistant and self.assistant.chat_ctx:
            for msg in self.assistant.chat_ctx.messages:
                if msg.role in ["user", "assistant"] and msg.text:
                    transcript_turns.append({
                        "speaker": "caller" if msg.role == "user" else "agent",
                        "text": msg.text,
                        "timestamp": datetime.utcnow().isoformat()
                    })

        db = SessionLocal()
        try:
            call_summary = CallSummary(
                room_name=room_name, 
                summary=summary, 
                transcript=transcript_turns
            )
            db.add(call_summary)
            db.commit()
            db.refresh(call_summary)
            return f"Success! Saved call summary ID {call_summary.id} for room {room_name} with {len(transcript_turns)} transcript turns."
        except Exception as e:
            logger.error(f"Error saving summary: {e}")
            return f"Error: Failed to save summary: {str(e)}"
        finally:
            db.close()

async def entrypoint(ctx: JobContext):
    logger.info(f"Connecting voice agent to room: {ctx.room.name}")
    
    # Auto-subscribe to audio only
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    
    # Wait for the first user participant to join
    logger.info("Waiting for participant...")
    
    # Initialize the speech, language, and voice models
    stt = deepgram.STT()
    
    cartesia_key = os.getenv("CARTESIA_API_KEY") or os.getenv("TTS_API_KEY")
    tts = cartesia.TTS(api_key=cartesia_key, model="sonic-english")
    
    llm_model = groq.LLM(
        api_key=os.getenv("GROQ_API_KEY"),
        model="llama-3.3-70b-versatile"
    )
    
    fnc_ctx = AssistantFunctionContext()
    
    assistant = VoiceAssistant(
        vad=silero.VAD.load(),
        stt=stt,
        llm=llm_model,
        tts=tts,
        fnc_ctx=fnc_ctx,
        chat_ctx=llm.ChatContext().append(
            role="system",
            text=(
                "You are an AI front-desk medical receptionist. Your name is Antigravity. "
                "You assist clients with scheduling appointments (we need name, reason, date, time, and optional phone). "
                "Ensure conversations are professional, empathetic, and concise. "
                "Use the schedule_appointment tool to save any appointments scheduled during the call. "
                "Before saying goodbye, you MUST call the save_conversation_summary tool to save a "
                "summary of the appointment and conversation. Thank the user, run the tool, and then say goodbye."
            )
        )
    )
    
    # Connect function context to assistant for automatic transcript extraction
    fnc_ctx.set_assistant(assistant)
    
    # Start assistant event loop
    assistant.start(ctx.room)
    logger.info("Voice assistant started successfully.")
    
    await asyncio.sleep(1)
    await assistant.say("Hello! Thank you for calling our office. My name is Antigravity. How can I help you today?", allow_interruptions=True)

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
