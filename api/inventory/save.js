const { createServiceClient } = require('../../backend/lib/supabase');
const { publishSnapshot, normalizeSite } = require('../../backend/lib/inventory');
const { requireUser, assertSiteAccess } = require('../../backend/lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { profile } = await requireUser(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const site = normalizeSite(body.site || body.siteCode || 'general');
    assertSiteAccess(profile, site);

    const client = createServiceClient();
    const data = await publishSnapshot(client, site, body.payload || body);
    return res.status(200).json({ data, role: profile.role });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'No se pudo guardar inventario' });
  }
};
