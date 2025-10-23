import express from 'express';
import { customAlphabet } from 'nanoid';

import { readDB, push, update, listMessages, resetDB, writeDB } from './db.js';
import { retrieveTopK, learnFromAnswer } from './kb.js';
import { createDevToken } from './livekit.js';
import { answerSmallTalk, answerConversational } from './llm_gemini.js';

const nanoid = customAlphabet('1234567890abcdef', 10);
export const router = express.Router();

const HOLD_MESSAGE =
  "Thanks for your question—please hold for a moment while I check with a specialist. I’ll be right back.";

/* -------------------- Health -------------------- */
router.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* -------------- Conversations CRUD --------------- */
router.post('/conversations', (req, res) => {
  const now = new Date();
  const id = `conv_${nanoid()}`;
  const title = (req.body?.title || '').trim() || null;
  const conv = { id, started_at: now.toISOString(), ended_at: null, title };
  push('conversations', conv);
  res.json(conv);
});

/* NEW: fetch a single conversation by id (used by transcript page) */
router.get('/conversations/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const conv = (db.conversations || []).find(c => c.id === id);
  if (!conv) return res.status(404).json({ error: 'not_found' });
  res.json(conv);
});

router.patch('/conversations/:id', (req, res) => {
  const { id } = req.params;
  const patch = {};
  if ('title' in req.body) patch.title = (req.body.title || '').trim() || null;
  const conv = update('conversations', id, patch);
  if (!conv) return res.status(404).json({ error: 'not_found' });
  res.json(conv);
});

router.patch('/conversations/:id/end', (req, res) => {
  const { id } = req.params;
  const conv = update('conversations', id, { ended_at: new Date().toISOString() });
  res.json(conv || { error: 'not_found' });
});

