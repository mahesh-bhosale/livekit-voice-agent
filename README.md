# ClinicConnect Voice

A conversational voice agent with **appointment booking**, **live call monitoring**, **human take-over**, and **Twilio warm transfer**. Built for the LiveKit Voice Agent Hackathon.

## Overview

ClinicConnect Voice connects callers to **Agent Alex**, a virtual receptionist for Sunrise Clinic. Alex handles natural voice conversations over LiveKit, books appointments via LLM tool calls, and escalates to a human when needed.

Supervisors open the **Live Monitor** dashboard (`/monitor`) to watch calls in real time — live transcript, agent state, detected intent, and current action — and can **take over** the conversation at any time.

When a caller asks for a person (billing, complaints, frustration), Alex initiates a **warm transfer**: Twilio dials a human agent's phone, speaks a call summary, and collects accept (1) or decline (2) via DTMF.

When the call ends, a **post-call summary** is generated with Groq and shown to watchers (and callers on disconnect).

## Architecture

```
┌─────────────┐     WebRTC audio      ┌──────────────────────────────────┐
│   Caller    │◄────────────────────►│  LiveKit Room (real-time transport)│
│  (Next.js)  │                       │  • caller participant              │
└─────────────┘                       │  • agent worker (Python)           │
                                      │  • watcher (monitor dashboard)     │
┌─────────────┐     WebRTC + data     └──────────────┬───────────────────┘
│   Watcher   │◄────────────────────────────────────┘
│  /monitor   │         data channel events:
└─────────────┘         transcript, agent_state, intent, action, call_status, summary

┌─────────────────────────────────────────────────────────────────────────┐
│  Agent Worker (Python) — STT → LLM → TTS pipeline                       │
│  Deepgram (STT) → Groq Llama 3.3 (LLM + tools) → Cartesia (TTS)         │
│  Tools: check_availability, book_appointment, request_human_transfer    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────┐   REST API    ┌──────────────────┐   Twilio REST   ┌────────────┐
│  Next.js    │──────────────►│  FastAPI backend │───────────────►│ Human phone │
│  frontend   │  rooms/token  │  + webhooks      │  warm transfer │ (DTMF 1/2)  │
└─────────────┘               └──────────────────┘                 └────────────┘
                                      │
                                      ▼
                               SQLite / PostgreSQL
                               (appointments, call summaries)
```

