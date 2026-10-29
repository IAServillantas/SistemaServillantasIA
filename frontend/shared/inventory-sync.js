(function (root) {
  'use strict';

  const cfg = () => root.SUPABASE_CONFIG || {};
  const apiBase = () => String(cfg().apiBase || '/api').replace(/\/$/, '');

  async function authHeader(json) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (root.Auth?.getSession) {
      const session = await root.Auth.getSession();
      if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    } else if (cfg().uploadToken) {
      h.Authorization = `Bearer ${cfg().uploadToken}`;
    }
    return h;
  }

  function createClient() {
    if (root.Auth?.client) return root.Auth.client();
    const { url, anonKey } = cfg();
    if (!url || !anonKey || !root.supabase?.createClient) return null;
    return root.supabase.createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storage: root.localStorage }
    });
  }

  async function loadActive(site) {
    const siteCode = site || 'general';
    try {
      const response = await fetch(`${apiBase()}/inventory/latest?site=${encodeURIComponent(siteCode)}`, {
        headers: await authHeader(false)
      });
      if (response.ok) {
        const body = await response.json();
        return body.data || null;
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error('Sesion expirada o sin permiso');
      }
    } catch (error) {
      if (error.message?.includes('Sesion') || error.message?.includes('permiso')) throw error;
    }

    const client = createClient();
    if (!client) return null;
    const { data, error } = await client
      .from('inventory_snapshots')
      .select('id, site_code, cutoff, file_name, data_version, loaded_at, rows')
      .eq('site_code', siteCode)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      siteCode: data.site_code,
      cutoff: data.cutoff || '',
      fileName: data.file_name || '',
      dataVersion: data.data_version || null,
      loadedAt: data.loaded_at,
      rows: data.rows || []
    };
  }

  async function save(site, payload) {
    const siteCode = site || 'general';
    const body = {
      site: siteCode,
      payload: {
        cutoff: payload.cutoff || '',
        fileName: payload.fileName || '',
        dataVersion: payload.dataVersion || null,
        rows: payload.rows || []
      }
    };

    const response = await fetch(`${apiBase()}/inventory/save`, {
      method: 'POST',
      headers: await authHeader(true),
      body: JSON.stringify(body)
    });
    if (response.ok) return (await response.json()).data;
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  function isConfigured() {
    const c = cfg();
    return Boolean((c.url && c.anonKey) || c.apiBase);
  }

  root.InventorySync = Object.freeze({ loadActive, save, isConfigured, createClient });
})(typeof window === 'undefined' ? globalThis : window);