router.get('/conversations', (req, res) => {
  const db = readDB();
  const list = (db.conversations || []).sort((a,b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  res.json({ conversations: list });
});

router.get('/conversations/:id/messages', (req, res) => {
  const { id } = req.params;
  const { since } = req.query;
  const msgs = listMessages(id, since);
  res.json({ messages: msgs });
});

/* ---------------- Help Requests (Admin) ----------- */
router.get('/help-requests', (req, res) => {
  const db = readDB();
  const hrs = (db.help_requests || []).sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  res.json({ help_requests: hrs });
});
router.get('/help-requests/:id', (req, res) => {
  const { id } = req.params;
  const hr = (readDB().help_requests || []).find(h => h.id === id);
  if (!hr) return res.status(404).json({ error: 'not_found' });
  res.json(hr);
});

/* ------------- Small-talk detector ---------------- */
function looksLikeSmallTalk(u) {
  const s = (u || '').trim().toLowerCase();
  if (!s) return false;
  const greet = /\b(hi|hello|hey|good (morning|afternoon|evening)|namaste)\b/.test(s);
  const ack   = /\b(thanks|thank you|ok|okay|great|cool|awesome)\b/.test(s);
  const filler= /^hi[, ]? this is\b/.test(s);
  return greet || ack || filler || s.length <= 24;
}

/* --------------- Answer or Escalate ---------------- */
router.post('/answer-or-escalate', async (req, res) => {
  const { conversationId = 'conv_demo', utterance } = req.body || {};
  if (!utterance) return res.status(400).json({ error: 'missing utterance' });

  const now = new Date();
  push('messages', { id:`msg_${nanoid()}`, conversation_id: conversationId, role:'user', content: utterance, created_at: now.toISOString() });

  // auto-title if none (fallback)
  const db = readDB();
  const conv = (db.conversations || []).find(c => c.id === conversationId);
  if (conv && !conv.title) update('conversations', conversationId, { title: utterance.slice(0, 60) });

  // small talk
  if (looksLikeSmallTalk(utterance)) {
    const st = await answerSmallTalk({ prompt: utterance });
    const text = (st?.ok && st.text) ? st.text.trim() : "Hi! How can I help you today?";
    const aMsg = push('messages', { id:`msg_${nanoid()}`, conversation_id: conversationId, role:'assistant', content: text, created_at: new Date().toISOString() });
    return res.json({ reply: text, onHold: false, source: 'small_talk', assistantMsg: { id:aMsg.id, created_at:aMsg.created_at } });
  }

  // Q->A retrieval (match question; use answer)
  const top = retrieveTopK(utterance, 1, 0.60);
  if (top && top.length) {
    const best = top[0];
    const llm = await answerConversational({ question: utterance, kbAnswer: best.answer });
    const reply = (llm?.ok && llm.text) ? llm.text.trim() : (best.answer || "I don't know");
    const aMsg = push('messages', { id:`msg_${nanoid()}`, conversation_id: conversationId, role:'assistant', content: reply, created_at: new Date().toISOString() });
    return res.json({ reply, onHold:false, source:'kb_qna', assistantMsg:{ id:aMsg.id, created_at:aMsg.created_at } });
  }

  // No KB -> escalate, show hold
  const help = push('help_requests', {
    id:`hr_${nanoid()}`, conversation_id: conversationId, question: utterance,
    status:'pending', created_at: now.toISOString(), updated_at: now.toISOString(),
    timeout_at: new Date(now.getTime()+15*60*1000).toISOString(), tags:[]
  });
  const aMsg = push('messages', { id:`msg_${nanoid()}`, conversation_id: conversationId, role:'assistant', content: "I don't know", created_at: new Date().toISOString(), help_request_id: help.id });
  // UI suppresses "I don't know" and shows HOLD line locally; still return a tame reply to speak:
  return res.json({ reply: "Thanks for your question—please hold for a moment while I check with a specialist. I’ll be right back.",
                    onHold: true, help_request: help, source:'no_kb',
                    assistantMsg:{ id:aMsg.id, created_at:aMsg.created_at } });
});

/* --------------- Resolve (learn + reply) ------------- */
router.post('/help-requests/:id/resolve', async (req, res) => {
  const { id } = req.params;
  const { answer, supervisorId = 'supervisor_demo' } = req.body || {};
  if (!answer) return res.status(400).json({ error: 'missing answer' });

  const hr = readDB().help_requests.find(h => h.id === id);
  if (!hr) return res.status(404).json({ error: 'help_request not found' });

  update('help_requests', id, { status:'resolved', updated_at:new Date().toISOString(), supervisor_id:supervisorId });

  // internal log
  push('messages', { id:`msg_${nanoid()}`, conversation_id: hr.conversation_id, role:'supervisor', content: answer, created_at: new Date().toISOString(), help_request_id:id });

  // learn Q&A
  await learnFromAnswer({ help_request_id:id, question:hr.question, answer });

  // respond conversationally using ONLY the agent's answer
  const llm = await answerConversational({ question: hr.question, kbAnswer: answer });
  const finalText = (llm?.ok && llm.text) ? llm.text.trim() : answer;

  const aMsg = push('messages', { id:`msg_${nanoid()}`, conversation_id: hr.conversation_id, role:'assistant', content: finalText, created_at: new Date().toISOString(), help_request_id:id });
  res.json({ ok:true, reply: finalText, assistantMsg:{ id:aMsg.id, created_at:aMsg.created_at } });
});

/* ----------------- Admin: reset & seed ---------------- */
// POST /admin/reset  -> clears db.json fully
router.post('/admin/reset', (req, res) => {
  const after = resetDB();
  res.json({ ok:true, cleared:true, state: after });
});

// POST /admin/seed-kb  { items: [{question, answer}, ...] }
// Resets KB only (optionally clears all if all=true)
router.post('/admin/seed-kb', (req, res) => {
  const { items = [], all = false } = req.body || {};
  let db = readDB();
  if (all) db = { conversations: [], messages: [], help_requests: [], kb: [] };
  db.kb = (items || []).map((it, i) => ({
    id: `kb_seed_${i+1}`,
    question: String(it.question || '').trim(),
    answer: String(it.answer || '').trim(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_help_request_id: null,
  }));
  writeDB(db);
  res.json({ ok:true, kb_count: db.kb.length });
});

/* --------------- Transcript & LiveKit ----------------- */
router.get('/transcripts/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const msgs = listMessages(conversationId);
  res.json({ conversationId, messages: msgs });
});

router.get('/livekit/token', async (req, res) => {
  const identity = req.query.identity || 'agent-' + nanoid();
  const room = process.env.LIVEKIT_ROOM || 'demo-room';
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) return res.status(500).json({ error: 'LIVEKIT_API_KEY/SECRET not set' });

  try {
    const token = await createDevToken({ apiKey, apiSecret, identity, room });
    res.json({ token, wsUrl: process.env.LIVEKIT_WS_URL, room, identity });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
