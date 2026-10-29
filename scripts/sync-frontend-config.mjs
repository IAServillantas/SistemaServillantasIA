#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function loadDotEnvFile() {
  const envPath = ['.env.local', '.env'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!envPath) return {};
  return Object.fromEntries(
    fs.readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
}

const fileEnv = loadDotEnvFile();
const pick = (...keys) => {
  for (const key of keys) {
    const value = process.env[key] || fileEnv[key];
    if (value) return value;
  }
  return '';
};

const url = pick('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
const anonKey = pick('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
const uploadToken = pick('INVENTORY_UPLOAD_TOKEN');

if (!url || !anonKey) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_ANON_KEY.');
  console.error('En Vercel: Project Settings → Environment Variables (Production + Preview).');
  console.error('En local: crea .env o exporta las variables.');
  process.exit(1);
}

const out = `window.SUPABASE_CONFIG = {
  url: ${JSON.stringify(url)},
  anonKey: ${JSON.stringify(anonKey)},
  apiBase: "/api",
  uploadToken: ${JSON.stringify(uploadToken)}
};
`;

const target = path.join(root, 'frontend/shared/supabase-config.js');
fs.writeFileSync(target, out);
console.log(`OK → ${path.relative(root, target)} (url=${url})`);
