(function (root) {
  'use strict';

  const LINKS = [
    { href: '/', label: 'Inicio', match: (p) => p === '/' },
    { href: '/inventario/', label: 'Inventario', match: (p) => p.startsWith('/inventario') },
    { href: '/chihuahua/', label: 'Chihuahua', match: (p) => p.startsWith('/chihuahua') },
    { href: '/criticas/', label: 'Criticas', match: (p) => p.startsWith('/criticas') },
    { href: '/admin/', label: 'Admin', match: (p) => p.startsWith('/admin'), adminOnly: true },
    { href: '/cuenta/', label: 'Cuenta', match: (p) => p.startsWith('/cuenta') }
  ];

  function path() {
    const p = root.location.pathname || '/';
    return p.endsWith('/') || p === '/' ? p : `${p}/`;
  }

  async function mountTopNav(options = {}) {
    if (!root.Auth || document.getElementById('appTopnav')) return null;
    const auth = options.auth || await root.Auth.requireAuth({ page: options.page || path() });
    if (!auth) return null;

    const role = auth.profile.role;
    const current = path();
    const nav = document.createElement('nav');
    nav.id = 'appTopnav';
    nav.className = 'app-topnav';
    nav.setAttribute('aria-label', 'Navegacion principal');

    const links = document.createElement('div');
    links.className = 'app-topnav-links';

    const brand = document.createElement('a');
    brand.className = 'app-topnav-brand';
    brand.href = '/';
    brand.textContent = 'Servillantas';
    links.appendChild(brand);

    for (const item of LINKS) {
      if (item.adminOnly && role !== 'super_admin') continue;
      const always = item.href === '/' || item.href === '/cuenta/';
      if (!always && !root.Auth.canOpen(role, item.href)) continue;

      const a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      if (item.match(current)) a.classList.add('active');
      links.appendChild(a);
    }

    const actions = document.createElement('div');
    actions.className = 'app-topnav-actions';
    const account = document.createElement('a');
    account.className = 'btn';
    account.href = '/cuenta/';
    account.textContent = 'Cuenta';
    const logout = document.createElement('button');
    logout.type = 'button';
    logout.textContent = 'Salir';
    logout.onclick = () => root.Auth.signOut();
    actions.append(account, logout);

    nav.append(links, actions);
    document.body.prepend(nav);
    document.body.classList.add('has-app-topnav');
    return auth;
  }

  root.AppNav = Object.freeze({ mountTopNav, LINKS });
})(typeof window === 'undefined' ? globalThis : window);
