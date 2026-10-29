const { createClient } = require('@supabase/supabase-js');
const { publicEnv, createServiceClient } = require('./supabase');

function bearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

function userClient(accessToken) {
  const { url, anonKey } = publicEnv();
  if (!url || !anonKey) throw new Error('Supabase no configurado');
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function requireUser(req) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error('No autorizado');
    error.status = 401;
    throw error;
  }

  const client = userClient(token);
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user) {
    const error = new Error('Sesion invalida');
    error.status = 401;
    throw error;
  }

  const service = createServiceClient();
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('id, email, full_name, role, active')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile || !profile.active) {
    const error = new Error('Perfil inactivo o inexistente');
    error.status = 403;
    throw error;
  }

  return { token, user: userData.user, profile, client, service };
}

function assertSiteAccess(profile, site) {
  const role = profile.role;
  const ok = role === 'super_admin'
    || (role === 'juarez' && site === 'general')
    || (role === 'chihuahua' && site === 'chihuahua');
  if (!ok) {
    const error = new Error('Sin permiso para este sitio');
    error.status = 403;
    throw error;
  }
}

function assertSuperAdmin(profile) {
  if (profile.role !== 'super_admin') {
    const error = new Error('Solo super administrador');
    error.status = 403;
    throw error;
  }
}

module.exports = { bearerToken, requireUser, assertSiteAccess, assertSuperAdmin };
