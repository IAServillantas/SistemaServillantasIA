const { requireUser, assertSuperAdmin } = require('../../backend/lib/auth');

function randomTempPassword() {
  const part = () => Math.random().toString(36).slice(2, 8);
  return `Tmp-${part()}${part()}!`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { profile, service } = await requireUser(req);
    assertSuperAdmin(profile);

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const userId = String(body.userId || '').trim();
    let newPassword = String(body.newPassword || '').trim();
    const generate = Boolean(body.generate);

    if (!userId) {
      const error = new Error('Falta userId');
      error.status = 400;
      throw error;
    }

    if (generate || !newPassword) newPassword = randomTempPassword();
    if (newPassword.length < 8) {
      const error = new Error('La contrasena debe tener al menos 8 caracteres');
      error.status = 400;
      throw error;
    }

    const { data: target, error: targetError } = await service
      .from('profiles')
      .select('id, email, role, active')
      .eq('id', userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) {
      const error = new Error('Usuario no encontrado');
      error.status = 404;
      throw error;
    }

    const { error: updateError } = await service.auth.admin.updateUserById(userId, {
      password: newPassword
    });
    if (updateError) throw updateError;

    await service.from('profiles').update({
      updated_at: new Date().toISOString()
    }).eq('id', userId);

    return res.status(200).json({
      ok: true,
      email: target.email,
      temporaryPassword: newPassword,
      note: 'Entrega esta contrasena al usuario y pide que la cambie en /cuenta/'
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'No se pudo resetear la contrasena' });
  }
};
