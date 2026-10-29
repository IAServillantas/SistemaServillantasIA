(() => {
  const msg = document.getElementById('msg');
  const submitBtn = document.getElementById('submitBtn');
  document.getElementById('backBtn').onclick = () => { location.href = '/'; };

  (async () => {
    const auth = await Auth.requireAuth({ page: '/cuenta/' });
    if (!auth) return;
    document.getElementById('userMeta').textContent =
      `${auth.profile.full_name || auth.profile.email} · ${auth.profile.role}`;
  })();

  document.getElementById('passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    msg.className = 'msg';
    msg.textContent = '';
    const password = document.getElementById('password').value;
    const password2 = document.getElementById('password2').value;
    if (password !== password2) {
      msg.className = 'msg error';
      msg.textContent = 'Las contrasenas no coinciden.';
      return;
    }
    submitBtn.disabled = true;
    try {
      await Auth.updatePassword(password);
      msg.className = 'msg ok';
      msg.textContent = 'Contrasena actualizada. Ya puedes usarla en el proximo acceso.';
      document.getElementById('passwordForm').reset();
    } catch (err) {
      msg.className = 'msg error';
      msg.textContent = err.message || 'No se pudo actualizar la contrasena.';
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
