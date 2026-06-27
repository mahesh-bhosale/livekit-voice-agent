"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiUrl } from "@/lib/livekit-client";

// ── Types ──────────────────────────────────────────────────────────
export interface RoomInfo {
  name: string;
  sid: string;
  numParticipants: number;
  maxParticipants: number;
  creationTime: number;
}

export interface TranscriptEntry {
  speaker: "caller" | "agent";
  text: string;
  timestamp: string;
}

export type AgentState = "idle" | "initializing" | "listening" | "thinking" | "speaking";

export type CallStatus = "disconnected" | "connecting" | "connected" | "transferring" | "ended" | "takeover";

export interface MonitorState {
  // Connection
  token: string | null;
  url: string | null;
  roomName: string | null;
  callStatus: CallStatus;

  // Live feed from data channel
  agentState: AgentState;
  transcript: TranscriptEntry[];
  intent: string;
  action: string;
  summary: string | null;

  // Rooms list
  rooms: RoomInfo[];
  roomsLoading: boolean;
  roomsError: string | null;

  // Takeover mode
  isTakenOver: boolean;
}

export interface MonitorActions {
  fetchRooms: () => Promise<void>;
  watchRoom: (roomName: string) => Promise<void>;
  stopWatching: () => void;
  handleDataMessage: (payload: Uint8Array) => void;
  requestTakeover: () => void;
  setCallStatus: (status: CallStatus) => void;
}

// ── Hook ───────────────────────────────────────────────────────────
export function useMonitor(): [MonitorState, MonitorActions] {
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>("disconnected");

  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [intent, setIntent] = useState<string>("general");
  const [action, setAction] = useState<string>("");
  const [summary, setSummary] = useState<string | null>(null);

  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  const [isTakenOver, setIsTakenOver] = useState(false);

  // Polling interval ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Rooms polling ──
  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/rooms"));
      if (!res.ok) throw new Error("Failed to fetch rooms");
      const data = await res.json();
      setRooms(data.rooms || []);
      setRoomsError(null);
    } catch (err: any) {
      setRoomsError(err.message);
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  // Start polling on mount
  useEffect(() => {
    fetchRooms();
    pollRef.current = setInterval(fetchRooms, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchRooms]);

  // ── Watch a room ──
  const watchRoom = useCallback(async (targetRoom: string) => {
    setCallStatus("connecting");
    setSummary(null);
    setTranscript([]);
    setAgentState("idle");
    setIntent("general");
    setAction("");
    setIsTakenOver(false);

    try {
      const watcherId = `watcher-${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch(getApiUrl("/api/token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: targetRoom,
          participantName: watcherId,
          isWatcher: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to get watcher token");
      }

      const data = await res.json();
      setToken(data.token);
      setUrl(data.url);
      setRoomName(targetRoom);
      setCallStatus("connected");
    } catch (err: any) {
      console.error("Watch error:", err);
      setCallStatus("disconnected");
      setRoomsError(err.message);
    }
  }, []);

  // ── Stop watching ──
  const stopWatching = useCallback(() => {
    setToken(null);
    setUrl(null);
    setRoomName(null);
    setCallStatus("disconnected");
    setSummary(null);
    setTranscript([]);
    setAgentState("idle");
    setIntent("general");
    setAction("");
    setIsTakenOver(false);
  }, []);

  // ── Data message handler (called from component) ──
  const handleDataMessage = useCallback((payload: Uint8Array) => {
    try {
      const text = new TextDecoder().decode(payload);
      const data = JSON.parse(text);

      switch (data.type) {
        case "agent_state":
          setAgentState(data.state as AgentState);
          break;

        case "transcript":
          setTranscript((prev) => {
            // Deduplicate exact matches at tail
            if (prev.length > 0) {
              const last = prev[prev.length - 1];
              if (last.speaker === data.speaker && last.text === data.text) return prev;
            }
            return [
              ...prev,
              {
                speaker: data.speaker,
                text: data.text,
                timestamp: new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }),
              },
            ];
          });
          break;

        case "intent":
          setIntent(data.intent);
          if (data.intent === "transfer_request") setCallStatus("transferring");
          break;

        case "action":
          setAction(data.action);
          break;

        case "summary":
          setSummary(data.text);
          setCallStatus("ended");
          break;

        default:
          break;
      }
    } catch {
      // silently ignore non-JSON or malformed packets
    }
  }, []);

  // ── Takeover request ──
  const requestTakeover = useCallback(() => {
    setIsTakenOver(true);
    setCallStatus("takeover");
  }, []);

  const state: MonitorState = {
    token,
    url,
    roomName,
    callStatus,
    agentState,
    transcript,
    intent,
    action,
    summary,
    rooms,
    roomsLoading,
    roomsError,
    isTakenOver,
  };

  const actions: MonitorActions = {
    fetchRooms,
    watchRoom,
    stopWatching,
    handleDataMessage,
    requestTakeover,
    setCallStatus,
  };

  return [state, actions];
}
