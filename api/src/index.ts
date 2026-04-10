import cors from "cors";
import express, { Request, Response } from "express";
import { Render } from "@renderinc/sdk";
import { AccessToken } from "livekit-server-sdk";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

type JsonRecord = Record<string, unknown>;

type ClaimData = {
  phone: string;
  location: string;
  damage: string;
  zip: string;
  other_party?: string;
};

type Claim = {
  id: string;
  status: "processing" | "completed" | "failed";
  created_at: string;
  claim_data: ClaimData;
  transcript?: string;
  workflow_status: {
    current_step: string;
    steps: Record<string, { status: string; result: unknown; completed_at?: string }>;
  };
  result?: unknown;
  task_run_id?: string;
};

type SessionTask = {
  status: "running" | "completed" | "failed";
  started_at?: string;
  completed_at?: string;
  result?: unknown;
  error?: string;
  task_run_id?: string;
};

type Session = {
  collected: Record<string, string>;
  tasks: Record<string, SessionTask>;
  profile: JsonRecord | null;
  created_at: string;
};

type VoiceSession = {
  room_id: string;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  collected: Record<string, string>;
  tasks: Record<string, SessionTask>;
  profile: JsonRecord | null;
  created_at: string;
  ws: WebSocket;
};

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(cors({ origin: true, credentials: true }));

const claimsDb: Record<string, Claim> = {};
const callSessions: Record<string, Session> = {};
const voiceSessions: Record<string, VoiceSession> = {};

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const customerProfiles: Record<string, JsonRecord> = {
  "555-0100": {
    name: "Sarah Johnson",
    first_name: "Sarah",
    policy_id: "POL-94102-7721",
    policy_status: "active",
    coverage: "$100,000",
    deductible: 500,
    member_since: "2019",
    previous_claims: 0,
    risk_score: 0.08,
    fraud_flags: [],
    loyalty_tier: "Gold",
    vehicle: {
      year: 2022,
      make: "Toyota",
      model: "Camry",
      color: "Silver",
      vin: "4T1B11HK5NU123456",
    },
    address: { city: "San Francisco", state: "CA", zip: "94102" },
  },
  "555-0200": {
    name: "Mike Thompson",
    first_name: "Mike",
    policy_id: "POL-88451-3392",
    policy_status: "active",
    coverage: "$50,000",
    deductible: 1000,
    member_since: "2021",
    previous_claims: 4,
    risk_score: 0.67,
    fraud_flags: ["multiple_claims_short_period"],
    loyalty_tier: "Standard",
    vehicle: {
      year: 2019,
      make: "Ford",
      model: "F-150",
      color: "Black",
      vin: "1FTEW1EP5KFA12345",
    },
    address: { city: "Beverly Hills", state: "CA", zip: "90210" },
  },
  "555-0300": {
    name: "Emma Rodriguez",
    first_name: "Emma",
    policy_id: "POL-PLAT-0042",
    policy_status: "active",
    coverage: "$250,000",
    deductible: 250,
    member_since: "2015",
    previous_claims: 1,
    risk_score: 0.05,
    fraud_flags: [],
    loyalty_tier: "Platinum",
    perks: ["priority_processing", "free_rental_car", "concierge_service"],
    vehicle: {
      year: 2024,
      make: "BMW",
      model: "X5",
      color: "Midnight Blue",
      vin: "5UXCR6C55R9A98765",
    },
    address: { city: "Manhattan", state: "NY", zip: "10001" },
  },
  "555-0400": {
    name: "James Wilson",
    first_name: "James",
    policy_id: "POL-66201-8844",
    policy_status: "payment_overdue",
    coverage: "$75,000",
    deductible: 750,
    member_since: "2022",
    previous_claims: 2,
    risk_score: 0.45,
    fraud_flags: [],
    loyalty_tier: "Standard",
    account_notes: ["payment_30_days_overdue", "requires_payment_before_claim"],
    vehicle: {
      year: 2020,
      make: "Honda",
      model: "Civic",
      color: "White",
      vin: "2HGFC2F69LH567890",
    },
    address: { city: "Miami", state: "FL", zip: "33101" },
  },
};

