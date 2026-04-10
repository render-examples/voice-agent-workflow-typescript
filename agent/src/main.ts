import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  llm,
  voice,
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const SYSTEM_PROMPT = `You are Alex, a friendly and empathetic customer support agent at SafeDrive Insurance.
You help customers file auto insurance claims after accidents.

Your personality:
- Warm and reassuring - accidents are stressful
- Professional but not robotic
- Patient - ask for ONE piece of information at a time

CRITICAL RULES:
1. Ask for ONE piece of information at a time
2. After EACH response, call the corresponding save function to record it
3. Wait for the customer to respond before asking the next question
4. USE customer info returned by functions to personalize your responses

Follow this EXACT flow:

1. Confirm safety: "Are you and everyone involved safe?"
   -> When they confirm, call save_safety_status(confirmed=true)

2. Ask for phone: "Can I get the phone number on your account?"
   -> When they give it, call save_phone_number(phone="...")
   -> The function returns customer info (name, vehicle, status)
   -> GREET THEM BY NAME: "Hi [name]! I see you have a [vehicle] on file. Is that the vehicle involved?"
   -> If they have account issues, mention it politely

3. Ask for location: "Where did the accident happen?"
   -> When they answer, call save_accident_location(location="...")

4. Ask about damage: "Can you describe the damage to your [vehicle make/model]?"
   -> Reference their vehicle if known
   -> When they describe it, call save_damage_description(damage="...")
   -> Say "I'm analyzing that now"

5. Ask for ZIP: "What's your ZIP code? I'll find repair shops near you."
   -> When they give it, call save_zip_code(zip_code="...")
   -> Say "Looking for shops in your area"

6. Ask about other vehicles: "Were any other vehicles involved?"
   -> Call save_other_party_info(involved=true/false, info="...")

7. After ALL info collected, call submit_claim with everything.

Guidelines:
- NEVER ask multiple questions at once
- Keep responses SHORT - this is a phone call
- NEVER use markdown (no asterisks, bold, etc.) - this is spoken audio
- Speak numbers naturally
- USE the customer's first name after looking them up
- If customer is Platinum/Gold tier, acknowledge their loyalty`;

function getApiUrl(): string {
  const apiUrl = process.env.API_URL;
  if (apiUrl) {
    return apiUrl;
  }

  const apiHost = process.env.API_HOST;
  if (apiHost) {
    if (apiHost.startsWith("http://") || apiHost.startsWith("https://")) {
      return apiHost;
    }
    if (apiHost.includes(".onrender.com")) {
      return `https://${apiHost}`;
    }
    return `https://${apiHost}.onrender.com`;
  }
  return "http://api:8000";
}

type SessionUpdatePayload = {
  room_name: string;
  field: string;
  value: string;
};

async function updateSession(roomName: string, field: string, value: string): Promise<boolean> {
  const payload: SessionUpdatePayload = { room_name: roomName, field, value };
  const apiBase = getApiUrl();
  try {
    const response = await fetch(`${apiBase}/api/session/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[agent] Session update failed (${response.status}) for ${field} via ${apiBase}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[agent] Session update error for ${field} via ${apiBase}:`, error);
    return false;
  }
}

