#!/usr/bin/env node
/**
 * Crea usuarios iniciales + perfiles.
 * Uso:
 *   node scripts/seed-users.mjs
 * Lee .env y opcionalmente SEED_USERS_JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

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

const url = process.env.SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const defaults = [
  { email: 'admin@servillantas.local', password: 'CambiaEstoAdmin1!', role: 'super_admin', full_name: 'Super Administrador' },
  { email: 'chihuahua@servillantas.local', password: 'CambiaEstoChih1!', role: 'chihuahua', full_name: 'Operaciones Chihuahua' },
  { email: 'juarez@servillantas.local', password: 'CambiaEstoJuarez1!', role: 'juarez', full_name: 'Operaciones Juarez' }
];

const users = process.env.SEED_USERS_JSON ? JSON.parse(process.env.SEED_USERS_JSON) : defaults;
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

for (const user of users) {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { full_name: user.full_name, role: user.role }
  });

  let userId = created?.user?.id;
  if (createError) {
    if (!/already|registered|exists/i.test(createError.message)) {
      console.error('FAIL create', user.email, createError.message);
      continue;
    }
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    userId = list?.users?.find((u) => u.email === user.email)?.id;
    if (!userId) {
      console.error('FAIL find', user.email);
      continue;
    }
    console.log('EXISTS', user.email);
  } else {
    console.log('CREATED', user.email);
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: userId,
    email: user.email,
    full_name: user.full_name || null,
    role: user.role,
    active: true,
    updated_at: new Date().toISOString()
  });
  if (profileError) console.error('FAIL profile', user.email, profileError.message);
  else console.log('PROFILE', user.email, user.role);
}

console.log('\nCambia las contrasenas temporales despues del primer acceso.');
