const { createAnonClient } = require('../../backend/lib/supabase');
const { getActiveSnapshot } = require('../../backend/lib/inventory');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const site = req.query.site || 'general';
    const client = createAnonClient();
    const data = await getActiveSnapshot(client, site);
    return res.status(200).json({ data });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'No se pudo leer inventario' });
  }
};
