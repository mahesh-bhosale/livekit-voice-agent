from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db import engine, Base
from app.routes import token, rooms, transfer, summaries

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and create tables on startup
    Base.metadata.create_all(bind=engine)
    yield

app = FastAPI(
    title="Voice Agent Hackathon API Backend",
    description="Backend services for rooms management, access tokens, and voice agents.",
    version="1.0.0",
    lifespan=lifespan
)

# Allow requests from the Next.js frontend development server
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add routes
app.include_router(token.router, prefix="/api")
app.include_router(rooms.router, prefix="/api")
app.include_router(transfer.router, prefix="/api")
app.include_router(summaries.router, prefix="/api")

@app.get("/")
def read_root():
    return {
        "status": "healthy",
        "service": "voice-agent-backend",
        "docs_url": "/docs"
    }
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
