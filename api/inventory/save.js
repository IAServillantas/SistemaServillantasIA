const { createServiceClient } = require('../../backend/lib/supabase');
const { publishSnapshot } = require('../../backend/lib/inventory');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const expected = process.env.INVENTORY_UPLOAD_TOKEN;
    if (expected) {
      const auth = String(req.headers.authorization || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== expected) return res.status(401).json({ error: 'No autorizado' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const client = createServiceClient();
    const data = await publishSnapshot(client, body.site || body.siteCode, body.payload || body);
    return res.status(200).json({ data });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'No se pudo guardar inventario' });
  }
};
