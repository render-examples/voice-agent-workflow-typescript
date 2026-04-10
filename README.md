# Insurance Claim Voice AI Demo

A demo showcasing [Render Workflows](https://docs.render.com/workflows) with a voice AI insurance claim scenario. Customers talk to an AI agent via [LiveKit](https://livekit.io/), and background workflow tasks process the claim in real time.

## How it works

1. **Customer starts a call** — connects to a LiveKit voice AI agent through the browser.
2. **Agent collects info** — phone number, location, damage description, zip code.
3. **Call ends** — the API triggers `process_claim`, the orchestrator workflow task.
4. **Background processing** — subtasks run (some in parallel), and progress updates appear in the UI:
   - Verify policy
   - Analyze damage + fraud check (parallel)
   - Generate estimate
   - Find repair shops
   - Send confirmation
5. **Results displayed** — claim details, estimate, and repair shop recommendations.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend      │────▶│   API Server    │────▶│   Render        │
│  React + Vite   │     │  Express (TS)    │     │   Workflows     │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │                       ▲
         │              ┌────────┴────────┐
         └─────────────▶│  LiveKit Agent  │
            (LiveKit)   │  Voice AI       │
                        └─────────────────┘
```

| Service | Description |
|---------|-------------|
| **Frontend** | React app with LiveKit client SDK for voice calls and real-time task progress |
| **API** | TypeScript Express server that issues LiveKit tokens, manages sessions, and triggers workflow tasks via the Render SDK |
| **Agent** | LiveKit Agents worker that handles voice conversations using OpenAI (GPT-4o for LLM, Whisper for STT, TTS for speech) |
| **Workflows** | Render Workflows service with TypeScript `task()` definitions for each claim processing step |

## Prerequisites

- A [Render](https://render.com/) account
- A [LiveKit Cloud](https://cloud.livekit.io/) project
- An [OpenAI](https://platform.openai.com/) API key

### Set up LiveKit Cloud

1. Sign in to [LiveKit Cloud](https://cloud.livekit.io/).
2. Create a new project (or use an existing one).
3. Go to **Settings** > **Keys** and create a new API key pair.
4. Note the following values:
   - **LiveKit URL** — looks like `wss://your-project-id.livekit.cloud`
   - **API Key** — starts with `API`
   - **API Secret** — the corresponding secret
5. Under **Settings** > **Agents**, confirm that agent dispatch is enabled for your project.

## Deploy to Render

### One-click deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

### Manual deploy

1. Fork or push this repo to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com/), switch to your dedicated workspace and click **New** > **Blueprint**.
3. Connect your GitHub repo — Render creates the frontend, API, agent, and workflow services from `render.yaml`.
4. Verify service names:
   - `voice-agent-ts-frontend`
   - `voice-agent-ts-api`
   - `voice-agent-ts-agent`

### Configure environment groups

The Blueprint references three environment groups. Create them in the Render Dashboard under **Environment Groups**:

| Group | Variables | Where to get them |
|-------|-----------|-------------------|
| `livekit-config` | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit Cloud dashboard (see [Set up LiveKit Cloud](#set-up-livekit-cloud)) |
| `render-config` | `RENDER_API_KEY`, `WORKFLOW_SERVICE_ID` | [Render API keys](https://dashboard.render.com/u/settings/api-keys) and the workflow service slug |
| `ai-config` | `OPENAI_API_KEY` | [OpenAI API keys](https://platform.openai.com/api-keys) |

`WORKFLOW_SERVICE_ID` is the slug of your Render Workflows service (visible in the Dashboard URL).

### Dedicated workspace checklist

Before finalizing deploy, confirm:

- You selected the intended Render workspace in the top-left workspace switcher.
- The three env groups (`livekit-config`, `render-config`, `ai-config`) exist in that same workspace.
- `WORKFLOW_SERVICE_ID` points to the workflow service in that same workspace (not another team/personal workspace).

## Local development

### Option A: Docker Compose (recommended)

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd voice-agent-workflow-typescript

# 2. Copy and configure environment variables
cp env.example .env
# Edit .env with your LiveKit, OpenAI, and Render API keys

# 3. Start the API, agent, and frontend
docker compose up

# 4. In a separate terminal, start the workflow dev server
# Requires Render CLI v2.12.0+ (`render --version`)
cd workflows
npm install
render workflows dev -- npm start

# 5. Open http://localhost:5173
```

### Option B: manual setup

#### 1. Configure environment variables

```bash
cp env.example .env
# Edit .env with your API keys.
# For local workflow simulation keep:
#   RENDER_USE_LOCAL_DEV=true
#   RENDER_LOCAL_DEV_URL=http://localhost:8120
```

#### 2. Start the API server

```bash
cd api
npm install
npm run dev
```

#### 3. Start the LiveKit agent

```bash
cd agent
npm install
npm run dev
```

#### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

#### 5. Start the workflow dev server

```bash
cd workflows
npm install
# Requires Render CLI v2.12.0+ (`render --version`)
render workflows dev -- npm start
```

Open http://localhost:5173 to run the demo.

## Project structure

```
voice-agent-workflow-typescript/
├── frontend/              # React app (Vite + Tailwind CSS)
│   ├── src/
│   │   ├── components/    # Call interface, claim progress UI
│   │   └── lib/api.ts     # API client
│   └── package.json
├── api/                   # TypeScript Express API
│   ├── src/index.ts       # Routes, session management, workflow triggers
│   └── package.json
├── agent/                 # LiveKit voice agent
│   ├── src/main.ts        # Agent with OpenAI STT/LLM/TTS
│   └── package.json
├── workflows/             # Render Workflows task definitions
│   ├── src/tasks.ts       # task() definitions
│   └── package.json
├── render.yaml            # Render Blueprint
├── docker-compose.yml     # Local dev orchestration
├── env.example            # Template for .env
└── README.md
```

## Workflow tasks

All tasks are defined in `workflows/src/tasks.ts` using the Render Workflows TypeScript SDK:

```typescript
import { task } from "@renderinc/sdk/workflows";

const verifyPolicy = task({ name: "verify_policy" }, async (phone: string) => {
  // Look up and verify the customer's policy
});

const processClaim = task(
  { name: "process_claim" },
  async (policyNumber: string, vehicleDetails: Record<string, unknown>) => {
    // Orchestrate subtasks, some in parallel
    const policy = await verifyPolicy(policyNumber);
    await Promise.all([analyzeDamage(vehicleDetails), fraudCheck(policyNumber)]);
    return policy;
  }
);
```

The `process_claim` task orchestrates all subtasks, running independent steps in parallel with `Promise.all`.

## Parity with Python template

This TypeScript template preserves the Python template's behavior:

- Same API routes and payload contracts (`/api/token`, `/api/claims`, `/api/session/*`, `/api/customer/lookup/*`, `/api/demo/profiles`, `/api/debug/workflow-test`).
- Same voice websocket flow at `/ws/voice` (`start_session`, transcript updates, background task triggers, TTS audio responses).
- Same workflow task set and orchestration order (`verify_policy`, `analyze_damage`, `fraud_check`, `generate_estimate`, `find_shops`, `send_notification`, `process_claim`, `conversation`, `generate_greeting`).
- Same demo customer profiles and scenario metadata.

## Technologies

- **Frontend**: React, Vite, Tailwind CSS, LiveKit React SDK
- **API**: TypeScript, Express, Render SDK
- **Voice AI**: LiveKit Agents, OpenAI GPT-4o, OpenAI TTS/STT
- **Workflows**: Render Workflows (`@renderinc/sdk`)

## License

MIT
