const { createServiceClient } = require('../../backend/lib/supabase');
const { getActiveSnapshot, normalizeSite } = require('../../backend/lib/inventory');
const { requireUser, assertSiteAccess } = require('../../backend/lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { profile } = await requireUser(req);
    const site = normalizeSite(req.query.site || 'general');
    assertSiteAccess(profile, site);
    const client = createServiceClient();
    const data = await getActiveSnapshot(client, site);
    return res.status(200).json({ data, role: profile.role });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'No se pudo leer inventario' });
  }
};
