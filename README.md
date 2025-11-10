# Salon-Assistant
AI receptionist that answers FAQs by voice. Unknown queries escalate to a human supervisor; their answer updates the knowledge base (KB) and the caller gets a follow-up. Built for the Frontdesk assessment with a working LiveKit voice demo (no chat fallback).

🧭 Overview

Voice In/Out: LiveKit captures the caller’s audio, streams it, and plays AI responses.

Agent API: /calls/ask answers from the KB or creates a pending help request.

Supervisor Console: simple web UI to resolve pending requests; resolution updates the KB and triggers a notification.

Persistence: SQLite for local dev (swap to Postgres easily).

🧱 Architecture
[Caller Mic] ⇄ LiveKit Room (Cloud) ⇄ Voice Client (Web) ──▶ Agent API (FastAPI)
                                                     │
                                                     └─▶ Supervisor Console (Web)
DB: SQLite (KB, HelpRequest, Notifications)

🗂️ Repo structure

Adjust if your folders differ—this is the expected shape.

/backend
  app/
    main.py
    routers/ (kb.py, requests.py, notifications.py)
    models.py, schemas.py, database.py
  requirements.txt

/frontend
  voice-client/  (LiveKit voice UI)
  supervisor/    (admin console UI)

/scripts        (ngrok/start helpers)
README.md

✅ Prerequisites

Python 3.10+

Node 18+ and npm or pnpm

A LiveKit Cloud project (free tier is fine)

Get: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET

(Optional) ngrok if you want to demo from a phone

⚙️ Configuration

Create a .env at the repo root (or inside /backend if your app loads from there):

# LiveKit
LIVEKIT_URL=wss://<your-livekit-subdomain>.livekit.cloud
LIVEKIT_API_KEY=<lk_api_key>
LIVEKIT_API_SECRET=<lk_api_secret>

# Backend
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
FRONTEND_ORIGIN=http://127.0.0.1:5173

# CORS (comma-separated)
ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173

# Notifications (simulated)
NOTIFY_CHANNEL=console


The backend exposes a /token endpoint to mint ephemeral LiveKit tokens for the browser client using the above LiveKit creds. Keep the secret server-side only.

🚀 Quickstart (TL;DR)
# 1) Backend
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 2) Voice client
cd ../frontend/voice-client
npm install
npm run dev    # opens http://127.0.0.1:5173

# 3) Supervisor console
cd ../supervisor
npm install
npm run dev    # opens http://127.0.0.1:5174  (or similar)
