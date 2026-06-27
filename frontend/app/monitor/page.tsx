"use client";

import React, { useState, useEffect } from "react";
import { Loader2, RefreshCw, Radio, Users, Calendar, ArrowLeft, Eye, EyeOff, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { getApiUrl } from "@/lib/livekit-client";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";

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
    // Poll rooms every 10 seconds
    const interval = setInterval(() => fetchRooms(true), 10000);
    return () => clearInterval(interval);
  }, []);

  const watchRoom = async (roomName: string) => {
    try {
      setErrorMessage("");
      // Fetch a watcher token (isWatcher: true)
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
            <div className="p-6 bg-gradient-to-b from-indigo-950/20 to-slate-950 border border-indigo-500/20 rounded-2xl flex flex-col items-center justify-center text-center relative overflow-hidden">
              <div className="absolute top-0 right-0 p-3">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
              </div>

              <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-400 mb-4 animate-pulse">
                <Radio className="h-6 w-6" />
              </div>

              <h3 className="font-bold text-white mb-1">Watching Room</h3>
              <p className="text-xs text-slate-400 font-mono mb-4">{watchRoomName}</p>
              
              <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl mb-6">
                <p className="text-[10px] text-indigo-300">
                  Connected in Watcher Mode. Your microphone is disabled, but you can hear the ongoing conversation.
                </p>
              </div>

              <button
                onClick={stopWatching}
                className="w-full py-2 bg-red-600 hover:bg-red-500 border border-red-700/30 text-white text-xs font-semibold rounded-xl active:scale-95 transition-all duration-200"
              >
                Disconnect Feed
              </button>

              {/* Render RoomAudioRenderer inside LiveKitRoom context to play audio streams */}
              <LiveKitRoom
                video={false}
                audio={true}
                token={watchToken}
                serverUrl={watchUrl}
                onDisconnected={stopWatching}
                connectOptions={{ autoSubscribe: true }}
              >
                <RoomAudioRenderer />
              </LiveKitRoom>
            </div>
          ) : (
            <div className="p-8 bg-slate-900/20 border border-slate-900 border-dashed rounded-2xl text-center flex flex-col items-center justify-center py-16">
              <EyeOff className="h-8 w-8 text-slate-700 mb-3" />
              <p className="text-xs text-slate-500">
                Select "Watch Live" next to an active channel to listen to the call feed.
              </p>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
