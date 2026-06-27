"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Eye,
  Loader2,
  Radio,
  Users,
  ArrowLeft,
  Headphones,
  Brain,
  AudioLines,
  Ear,
  Target,
  Zap,
  ShieldCheck,
  X,
  RefreshCw,
  Sparkles,
  UserRoundPlus,
  CalendarCheck,
  PhoneForwarded,
  Play,
} from "lucide-react";
import Link from "next/link";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
  useLocalParticipant,
} from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import {
  useMonitor,
  type AgentState,
  type CallStatus,
  type TranscriptEntry,
  type RoomInfo,
  type BookingData,
  type CallSummaryEntry,
} from "@/lib/useMonitor";
import { APP_NAME } from "@/lib/branding";

function statusConfig(status: CallStatus) {
  switch (status) {
    case "connected":
      return { label: "Connected", bg: "bg-emerald-500/15", text: "text-emerald-400", dot: "bg-emerald-400" };
    case "connecting":
      return { label: "Connecting", bg: "bg-blue-500/15", text: "text-blue-400", dot: "bg-blue-400" };
    case "transferring":
      return { label: "Transferring", bg: "bg-amber-500/15", text: "text-amber-400", dot: "bg-amber-400" };
    case "transfer_connected":
      return { label: "Human Connected", bg: "bg-teal-500/15", text: "text-teal-400", dot: "bg-teal-400" };
    case "ended":
      return { label: "Call Ended", bg: "bg-slate-500/15", text: "text-slate-400", dot: "bg-slate-500" };
    case "takeover":
      return { label: "You Are Live", bg: "bg-rose-500/15", text: "text-rose-400", dot: "bg-rose-400" };
    default:
      return { label: "Disconnected", bg: "bg-slate-500/15", text: "text-slate-500", dot: "bg-slate-600" };
  }
}

function agentStateConfig(state: AgentState) {
  switch (state) {
    case "listening":
      return { label: "Listening", color: "bg-indigo-500", glow: "shadow-indigo-500/40", icon: Ear };
    case "thinking":
      return { label: "Thinking", color: "bg-amber-500", glow: "shadow-amber-500/40", icon: Brain };
    case "speaking":
      return { label: "Speaking", color: "bg-emerald-500", glow: "shadow-emerald-500/40", icon: AudioLines };
    default:
      return { label: "Idle", color: "bg-slate-600", glow: "shadow-slate-500/20", icon: Radio };
  }
}

