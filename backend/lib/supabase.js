const { createClient } = require('@supabase/supabase-js');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

function publicEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  };
}

function createAnonClient() {
  const { url, anonKey } = publicEnv();
  if (!url || !anonKey) throw new Error('Supabase no configurado (URL/ANON_KEY)');
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function createServiceClient() {
  const url = required('SUPABASE_URL');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

module.exports = { publicEnv, createAnonClient, createServiceClient };
