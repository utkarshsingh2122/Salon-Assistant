// api/src/kb.js
// Minimal Q&A KB with question-matching retrieval.
// Stores { id, question, answer, created_at, updated_at } in db.kb

import { readDB, push, update } from './db.js';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('1234567890abcdef', 10);

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

/**
 * Return top K KB answers whose QUESTIONS are similar to the query.
 * Each result: { id, question, answer, score, text: answer }
 */
export function retrieveTopK(query, k = 3, minScore = 0.5) {
  const db = readDB();
  const kb = db.kb || [];
  const qTok = tokenize(query);
  const scored = kb.map(item => {
    const score = jaccard(qTok, tokenize(item.question || ""));
    return { id: item.id, question: item.question, answer: item.answer, score, text: item.answer };
  })
  .filter(r => r.score >= minScore)
  .sort((a, b) => b.score - a.score)
  .slice(0, k);

  return scored;
}

/**
 * Upsert a Q&A into the KB.
 * If an existing question is almost the same (>= 0.9), update that entry.
 */
export async function learnFromAnswer({ help_request_id, question, answer }) {
  const db = readDB();
  if (!db.kb) db.kb = [];

  const qTok = tokenize(question);
  let best = null, bestScore = 0;
  for (const it of db.kb) {
    const s = jaccard(qTok, tokenize(it.question || ""));
    if (s > bestScore) { bestScore = s; best = it; }
  }

  const now = new Date().toISOString();
  if (best && bestScore >= 0.9) {
    update('kb', best.id, {
      question,
      answer,
      updated_at: now,
      last_help_request_id: help_request_id || null,
    });
    return { upsertedId: best.id, updated: true, score: bestScore };
  } else {
    const rec = {
      id: `kb_${nanoid()}`,
      question,
      answer,
      created_at: now,
      updated_at: now,
      last_help_request_id: help_request_id || null,
    };
    push('kb', rec);
    return { upsertedId: rec.id, created: true };
  }
}
