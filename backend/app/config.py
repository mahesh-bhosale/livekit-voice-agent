from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv(override=True)

class Settings(BaseSettings):
    LIVEKIT_URL: str = "wss://your-project.livekit.cloud"
    LIVEKIT_API_KEY: str = "your_livekit_api_key"
    LIVEKIT_API_SECRET: str = "your_livekit_api_secret"

    GROQ_API_KEY: str = ""
    DEEPGRAM_API_KEY: str = ""
    CARTESIA_API_KEY: str = ""
    TTS_API_KEY: str = ""

    DATABASE_URL: str = "sqlite:///./voice_agent.db"

    TWILIO_ACCOUNT_SID: str | None = None
    TWILIO_AUTH_TOKEN: str | None = None
    TWILIO_FROM_NUMBER: str | None = None
    HUMAN_AGENT_NUMBER: str | None = None

    # Public URL for Twilio webhooks (use ngrok in local dev)
    PUBLIC_API_URL: str = "http://localhost:8000"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore"
    }

settings = Settings()
