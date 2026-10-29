#!/usr/bin/env node
/**
 * Aplica la migración inicial usando DATABASE_URL (URI de Postgres de Supabase).
 * Si no hay DATABASE_URL, imprime instrucciones para el SQL Editor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

const sqlFile = path.join(root, 'supabase/migrations/20261029100000_inventory_init.sql');
const sql = fs.readFileSync(sqlFile, 'utf8');
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';

if (!dbUrl) {
  console.log(`No hay DATABASE_URL.

Opcion A (recomendada, 30s):
1. Abre Supabase → SQL Editor
2. Pega el contenido de:
   ${path.relative(root, sqlFile)}
3. Run

Opcion B:
Agrega en .env la URI de Database Settings → Connection string (URI), por ejemplo:
DATABASE_URL=postgresql://postgres.XXXX:PASSWORD@aws-0-....pooler.supabase.com:6543/postgres
Luego: npm run db:migrate
`);
  process.exit(2);
}

const psql = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlFile], {
  encoding: 'utf8',
  env: process.env
});
if (psql.status !== 0) {
  console.error(psql.stderr || psql.stdout || 'psql fallo');
  console.error('\nSi no tienes psql, usa el SQL Editor (Opcion A).');
  process.exit(psql.status || 1);
}
console.log('Migracion aplicada OK');