const defaultProfile: JsonRecord = {
  name: "Valued Customer",
  first_name: "there",
  policy_id: "POL-TEMP-0001",
  policy_status: "active",
  coverage: "$50,000",
  deductible: 500,
  member_since: "2023",
  previous_claims: 0,
  risk_score: 0.15,
  fraud_flags: [],
  loyalty_tier: "Standard",
  vehicle: null,
  address: null,
};

function nowIso(): string {
  return new Date().toISOString();
}

function unwrapResult(results: unknown): unknown {
  return Array.isArray(results) ? results[0] : results;
}

function taskIdentifier(taskName: string): string {
  if ((process.env.RENDER_USE_LOCAL_DEV ?? "").toLowerCase() === "true") {
    return taskName;
  }
  const workflowServiceId = process.env.WORKFLOW_SERVICE_ID;
  if (!workflowServiceId) {
    throw new Error("WORKFLOW_SERVICE_ID not configured");
  }
  return `${workflowServiceId}/${taskName}`;
}

function getCustomerProfile(phone: string): JsonRecord {
  const normalized = phone.replace(/\D/g, "");
  for (const [known, profile] of Object.entries(customerProfiles)) {
    const candidate = known.replace(/\D/g, "");
    if (normalized.endsWith(candidate) || normalized.includes(candidate)) {
      return profile;
    }
  }
  return defaultProfile;
}

async function wsSend(ws: WebSocket, payload: JsonRecord): Promise<void> {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(payload));
}

async function speechToText(audioBytes: Buffer): Promise<string> {
  if (!openaiClient) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const file = await toFile(audioBytes, "audio.webm", { type: "audio/webm" });
  const transcription = await openaiClient.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "en",
  });
  return transcription.text;
}

async function textToSpeech(text: string): Promise<Buffer> {
  if (!openaiClient) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const response = await openaiClient.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "marin",
    input: text,
    response_format: "mp3",
    speed: 1.1,
  });
  const audioBuffer = Buffer.from(await response.arrayBuffer());
  return audioBuffer;
}

function getTaskArgument(taskName: string, session: { collected: Record<string, string> }, room: string): string | undefined {
  switch (taskName) {
    case "verify_policy":
      return session.collected.phone;
    case "analyze_damage":
      return session.collected.damage;
    case "find_shops":
      return session.collected.zip;
    case "fraud_check":
      return room;
    default:
      return undefined;
  }
}

async function runWorkflowTask(room: string, taskName: string, args: unknown[]): Promise<void> {
  const targetVoice = voiceSessions[room];
  const targetCall = callSessions[room];
  if (!targetVoice && !targetCall) {
    return;
  }

  try {
    const render = new Render();
    const run = await render.workflows.runTask(taskIdentifier(taskName), args);
    const result = unwrapResult(run.results);

    if (targetVoice) {
      targetVoice.tasks[taskName] = {
        status: "completed",
        result,
        completed_at: nowIso(),
        task_run_id: run.id,
      };
      await wsSend(targetVoice.ws, {
        type: "session_update",
        data: {
          collected: targetVoice.collected,
          tasks: targetVoice.tasks,
          profile: targetVoice.profile,
        },
      });
    } else if (targetCall) {
      targetCall.tasks[taskName] = {
        status: "completed",
        result,
        completed_at: nowIso(),
        task_run_id: run.id,
      };
    }
  } catch (error) {
    const failure: SessionTask = {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      completed_at: nowIso(),
    };
    if (targetVoice) {
      targetVoice.tasks[taskName] = failure;
    } else if (targetCall) {
      targetCall.tasks[taskName] = failure;
    }
  }
}

