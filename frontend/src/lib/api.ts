const explicitApiUrl = import.meta.env.VITE_API_URL;
const serviceHost = import.meta.env.VITE_API_HOST;

const hostBase = serviceHost
  ? serviceHost.startsWith("http")
    ? serviceHost
    : `https://${serviceHost}`
  : null;

const API_BASE = explicitApiUrl
  ? `${explicitApiUrl}/api`
  : hostBase
    ? `${hostBase}/api`
    : "http://localhost:8000/api";

export interface TokenResponse {
  token: string;
  room_name: string;
  livekit_url: string;
}

export interface ClaimData {
  phone: string;
  location: string;
  damage: string;
  zip: string;
  other_party?: string;
}

export interface WorkflowStep {
  status: "pending" | "running" | "completed" | "failed";
  result: unknown;
  completed_at?: string;
}

export interface Claim {
  id: string;
  status: "processing" | "completed" | "failed";
  created_at: string;
  claim_data: ClaimData;
  transcript?: string;
  workflow_status: {
    current_step: string;
    steps: Record<string, WorkflowStep>;
  };
  result?: {
    policy?: { policy_id: string; name: string; status: string };
    damage?: { severity: string; parts: string[] };
    fraud?: { score: number; risk: string };
    estimate?: { total: number; deductible: number; customer_owes: number };
    shops?: Array<{ name: string; distance: string; rating: number }>;
  };
}

export async function getToken(roomName?: string): Promise<TokenResponse> {
  const response = await fetch(`${API_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room_name: roomName }),
  });

  if (!response.ok) {
    throw new Error("Failed to get token");
  }

  return response.json();
}

export async function createClaim(
  claimData: ClaimData,
  transcript?: string
): Promise<{ claim_id: string }> {
  const response = await fetch(`${API_BASE}/claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim_data: claimData, transcript }),
  });

  if (!response.ok) {
    throw new Error("Failed to create claim");
  }

  return response.json();
}

export async function getClaim(claimId: string): Promise<Claim> {
  const response = await fetch(`${API_BASE}/claims/${claimId}`);

  if (!response.ok) {
    throw new Error("Failed to get claim");
  }

  return response.json();
}

export async function getLatestClaim(): Promise<Claim | null> {
  try {
    const response = await fetch(`${API_BASE}/claims/latest`);

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}

export interface SessionTask {
  status: "running" | "completed" | "failed";
  result?: unknown;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export interface CallSession {
  collected: Record<string, string>;
  tasks: Record<string, SessionTask>;
  created_at?: string;
}

export async function getSession(roomName: string): Promise<CallSession> {
  const response = await fetch(`${API_BASE}/session/${roomName}`);
  if (!response.ok) {
    return { collected: {}, tasks: {} };
  }
  const data = (await response.json()) as CallSession;
  if (Object.keys(data.collected ?? {}).length > 0 || Object.keys(data.tasks ?? {}).length > 0) {
    return data;
  }

  // Fallback for deployments where the worker reports updates under a generic room name.
  const fallbackResponse = await fetch(`${API_BASE}/session/unknown-room`);
  if (!fallbackResponse.ok) {
    return data;
  }
  const fallbackData = (await fallbackResponse.json()) as CallSession;
  if (Object.keys(fallbackData.collected ?? {}).length > 0 || Object.keys(fallbackData.tasks ?? {}).length > 0) {
    return fallbackData;
  }

  return data;
}
