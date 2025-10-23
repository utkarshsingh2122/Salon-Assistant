// api/src/llm_gemini.js
import { GoogleGenAI } from "@google/genai";

/** ------ lazy client so .env is loaded first (Option B) ------ */
let _ai = null;
function getAi() {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!_ai) {
    if (!GEMINI_API_KEY) {
      console.error("[LLM] Missing GEMINI_API_KEY. Set it in .env or hosting env.");
    } else {
      console.log("[LLM] init (lazy)", { hasKey: !!GEMINI_API_KEY, model: GEMINI_MODEL });
    }
    _ai = { client: new GoogleGenAI({ apiKey: GEMINI_API_KEY }), model: GEMINI_MODEL };
  } else {
    _ai.model = GEMINI_MODEL;
  }
  return _ai;
}

/** utils **/
const hasText = (s) => !!(s && String(s).trim().length);
function scoreConfidence(text) {
  if (!text) return 0;
  const low = /(not sure|unsure|can't|cannot|no information|don't know)/i.test(text);
  const len = text.split(/\s+/).length;
  const base = Math.min(1, len / 12);
  return Math.max(0, low ? base * 0.3 : base);
}

/**
 * Strict KB-only answering (used rarely now; still available).
 * If not fully contained, respond EXACTLY: "I don't know"
 */
export async function answerWithGemini({ question, kbContext = "" }) {
  if (process.env.LLM_ENABLED === "false") {
    console.log("[LLM] answerWithGemini: LLM disabled via env");
    return { ok: false, reason: "disabled" };
  }
  const { client, model } = getAi();
  console.log("[LLM] answerWithGemini:start", {
    model,
    questionPreview: String(question || "").slice(0, 120),
    kbBytes: Buffer.from(kbContext || "", "utf8").length,
  });

  const contents = [
    "You are “Assistant Adam,” a strictly grounded agent.",
    "You may ONLY answer using facts found in the kb_context below.",
    "If the answer is not fully contained in kb_context, reply EXACTLY: I don't know",
    "Keep responses concise.",
    "",
    "User question:",
    question,
    "",
    "kb_context:",
    hasText(kbContext) ? kbContext : "(empty)",
  ].join("\n");

  try {
    const t0 = Date.now();
    const response = await client.models.generateContent({ model, contents });
    const raw = (response?.text || "").trim();
    console.log("[LLM] answerWithGemini:raw", { ms: Date.now() - t0, rawPreview: raw.slice(0, 200) });

    let text = raw;
    const grounded = hasText(kbContext);
    if (!grounded || !/\S/.test(text)) text = "I don't know";
    const confidence = scoreConfidence(text);
    console.log("[LLM] answerWithGemini:final", { textPreview: text.slice(0, 200), confidence });
    return { ok: true, text, confidence };
  } catch (e) {
    console.error("[LLM] answerWithGemini:error", e?.message || e);
    return { ok: false, reason: "gemini_error", details: String(e?.message || e) };
  }
}

/**
 * Conversational answer given a canonical KB answer.
 * - Use kbAnswer as the ONLY factual source.
 * - Talk like a human (brief, warm, directly answering the question).
 * - No new facts; do not contradict kbAnswer.
 */
export async function answerConversational({ question, kbAnswer, tone = "friendly, concise" }) {
  if (process.env.LLM_ENABLED === "false") {
    console.log("[LLM] answerConversational: LLM disabled via env");
    return { ok: false, reason: "disabled" };
  }
  const { client, model } = getAi();
  console.log("[LLM] answerConversational:start", {
    model,
    questionPreview: String(question || "").slice(0, 120),
    kbLen: (kbAnswer || "").length
  });

  const contents = [
    `You are “Assistant Adam,” a ${tone} agent.`,
    "You must answer using ONLY the facts in kb_answer below.",
    "Sound conversational and natural (not a copy-paste).",
    "Answer directly and keep it short unless the question needs steps.",
    "",
    "question:",
    String(question || "").trim(),
    "",
    "kb_answer:",
    String(kbAnswer || "").trim() || "(empty)",
  ].join("\n");

  try {
    const t0 = Date.now();
    const response = await client.models.generateContent({ model, contents });
    const text = (response?.text || "").trim();
    console.log("[LLM] answerConversational:final", { ms: Date.now() - t0, textPreview: text.slice(0, 200) });
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text, confidence: scoreConfidence(text) };
  } catch (e) {
    console.error("[LLM] answerConversational:error", e?.message || e);
    return { ok: false, reason: "gemini_error", details: String(e?.message || e) };
  }
}

/**
 * Small-talk (greetings/acknowledgements).
 */
export async function answerSmallTalk({ prompt }) {
  if (process.env.LLM_ENABLED === "false") {
    console.log("[LLM] answerSmallTalk: LLM disabled via env");
    return { ok: false, reason: "disabled" };
  }
  const { client, model } = getAi();
  const p = String(prompt || "").trim();
  const contents = [
    "You are “Assistant Adam,” a friendly receptionist for a business.",
    "You may answer general chit-chat (greetings, pleasantries, acknowledgements).",
    "Keep responses warm, brief, and professional.",
    "Avoid inventing business facts.",
    "",
    "Message:",
    p,
  ].join("\n");

  try {
    const t0 = Date.now();
    const response = await client.models.generateContent({ model, contents });
    const text = (response?.text || "Hello! How can I help you today?").trim();
    console.log("[LLM] answerSmallTalk:final", { ms: Date.now() - t0, textPreview: text.slice(0, 200) });
    return { ok: true, text, confidence: scoreConfidence(text) };
  } catch (e) {
    console.error("[LLM] answerSmallTalk:error", e?.message || e);
    return { ok: false, reason: "gemini_error", details: String(e?.message || e) };
  }
}
