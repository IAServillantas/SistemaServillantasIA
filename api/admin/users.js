const { requireUser, assertSuperAdmin } = require('../../backend/lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { profile, service } = await requireUser(req);
    assertSuperAdmin(profile);

    const { data, error } = await service
      .from('profiles')
      .select('id, email, full_name, role, active, created_at, updated_at')
      .order('email');
    if (error) throw error;

    return res.status(200).json({ data: data || [] });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'No se pudieron listar usuarios' });
  }
};