async function processVoiceTurn(ws: WebSocket, session: VoiceSession, audioBytes: Buffer): Promise<void> {
  await wsSend(ws, { type: "processing", step: "stt" });
  const transcript = await speechToText(audioBytes);
  if (!transcript.trim()) {
    return;
  }
  await wsSend(ws, { type: "transcript", text: transcript, role: "user" });

  await wsSend(ws, { type: "processing", step: "llm" });
  const render = new Render();
  const conversationInput = {
    transcript,
    sessionState: {
      roomId: session.room_id,
      collected: session.collected,
      profile: session.profile,
    },
    conversationHistory: session.conversation_history,
  };
  const taskRun = await render.workflows.runTask(taskIdentifier("conversation"), [conversationInput]);
  const result = (unwrapResult(taskRun.results) ?? {}) as JsonRecord;

  const responseText = String(result.responseText ?? "Got it.");
  const extractedFields = (result.extractedFields as Array<{ field: string; value: string }> | undefined) ?? [];
  const triggeredTasks = (result.triggeredTasks as string[] | undefined) ?? [];

  for (const item of extractedFields) {
    session.collected[item.field] = item.value;
    if (item.field === "phone") {
      const profile = getCustomerProfile(item.value);
      if (profile !== defaultProfile) {
        session.profile = profile;
      }
    }
  }

  session.conversation_history.push({ role: "user", content: transcript });
  session.conversation_history.push({ role: "assistant", content: responseText });

  for (const taskName of triggeredTasks) {
    if (!session.tasks[taskName]) {
      session.tasks[taskName] = { status: "running", started_at: nowIso() };
      const arg = getTaskArgument(taskName, session, session.room_id);
      if (arg !== undefined) {
        void runWorkflowTask(session.room_id, taskName, [arg]);
      }
    }
  }

  await wsSend(ws, {
    type: "session_update",
    data: { collected: session.collected, tasks: session.tasks, profile: session.profile },
  });
  await wsSend(ws, { type: "transcript", text: responseText, role: "assistant" });

  await wsSend(ws, { type: "processing", step: "tts" });
  const audioResponse = await textToSpeech(responseText);
  await wsSend(ws, { type: "audio", data: audioResponse.toString("base64") });
}

async function generateGreeting(ws: WebSocket, session: VoiceSession): Promise<void> {
  const render = new Render();
  await wsSend(ws, { type: "processing", step: "llm" });
  const taskRun = await render.workflows.runTask(taskIdentifier("generate_greeting"), []);
  const result = (unwrapResult(taskRun.results) ?? {}) as JsonRecord;
  const responseText = String(result.responseText ?? "Hi, this is Alex from SafeDrive Insurance. Are you safe?");

  session.conversation_history.push({ role: "assistant", content: responseText });
  await wsSend(ws, { type: "transcript", text: responseText, role: "assistant" });

  await wsSend(ws, { type: "processing", step: "tts" });
  const audioResponse = await textToSpeech(responseText);
  await wsSend(ws, { type: "audio", data: audioResponse.toString("base64") });
}

app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "Insurance Claim API (TypeScript)" });
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy" });
});

app.post("/api/token", async (req: Request, res: Response) => {
  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    return res.status(500).json({ detail: "LiveKit not configured" });
  }

  const participantName = req.body?.participant_name ?? "customer";
  const roomName = req.body?.room_name ?? `claim-${randomUUID().slice(0, 8)}`;
  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
    name: participantName,
  });
  token.addGrant({ roomJoin: true, room: roomName });

  return res.json({
    token: await token.toJwt(),
    room_name: roomName,
    livekit_url: livekitUrl,
  });
});

