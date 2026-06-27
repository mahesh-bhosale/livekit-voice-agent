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
  // FIX: expose the full transfer result object so UI can distinguish no-answer / declined / unavailable
  transferResult: "accepted" | "declined" | "no-answer" | "unavailable" | "in_progress" | null;
  transferMessage: string | null;
  bookingData: BookingData | null;
  rooms: RoomInfo[];
  roomsLoading: boolean;
  roomsError: string | null;
  // FIX: distinguish permanent takeover (transfer accepted) from temporary takeover
  isTakenOver: boolean;
  isPermanentTakeover: boolean;
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
  triggerResume: () => Promise<void>;
  registerTakeoverExecute: (handler: (() => Promise<void>) | null) => void;
  registerResumeExecute: (handler: (() => Promise<void>) | null) => void;
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
  const [transferResult, setTransferResult] = useState<MonitorState["transferResult"]>(null);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [bookingData, setBookingData] = useState<BookingData | null>(null);

  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  const [isTakenOver, setIsTakenOver] = useState(false);
  // FIX: track permanent takeover separately so Resume AI button is hidden after transfer accepted
  const [isPermanentTakeover, setIsPermanentTakeover] = useState(false);
  const isPermanentTakeoverRef = useRef(false);
  // FIX: track resume-in-progress to prevent double-clicks and premature state changes
  const [resumeInProgress, setResumeInProgress] = useState(false);
  const resumeInProgressRef = useRef(false);

  useEffect(() => {
    isPermanentTakeoverRef.current = isPermanentTakeover;
  }, [isPermanentTakeover]);

  useEffect(() => {
    resumeInProgressRef.current = resumeInProgress;
  }, [resumeInProgress]);

  const takeoverExecuteRef = useRef<(() => Promise<void>) | null>(null);
  // FIX: separate ref for resume so the Resume AI button has its own handler
  const resumeExecuteRef = useRef<(() => Promise<void>) | null>(null);

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
    setTransferMessage(null);
    setBookingData(null);
    setIsTakenOver(false);
    setIsPermanentTakeover(false);

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
    setTransferMessage(null);
    setBookingData(null);
    setIsTakenOver(false);
    setIsPermanentTakeover(false);
    takeoverExecuteRef.current = null;
    resumeExecuteRef.current = null;
    fetchPastSummaries();
  }, [fetchPastSummaries]);

  const handleDataMessage = useCallback(
    (payload: Uint8Array) => {
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
            if (data.intent === "transfer_to_human" || data.intent === "transfer_request") {
              setCallStatus("transferring");
            }
            break;

          case "action":
            setAction(data.action || "");
            break;

          case "call_status":
            if (data.status) setCallStatus(data.status as CallStatus);

            if (data.status === "takeover") {
              setIsTakenOver(true);
            } else if (data.status === "transfer_connected") {
              // FIX: mark as permanent so Resume AI is hidden
              setIsTakenOver(true);
              setIsPermanentTakeover(true);
            } else if (data.status === "connected") {
              // Agent confirmed resume or normal connected state
              if (resumeInProgressRef.current) {
                // Resume confirmed by agent — now safe to clear takeover state
                setIsTakenOver(false);
                setResumeInProgress(false);
              } else if (!isPermanentTakeoverRef.current) {
                setIsTakenOver(false);
              }
            }
            break;

          case "transfer_result":
            setTransferResult(data.result as MonitorState["transferResult"]);
            setTransferMessage(data.message || null);
            if (data.result === "accepted") {
              setCallStatus("transfer_connected");
              setIsPermanentTakeover(true);
              setIsTakenOver(true);
            } else if (
              data.result === "no-answer" ||
              data.result === "declined" ||
              data.result === "unavailable"
            ) {
              setCallStatus("connected");
              setIsTakenOver(false);
              setIsPermanentTakeover(false);
            }
            break;

          case "supervisor_audio":
            if (data.enabled) {
              setIsTakenOver(true);
              setIsPermanentTakeover(true);
              setCallStatus("transfer_connected");
            }
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
    },
    [fetchPastSummaries]
  );

  const beginTakeover = useCallback(() => {
    setIsTakenOver(true);
    setCallStatus("takeover");
  }, []);

  const registerTakeoverExecute = useCallback((handler: (() => Promise<void>) | null) => {
    takeoverExecuteRef.current = handler;
  }, []);

  // FIX: separate register for resume handler
  const registerResumeExecute = useCallback((handler: (() => Promise<void>) | null) => {
    resumeExecuteRef.current = handler;
  }, []);

  const triggerTakeover = useCallback(async () => {
    beginTakeover();
    if (takeoverExecuteRef.current) {
      await takeoverExecuteRef.current();
    }
  }, [beginTakeover]);

  const triggerResume = useCallback(async () => {
    // FIX: use ref to avoid stale closure over isPermanentTakeover
    if (isPermanentTakeoverRef.current) return;
    if (resumeInProgressRef.current) return; // prevent double-click
    setResumeInProgress(true);
    if (resumeExecuteRef.current) {
      await resumeExecuteRef.current();
    }
    // FIX: Do NOT immediately reset isTakenOver or callStatus here.
    // The agent will send call_status: "connected" via data channel after resume completes,
    // which will drive the state reset in handleDataMessage. This prevents the mic-kill
    // race condition where the useEffect sees isTakenOver=false and disables the mic
    // before the agent has finished resuming.
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
    transferResult,
    transferMessage,
    bookingData,
    rooms,
    roomsLoading,
    roomsError,
    isTakenOver,
    isPermanentTakeover,
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
    triggerResume,
    registerTakeoverExecute,
    registerResumeExecute,
    setCallStatus,
    fetchPastSummaries,
  };

  return [state, actions];
}