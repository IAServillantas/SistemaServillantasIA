#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
for (const name of ['.env.local', '.env']) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Faltan SUPABASE_URL / keys en .env');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };
const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push([name, true, '']);
  } catch (e) {
    checks.push([name, false, e.message]);
  }
}

await check('auth health', async () => {
  const res = await fetch(`${url}/auth/v1/health`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
});

for (const table of ['inventory_rules', 'inventory_snapshots', 'profiles']) {
  await check(`tabla ${table}`, async () => {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
    const text = await res.text();
    if (res.status === 404 && text.includes('PGRST205')) {
      throw new Error('no existe — corre la migracion SQL');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  });
}

for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
process.exit(checks.every((c) => c[1]) ? 0 : 1);
