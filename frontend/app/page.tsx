"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Phone,
  Loader2,
  Sparkles,
  Activity,
  ShieldCheck,
  HeartPulse,
  Headphones,
} from "lucide-react";
import Link from "next/link";
import { getApiUrl } from "@/lib/livekit-client";
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { APP_NAME, APP_TAGLINE, AGENT_NAME, CLINIC_NAME } from "@/lib/branding";

export default function Main() {
  const [token, setToken] = useState<string | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "disconnected" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [callSummary, setCallSummary] = useState<string | null>(null);

  const startCall = async () => {
    try {
      setStatus("connecting");
      setErrorMessage("");
      setCallSummary(null);

      const roomRes = await fetch(getApiUrl("/api/rooms"), { method: "POST" });
      if (!roomRes.ok) throw new Error("Failed to create room on the backend");

      const roomData = await roomRes.json();
      const generatedRoomName = roomData.roomName;
      setRoomName(generatedRoomName);

      const tokenRes = await fetch(getApiUrl("/api/token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: generatedRoomName,
          participantName: "caller",
          isWatcher: false,
        }),
      });
      if (!tokenRes.ok) {
        const errorData = await tokenRes.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to mint token from backend");
      }

      const tokenData = await tokenRes.json();
      setToken(tokenData.token);
      setRoomUrl(tokenData.url);
      setStatus("connected");
    } catch (err: unknown) {
      console.error(err);
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  };

  const handleDisconnect = () => {
    setToken(null);
    setRoomUrl(null);
    setRoomName(null);
    setStatus("disconnected");
  };

  return (
    <main className="min-h-screen bg-radial from-slate-900 via-slate-950 to-black text-slate-100 flex flex-col justify-between font-sans">
      <header className="border-b border-slate-800/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500/10 border border-teal-500/20 rounded-xl text-teal-400">
              <HeartPulse className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-semibold text-lg tracking-tight bg-gradient-to-r from-teal-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                {APP_NAME}
              </h1>
              <p className="text-[10px] text-slate-400">{APP_TAGLINE}</p>
            </div>
          </div>
          <nav className="flex items-center gap-6">
            <Link
              href="/monitor"
              className="text-xs font-medium text-slate-400 hover:text-teal-400 transition-colors py-2 px-3 hover:bg-slate-800/40 rounded-lg flex items-center gap-1.5"
            >
              <Headphones className="h-3.5 w-3.5" />
              Live Monitor
            </Link>
          </nav>
        </div>
      </header>

      <div className="flex-1 max-w-4xl w-full mx-auto px-6 py-12 flex flex-col items-center justify-center">
        {status === "idle" || status === "disconnected" || status === "error" ? (
          <div className="w-full max-w-md bg-gradient-to-b from-slate-900/80 to-slate-950/80 border border-slate-800/80 backdrop-blur-xl rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl group-hover:bg-teal-500/15 transition-all duration-700" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl group-hover:bg-cyan-500/15 transition-all duration-700" />

            <div className="flex flex-col items-center text-center relative z-10">
              <div className="mb-6 p-4 bg-gradient-to-tr from-teal-500 to-cyan-600 rounded-2xl shadow-lg shadow-teal-500/20 text-white">
                <HeartPulse className="h-10 w-10" />
              </div>

              <h2 className="text-2xl font-bold text-white mb-2">{CLINIC_NAME} Reception</h2>
              <p className="text-sm text-slate-400 mb-8 max-w-sm">
                Speak with {AGENT_NAME}, our AI receptionist. Book appointments, ask questions, or request a human
                agent — all over a secure voice connection.
              </p>

              {errorMessage && (
                <div className="w-full mb-6 p-3 bg-red-950/30 border border-red-800/50 text-red-400 text-xs rounded-xl">
                  {errorMessage}
                </div>
              )}

              {callSummary && status === "disconnected" && (
                <div className="w-full mb-6 p-4 bg-slate-950/60 border border-slate-800 rounded-xl text-left">
                  <p className="text-[10px] uppercase tracking-wider text-teal-400 font-semibold mb-2">
                    Call Summary
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed">{callSummary}</p>
                </div>
              )}

              <button
                onClick={startCall}
                className="w-full py-4 px-6 bg-gradient-to-r from-teal-500 via-cyan-500 to-emerald-500 hover:from-teal-600 hover:via-cyan-600 hover:to-emerald-600 text-white font-semibold rounded-2xl shadow-xl shadow-teal-500/10 hover:shadow-teal-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-3"
              >
                <Phone className="h-5 w-5" />
                Start Voice Call
              </button>

              {status === "disconnected" && !callSummary && (
                <p className="text-xs text-slate-500 mt-4">Call ended</p>
              )}
            </div>
          </div>
        ) : status === "connecting" ? (
          <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 backdrop-blur-xl rounded-3xl p-12 flex flex-col items-center justify-center shadow-2xl">
            <Loader2 className="h-12 w-12 text-teal-400 animate-spin mb-6" />
            <h3 className="text-lg font-semibold text-white mb-2">Connecting to {CLINIC_NAME}</h3>
            <p className="text-xs text-slate-400">Setting up secure voice channel…</p>
          </div>
        ) : (
          token &&
          roomUrl && (
            <LiveKitRoom
              video={false}
              audio={true}
              token={token}
              serverUrl={roomUrl}
              onDisconnected={handleDisconnect}
              connectOptions={{ autoSubscribe: true }}
              className="w-full max-w-md"
            >
              <ActiveCallView
                roomName={roomName}
                onEndCall={handleDisconnect}
                onSummary={setCallSummary}
              />
              <RoomAudioRenderer />
            </LiveKitRoom>
          )
        )}
      </div>

      <footer className="border-t border-slate-900 py-6">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            &copy; {new Date().getFullYear()} {APP_NAME}. Voice Agent Hackathon prototype.
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-4 w-4 text-teal-500/60" /> Encrypted WebRTC
            </span>
            <span className="h-1 w-1 bg-slate-700 rounded-full" />
            <span className="flex items-center gap-1">
              <Activity className="h-4 w-4 text-emerald-500/60" /> Real-time STT / LLM / TTS
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}

