import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const seedPath = path.join(__dirname, '..', 'seeds', 'kb_salon_seed.json');

async function main() {
  const base = 'http://localhost:' + (process.env.PORT || 3000);
  const fetchJson = async (url, opts) => {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...(opts||{}) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  };

  // 1) reset everything
  console.log('[seed] resetting DB …');
  await fetchJson(`${base}/admin/reset`, { method: 'POST' });

  // 2) seed KB from file
  const items = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  console.log(`[seed] seeding ${items.length} KB items …`);
  await fetchJson(`${base}/admin/seed-kb`, { method: 'POST', body: JSON.stringify({ items, all: false }) });

  console.log('[seed] done.');
}

main().catch((e) => {
  console.error('[seed] failed:', e);
  process.exit(1);
});
