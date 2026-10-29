(function (root) {
  'use strict';

  const ROLE_PAGES = Object.freeze({
    super_admin: ['/', '/inventario/', '/criticas/', '/chihuahua/'],
    juarez: ['/', '/inventario/', '/criticas/'],
    chihuahua: ['/', '/chihuahua/']
  });

  const SITE_BY_ROLE = Object.freeze({
    super_admin: ['general', 'chihuahua'],
    juarez: ['general'],
    chihuahua: ['chihuahua']
  });

  function cfg() {
    return root.SUPABASE_CONFIG || {};
  }

  function client() {
    const { url, anonKey } = cfg();
    if (!url || !anonKey || !root.supabase?.createClient) {
      throw new Error('Supabase no configurado');
    }
    if (!root.__sbAuthClient) {
      root.__sbAuthClient = root.supabase.createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: root.localStorage
        }
      });
    }
    return root.__sbAuthClient;
  }

  function loginPath(next) {
    const q = next ? `?next=${encodeURIComponent(next)}` : '';
    return `/login/${q}`;
  }

  async function getSession() {
    const { data, error } = await client().auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function getProfile() {
    const session = await getSession();
    if (!session) return null;
    const { data, error } = await client()
      .from('profiles')
      .select('id, email, full_name, role, active')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data || !data.active) return null;
    return data;
  }

  function canOpen(role, pathname) {
    const allowed = ROLE_PAGES[role] || [];
    const path = pathname.endsWith('/') || pathname === '/' ? pathname : `${pathname}/`;
    return allowed.some((p) => path === p || path.startsWith(p));
  }

  function canUseSite(role, site) {
    return (SITE_BY_ROLE[role] || []).includes(site);
  }

  async function requireAuth(options = {}) {
    const session = await getSession();
    if (!session) {
      root.location.replace(loginPath(root.location.pathname + root.location.search));
      return null;
    }
    const profile = await getProfile();
    if (!profile) {
      await client().auth.signOut();
      root.location.replace(loginPath(root.location.pathname));
      return null;
    }
    if (options.roles && !options.roles.includes(profile.role) && profile.role !== 'super_admin') {
      root.location.replace('/?denied=1');
      return null;
    }
    if (options.page && !canOpen(profile.role, options.page)) {
      root.location.replace('/?denied=1');
      return null;
    }
    return { session, profile, client: client() };
  }

  async function signIn(email, password) {
    const { data, error } = await client().auth.signInWithPassword({ email, password });
    if (error) throw error;
    const profile = await getProfile();
    if (!profile) {
      await client().auth.signOut();
      throw new Error('Usuario sin perfil activo. Contacta al administrador.');
    }
    return { session: data.session, profile };
  }

  async function signOut() {
    await client().auth.signOut();
    root.location.replace('/login/');
  }

  function accessTokenFrom(session) {
    return session?.access_token || '';
  }

  root.Auth = Object.freeze({
    ROLE_PAGES,
    SITE_BY_ROLE,
    client,
    getSession,
    getProfile,
    requireAuth,
    signIn,
    signOut,
    canOpen,
    canUseSite,
    accessTokenFrom,
    loginPath
  });
})(typeof window === 'undefined' ? globalThis : window);
