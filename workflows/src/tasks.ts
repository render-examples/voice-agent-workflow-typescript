import OpenAI from "openai";
import { task } from "@renderinc/sdk/workflows";

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function hashCode(input: string): number {
  let h = 0;
  for (const char of input) {
    h = ((h << 5) - h + char.charCodeAt(0)) | 0;
  }
  return h;
}

const PART_KEYWORDS: Record<string, string> = {
  bumper: "bumper",
  trunk: "trunk",
  "tail light": "tail_light",
  taillight: "tail_light",
  headlight: "headlight",
  hood: "hood",
  door: "door",
  window: "window",
  windshield: "windshield",
  mirror: "mirror",
  fender: "fender",
  wheel: "wheel",
  tire: "tire",
};

export const verifyPolicy = task(
  { name: "verify_policy" },
  async function verifyPolicy(phone: string): Promise<Record<string, unknown>> {
    await wait(2000);
    const policyId = `POL-${phone.slice(-4)}-${String(Math.abs(hashCode(phone)) % 10000).padStart(4, "0")}`;

    let loyalty = "Standard";
    let claims = 0;
    if (phone.includes("0100")) {
      loyalty = "Gold";
      claims = 0;
    } else if (phone.includes("0200")) {
      claims = 4;
    } else if (phone.includes("0300")) {
      loyalty = "Platinum";
      claims = 1;
    } else if (phone.includes("0400")) {
      claims = 2;
    }

    return {
      policy_id: policyId,
      phone,
      name: "Valued Customer",
      status: "active",
      coverage: { collision: 50000, deductible: 500 },
      loyalty_tier: loyalty,
      previous_claims: claims,
    };
  }
);

export const analyzeDamage = task(
  { name: "analyze_damage" },
  async function analyzeDamage(description: string): Promise<Record<string, unknown>> {
    await wait(8000);
    const lower = description.toLowerCase();
    const parts: string[] = [];
    for (const [keyword, part] of Object.entries(PART_KEYWORDS)) {
      if (lower.includes(keyword) && !parts.includes(part)) {
        parts.push(part);
      }
    }
    if (!parts.length) {
      parts.push("unspecified_damage");
    }
    const severity = parts.length >= 4 ? "severe" : parts.length >= 2 ? "moderate" : "minor";
    return {
      severity,
      parts,
      description,
      confidence: 0.85,
    };
  }
);

export const fraudCheck = task(
  { name: "fraud_check" },
  async function fraudCheck(claimId: string): Promise<Record<string, unknown>> {
    await wait(5000);
    return {
      claim_id: claimId,
      score: 12,
      risk: "low",
      flags: [],
      risk_score: 0.12,
      passed: true,
    };
  }
);

export const generateEstimate = task(
  { name: "generate_estimate" },
  async function generateEstimate(_damage: Record<string, unknown>): Promise<Record<string, unknown>> {
    await wait(6000);
    return {
      total: 2347.0,
      deductible: 500.0,
      customer_owes: 500.0,
      insurance_pays: 1847.0,
      breakdown: {
        rear_bumper: 850.0,
        trunk_repair: 1200.0,
        tail_light: 297.0,
      },
      labor: 700.0,
    };
  }
);

export const findShops = task(
  { name: "find_shops" },
  async function findShops(zipCode: string): Promise<Array<Record<string, unknown>>> {
    await wait(4000);
    return [
      { name: "AutoFix Pro", address: `123 Main St, ${zipCode}`, zip_code: zipCode, distance: "1.2 mi", rating: 4.8, wait_days: 3 },
      { name: "CarCare Center", address: `456 Oak Ave, ${zipCode}`, zip_code: zipCode, distance: "2.5 mi", rating: 4.6, wait_days: 2 },
      { name: "Bay Auto Body", address: `789 Elm St, ${zipCode}`, zip_code: zipCode, distance: "3.1 mi", rating: 4.9, wait_days: 5 },
    ];
  }
);

export const sendNotification = task(
  { name: "send_notification" },
  async function sendNotification(
    _claimId: string,
    _results: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    await wait(3000);
    return { email_sent: true, sms_sent: true };
  }
);

export const processClaim = task(
  { name: "process_claim" },
  async function processClaim(claimId: string, claimData: Record<string, string>): Promise<Record<string, unknown>> {
    const policy = await verifyPolicy(claimData.phone);
    const [damage, fraud] = await Promise.all([analyzeDamage(claimData.damage), fraudCheck(claimId)]);
    const estimate = await generateEstimate(damage);
    const shops = await findShops(claimData.zip);
    await sendNotification(claimId, { policy, damage, fraud, estimate, shops });

    return {
      claim_id: claimId,
      status: "approved",
      policy,
      damage,
      fraud,
      estimate,
      shops,
    };
  }
);

const SYSTEM_PROMPT = `You are Alex, a friendly and empathetic customer support agent at SafeDrive Insurance.
You help customers file auto insurance claims after accidents.

Your personality:
- Warm and reassuring - accidents are stressful
- Professional but not robotic
- Patient - ask for ONE piece of information at a time

CRITICAL RULES:
1. Ask for ONE piece of information at a time
2. Wait for the customer to respond before asking the next question
3. USE customer info to personalize your responses
4. Keep responses SHORT - this is a phone call
5. NEVER use markdown (no asterisks, bold, etc.) - this is spoken audio
6. Speak numbers naturally
7. ALWAYS respond with spoken text, even when calling tools - acknowledge what they said and ask the next question

Follow this EXACT flow:

1. If safety not confirmed: Ask "Are you and everyone involved safe?"

2. If no phone: Ask "Can I get the phone number on your account?"
   - If customer info is available, greet them by name and confirm their vehicle

3. If no location: Ask "Where did the accident happen?"

4. If no damage description: Ask "Can you describe the damage to your vehicle?"
   - Reference their vehicle make/model if known
   - Say "I'm analyzing that now" after they describe it

5. If no ZIP code: Ask "What's your ZIP code? I'll find repair shops near you."
   - Say "Looking for shops in your area" after they give it

6. If no other party info: Ask "Were any other vehicles involved?"

7. After ALL info collected, summarize and confirm the claim is being processed.

Guidelines:
- NEVER ask multiple questions at once
- USE the customer's first name after looking them up
- If customer is Platinum/Gold tier, acknowledge their loyalty`;

