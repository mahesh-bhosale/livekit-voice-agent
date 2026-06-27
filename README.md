# LiveKit Voice Agent Hackathon Project Monorepo

This repository contains a monorepo containing:
- **`backend/`**: Python FastAPI server providing token generation and room management REST APIs, plus a LiveKit Voice Agent pipeline worker.
- **`frontend/`**: Next.js 14 Web Application supporting call joining, WebRTC audio streaming, mute controls, and call states.

## Directory Structure

```text
voice-agent/
  backend/            # Python FastAPI backend
    app/
      main.py         # Entry point & CORS setup
      config.py       # Pydantic Settings
      db.py           # SQLAlchemy SQLite setup
      models.py       # DB models (Appointments & CallSummaries)
      routes/         # Token and Room router endpoints
      agent/          # LiveKit Agent Worker setup
    requirements.txt
    .env
  frontend/           # Next.js 14 App Router UI client
    app/              # App Router pages
    lib/              # LiveKit Client configuration
    package.json
    .env.local
  README.md
  .gitignore
```

## Setup Instructions

### 1. Backend Setup

1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Create and activate a Python virtual environment:
   ```bash
   python -m venv venv
   # On Windows (PowerShell):
   .\venv\Scripts\Activate.ps1
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure `.env`:
   - Copy `.env.example` to `.env`.
   - Update `LIVEKIT_API_SECRET` with your LiveKit project secret from the LiveKit Console.
5. Start the FastAPI server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
6. Run the LiveKit Voice Agent worker:
   ```bash
   python app/agent/agent.py dev
   ```

### 2. Frontend Setup

1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Configure `.env.local`:
   - Copy `.env.local.example` to `.env.local`.
   - Modify URLs if necessary (defaults point to local FastAPI and LiveKit cloud).
4. Run the Next.js development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` to view the application.

## API Documentation

FastAPI automatically serves Swagger documentation at `http://localhost:8000/docs`.

### Key Endpoints:
- `POST /api/rooms` - Create a LiveKit room.
- `GET /api/rooms` - List active rooms.
- `POST /api/token` - Mint AccessTokens for participants.
