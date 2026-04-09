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
│  React + Vite   │     │    FastAPI       │     │   Workflows     │
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
| **API** | FastAPI server that issues LiveKit tokens, manages sessions, and triggers workflow tasks via the Render SDK |
| **Agent** | LiveKit Agents worker that handles voice conversations using OpenAI (GPT-4o for LLM, Whisper for STT, TTS for speech) |
| **Workflows** | Render Workflows service with `@app.task` definitions for each claim processing step |

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
2. In the [Render Dashboard](https://dashboard.render.com/), switch to your dedicated workspace.
3. Click **New** > **Blueprint**.
4. Connect your GitHub repo and deploy from branch `deploy/ts-voice-agent-render-workspace`.
5. Render creates the frontend, API, and agent services from `render.yaml` with TS-specific service names:
   - `voice-agent-ts-frontend`
   - `voice-agent-ts-api`
   - `voice-agent-ts-agent`

### Configure environment groups

The Blueprint references three environment groups. Create them in the Render Dashboard under **Env Groups**:

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
cd voice-agent-workflow-public

# 2. Copy and configure environment variables
cp env.example .env
# Edit .env with your LiveKit, OpenAI, and Render API keys

# 3. Start the API, agent, and frontend
docker compose up

# 4. In a separate terminal, start the workflow dev server
cd workflows
pip install -r requirements.txt
render workflows dev -- python main.py

# 5. Open http://localhost:5173
```

### Option B: manual setup

#### 1. Configure environment variables

```bash
cp env.example .env
# Edit .env with your API keys
```

#### 2. Start the API server

```bash
cd api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

#### 3. Start the LiveKit agent

```bash
cd agent
pip install -r requirements.txt
python main.py dev
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
pip install -r requirements.txt
render workflows dev -- python main.py
```

Open http://localhost:5173 to run the demo.

## Project structure

```
voice-agent-workflow-public/
├── frontend/              # React app (Vite + Tailwind CSS)
│   ├── src/
│   │   ├── components/    # Call interface, claim progress UI
│   │   └── lib/api.ts     # API client
│   └── package.json
├── api/                   # FastAPI server
│   ├── main.py            # Routes, session management, workflow triggers
│   └── requirements.txt
├── agent/                 # LiveKit voice agent
│   ├── main.py            # Agent with OpenAI STT/LLM/TTS
│   └── requirements.txt
├── workflows/             # Render Workflows task definitions
│   ├── main.py            # @app.task definitions
│   └── requirements.txt
├── render.yaml            # Render Blueprint
├── docker-compose.yml     # Local dev orchestration
├── env.example            # Template for .env
└── README.md
```

## Workflow tasks

All tasks are defined in `workflows/main.py` using the Render Workflows Python SDK:

```python
from render_sdk.workflows import Workflows

app = Workflows()

@app.task
async def verify_policy(phone: str) -> dict:
    # Look up and verify the customer's policy
    ...

@app.task
async def process_claim(policy_number: str, vehicle_details: dict):
    # Orchestrate subtasks, some in parallel
    policy = await verify_policy(policy_number)
    await asyncio.gather(
        analyze_damage(vehicle_details),
        fraud_check(policy_number, vehicle_details),
    )
    ...
```

The `process_claim` task orchestrates all subtasks, running independent steps in parallel with `asyncio.gather`.

## Technologies

- **Frontend**: React, Vite, Tailwind CSS, LiveKit React SDK
- **API**: Python, FastAPI, Render SDK
- **Voice AI**: LiveKit Agents, OpenAI GPT-4o, OpenAI TTS/STT
- **Workflows**: Render Workflows (`render_sdk`)

## License

MIT