export default function MonitorPage() {
  const [state, actions] = useMonitor();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800/60 bg-slate-950/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="w-full max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="h-5 w-px bg-slate-800" />
            <Headphones className="h-4 w-4 text-teal-400" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white tracking-tight leading-tight">
                {state.roomName ? state.roomName : `${APP_NAME} Monitor`}
              </span>
              {!state.roomName && (
                <span className="text-[10px] text-slate-500">Live call supervision dashboard</span>
              )}
            </div>
            {state.roomName && (
              <>
                <div className="h-5 w-px bg-slate-800 hidden sm:block" />
                <StatusBadge status={state.callStatus} />
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!state.token && (
              <button
                onClick={() => actions.fetchRooms()}
                className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 hover:bg-slate-900 transition-all"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            )}
            {state.token && !state.isTakenOver && state.callStatus !== "ended" && (
              <TakeoverButton onTakeover={() => void actions.triggerTakeover()} />
            )}
            {state.token && (
              <button
                onClick={actions.stopWatching}
                className="flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-500/20 hover:border-red-500/40 hover:bg-red-500/5 transition-all"
              >
                <X className="h-3 w-3" />
                Leave
              </button>
            )}
          </div>
        </div>
      </header>

      {state.token && state.url ? (
        <LiveKitRoom
          video={false}
          audio={true}
          token={state.token}
          serverUrl={state.url}
          onDisconnected={actions.stopWatching}
          connectOptions={{ autoSubscribe: true }}
          className="flex-1 flex flex-col"
        >
          <ConnectedDashboard state={state} actions={actions} />
          <RoomAudioRenderer />
        </LiveKitRoom>
      ) : (
        <RoomsListView
          rooms={state.rooms}
          loading={state.roomsLoading}
          error={state.roomsError}
          onWatch={actions.watchRoom}
          pastSummaries={state.pastSummaries}
          pastSummariesLoading={state.pastSummariesLoading}
        />
      )}
    </div>
  );
}

function RoomsListView({
  rooms,
  loading,
  error,
  onWatch,
  pastSummaries,
  pastSummariesLoading,
}: {
  rooms: RoomInfo[];
  loading: boolean;
  error: string | null;
  onWatch: (name: string) => void;
  pastSummaries: CallSummaryEntry[];
  pastSummariesLoading: boolean;
}) {
  return (
    <div className="flex-1 w-full max-w-[1600px] mx-auto px-6 py-10 flex flex-col gap-10">
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500 flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-teal-400 animate-pulse" />
            Active Calls
            <span className="ml-1 px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400 font-mono">
              {rooms.length}
            </span>
          </h2>
          <p className="text-[10px] text-slate-600">Auto-refreshes every 3 s</p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-xl bg-red-500/5 border border-red-500/10 text-red-400 text-xs">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-center">
            <Loader2 className="h-7 w-7 text-teal-500 animate-spin mb-3" />
            <p className="text-xs text-slate-500">Loading active rooms…</p>
          </div>
        ) : rooms.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center border border-dashed border-slate-800/80 rounded-2xl bg-slate-900/10">
            <Users className="h-10 w-10 text-slate-700 mb-3" />
            <h3 className="text-sm font-semibold text-slate-300 mb-1">No Active Calls</h3>
            <p className="text-xs text-slate-500 max-w-xs">
              Start a call from the caller portal and it will appear here for live monitoring.
            </p>
            <Link
              href="/"
              className="mt-4 text-xs text-teal-400 hover:text-teal-300 underline underline-offset-2"
            >
              Go to caller portal
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rooms.map((room) => (
              <div
                key={room.name}
                className="group p-5 rounded-2xl bg-slate-900/50 border border-slate-800/60 hover:border-teal-500/20 hover:bg-slate-900/80 transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="px-2 py-0.5 text-[10px] font-mono text-teal-400 bg-teal-500/10 rounded-md">
                    {room.name}
                  </span>
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {room.numParticipants}
                  </span>
                </div>
                <button
                  onClick={() => onWatch(room.name)}
                  className="w-full py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 bg-slate-800 hover:bg-teal-600 text-slate-300 hover:text-white border border-slate-700/50 hover:border-teal-500 transition-all duration-200 active:scale-[0.97]"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Watch Live
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-800/60 pt-10">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500 flex items-center gap-2 mb-6">
          <Sparkles className="h-3.5 w-3.5 text-teal-400" />
          Past Call Summaries
          <span className="ml-1 px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400 font-mono">
            {pastSummaries?.length || 0}
          </span>
        </h2>

        {pastSummariesLoading ? (
          <div className="py-12 flex flex-col items-center justify-center">
            <Loader2 className="h-5 w-5 text-teal-500 animate-spin mb-2" />
            <p className="text-xs text-slate-500">Loading call history…</p>
          </div>
        ) : !pastSummaries || pastSummaries.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-600 border border-dashed border-slate-800/60 rounded-2xl bg-slate-900/10">
            No past call summaries found. Completed calls will save summaries here automatically.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pastSummaries.map((sum) => (
              <PastSummaryCard key={sum.id} summary={sum} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PastSummaryCard({ summary }: { summary: CallSummaryEntry }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const formattedDate = summary.created_at
    ? new Date(summary.created_at).toLocaleString()
    : "Date unknown";

  return (
    <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/60 flex flex-col justify-between hover:border-slate-700/60 hover:bg-slate-900/60 transition-all duration-200">
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="px-2 py-0.5 text-[9px] font-mono text-teal-400 bg-teal-500/10 rounded">
            {summary.room_name}
          </span>
          <span className="text-[9px] text-slate-500 font-mono">{formattedDate}</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed mb-4">{summary.summary}</p>
      </div>

      {summary.transcript && summary.transcript.length > 0 && (
        <div className="mt-2 border-t border-slate-800/40 pt-3">
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="text-[10px] text-teal-400 hover:text-teal-300 font-semibold flex items-center gap-1 transition-colors"
          >
            {showTranscript ? "Hide Transcript" : "View Full Transcript"}
          </button>
          
          {showTranscript && (
            <div className="mt-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 max-h-40 overflow-y-auto space-y-1.5">
              {summary.transcript.map((t: any, idx: number) => (
                <p key={idx} className="text-[10px] text-slate-400 leading-normal">
                  <span className="font-semibold text-slate-300 capitalize">{t.speaker}:</span>{" "}
                  {t.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectedDashboard({
  state,
  actions,
}: {
  state: ReturnType<typeof useMonitor>[0];
  actions: ReturnType<typeof useMonitor>[1];
}) {
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();

  useEffect(() => {
    const handler = (payload: Uint8Array) => {
      actions.handleDataMessage(payload);
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => {
      room.off(RoomEvent.DataReceived, handler);
    };
  }, [room, actions]);

  useEffect(() => {
    if (localParticipant && !state.isTakenOver) {
      void localParticipant.setMicrophoneEnabled(false);
    }
  }, [localParticipant, state.roomName, state.isTakenOver]);

  const executeTakeover = useCallback(async () => {
    try {
      await room.localParticipant.publishData(
        JSON.stringify({ type: "takeover_request" }),
        { reliable: true },
      );
    } catch (e) {
      console.error("Failed to publish takeover request:", e);
    }
    try {
      await localParticipant.setMicrophoneEnabled(true);
    } catch (e) {
      console.error("Failed to enable mic:", e);
    }
  }, [room, localParticipant]);

  useEffect(() => {
    actions.registerTakeoverExecute(executeTakeover);
    return () => actions.registerTakeoverExecute(null);
  }, [actions, executeTakeover]);

  useEffect(() => {
    if (state.isTakenOver && localParticipant && !isMicrophoneEnabled) {
      void localParticipant.setMicrophoneEnabled(true);
    }
  }, [state.isTakenOver, localParticipant, isMicrophoneEnabled]);

  const toggleMic = useCallback(async () => {
    if (localParticipant) {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    }
  }, [localParticipant, isMicrophoneEnabled]);

  const endTakeover = useCallback(() => {
    if (localParticipant) localParticipant.setMicrophoneEnabled(false);
    actions.stopWatching();
  }, [localParticipant, actions]);

  const resumeAI = useCallback(async () => {
    try {
      await room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: "resume_request" })),
        { reliable: true },
      );
    } catch (e) {
      console.error("Failed to publish resume request:", e);
    }
    if (localParticipant) {
      void localParticipant.setMicrophoneEnabled(false);
    }
  }, [room, localParticipant]);

  return (
    <div className="flex-1 flex flex-col lg:flex-row w-full max-w-[1600px] mx-auto relative">
      <div className="flex-1 flex flex-col min-w-0">
        {state.transferResult && state.callStatus !== "takeover" && (
          <TransferBanner result={state.transferResult} />
        )}

        {state.isTakenOver && (
          <div className="px-6 py-3 bg-rose-500/10 border-b border-rose-500/20 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
              </span>
              <span className="text-xs font-semibold text-rose-300">You are now live with the caller</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMic}
                className={`p-2 rounded-lg border text-xs transition-all ${
                  isMicrophoneEnabled
                    ? "bg-slate-800 border-slate-700 text-white"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                {isMicrophoneEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </button>
              <button
                onClick={resumeAI}
                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
              >
                <Play className="h-3.5 w-3.5" />
                Resume AI
              </button>
              <button
                onClick={endTakeover}
                className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                End
              </button>
            </div>
          </div>
        )}

        <TranscriptPanel transcript={state.transcript} />
      </div>

      <aside className="w-full lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l border-slate-800/60 flex flex-col shrink-0">
        <div className="p-5 border-b border-slate-800/60">
          <SectionLabel text="Agent State" />
          <AgentStatePill state={state.agentState} />
        </div>

        <div className="p-5 border-b border-slate-800/60">
          <SectionLabel text="Detected Intent" />
          <IntentBadge intent={state.intent} />
        </div>

        <div className="p-5 border-b border-slate-800/60">
          <SectionLabel text="Current Action" />
          <ActionLine action={state.action} />
        </div>

        {state.bookingData && (
          <div className="p-5 border-b border-slate-800/60">
            <SectionLabel text="Booking Details" />
            <BookingCard data={state.bookingData} />
          </div>
        )}

        <div className="p-5 border-b border-slate-800/60">
          <SectionLabel text="Room Info" />
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <Users className="h-3.5 w-3.5" />
            <span className="font-mono">{state.roomName || "—"}</span>
          </div>
        </div>

        {!state.isTakenOver && state.callStatus !== "ended" && state.callStatus !== "disconnected" && (
          <div className="p-5 mt-auto">
            <button
              onClick={() => void actions.triggerTakeover()}
              className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white shadow-lg shadow-rose-600/10 hover:shadow-rose-600/20 active:scale-[0.97] transition-all duration-200"
            >
              <UserRoundPlus className="h-4 w-4" />
              Take Over Call
            </button>
            <p className="text-[9px] text-slate-600 text-center mt-2">
              Pauses the AI agent and connects your microphone to the caller.
            </p>
          </div>
        )}
      </aside>

      {state.summary && (
        <SummaryModal
          summary={state.summary}
          transcript={state.transcript}
          onClose={() => actions.setCallStatus("ended")}
        />
      )}
    </div>
  );
}

function TransferBanner({ result }: { result: string }) {
  const accepted = result === "accepted";
  return (
    <div
      className={`px-6 py-3 border-b flex items-center gap-2 text-xs font-medium ${
        accepted
          ? "bg-teal-500/10 border-teal-500/20 text-teal-300"
          : "bg-amber-500/10 border-amber-500/20 text-amber-300"
      }`}
    >
      <PhoneForwarded className="h-4 w-4 shrink-0" />
      {accepted
        ? "Warm transfer accepted — human agent is being connected."
        : result === "declined"
          ? "Warm transfer declined — human agent unavailable."
          : "Warm transfer could not be completed."}
    </div>
  );
}

function BookingCard({ data }: { data: BookingData }) {
  return (
    <div className="mt-2 p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-1.5">
      <div className="flex items-center gap-1.5 text-teal-400 font-semibold mb-2">
        <CalendarCheck className="h-3.5 w-3.5" />
        Confirmed
      </div>
      <p><span className="text-slate-500">Name:</span> {data.name}</p>
      <p><span className="text-slate-500">Reason:</span> {data.reason}</p>
      <p><span className="text-slate-500">When:</span> {data.date} at {data.time}</p>
      <p><span className="text-slate-500">Phone:</span> {data.phone}</p>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600 mb-2">{text}</p>
  );
}

function StatusBadge({ status }: { status: CallStatus }) {
  const cfg = statusConfig(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${cfg.dot} ${
          status === "connected" || status === "takeover" || status === "transferring" ? "animate-pulse" : ""
        }`}
      />
      {cfg.label}
    </span>
  );
}

function AgentStatePill({ state }: { state: AgentState }) {
  const cfg = agentStateConfig(state);
  const Icon = cfg.icon;
  return (
    <div className="flex items-center gap-3 mt-1">
      <div
        className={`h-9 w-9 rounded-xl ${cfg.color} ${cfg.glow} shadow-lg flex items-center justify-center ${
          state !== "idle" ? "animate-pulse" : ""
        }`}
      >
        <Icon className="h-4 w-4 text-white" />
      </div>
      <span className="text-sm font-semibold text-slate-200">{cfg.label}</span>
    </div>
  );
}

function IntentBadge({ intent }: { intent: string }) {
  const isBooking = intent === "booking";
  const isTransfer = intent === "transfer_request";

  return (
    <div className="mt-1">
      <span
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
          isBooking
            ? "bg-teal-500/10 border-teal-500/20 text-teal-400"
            : isTransfer
              ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
              : "bg-slate-800 border-slate-700/60 text-slate-400"
        }`}
      >
        {isBooking ? (
          <Target className="h-3 w-3" />
        ) : isTransfer ? (
          <Zap className="h-3 w-3" />
        ) : (
          <ShieldCheck className="h-3 w-3" />
        )}
        {intent.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
      </span>
    </div>
  );
}

function ActionLine({ action }: { action: string }) {
  if (!action) {
    return <p className="mt-1 text-xs text-slate-600 italic">No active action</p>;
  }

  const label = action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="mt-1 flex items-center gap-2">
      <Loader2 className="h-3.5 w-3.5 text-teal-400 animate-spin shrink-0" />
      <span className="text-xs text-slate-300 font-medium">{label}…</span>
    </div>
  );
}

function TakeoverButton({ onTakeover }: { onTakeover: () => void }) {
  return (
    <button
      onClick={onTakeover}
      className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-rose-400 hover:text-rose-300 px-3 py-1.5 rounded-lg border border-rose-500/20 hover:border-rose-500/40 hover:bg-rose-500/5 transition-all"
    >
      <UserRoundPlus className="h-3 w-3" />
      Take Over
    </button>
  );
}

function TranscriptPanel({ transcript }: { transcript: TranscriptEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [transcript]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-3 min-h-0"
      style={{ maxHeight: "calc(100vh - 3.5rem)" }}
    >
      {transcript.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
          <div className="h-14 w-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-4">
            <AudioLines className="h-6 w-6 text-slate-700" />
          </div>
          <p className="text-xs text-slate-600">Waiting for conversation to begin…</p>
        </div>
      ) : (
        transcript.map((entry, i) => {
          const isAgent = entry.speaker === "agent";
          return (
            <div
              key={i}
              className={`flex flex-col max-w-[75%] ${isAgent ? "self-end items-end" : "self-start items-start"}`}
            >
              <span className="text-[9px] text-slate-600 mb-0.5 px-1 font-mono">
                {isAgent ? "Agent" : "Caller"} · {entry.timestamp}
              </span>
              <div
                className={`px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                  isAgent
                    ? "bg-teal-600 text-white rounded-br-sm"
                    : "bg-slate-800 text-slate-100 border border-slate-700/40 rounded-bl-sm"
                }`}
              >
                {entry.text}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function SummaryModal({
  summary,
  transcript,
  onClose,
}: {
  summary: string;
  transcript: TranscriptEntry[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg mx-4 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="h-1 bg-gradient-to-r from-teal-500 via-cyan-500 to-emerald-500 shrink-0" />

        <div className="p-8 overflow-y-auto">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <h3 className="text-lg font-bold text-white">Post-Call Summary</h3>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 mb-4">
            <p className="text-sm text-slate-300 leading-relaxed">{summary}</p>
          </div>

          {transcript.length > 0 && (
            <div className="mb-6">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                Full Transcript
              </p>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 max-h-48 overflow-y-auto space-y-2">
                {transcript.map((entry, i) => (
                  <p key={i} className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-300">
                      {entry.speaker === "agent" ? "Agent" : "Caller"}:
                    </span>{" "}
                    {entry.text}
                  </p>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold transition-all active:scale-[0.97]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
