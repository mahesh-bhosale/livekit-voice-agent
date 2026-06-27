import random
import string
from fastapi import APIRouter, HTTPException, status
from livekit import api
from app.config import settings

router = APIRouter()

def generate_random_room_name() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
    return f"call-{suffix}"

def get_livekit_api():
    # Convert WebSocket URL (wss://) to HTTPS url (https://) for REST/gRPC client
    url = settings.LIVEKIT_URL
    if url.startswith("wss://"):
        url = url.replace("wss://", "https://")
    elif url.startswith("ws://"):
        url = url.replace("ws://", "http://")
        
    return api.LiveKitAPI(
        url=url,
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET
    )

@router.post("/rooms")
async def create_room():
    if not settings.LIVEKIT_API_KEY or settings.LIVEKIT_API_KEY == "your_livekit_api_key":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LIVEKIT_API_KEY is not configured."
        )
    if not settings.LIVEKIT_API_SECRET or settings.LIVEKIT_API_SECRET == "your_livekit_api_secret":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LIVEKIT_API_SECRET is not configured."
        )

    room_name = generate_random_room_name()
    try:
        async with get_livekit_api() as lkapi:
            room_info = await lkapi.room.create_room(
                api.CreateRoomRequest(
                    name=room_name,
                    empty_timeout=300,  # Auto close after 5 minutes if empty
                    max_participants=10
                )
            )
            return {"roomName": room_info.name}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create LiveKit room: {str(e)}"
        )

@router.get("/rooms")
async def list_rooms():
    if not settings.LIVEKIT_API_KEY or settings.LIVEKIT_API_KEY == "your_livekit_api_key":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LIVEKIT_API_KEY is not configured."
        )
    if not settings.LIVEKIT_API_SECRET or settings.LIVEKIT_API_SECRET == "your_livekit_api_secret":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LIVEKIT_API_SECRET is not configured."
        )

    try:
        async with get_livekit_api() as lkapi:
            results = await lkapi.room.list_rooms(api.ListRoomsRequest())
            rooms_list = []
            for room in results.rooms:
                rooms_list.append({
                    "name": room.name,
                    "sid": room.sid,
                    "numParticipants": room.num_participants,
                    "maxParticipants": room.max_participants,
                    "creationTime": room.creation_time
                })
            return {"rooms": rooms_list}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list LiveKit rooms: {str(e)}"
        )
