(function (root) {
  'use strict';

  const cfg = () => root.SUPABASE_CONFIG || {};
  const apiBase = () => String(cfg().apiBase || '/api').replace(/\/$/, '');

  function headers(json) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (cfg().uploadToken) h.Authorization = `Bearer ${cfg().uploadToken}`;
    return h;
  }

  function createClient() {
    const { url, anonKey } = cfg();
    if (!url || !anonKey || !root.supabase?.createClient) return null;
    return root.supabase.createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  async function loadActive(site) {
    const siteCode = site || 'general';
    try {
      const response = await fetch(`${apiBase()}/inventory/latest?site=${encodeURIComponent(siteCode)}`, {
        headers: headers(false)
      });
      if (response.ok) {
        const body = await response.json();
        return body.data || null;
      }
    } catch (_) { /* API local ausente: fallback directo */ }

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

    try {
      const response = await fetch(`${apiBase()}/inventory/save`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify(body)
      });
      if (response.ok) return (await response.json()).data;
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    } catch (error) {
      // Sin API (solo frontend estatico): requiere service role; no se escribe desde anon.
      throw error;
    }
  }

  function isConfigured() {
    const c = cfg();
    return Boolean((c.url && c.anonKey) || c.apiBase);
  }

  root.InventorySync = Object.freeze({ loadActive, save, isConfigured, createClient });
})(typeof window === 'undefined' ? globalThis : window);
