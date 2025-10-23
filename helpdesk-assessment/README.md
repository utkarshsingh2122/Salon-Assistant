# HelpDesk Assessment – Reference Implementation (LiveKit + Simulated Escalations)

This repo gives you a **minimal, review-friendly** implementation of the assessment:
- Voice/“call” via **LiveKit** (local dev token) + a typed fallback
- AI agent checks a tiny **Knowledge Base (KB)**
- If unknown → creates a **Help Request**
- **Supervisor Admin** resolves it
- System follows up (simulated SMS/webhook) and **learns** into the KB
- **Timeout worker** marks stale Pending → Unresolved

> Focus is on code quality, data model, and lifecycle over polish.

## Tech
- **Backend**: Node + Express
- **DB**: simple JSON files (to keep it portable); switchable later
- **LiveKit**: server-side token endpoint + web client in `/agent.html`
- **UI**: ultra-minimal vanilla JS (served by Express)

---

## Quick Start

### 0) Prereqs
- Node 18+ and npm
- (Optional) Docker if you want to run via compose
- A **LiveKit Cloud** project OR a local LiveKit server
  - Get `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_WS_URL` (wss://...)

### 1) Configure
```bash
cp api/.env.example api/.env
# Edit api/.env with your LiveKit creds (or local server values)
```

### 2) Install & Run (no Docker)
```bash
cd api
npm install
npm run dev
```
- Backend runs at: `http://localhost:3000`
- Admin UI: `http://localhost:3000/` (Pending/Resolved/Unresolved, Learned Answers)
- Agent UI (LiveKit): `http://localhost:3000/agent.html`
  - Type a question in the text box to simulate STT
  - Click **Connect** to join a LiveKit room (publishes mic); voice pipeline is stubbed for demo

### 3) Docker (optional)
```bash
docker compose up --build
```
- Then open the same URLs as above.

### 4) Test Flow (Demo Script)
1. Open **Agent UI** → type a **known** question: “What are your hours?” → should answer immediately.
2. Ask an **unknown** question: “Do you have keratin treatment?” →
   - Agent says it will check supervisor; a **Pending** item appears on Admin UI.
3. Open **Admin UI** → Pending → open the item → submit answer.
   - Console shows **simulated SMS** to customer.
   - KB gets a new **Learned Answer**.
4. Back on Agent UI, ask the **same** unknown again → now answered instantly from KB.
5. (Optional) Let a Pending item sit past timeout (15 min by default, set smaller in `.env`) → see it move to **Unresolved**.

---

## Project Structure
```
helpdesk-assessment/
  api/
    src/
      server.js         # Express app, routes, timeout worker
      routes.js         # API endpoints
      db.js             # tiny JSON-file store
      kb.js             # KB search + learn
      livekit.js        # token creation for LiveKit
      public/
        index.html      # Admin UI
        admin.js
        agent.html      # Agent/Voice UI (LiveKit + typed fallback)
        agent.js
        styles.css
    package.json
    .env.example
  data/
    seed.json           # initial data (KB, customers)
  docker-compose.yml
  README.md
```

## Notes
- This is intentionally **small and readable**. Swap the JSON store for Firestore/Dynamo by replacing `db.js` and keeping the same service API.
- LiveKit voice path is **connected** (you join a room and publish mic). STT/LLM/TTS pipeline is **stubbed** to keep the assessment focused on escalation workflows.
- The `/agent` logic demonstrates **known vs unknown** and raises **help requests** from the agent.