async function lookupCustomer(phone: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${getApiUrl()}/api/customer/lookup/${encodeURIComponent(phone)}`);
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as Record<string, unknown>;
}

async function submitClaim(payload: Record<string, unknown>): Promise<string> {
  const response = await fetch(`${getApiUrl()}/api/claims`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Claim submit failed (${response.status})`);
  }
  const data = (await response.json()) as { claim_id?: string };
  return data.claim_id ?? "CLM-PENDING";
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    const roomName = ctx.room.name ?? "unknown-room";

    const save_safety_status = llm.tool({
      description: "Save that safety has been confirmed.",
      parameters: z.object({ confirmed: z.boolean() }),
      execute: async ({ confirmed }) => {
        await updateSession(roomName, "safety_confirmed", confirmed ? "yes" : "no");
        return "Safety status recorded.";
      },
    });

    const save_phone_number = llm.tool({
      description: "Save the customer's phone number and look up policy context.",
      parameters: z.object({ phone: z.string() }),
      execute: async ({ phone }) => {
        const normalizedPhone = phone ?? "";
        await updateSession(roomName, "phone", normalizedPhone);
        const customer = await lookupCustomer(normalizedPhone);
        if (!customer) {
          return `Phone number ${normalizedPhone} recorded.`;
        }
        const name = String(customer.first_name ?? "there");
        const vehicle = customer.vehicle ? `Vehicle on file: ${String(customer.vehicle)}` : "Vehicle not found.";
        const tier = String(customer.loyalty_tier ?? "Standard");
        const hasIssues = Boolean(customer.has_issues);
        const notes = Array.isArray(customer.account_notes) ? customer.account_notes.map(String) : [];

        const infoParts: string[] = [`Customer found: ${name}`];
        if (customer.vehicle) {
          infoParts.push(`Their vehicle on file is a ${String(customer.vehicle)}`);
        }
        if (tier === "Platinum") {
          infoParts.push("They are a Platinum VIP member - give them premium service");
        } else if (tier === "Gold") {
          infoParts.push("They are a Gold member");
        }
        if (hasIssues && notes.includes("payment_30_days_overdue")) {
          infoParts.push("WARNING: Their account has an overdue payment - mention this politely");
        }
        infoParts.push("Greet them by name and confirm the vehicle if known");
        return infoParts.join(". ");
      },
    });

    const save_accident_location = llm.tool({
      description: "Save the accident location.",
      parameters: z.object({ location: z.string() }),
      execute: async ({ location }) => {
        const normalizedLocation = location ?? "";
        await updateSession(roomName, "location", normalizedLocation);
        return `Location recorded: ${normalizedLocation}`;
      },
    });

    const save_damage_description = llm.tool({
      description: "Save damage description and trigger analysis.",
      parameters: z.object({ damage: z.string() }),
      execute: async ({ damage }) => {
        const normalizedDamage = damage ?? "";
        await updateSession(roomName, "damage", normalizedDamage);
        return "Damage description recorded. Analysis started.";
      },
    });

    const save_zip_code = llm.tool({
      description: "Save ZIP code and trigger shop lookup.",
      parameters: z.object({ zip_code: z.string() }),
      execute: async ({ zip_code }) => {
        const normalizedZip = zip_code ?? "";
        await updateSession(roomName, "zip", normalizedZip);
        return `ZIP code ${normalizedZip} recorded. Finding nearby repair shops.`;
      },
    });

    const save_other_party_info = llm.tool({
      description: "Save information about other vehicles involved.",
      parameters: z.object({ involved: z.boolean(), info: z.string().optional() }),
      execute: async ({ involved, info }) => {
        const safeInfo = info ?? "yes";
        await updateSession(roomName, "other_party", involved ? safeInfo : "none");
        return "Other party information recorded.";
      },
    });

    const submit_claim = llm.tool({
      description: "Submit final claim once all details are collected.",
      parameters: z.object({
        phone: z.string(),
        location: z.string(),
        damage_description: z.string(),
        zip_code: z.string(),
        other_vehicles_involved: z.boolean().optional(),
        other_party_info: z.string().optional(),
      }),
      execute: async ({
        phone,
        location,
        damage_description,
        zip_code,
        other_vehicles_involved,
        other_party_info,
      }) => {
        const claimId = await submitClaim({
          claim_data: {
            phone,
            location,
            damage: damage_description,
            zip: zip_code,
            other_party: other_vehicles_involved ? (other_party_info ?? "") : undefined,
          },
        });
        return `Claim submitted successfully. The claim number is ${claimId}.`;
      },
    });

    const agent = new voice.Agent({
      instructions: SYSTEM_PROMPT,
      tools: {
        save_safety_status,
        save_phone_number,
        save_accident_location,
        save_damage_description,
        save_zip_code,
        save_other_party_info,
        submit_claim,
      },
    });

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad! as silero.VAD,
      stt: new openai.STT(),
      tts: new openai.TTS({ model: "gpt-4o-mini-tts", voice: "alloy" }),
      llm: new openai.LLM({ model: "gpt-4o" }),
    });

    await session.start({ room: ctx.room, agent });
    await session.say(
      "Hi, this is Alex from SafeDrive Insurance. I understand you need to file a claim. First things first, are you and everyone involved safe?",
      { allowInterruptions: true }
    );
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
