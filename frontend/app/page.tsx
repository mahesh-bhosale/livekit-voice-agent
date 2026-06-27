"use client";

import React, { useState, useEffect } from "react";
import { Mic, MicOff, PhoneOff, Phone, Loader2, Sparkles, Activity, ShieldCheck, HeartPulse } from "lucide-react";
import Link from "next/link";
import { getApiUrl } from "@/lib/livekit-client";
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant } from "@livekit/components-react";

export default function Main() {
  const [token, setToken] = useState<string | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "disconnected" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const startCall = async () => {
    try {
      setStatus("connecting");
      setErrorMessage("");

      // 1. Create a room
      const roomRes = await fetch(getApiUrl("/api/rooms"), {
        method: "POST",
      });
      if (!roomRes.ok) {
        throw new Error("Failed to create room on the backend");
      }
      const roomData = await roomRes.json();
      const generatedRoomName = roomData.roomName;
      setRoomName(generatedRoomName);

      // 2. Fetch LiveKit access token
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
    } catch (err: any) {
      console.error(err);
      setStatus("error");
      setErrorMessage(err.message || "An unexpected error occurred.");
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
      {/* Header */}
      <header className="border-b border-slate-800/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-semibold text-lg tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                Antigravity AI
              </h1>
              <p className="text-[10px] text-slate-400">Voice Assistant Portal</p>
            </div>
          </div>
          <nav className="flex items-center gap-6">
            <Link 
              href="/monitor" 
              className="text-xs font-medium text-slate-400 hover:text-indigo-400 transition-colors py-2 px-3 hover:bg-slate-800/40 rounded-lg"
            >
              Monitor Dashboard
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 max-w-4xl w-full mx-auto px-6 py-12 flex flex-col items-center justify-center">
        {status === "idle" || status === "disconnected" || status === "error" ? (
          /* Landing Screen */
          <div className="w-full max-w-md bg-gradient-to-b from-slate-900/80 to-slate-950/80 border border-slate-800/80 backdrop-blur-xl rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
            {/* Glowing backgrounds */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/15 transition-all duration-700" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/15 transition-all duration-700" />

            <div className="flex flex-col items-center text-center relative z-10">
              <div className="mb-6 p-4 bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-2xl shadow-lg shadow-indigo-500/20 text-white animate-pulse">
                <HeartPulse className="h-10 w-10" />
              </div>
              
              <h2 className="text-2xl font-bold text-white mb-2">AI Medical Receptionist</h2>
              <p className="text-sm text-slate-400 mb-8 max-w-sm">
                Antigravity can help you schedule appointments, answers FAQs, and transcribe your conversation. Connect instantly via voice.
              </p>

              {errorMessage && (
                <div className="w-full mb-6 p-3 bg-red-950/30 border border-red-800/50 text-red-400 text-xs rounded-xl">
                  {errorMessage}
                </div>
              )}

              <button
                onClick={startCall}
                className="w-full py-4 px-6 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 text-white font-semibold rounded-2xl shadow-xl shadow-indigo-500/10 hover:shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-3"
              >
                <Phone className="h-5 w-5" />
                Start Voice Call
              </button>
              
              {status === "disconnected" && (
                <p className="text-xs text-slate-500 mt-4">Call ended successfully</p>
              )}
            </div>
          </div>
        ) : status === "connecting" ? (
          /* Connecting Screen */
          <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 backdrop-blur-xl rounded-3xl p-12 flex flex-col items-center justify-center shadow-2xl relative">
            <Loader2 className="h-12 w-12 text-indigo-400 animate-spin mb-6" />
            <h3 className="text-lg font-semibold text-white mb-2">Connecting to Server</h3>
            <p className="text-xs text-slate-400">Minting credentials and initializing WebRTC...</p>
          </div>
        ) : (
          /* Connected Live Call Screen (LiveKitRoom Wrapper) */
          token && roomUrl && (
            <LiveKitRoom
              video={false}
              audio={true}
              token={token}
              serverUrl={roomUrl}
              onDisconnected={handleDisconnect}
              connectOptions={{ autoSubscribe: true }}
              className="w-full max-w-md"
            >
              <ActiveCallView roomName={roomName} onEndCall={handleDisconnect} />
              <RoomAudioRenderer />
            </LiveKitRoom>
          )
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            &copy; {new Date().getFullYear()} Antigravity Systems. Built for Voice Agent Hackathon.
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-4 w-4 text-indigo-500/60" /> HIPAA Compliant Encryption
            </span>
            <span className="h-1 w-1 bg-slate-700 rounded-full" />
            <span className="flex items-center gap-1">
              <Activity className="h-4 w-4 text-emerald-500/60" /> Low Latency Node
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
}

function ActiveCallView({ roomName, onEndCall }: ActiveCallViewProps) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const [callDuration, setCallDuration] = useState(0);

  // Connection State representation
  const connectionState = localParticipant ? "connected" : "connecting";

  useEffect(() => {
    const interval = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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

  return (
    <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-indigo-500/20 rounded-3xl p-8 shadow-2xl relative overflow-hidden flex flex-col items-center">
      {/* Dynamic pulse wave visualizer */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 pointer-events-none z-0">
        <div className="absolute inset-0 bg-indigo-500/5 rounded-full animate-ping [animation-duration:3s]" />
        <div className="absolute inset-20 bg-purple-500/5 rounded-full animate-ping [animation-duration:2s]" />
      </div>

      <div className="relative z-10 w-full flex flex-col items-center">
        {/* Connection status pills */}
        <div className="flex items-center gap-2 mb-6">
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] uppercase font-bold rounded-full tracking-wider animate-pulse">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
            {connectionState}
          </span>
          {roomName && (
            <span className="px-3 py-1 bg-slate-800 border border-slate-700/60 text-slate-300 text-[10px] font-mono rounded-full">
              {roomName}
            </span>
          )}
        </div>

        {/* Big Avatar / Sound waves */}
        <div className="w-28 h-28 bg-gradient-to-tr from-indigo-500/20 to-purple-600/20 border border-indigo-500/30 rounded-full flex items-center justify-center mb-6 relative">
          <div className="absolute inset-0 rounded-full border border-indigo-500/10 animate-pulse" />
          <div className={`p-5 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full text-white shadow-lg shadow-indigo-500/20 ${isMicrophoneEnabled ? 'scale-100' : 'scale-95 saturate-50'}`}>
            <Sparkles className="h-8 w-8 animate-spin [animation-duration:6s]" />
          </div>
        </div>

        <h3 className="text-xl font-bold text-white mb-1">Antigravity Receptionist</h3>
        <p className="text-xs text-slate-400 mb-8 font-mono tracking-wider">{formatDuration(callDuration)}</p>

        {/* In-Call Controls */}
        <div className="flex items-center justify-center gap-6 w-full max-w-xs">
          {/* Mute Button */}
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

          {/* End Call Button */}
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
