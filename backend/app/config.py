from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv()

class Settings(BaseSettings):
    LIVEKIT_URL: str = "wss://hackathon-lw9jp9ly.livekit.cloud"
    LIVEKIT_API_KEY: str = "APIA86zqbMEwV9j"
    LIVEKIT_API_SECRET: str = "your_livekit_api_secret"
    
    GROQ_API_KEY: str = "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"
    DEEPGRAM_API_KEY: str = "9f7e21f0d415e8d8fa0f6c293cecd3692230c904"
    CARTESIA_API_KEY: str = "sk_car_DkVJ6J6C9PNdZdQ5ag7P9p"
    
    DATABASE_URL: str = "postgresql://neondb_owner:npg_OKbrtv7uXzU9@ep-curly-union-aoxy6cuo.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
    
    TWILIO_ACCOUNT_SID: str | None = None
    TWILIO_AUTH_TOKEN: str | None = None
    TWILIO_FROM_NUMBER: str | None = None
    HUMAN_AGENT_NUMBER: str | None = None

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore"
    }

settings = Settings()