app.post("/api/claims", async (req: Request, res: Response) => {
  const claimData = req.body?.claim_data as ClaimData | undefined;
  const transcript = req.body?.transcript as string | undefined;
  if (!claimData?.phone || !claimData?.location || !claimData?.damage || !claimData?.zip) {
    return res.status(400).json({ detail: "Invalid claim_data payload" });
  }

  const claimId = `CLM-${new Date().getFullYear()}-${randomUUID().slice(0, 4).toUpperCase()}`;
  const claim: Claim = {
    id: claimId,
    status: "processing",
    created_at: nowIso(),
    claim_data: claimData,
    transcript,
    workflow_status: {
      current_step: "verify_policy",
      steps: {
        verify_policy: { status: "pending", result: null },
        analyze_damage: { status: "pending", result: null },
        fraud_check: { status: "pending", result: null },
        generate_estimate: { status: "pending", result: null },
        find_shops: { status: "pending", result: null },
        send_notification: { status: "pending", result: null },
      },
    },
    result: null,
  };
  claimsDb[claimId] = claim;

  if ((process.env.RENDER_USE_LOCAL_DEV ?? "").toLowerCase() !== "true") {
    if (!process.env.WORKFLOW_SERVICE_ID) {
      return res
        .status(500)
        .json({ detail: "WORKFLOW_SERVICE_ID not configured. Set it in render-config env group." });
    }
    if (!process.env.RENDER_API_KEY) {
      return res
        .status(500)
        .json({ detail: "RENDER_API_KEY not configured. Set it in render-config env group." });
    }
  }

  try {
    const render = new Render();
    const started = await render.workflows.startTask(taskIdentifier("process_claim"), [claimId, claimData]);
    claim.task_run_id = started.taskRunId;
    return res.json({ claim_id: claimId, status: "processing" });
  } catch (error) {
    return res.status(500).json({
      detail: `Workflow trigger failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

app.get("/api/claims/latest", (_req: Request, res: Response) => {
  const claims = Object.values(claimsDb);
  if (!claims.length) {
    return res.status(404).json({ detail: "No claims found" });
  }
  claims.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return res.json(claims.at(-1));
});

app.get("/api/claims/:claimId", async (req: Request, res: Response) => {
  const claim = claimsDb[req.params.claimId];
  if (!claim) {
    return res.status(404).json({ detail: "Claim not found" });
  }

  if (claim.task_run_id) {
    try {
      const render = new Render();
      const run = await render.workflows.getTaskRun(claim.task_run_id);
      if (run.status === "completed") {
        claim.status = "completed";
        claim.result = run.results;
      } else if (run.status === "failed") {
        claim.status = "failed";
      }
    } catch {
      // Keep current state if poll fails.
    }
  }
  return res.json(claim);
});

app.post("/api/claims/:claimId/steps/:stepName", (req: Request, res: Response) => {
  const claim = claimsDb[req.params.claimId];
  if (!claim) {
    return res.status(404).json({ detail: "Claim not found" });
  }
  const stepName = req.params.stepName;
  if (!(stepName in claim.workflow_status.steps)) {
    return res.status(404).json({ detail: "Step not found" });
  }
  const status = String(req.query.status ?? req.body?.status ?? "pending");
  const result = req.body?.result ?? null;
  claim.workflow_status.steps[stepName] = {
    status,
    result,
    completed_at: status === "completed" ? nowIso() : undefined,
  };

  const orderedSteps = [
    "verify_policy",
    "analyze_damage",
    "fraud_check",
    "generate_estimate",
    "find_shops",
    "send_notification",
  ];

  const nextPending = orderedSteps.find(
    (step) => claim.workflow_status.steps[step]?.status === "pending"
  );
  if (nextPending) {
    claim.workflow_status.current_step = nextPending;
  } else {
    claim.workflow_status.current_step = "completed";
    claim.status = "completed";
  }

  return res.json({ status: "updated" });
});

app.post("/api/session/update", (req: Request, res: Response) => {
  const room = String(req.body?.room_name ?? "");
  const field = String(req.body?.field ?? "");
  const value = String(req.body?.value ?? "");
  if (!room || !field) {
    return res.status(400).json({ detail: "room_name and field are required" });
  }

  if (!callSessions[room]) {
    callSessions[room] = {
      collected: {},
      tasks: {},
      profile: null,
      created_at: nowIso(),
    };
  }
  const session = callSessions[room];
  session.collected[field] = value;

  if (field === "phone" && !session.tasks.verify_policy) {
    session.profile = getCustomerProfile(value);
    session.tasks.verify_policy = { status: "running", started_at: nowIso() };
    void runWorkflowTask(room, "verify_policy", [value]);
  } else if (field === "damage" && !session.tasks.analyze_damage) {
    session.tasks.analyze_damage = { status: "running", started_at: nowIso() };
    void runWorkflowTask(room, "analyze_damage", [value]);
  } else if (field === "zip" && !session.tasks.find_shops) {
    session.tasks.find_shops = { status: "running", started_at: nowIso() };
    void runWorkflowTask(room, "find_shops", [value]);
  }

  if (!session.tasks.fraud_check && session.collected.phone && session.collected.damage) {
    session.tasks.fraud_check = { status: "running", started_at: nowIso() };
    void runWorkflowTask(room, "fraud_check", [room]);
  }

  return res.json({ status: "updated", session });
});

app.get("/api/session/:roomName", (req: Request, res: Response) => {
  res.json(callSessions[req.params.roomName] ?? { collected: {}, tasks: {} });
});

app.get("/api/customer/lookup/:phone", (req: Request, res: Response) => {
  const profile = getCustomerProfile(req.params.phone);
  const vehicle = profile.vehicle as JsonRecord | null;
  const vehicleDescription = vehicle
    ? `${vehicle.year} ${vehicle.color} ${vehicle.make} ${vehicle.model}`
    : null;

  return res.json({
    found: profile !== defaultProfile,
    first_name: profile.first_name,
    full_name: profile.name,
    loyalty_tier: profile.loyalty_tier,
    member_since: profile.member_since,
    vehicle: vehicleDescription,
    vehicle_details: vehicle,
    policy_status: profile.policy_status,
    previous_claims: profile.previous_claims,
    deductible: profile.deductible,
    has_issues:
      profile.policy_status !== "active" ||
      ((profile.account_notes as unknown[] | undefined)?.length ?? 0) > 0,
    account_notes: profile.account_notes ?? [],
    perks: profile.perks ?? [],
  });
});

app.get("/api/demo/profiles", (_req: Request, res: Response) => {
  return res.json({
    profiles: [
      {
        phone: "555-0100",
        zip: "94102",
        name: "Sarah Johnson",
        vehicle: "2022 Silver Toyota Camry",
        scenario: "Good Customer",
        description: "Clean history, Gold member, quick approval. Low risk score.",
        expected_outcome: "Fast approval, standard process",
      },
      {
        phone: "555-0200",
        zip: "90210",
        name: "Mike Thompson",
        vehicle: "2019 Black Ford F-150",
        scenario: "Frequent Claims",
        description: "4 previous claims in 2 years, higher risk score, fraud flags.",
        expected_outcome: "Extended review, fraud check warning",
      },
      {
        phone: "555-0300",
        zip: "10001",
        name: "Emma Rodriguez",
        vehicle: "2024 Midnight Blue BMW X5",
        scenario: "VIP Customer",
        description: "Platinum member since 2015, premium coverage, concierge perks.",
        expected_outcome: "Priority processing, premium repair shop options",
      },
      {
        phone: "555-0400",
        zip: "33101",
        name: "James Wilson",
        vehicle: "2020 White Honda Civic",
        scenario: "Payment Issues",
        description: "Policy payment 30 days overdue, requires attention.",
        expected_outcome: "Account warning, payment required notice",
      },
    ],
    usage: "Say the phone number during the call when Alex asks for it.",
  });
});

app.get("/api/debug/workflow-test", async (_req: Request, res: Response) => {
  const results: Record<string, JsonRecord> = {};
  const taskNames = ["verify_policy", "generate_greeting", "conversation"];
  for (const name of taskNames) {
    try {
      const render = new Render();
      const args =
        name === "verify_policy"
          ? ["555-0100"]
          : name === "generate_greeting"
            ? []
            : [
                {
                  transcript: "hello",
                  sessionState: { roomId: "debug-room", collected: {}, profile: null },
                  conversationHistory: [],
                },
              ];
      const run = await render.workflows.runTask(taskIdentifier(name), args);
      results[name] = { status: "ok", run_id: run.id };
    } catch (error) {
      results[name] = { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }
  const prefix = taskIdentifier("X");
  return res.json({
    collected: { task_id_prefix: prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : prefix },
    tasks: results,
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/voice" });

wss.on("connection", (ws) => {
  let session: VoiceSession | null = null;

  ws.on("message", (raw) => {
    void (async () => {
      try {
        const message = JSON.parse(raw.toString("utf8")) as JsonRecord;
        const type = String(message.type ?? "");

        if (type === "start_session") {
          const roomId = String(message.roomId ?? `voice-${randomUUID().slice(0, 8)}`);
          session = {
            room_id: roomId,
            conversation_history: [],
            collected: {},
            tasks: {},
            profile: null,
            created_at: nowIso(),
            ws,
          };
          voiceSessions[roomId] = session;
          await wsSend(ws, { type: "session_started", roomId });
          await generateGreeting(ws, session);
          return;
        }

        if (type === "audio" && session) {
          const audioData = String(message.data ?? "");
          const audioBytes = Buffer.from(audioData, "base64");
          await processVoiceTurn(ws, session, audioBytes);
        }
      } catch (error) {
        await wsSend(ws, {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  ws.on("close", () => {
    if (session) {
      delete voiceSessions[session.room_id];
    }
  });
});

const port = Number(process.env.PORT ?? 8000);
server.listen(port, "0.0.0.0", () => {
  console.log(`[api] listening on ${port}`);
});
