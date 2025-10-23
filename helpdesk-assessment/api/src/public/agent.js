// api/src/public/agent.js
const feed = document.getElementById('feed');
const textInput = document.getElementById('text');
const sendBtn = document.getElementById('send');
const holdIndicator = document.getElementById('hold-indicator');
const callToggle = document.getElementById('call-toggle');
const micToggle = document.getElementById('mic-toggle');
const statusEl = document.getElementById('status');

let conversationId = null;
let inCall = false;
let lastPollISO = null;
let pollTimer = null;

// LiveKit
let lk = null;
let room = null;
let micActive = false;

// De-dup of rendered assistant/supervisor messages
const renderedIds = new Set();

// Content-based de-dup for assistant in case IDs mismatch
let lastAssistantNorm = "";
let lastAssistantAt = 0;
const ASSISTANT_DEDUP_WINDOW = 3000; // ms

/* ---------------- Utils ---------------- */
function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isIdk(s) { return /^\s*i\s*don'?t\s*know\s*$/i.test(String(s || '')); }

/* ---------------- TTS ------------------ */
function speak(text) {
  if (!window.speechSynthesis || !text) return;
  try { speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch {}
}

/* ---------------- UI helpers ----------- */
function appendMessage(role, text, id=null, created_at=null) {
  if (id && renderedIds.has(id)) return;

  // content-based safeguard for assistant only
  if (role === 'assistant') {
    const now = Date.now();
    const norm = normalizeText(text);
    if (norm && norm === lastAssistantNorm && (now - lastAssistantAt) < ASSISTANT_DEDUP_WINDOW) {
      console.log('[Agent] assistant content dedup skipped');
      return;
    }
    lastAssistantNorm = norm;
    lastAssistantAt = now;
  }

  const div = document.createElement('div');
  div.className = `bubble ${role}`;
  div.textContent = text;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  if (id) renderedIds.add(id);
  if (created_at) {
    // advance watermark to avoid polling the same message again
    if (!lastPollISO || Date.parse(created_at) > Date.parse(lastPollISO)) {
      lastPollISO = created_at;
    }
  }
}

function showHoldUI(on) {
  holdIndicator.style.display = on ? 'block' : 'none';
  statusEl.textContent = on ? 'on hold (waiting for supervisor)…' : (inCall ? 'live' : 'idle');
}

/* ---------------- Poll ------------------ */
async function pollNewMessages() {
  if (!conversationId) return;
  try {
    const url = lastPollISO
      ? `/conversations/${conversationId}/messages?since=${encodeURIComponent(lastPollISO)}`
      : `/conversations/${conversationId}/messages`;
    const res = await fetch(url);
    const data = await res.json();
    const msgs = data.messages || [];
    if (msgs.length) {
      for (const m of msgs) {
        if (renderedIds.has(m.id)) continue;

        if (m.role === 'assistant') {
          // Never show raw "I don't know" – keep hold
          if (isIdk(m.content)) {
            console.log('[Agent] suppressed IDK assistant msg', m.id);
            showHoldUI(true);
            continue;
          }
          appendMessage('assistant', m.content, m.id, m.created_at);
          showHoldUI(false);
          speak(m.content);
        }

        // IMPORTANT: do NOT render supervisor messages on customer UI
        // else if (m.role === 'supervisor') { /* hidden from user */ }
      }
      const last = msgs[msgs.length - 1];
      if (last) lastPollISO = last.created_at;
    }
  } catch (e) {
    console.warn('[Agent] poll failed', e);
  }
}

/* --------------- Session helpers ------- */
const nameInput = document.getElementById('session-name');
// ...

async function ensureSession() {
  if (conversationId) return;
  // send optional title on create
  const title = (nameInput?.value || '').trim();
  const r = await fetch('/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(title ? { title } : {})
  });
  const conv = await r.json();
  conversationId = conv.id;
  lastPollISO = new Date().toISOString();

  // if no title at creation but user enters later, let them rename
  if (!conv.title && title) {
    await fetch(`/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
  }
  if (!pollTimer) pollTimer = setInterval(pollNewMessages, 2000);
}

/* --------------- LLM turn -------------- */
async function sendToAssistant(text) {
  await ensureSession();
  appendMessage('user', text);

  const res = await fetch('/answer-or-escalate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, utterance: text }),
  });
  const data = await res.json();
  console.log('[Agent] /answer-or-escalate ->', data);

  if (data?.assistantMsg && data.reply) {
    // Suppress "I don't know" on UI; show HOLD state instead
    if (isIdk(data.reply)) {
      showHoldUI(true);
      // move watermark past this message so poll won't re-render it
      if (data.assistantMsg.created_at) lastPollISO = data.assistantMsg.created_at;
    } else {
      const { id, created_at } = data.assistantMsg;
      appendMessage('assistant', data.reply, id, created_at);
      speak(data.reply);
    }
  }
  if (data?.onHold) {
    showHoldUI(true);
  }
}

/* --------------- Text chat ------------- */
sendBtn?.addEventListener('click', async () => {
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = '';
  await sendToAssistant(text);
});

/* --------------- LiveKit --------------- */
async function connectLiveKit() {
  try {
    if (!lk) lk = await window.requireLiveKit();
    const tokenRes = await fetch(`/livekit/token?identity=cust_${Math.random().toString(36).slice(2,6)}`);
    const tok = await tokenRes.json();
    room = new lk.Room();
    await room.connect(tok.wsUrl, tok.token);
    console.log('[Agent] LiveKit connected', room.name);
    await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    room.on(lk.RoomEvent.Disconnected, () => console.log('[Agent] LiveKit disconnected'));
  } catch (e) {
    console.warn('[Agent] LiveKit connect failed:', e);
  }
}
async function publishMicWhileHeld(on) {
  if (!room) return;
  try {
    micActive = !!on;
    await room.localParticipant.setMicrophoneEnabled(!!on);
  } catch (e) {
    console.warn('[Agent] mic toggle failed', e);
  }
}

/* --------------- Push-to-talk STT ----- */
let rec = null;
let sttSupported = false;
try {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    rec = new SpeechRec();
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.continuous = false; // hold-to-speak
    sttSupported = true;
  }
} catch {}

function bindPushToTalk() {
  if (!sttSupported || !micToggle) {
    if (micToggle) {
      micToggle.disabled = true;
      micToggle.title = 'Browser STT not supported';
    }
    return;
  }
  let interim = '';
  let finalText = '';

  const startHold = async () => {
    if (!inCall) return;
    micToggle.setAttribute('aria-pressed', 'true');
    statusEl.textContent = 'listening…';
    interim = ''; finalText = '';
    await publishMicWhileHeld(true);
    try { rec.start(); } catch {}
  };
  const endHold = async () => {
    micToggle.setAttribute('aria-pressed', 'false');
    statusEl.textContent = inCall ? 'live' : 'idle';
    await publishMicWhileHeld(false);
    try { rec.stop(); } catch {}
  };

  micToggle.onmousedown = startHold;
  micToggle.onmouseup = endHold;
  micToggle.onmouseleave = () => { if (micActive) endHold(); };

  micToggle.ontouchstart = (e) => { e.preventDefault(); startHold(); };
  micToggle.ontouchend = (e) => { e.preventDefault(); endHold(); };
  micToggle.ontouchcancel = (e) => { e.preventDefault(); if (micActive) endHold(); };

  rec.onresult = async (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText = transcript.trim();
    }
  };
  rec.onend = async () => {
    const text = (finalText || interim || '').trim();
    interim = ''; finalText = '';
    if (text) await sendToAssistant(text);
  };
}

/* --------------- Call controls -------- */
callToggle?.addEventListener('click', async () => {
  inCall = !inCall;
  callToggle.textContent = inCall ? 'End Call' : 'Start Call';
  statusEl.textContent = inCall ? 'live' : 'idle';

  if (inCall) {
    await ensureSession();
    await connectLiveKit();
    micToggle.disabled = false;
    bindPushToTalk();
    if (!pollTimer) pollTimer = setInterval(pollNewMessages, 2000);
  } else {
    micToggle.disabled = true;
    micToggle.setAttribute('aria-pressed', 'false');
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (conversationId) {
      await fetch(`/conversations/${conversationId}/end`, { method: 'PATCH' });
    }
    if (room) {
      try { await room.disconnect(); } catch {}
      room = null;
    }
    showHoldUI(false);
    conversationId = null;
    renderedIds.clear();
    lastPollISO = null;
    lastAssistantNorm = ""; lastAssistantAt = 0;
  }
});