const CONVERSATION_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "save_safety_status",
      description: "Save that safety has been confirmed",
      parameters: {
        type: "object",
        properties: {
          confirmed: { type: "boolean", description: "Whether safety was confirmed" },
        },
        required: ["confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_phone_number",
      description: "Save the customer's phone number",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "The customer's phone number" },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_accident_location",
      description: "Save the accident location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "The accident location" },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_damage_description",
      description: "Save the damage description",
      parameters: {
        type: "object",
        properties: {
          damage: { type: "string", description: "Description of the vehicle damage" },
        },
        required: ["damage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_zip_code",
      description: "Save the ZIP code",
      parameters: {
        type: "object",
        properties: {
          zip_code: { type: "string", description: "The customer's ZIP code" },
        },
        required: ["zip_code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_other_party_info",
      description: "Save information about other vehicles/parties involved",
      parameters: {
        type: "object",
        properties: {
          involved: { type: "boolean", description: "Whether other vehicles/parties were involved" },
          info: { type: "string", description: "Details about other parties if involved" },
        },
        required: ["involved"],
      },
    },
  },
];

type ConversationInput = {
  transcript: string;
  sessionState: {
    roomId: string;
    collected: Record<string, string>;
    profile?: Record<string, unknown> | null;
  };
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
};

export const conversation = task(
  { name: "conversation" },
  async function conversation(inputData: ConversationInput): Promise<Record<string, unknown>> {
    const transcript = inputData.transcript;
    const sessionState = inputData.sessionState;
    const history = inputData.conversationHistory;

    const collectedInfo = Object.entries(sessionState.collected ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");

    const profile = sessionState.profile ?? null;
    const profileContext = profile
      ? `Customer: ${profile.first_name ?? ""} ${profile.name ?? ""}, ${profile.loyalty_tier ?? "Standard"} member, Vehicle: ${
          profile.vehicle ?? "unknown"
        }`
      : "Customer not yet identified";

    const contextualPrompt = `${SYSTEM_PROMPT}\n\nCURRENT SESSION STATE:\n- Collected information: ${
      collectedInfo || "none yet"
    }\n- ${profileContext}`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: contextualPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: transcript },
    ];

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: CONVERSATION_TOOLS,
      tool_choice: "auto",
    });

    const choice = response.choices[0]?.message;
    const extractedFields: Array<{ field: string; value: string }> = [];
    const triggeredTasks: string[] = [];

    for (const call of choice?.tool_calls ?? []) {
      const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      switch (call.function.name) {
        case "save_safety_status":
          extractedFields.push({ field: "safety_confirmed", value: args.confirmed ? "yes" : "no" });
          break;
        case "save_phone_number":
          extractedFields.push({ field: "phone", value: String(args.phone ?? "") });
          triggeredTasks.push("verify_policy");
          break;
        case "save_accident_location":
          extractedFields.push({ field: "location", value: String(args.location ?? "") });
          break;
        case "save_damage_description":
          extractedFields.push({ field: "damage", value: String(args.damage ?? "") });
          triggeredTasks.push("analyze_damage");
          break;
        case "save_zip_code":
          extractedFields.push({ field: "zip", value: String(args.zip_code ?? "") });
          triggeredTasks.push("find_shops");
          break;
        case "save_other_party_info":
          extractedFields.push({
            field: "other_party",
            value: args.involved ? String(args.info ?? "yes") : "none",
          });
          break;
      }
    }

    const collected = { ...(sessionState.collected ?? {}) };
    for (const field of extractedFields) {
      collected[field.field] = field.value;
    }
    if (collected.phone && collected.damage && !triggeredTasks.includes("fraud_check")) {
      triggeredTasks.push("fraud_check");
    }

    let responseText = choice?.content ?? "";
    if (!responseText && extractedFields.length) {
      if (!collected.phone) {
        responseText = "Great, I'm glad everyone is safe. Can I get the phone number on your account?";
      } else if (!collected.location) {
        responseText = "Thanks for that. Where did the accident happen?";
      } else if (!collected.damage) {
        responseText = "Got it. Can you describe the damage to your vehicle?";
      } else if (!collected.zip) {
        responseText = "I'm analyzing that now. What's your ZIP code? I'll find repair shops near you.";
      } else if (!collected.other_party) {
        responseText = "Looking for shops in your area. Were any other vehicles involved?";
      } else {
        responseText =
          "Perfect, I have all the information I need. Your claim is being processed and you'll receive a confirmation shortly.";
      }
    }

    return {
      responseText,
      extractedFields,
      triggeredTasks,
    };
  }
);

export const generateGreeting = task(
  { name: "generate_greeting" },
  async function generateGreeting(): Promise<Record<string, unknown>> {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Generate a brief warm greeting. Introduce yourself as Alex from SafeDrive Insurance and ask if everyone involved is safe. Keep it under 30 words.",
        },
      ],
    });

    return { responseText: response.choices[0]?.message?.content ?? "Hi, this is Alex from SafeDrive Insurance. Is everyone safe?" };
  }
);