interface ActiveCallViewProps {
  roomName: string | null;
  onEndCall: () => void;
  onSummary: (summary: string) => void;
}

function ActiveCallView({ roomName, onEndCall, onSummary }: ActiveCallViewProps) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const room = useRoomContext();
  const [callDuration, setCallDuration] = useState(0);
  const [callStatus, setCallStatus] = useState("connected");

  const connectionState = localParticipant ? "connected" : "connecting";

  useEffect(() => {
    const interval = setInterval(() => setCallDuration((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleDataMessage = useCallback(
    (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === "summary") onSummary(data.text);
        if (data.type === "call_status") setCallStatus(data.status);
      } catch {
        // ignore
      }
    },
    [onSummary],
  );

  useEffect(() => {
    room.on(RoomEvent.DataReceived, handleDataMessage);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataMessage);
    };
  }, [room, handleDataMessage]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const toggleMute = () => {
    if (localParticipant) {
      localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    }
  };

  const statusLabel =
    callStatus === "transferring"
      ? "Transferring to human…"
      : callStatus === "takeover"
        ? "Human agent joined"
        : callStatus === "transfer_connected"
          ? "Connected to specialist"
          : connectionState;

  return (
    <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-teal-500/20 rounded-3xl p-8 shadow-2xl relative overflow-hidden flex flex-col items-center">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 pointer-events-none z-0">
        <div className="absolute inset-0 bg-teal-500/5 rounded-full animate-ping [animation-duration:3s]" />
        <div className="absolute inset-20 bg-cyan-500/5 rounded-full animate-ping [animation-duration:2s]" />
      </div>

      <div className="relative z-10 w-full flex flex-col items-center">
        <div className="flex items-center gap-2 mb-6 flex-wrap justify-center">
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] uppercase font-bold rounded-full tracking-wider">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            {statusLabel}
          </span>
          {roomName && (
            <span className="px-3 py-1 bg-slate-800 border border-slate-700/60 text-slate-300 text-[10px] font-mono rounded-full">
              {roomName}
            </span>
          )}
        </div>

        <div className="w-28 h-28 bg-gradient-to-tr from-teal-500/20 to-cyan-600/20 border border-teal-500/30 rounded-full flex items-center justify-center mb-6 relative">
          <div className="absolute inset-0 rounded-full border border-teal-500/10 animate-pulse" />
          <div
            className={`p-5 bg-gradient-to-tr from-teal-500 to-cyan-500 rounded-full text-white shadow-lg shadow-teal-500/20 ${
              isMicrophoneEnabled ? "scale-100" : "scale-95 saturate-50"
            }`}
          >
            <Sparkles className="h-8 w-8 animate-spin [animation-duration:6s]" />
          </div>
        </div>

        <h3 className="text-xl font-bold text-white mb-1">{AGENT_NAME} · Virtual Receptionist</h3>
        <p className="text-xs text-slate-400 mb-8 font-mono tracking-wider">{formatDuration(callDuration)}</p>

        <div className="flex items-center justify-center gap-6 w-full max-w-xs">
          <button
            onClick={toggleMute}
            className={`p-4 rounded-full border flex items-center justify-center transition-all duration-200 active:scale-95 ${
              isMicrophoneEnabled
                ? "bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-700"
                : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
            }`}
            title={isMicrophoneEnabled ? "Mute Microphone" : "Unmute Microphone"}
          >
            {isMicrophoneEnabled ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
          </button>

          <button
            onClick={onEndCall}
            className="p-4 bg-red-600 hover:bg-red-500 text-white rounded-full border border-red-700/30 flex items-center justify-center shadow-lg shadow-red-600/10 hover:shadow-red-600/20 transition-all duration-200 active:scale-95"
            title="End Call"
          >
            <PhoneOff className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
