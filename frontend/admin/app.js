(() => {
  const apiBase = () => String((window.SUPABASE_CONFIG || {}).apiBase || '/api').replace(/\/$/, '');
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  const body = document.getElementById('usersBody');

  document.getElementById('homeBtn').onclick = () => { location.href = '/'; };
  document.getElementById('logoutBtn').onclick = () => Auth.signOut();

  async function authHeaders() {
    const session = await Auth.getSession();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`
    };
  }

  async function loadUsers() {
    status.textContent = 'Cargando usuarios...';
    result.textContent = '';
    const response = await fetch(`${apiBase()}/admin/users`, { headers: await authHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    renderUsers(payload.data || []);
    status.textContent = `${payload.data?.length || 0} usuarios`;
  }

  function renderUsers(users) {
    body.innerHTML = '';
    for (const user of users) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${escapeHtml(user.full_name || user.email)}</strong><br>
          <span class="muted">${escapeHtml(user.email)}</span>
        </td>
        <td>${escapeHtml(user.role)}</td>
        <td>${user.active ? 'Activo' : 'Inactivo'}</td>
        <td><input type="password" data-id="${user.id}" placeholder="Opcional (o generar)"></td>
        <td class="actions">
          <button type="button" class="primary" data-reset="${user.id}">Resetear</button>
          <button type="button" data-gen="${user.id}">Generar temporal</button>
        </td>`;
      body.appendChild(tr);
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  async function resetPassword(userId, { generate = false } = {}) {
    result.className = 'muted';
    result.textContent = 'Aplicando...';
    const input = body.querySelector(`input[data-id="${userId}"]`);
    const newPassword = generate ? '' : (input?.value || '');
    const response = await fetch(`${apiBase()}/admin/reset-password`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ userId, newPassword, generate })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    result.className = 'ok';
    result.textContent = `Listo para ${payload.email}. Contrasena temporal: ${payload.temporaryPassword}`;
    if (input) input.value = '';
  }

  body.addEventListener('click', async (event) => {
    const resetId = event.target.getAttribute('data-reset');
    const genId = event.target.getAttribute('data-gen');
    if (!resetId && !genId) return;
    try {
      await resetPassword(resetId || genId, { generate: Boolean(genId) });
    } catch (err) {
      result.className = 'err';
      result.textContent = err.message || 'Error al resetear';
    }
  });

  (async () => {
    const auth = await Auth.requireAuth({ page: '/admin/', roles: ['super_admin'] });
    if (!auth) return;
    if (auth.profile.role !== 'super_admin') {
      location.replace('/?denied=1');
      return;
    }
    try {
      await loadUsers();
    } catch (err) {
      status.className = 'err';
      status.textContent = err.message || 'No se pudo cargar';
    }
  })();
})();
