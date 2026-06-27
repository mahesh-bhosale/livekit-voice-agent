"use client";

import React, { useState, useEffect, useRef } from "react";
import { Loader2, RefreshCw, Radio, Users, Calendar, ArrowLeft, Eye, EyeOff, ShieldAlert, Sparkles, Brain, CheckCircle, HelpCircle, PhoneCall } from "lucide-react";
import Link from "next/link";
import { getApiUrl } from "@/lib/livekit-client";
import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";

interface RoomInfo {
  name: string;
  sid: string;
  numParticipants: number;
  maxParticipants: number;
  creationTime: number;
}

export default function MonitorPage() {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [watchToken, setWatchToken] = useState<string | null>(null);
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [watchRoomName, setWatchRoomName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchRooms = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setErrorMessage("");

    try {
      const res = await fetch(getApiUrl("/api/rooms"));
      if (!res.ok) {
        throw new Error("Failed to fetch rooms from backend");
      }
      const data = await res.json();
      setRooms(data.rooms || []);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Could not retrieve active rooms.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(() => fetchRooms(true), 8000);
    return () => clearInterval(interval);
  }, []);

  const watchRoom = async (roomName: string) => {
    try {
      setErrorMessage("");
      const res = await fetch(getApiUrl("/api/token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName,
          participantName: `watcher-${Math.floor(Math.random() * 1000)}`,
          isWatcher: true,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to mint watcher token");
      }

      const data = await res.json();
      setWatchToken(data.token);
      setWatchUrl(data.url);
      setWatchRoomName(roomName);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Could not watch room.");
    }
  };

  const stopWatching = () => {
    setWatchToken(null);
    setWatchUrl(null);
    setWatchRoomName(null);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="font-semibold text-lg text-white">Live Monitoring</h1>
              <p className="text-[10px] text-slate-400">Real-time Call Dashboard</p>
            </div>
          </div>
          <button
            onClick={() => fetchRooms()}
            disabled={loading || refreshing}
            className="p-2 bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-all duration-200 disabled:opacity-50 flex items-center gap-2 text-xs"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Active Calls List (2 Columns on large screen) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="flex items-center justify-between border-b border-slate-900 pb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Radio className="h-4 w-4 text-indigo-400 animate-pulse" />
              Active Channels ({rooms.length})
            </h2>
          </div>

          {errorMessage && (
            <div className="p-4 bg-red-950/20 border border-red-900/60 rounded-2xl text-red-400 text-xs flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 bg-slate-900/20 rounded-2xl border border-slate-900 border-dashed">
              <Loader2 className="h-8 w-8 text-indigo-500 animate-spin mb-4" />
              <p className="text-xs text-slate-500">Querying active channels...</p>
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 bg-slate-900/20 rounded-2xl border border-slate-900 border-dashed text-center px-4">
              <Users className="h-10 w-10 text-slate-600 mb-4" />
              <h3 className="font-semibold text-slate-300 mb-1">No Active Calls</h3>
              <p className="text-xs text-slate-500 max-w-xs">
                There are no callers connected at the moment. Use the landing page to start a new voice session.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rooms.map((room) => {
                const isCurrentWatcherRoom = watchRoomName === room.name;
                return (
                  <div
                    key={room.name}
                    className="p-5 bg-slate-900/60 border border-slate-900 rounded-2xl hover:border-slate-800 hover:bg-slate-900 transition-all duration-300 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="px-2.5 py-0.5 bg-indigo-500/10 text-indigo-400 text-[10px] font-mono rounded-md">
                          {room.name}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                          <Users className="h-3 w-3" />
                          {room.numParticipants} / {room.maxParticipants}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 font-mono mb-6">
                        SID: {room.sid}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-4 border-t border-slate-800/40 pt-4">
                      <span className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(room.creationTime * 1000).toLocaleTimeString()}
                      </span>
                      
                      {isCurrentWatcherRoom ? (
                        <button
                          onClick={stopWatching}
                          className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-[10px] font-semibold rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => watchRoom(room.name)}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/60 text-[10px] font-semibold rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Watch Live
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Watcher Stream Panel (1 Column on large screen) */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-900 pb-3">
            Live Stream Feed
          </h2>

          {watchToken && watchUrl && watchRoomName ? (
            <LiveKitRoom
              video={false}
              audio={true}
              token={watchToken}
              serverUrl={watchUrl}
              onDisconnected={stopWatching}
              connectOptions={{ autoSubscribe: true }}
            >
              <LiveFeedMonitor roomName={watchRoomName} onDisconnect={stopWatching} />
              <RoomAudioRenderer />
            </LiveKitRoom>
          ) : (
            <div className="p-8 bg-slate-900/20 border border-slate-900 border-dashed rounded-2xl text-center flex flex-col items-center justify-center py-16">
              <EyeOff className="h-8 w-8 text-slate-700 mb-3" />
              <p className="text-xs text-slate-500">
                Select "Watch Live" next to an active channel to listen to the call feed and view real-time logs.
              </p>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}

// Subcomponent that consumes the LiveKit room context to decode data channel messages
function LiveFeedMonitor({ roomName, onDisconnect }: { roomName: string; onDisconnect: () => void }) {
  const room = useRoomContext();
  const [agentState, setAgentState] = useState<string>("idle");
  const [transcript, setTranscript] = useState<{ speaker: string; text: string; timestamp: string }[]>([]);
  const [intent, setIntent] = useState<string>("general");
  const [action, setAction] = useState<string>("idle");
  const [summary, setSummary] = useState<string>("");

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll chat window to bottom on new message
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  useEffect(() => {
    const handleDataReceived = (payload: Uint8Array) => {
      const decoder = new TextDecoder();
      try {
        const text = decoder.decode(payload);
        const data = JSON.parse(text);
        
        logger.info("Watcher received data packet:", data);
        
        if (data.type === "agent_state") {
          setAgentState(data.state);
        } else if (data.type === "transcript") {
          setTranscript((prev) => {
            // Avoid exact duplicate checks (final updates vs chunk updates)
            if (prev.length > 0) {
              const last = prev[prev.length - 1];
              if (last.speaker === data.speaker && last.text === data.text) {
                return prev;
              }
            }
            return [...prev, {
              speaker: data.speaker,
              text: data.text,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            }];
          });
        } else if (data.type === "intent") {
          setIntent(data.intent);
        } else if (data.type === "action") {
          setAction(data.action);
        } else if (data.type === "summary") {
          setSummary(data.text);
        }
      } catch (err) {
        console.error("Failed to parse data package from room:", err);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room]);

  // CSS mappings for agent state glows
  const stateColor = 
    agentState === "speaking" ? "bg-emerald-500 shadow-emerald-500/30" : 
    agentState === "thinking" ? "bg-amber-500 shadow-amber-500/30" : 
    agentState === "listening" ? "bg-indigo-500 shadow-indigo-500/30" : 
    "bg-slate-500 shadow-slate-500/30";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col shadow-xl overflow-hidden max-h-[700px]">
      
      {/* Watcher Status Panel */}
      <div className="p-4 bg-slate-900 border-b border-slate-800/80 flex items-center justify-between">
        <div>
          <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Watcher Mode Active</span>
          <h4 className="text-sm font-semibold text-white font-mono">{roomName}</h4>
        </div>
        <button 
          onClick={onDisconnect}
          className="text-xs py-1 px-3 bg-red-950/20 border border-red-900/40 text-red-400 hover:bg-red-950/40 rounded-lg transition-all"
        >
          Disconnect
        </button>
      </div>

      {/* Real-time State Monitors */}
      <div className="p-4 bg-slate-950/40 grid grid-cols-3 gap-2 border-b border-slate-800/60 text-center">
        <div className="p-2 bg-slate-900/60 border border-slate-800/50 rounded-xl flex flex-col items-center">
          <span className="text-[9px] text-slate-500 uppercase font-semibold">Agent State</span>
          <span className="flex items-center gap-1.5 mt-1">
            <span className={`w-2 h-2 rounded-full ${stateColor} animate-pulse shadow-md`} />
            <span className="text-xs font-semibold text-slate-200 capitalize">{agentState}</span>
          </span>
        </div>

        <div className="p-2 bg-slate-900/60 border border-slate-800/50 rounded-xl flex flex-col items-center">
          <span className="text-[9px] text-slate-500 uppercase font-semibold">Intent</span>
          <span className="flex items-center gap-1.5 mt-1 text-xs font-semibold text-slate-200 capitalize">
            {intent === "booking" ? <CheckCircle className="h-3.5 w-3.5 text-indigo-400" /> :
             intent === "transfer_request" ? <PhoneCall className="h-3.5 w-3.5 text-red-400 animate-bounce" /> :
             <HelpCircle className="h-3.5 w-3.5 text-slate-400" />}
            {intent.replace("_", " ")}
          </span>
        </div>

        <div className="p-2 bg-slate-900/60 border border-slate-800/50 rounded-xl flex flex-col items-center">
          <span className="text-[9px] text-slate-500 uppercase font-semibold">Action</span>
          <span className="text-[10px] font-semibold text-slate-300 mt-1 capitalize truncate max-w-[80px]">
            {action.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* Live Transcript Log */}
      <div className="flex-1 p-4 overflow-y-auto max-h-[300px] min-h-[220px] bg-slate-950/20 flex flex-col gap-3" ref={scrollRef}>
        {transcript.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
            <Loader2 className="h-5 w-5 text-indigo-500 animate-spin mb-2" />
            <p className="text-[10px] text-slate-500">Waiting for first utterance...</p>
          </div>
        ) : (
          transcript.map((msg, index) => {
            const isAgent = msg.speaker === "agent";
            return (
              <div 
                key={index} 
                className={`flex flex-col max-w-[85%] ${isAgent ? "self-start items-start" : "self-end items-end"}`}
              >
                <span className="text-[8px] text-slate-500 mb-0.5 px-1">
                  {isAgent ? "Agent" : "Caller"} &bull; {msg.timestamp}
                </span>
                <div 
                  className={`p-3 rounded-2xl text-xs leading-relaxed ${
                    isAgent 
                      ? "bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700/30" 
                      : "bg-indigo-600 text-white rounded-tr-none"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Final Summary Card (if generated) */}
      {summary && (
        <div className="p-4 bg-gradient-to-tr from-amber-500/10 to-indigo-500/10 border-t border-slate-800">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <h5 className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">AI Call Summary</h5>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed italic bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            {summary}
          </p>
        </div>
      )}
    </div>
  );
}

// Client logging helper
const logger = {
  info: (...args: any[]) => console.log("[LiveFeedMonitor] INFO:", ...args),
  error: (...args: any[]) => console.error("[LiveFeedMonitor] ERROR:", ...args)
};
