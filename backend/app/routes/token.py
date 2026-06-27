import json
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from livekit import api
from app.config import settings

router = APIRouter()

class TokenRequest(BaseModel):
    roomName: str = Field(..., description="The name of the room to join")
    participantName: str = Field(..., description="The display name / identity of the participant")
    isWatcher: bool = Field(default=False, description="Whether the user is a watcher (no publish stream)")

    model_config = {
        "populate_by_name": True,
        "json_schema_extra": {
            "example": {
                "roomName": "call-12345",
                "participantName": "caller",
                "isWatcher": False
            }
        }
    }

@router.post("/token")
async def mint_token(payload: TokenRequest):
    if not settings.LIVEKIT_API_KEY or settings.LIVEKIT_API_KEY == "your_livekit_api_key":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LIVEKIT_API_KEY is not configured."
        )
    if not settings.LIVEKIT_API_SECRET or settings.LIVEKIT_API_SECRET == "your_livekit_api_secret":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LIVEKIT_API_SECRET is not configured. Please add the secret key."
        )

    try:
        # Create token
        token = (
            api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
            .with_identity(payload.participantName)
            .with_name(payload.participantName)
        )

        # Build VideoGrants
        grants = api.VideoGrants(
            room_join=True,
            room=payload.roomName,
            can_publish=True,
            can_subscribe=True,
        )
        
        token = token.with_grants(grants)

        # Set Metadata if watcher
        if payload.isWatcher:
            token = token.with_metadata(json.dumps({"role": "watcher"}))

        jwt = token.to_jwt()

        return {
            "token": jwt,
            "url": settings.LIVEKIT_URL
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Token generation failed: {str(e)}"
        )
