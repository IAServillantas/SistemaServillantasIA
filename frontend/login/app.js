(() => {
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || '/';
  const form = document.getElementById('loginForm');
  const error = document.getElementById('error');
  const submitBtn = document.getElementById('submitBtn');

  function homeFor(role) {
    if (role === 'chihuahua') return '/chihuahua/';
    if (role === 'juarez') return '/inventario/';
    return '/';
  }

  (async () => {
    try {
      const session = await Auth.getSession();
      if (!session) return;
      const profile = await Auth.getProfile();
      if (profile) location.replace(Auth.canOpen(profile.role, next) ? next : homeFor(profile.role));
    } catch (_) { /* formulario listo */ }
  })();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    submitBtn.disabled = true;
    try {
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const { profile } = await Auth.signIn(email, password);
      location.replace(Auth.canOpen(profile.role, next) ? next : homeFor(profile.role));
    } catch (err) {
      error.textContent = err.message || 'No se pudo iniciar sesion';
      submitBtn.disabled = false;
    }
  });
})();
