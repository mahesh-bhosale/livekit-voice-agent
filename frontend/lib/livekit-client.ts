export const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://hackathon-lw9jp9ly.livekit.cloud";
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const getApiUrl = (path: string) => {
  return `${API_URL.replace(/\/$/, "")}${path}`;
};
