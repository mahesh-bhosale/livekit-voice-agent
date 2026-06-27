"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiUrl } from "@/lib/livekit-client";

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

export interface BookingData {
  name: string;
  reason: string;
  date: string;
  time: string;
  phone: string;
}

export interface CallSummaryEntry {
  id: number;
  room_name: string;
  summary: string;
  transcript: TranscriptEntry[];
  created_at: string | null;
}


export type AgentState = "idle" | "initializing" | "listening" | "thinking" | "speaking";

export type CallStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "transferring"
  | "transfer_connected"
  | "ended"
  | "takeover";

export interface MonitorState {
  token: string | null;
  url: string | null;
  roomName: string | null;
  callStatus: CallStatus;
  agentState: AgentState;
  transcript: TranscriptEntry[];
  intent: string;
  action: string;
  summary: string | null;
  transferResult: string | null;
  bookingData: BookingData | null;
  rooms: RoomInfo[];
  roomsLoading: boolean;
  roomsError: string | null;
  isTakenOver: boolean;
  pastSummaries: CallSummaryEntry[];
  pastSummariesLoading: boolean;
}

export interface MonitorActions {
  fetchRooms: () => Promise<void>;
  watchRoom: (roomName: string) => Promise<void>;
  stopWatching: () => void;
  handleDataMessage: (payload: Uint8Array) => void;
  beginTakeover: () => void;
  triggerTakeover: () => Promise<void>;
  registerTakeoverExecute: (handler: (() => Promise<void>) | null) => void;
  setCallStatus: (status: CallStatus) => void;
  fetchPastSummaries: () => Promise<void>;
}

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
  const [transferResult, setTransferResult] = useState<string | null>(null);
  const [bookingData, setBookingData] = useState<BookingData | null>(null);

  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  const [isTakenOver, setIsTakenOver] = useState(false);
  const takeoverExecuteRef = useRef<(() => Promise<void>) | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [pastSummaries, setPastSummaries] = useState<CallSummaryEntry[]>([]);
  const [pastSummariesLoading, setPastSummariesLoading] = useState(true);

  const fetchPastSummaries = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/summaries"));
      if (!res.ok) throw new Error("Failed to fetch summaries");
      const data = await res.json();
      setPastSummaries(data || []);
    } catch (err: unknown) {
      console.error("Failed to fetch summaries:", err);
    } finally {
      setPastSummariesLoading(false);
    }
  }, []);


  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/rooms"));
      if (!res.ok) throw new Error("Failed to fetch rooms");
      const data = await res.json();
      setRooms(data.rooms || []);
      setRoomsError(null);
    } catch (err: unknown) {
      setRoomsError(err instanceof Error ? err.message : "Failed to fetch rooms");
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    fetchPastSummaries();
    pollRef.current = setInterval(fetchRooms, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchRooms, fetchPastSummaries]);

  const watchRoom = useCallback(async (targetRoom: string) => {
    setCallStatus("connecting");
    setSummary(null);
    setTranscript([]);
    setAgentState("idle");
    setIntent("general");
    setAction("");
    setTransferResult(null);
    setBookingData(null);
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
    } catch (err: unknown) {
      console.error("Watch error:", err);
      setCallStatus("disconnected");
      setRoomsError(err instanceof Error ? err.message : "Failed to watch room");
    }
  }, []);

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
    setTransferResult(null);
    setBookingData(null);
    setIsTakenOver(false);
    takeoverExecuteRef.current = null;
    fetchPastSummaries();
  }, [fetchPastSummaries]);

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
          setAction(data.action || "");
          break;

        case "call_status":
          if (data.status) setCallStatus(data.status as CallStatus);
          if (data.status === "takeover") setIsTakenOver(true);
          break;

        case "transfer_result":
          setTransferResult(data.result);
          break;

        case "booking_data":
          setBookingData({
            name: data.name,
            reason: data.reason,
            date: data.date,
            time: data.time,
            phone: data.phone,
          });
          break;

        case "summary":
          setSummary(data.text);
          setCallStatus("ended");
          fetchPastSummaries();
          break;

        default:
          break;
      }
    } catch {
      // ignore malformed packets
    }
  }, [fetchPastSummaries]);

  const beginTakeover = useCallback(() => {
    setIsTakenOver(true);
    setCallStatus("takeover");
  }, []);

  const registerTakeoverExecute = useCallback((handler: (() => Promise<void>) | null) => {
    takeoverExecuteRef.current = handler;
  }, []);

  const triggerTakeover = useCallback(async () => {
    beginTakeover();
    if (takeoverExecuteRef.current) {
      await takeoverExecuteRef.current();
    }
  }, [beginTakeover]);

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
    transferResult,
    bookingData,
    rooms,
    roomsLoading,
    roomsError,
    isTakenOver,
    pastSummaries,
    pastSummariesLoading,
  };

  const actions: MonitorActions = {
    fetchRooms,
    watchRoom,
    stopWatching,
    handleDataMessage,
    beginTakeover,
    triggerTakeover,
    registerTakeoverExecute,
    setCallStatus,
    fetchPastSummaries,
  };

  return [state, actions];
}