| Layer | Technology |
|-------|------------|
| Real-time transport | [LiveKit](https://livekit.io) rooms & WebRTC |
| Agent worker | Python [LiveKit Agents SDK](https://docs.livekit.io/agents/) |
| STT | Deepgram Nova-2 |
| LLM | Groq (`llama-3.3-70b-versatile`) |
| TTS | Cartesia Sonic English |
| Backend API | FastAPI (rooms, tokens, Twilio webhooks) |
| Frontend | Next.js 16 (caller UI + monitor dashboard) |
| Warm transfer | Twilio outbound call + TwiML gather |
| Storage | SQLAlchemy (SQLite locally, PostgreSQL in production) |

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-org/livekit-voice-agent.git
cd livekit-voice-agent
```

### 2. Backend

```bash
cd backend
python -m venv venv

# Windows (PowerShell)
.\venv\Scripts\Activate.ps1

# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env`:

| Variable | Description |
|----------|-------------|
| `LIVEKIT_URL` | WebSocket URL from [LiveKit Cloud](https://cloud.livekit.io) dashboard |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `GROQ_API_KEY` | [Groq](https://console.groq.com) API key |
| `DEEPGRAM_API_KEY` | [Deepgram](https://console.deepgram.com) API key |
| `CARTESIA_API_KEY` or `TTS_API_KEY` | [Cartesia](https://cartesia.ai) TTS key |
| `DATABASE_URL` | `sqlite:///./voice_agent.db` for local dev |
| `TWILIO_ACCOUNT_SID` | Twilio account SID (warm transfer) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | Twilio trial/outbound number (E.164, e.g. `+15551234567`) |
| `HUMAN_AGENT_NUMBER` | Phone number of the human agent to dial (must be verified on Twilio trial) |
| `PUBLIC_API_URL` | Public URL for Twilio webhooks — use [ngrok](https://ngrok.com) in local dev (e.g. `https://abc123.ngrok.io`) |

### 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
```

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Running

Use **three terminals**. The agent worker must be running for calls to be answered.

**Terminal 1 — Backend API**

```bash
cd backend
source venv/bin/activate   # or .\venv\Scripts\Activate.ps1 on Windows
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — Agent worker**

```bash
cd backend
source venv/bin/activate
python -m app.agent.worker dev
```

**Terminal 3 — Frontend**

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the caller portal and [http://localhost:3000/monitor](http://localhost:3000/monitor) for live supervision.

For warm transfer in local dev, expose the backend with ngrok and set `PUBLIC_API_URL` to the ngrok HTTPS URL:

```bash
ngrok http 8000
```

## Flows

### Booking flow

1. Caller clicks **Start Voice Call** on the home page.
2. A LiveKit room is created and Agent Alex greets the caller.
3. Alex collects **name**, **reason for visit**, **preferred date/time**, and **phone number** conversationally.
4. Alex calls `check_availability` — checks hardcoded demo slots plus appointments already stored in the database.
5. If available, Alex confirms with the caller and calls `book_appointment`, which persists to SQLite/Postgres.
6. Alex reads back the booking details. The monitor dashboard shows live **Booking Details** in the sidebar.

### Monitoring flow

1. Open `/monitor` while a call is active (or start a call from `/` first).
2. Active rooms appear in the list (polled every 3 seconds).
3. Click **Watch Live** to join as a watcher.
4. The dashboard updates in real time via LiveKit data channel:
   - **Transcript** — caller and agent turns
   - **Agent State** — listening / thinking / speaking
   - **Detected Intent** — e.g. `booking`, `transfer_request`
   - **Current Action** — e.g. checking availability, booking, transferring
   - **Call Status** — connected → transferring → ended

### Take-over flow

1. While watching a live call, click **Take Over Call** (header or sidebar).
2. The frontend publishes `{ type: "takeover_request" }` on the data channel.
3. The agent worker pauses AI processing, interrupts speech, and broadcasts `call_status: takeover`.
4. The watcher's microphone is enabled; they speak directly to the caller.
5. Click **End** to leave the room and end the take-over session.

### Warm transfer flow

1. Caller asks for a human (billing, complaint, "talk to a person").
2. Alex calls `request_human_transfer` with a reason.
3. Monitor shows status **Transferring** and action **Transferring**.
4. Twilio dials `HUMAN_AGENT_NUMBER` and speaks a summary of the call.
5. Human agent presses **1** to accept or **2** to decline.
6. **Accept** — Alex tells the caller a specialist is connecting; monitor shows **Human Connected**.
7. **Decline** — Alex apologizes and offers alternatives; monitor shows the decline banner.
8. If Twilio is not configured, the transfer gracefully falls back to "unavailable."

### Post-call summary

When the caller disconnects, the worker:

1. Generates a 2–3 sentence summary via Groq.
2. Saves it to the `call_summaries` table with the full transcript.
3. Broadcasts `{ type: "summary", text: "..." }` on the data channel.

Watchers see a **Post-Call Summary** modal. Callers see the summary on the landing screen after hang-up.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `POST` | `/api/rooms` | Create a LiveKit room |
| `GET` | `/api/rooms` | List active rooms |
| `POST` | `/api/token` | Mint LiveKit JWT for caller or watcher |
| `GET` | `/api/transfer/twiml` | Twilio TwiML — summary + DTMF gather |
| `POST` | `/api/transfer/gather` | Twilio DTMF accept/decline handler |

Swagger docs: [http://localhost:8000/docs](http://localhost:8000/docs)

## Project structure

```
livekit-voice-agent/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── config.py            # Settings / env vars
│   │   ├── db.py                # SQLAlchemy engine
│   │   ├── models.py            # Appointment, CallSummary
│   │   ├── routes/
│   │   │   ├── rooms.py         # Room CRUD
│   │   │   ├── token.py         # JWT minting
│   │   │   └── transfer.py      # Twilio webhooks
│   │   ├── services/
│   │   │   └── transfer.py      # Warm transfer coordination
│   │   └── agent/
│   │       ├── worker.py        # LiveKit agent (main entry)
│   │       └── availability.py  # Slot availability check
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── page.tsx             # Caller portal
│   │   ├── monitor/page.tsx     # Live monitor dashboard
│   │   └── layout.tsx
│   ├── lib/
│   │   ├── useMonitor.ts        # Monitor state + data channel
│   │   ├── livekit-client.ts    # API URL helpers
│   │   └── branding.ts          # App name constants
│   └── .env.local.example
└── README.md
```

## Known limitations

This is a **hackathon prototype**, not production-ready software:

- **Single LiveKit project** — all calls share one cloud project.
- **SQLite for local storage** — fine for demos; use PostgreSQL for production (`DATABASE_URL`).
- **Hardcoded availability slots** — demo dates in `availability.py` plus DB-backed booked slots; not a real scheduler.
- **Twilio trial constraints** — trial accounts can only call **verified** phone numbers; outbound caller ID must be a Twilio number.
- **Warm transfer bridging** — accept/decline is fully implemented via Twilio DTMF; full PSTN↔WebRTC audio bridge requires LiveKit SIP (documented as future work).
- **No authentication** — anyone with the URL can start or monitor calls.
- **Take-over is one-way** — no "hand back to AI" button; ending take-over leaves the room.

## Demo video

[Demo video link placeholder]

Suggested demo script:

1. Book an appointment with Agent Alex (name, reason, date, time, phone).
2. Open `/monitor` and show live transcript, state, intent, and action updating.
3. Take over the call from the monitor and speak to the caller.
4. Start a new call, ask for a human, show warm transfer (summary spoken to phone, accept and decline outcomes).
5. End the call and show the post-call summary.

## License

MIT (or your chosen license)
