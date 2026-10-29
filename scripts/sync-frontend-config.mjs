#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envPath = ['.env.local', '.env'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
if (!envPath) {
  console.error('No hay .env.local ni .env');
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
const anonKey = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const uploadToken = env.INVENTORY_UPLOAD_TOKEN || '';

const out = `window.SUPABASE_CONFIG = {
  url: ${JSON.stringify(url)},
  anonKey: ${JSON.stringify(anonKey)},
  apiBase: "/api",
  uploadToken: ${JSON.stringify(uploadToken)}
};
`;

const target = path.join(root, 'frontend/shared/supabase-config.js');
fs.writeFileSync(target, out);
console.log(`OK → ${path.relative(root, target)}`);
