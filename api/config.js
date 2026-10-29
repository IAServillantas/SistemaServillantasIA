const { publicEnv } = require('../backend/lib/supabase');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { url, anonKey } = publicEnv();
  return res.status(200).json({
    configured: Boolean(url && anonKey),
    url,
    anonKey,
    sites: ['general', 'chihuahua']
  });
};
