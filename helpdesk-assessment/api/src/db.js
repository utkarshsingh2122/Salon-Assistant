// Simple JSON file "database"
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'db.json');

function emptyState() {
  return {
    conversations: [],
    messages: [],
    help_requests: [],
    kb: [],
  };
}

export function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const init = emptyState();
      fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
      return init;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    console.error('[DB] read error', e);
    return emptyState();
  }
}

export function writeDB(obj) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('[DB] write error', e);
  }
}

export function resetDB() {
  const init = emptyState();
  writeDB(init);
  return init;
}

export function push(table, row) {
  const db = readDB();
  if (!db[table]) db[table] = [];
  db[table].push(row);
  writeDB(db);
  return row;
}

export function update(table, id, patch) {
  const db = readDB();
  if (!db[table]) return null;
  const idx = db[table].findIndex((r) => r.id === id);
  if (idx === -1) return null;
  db[table][idx] = { ...db[table][idx], ...patch };
  writeDB(db);
  return db[table][idx];
}

export function listMessages(conversation_id, sinceISO) {
  const db = readDB();
  let msgs = (db.messages || []).filter((m) => m.conversation_id === conversation_id);
  if (sinceISO) {
    const t = Date.parse(sinceISO);
    msgs = msgs.filter((m) => Date.parse(m.created_at) > t);
  }
  // sort by created_at ascending
  msgs.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return msgs;
}
