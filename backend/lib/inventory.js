const SITES = new Set(['general', 'chihuahua']);

function normalizeSite(site) {
  const value = String(site || '').trim().toLowerCase();
  if (!SITES.has(value)) throw new Error(`site invalido: ${site}`);
  return value;
}

function toDashboardPayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    siteCode: row.site_code,
    cutoff: row.cutoff || '',
    fileName: row.file_name || '',
    dataVersion: row.data_version || null,
    loadedAt: row.loaded_at,
    rows: Array.isArray(row.rows) ? row.rows : []
  };
}

async function getActiveSnapshot(client, site) {
  const siteCode = normalizeSite(site);
  const { data, error } = await client
    .from('inventory_snapshots')
    .select('id, site_code, cutoff, file_name, data_version, loaded_at, rows, row_count, is_active')
    .eq('site_code', siteCode)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return toDashboardPayload(data);
}

async function publishSnapshot(serviceClient, site, payload) {
  const siteCode = normalizeSite(site);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const { data, error } = await serviceClient.rpc('publish_inventory_snapshot', {
    p_site_code: siteCode,
    p_cutoff: payload?.cutoff || null,
    p_file_name: payload?.fileName || payload?.file_name || null,
    p_data_version: payload?.dataVersion || payload?.data_version || null,
    p_rows: rows
  });
  if (error) throw error;
  return toDashboardPayload(Array.isArray(data) ? data[0] : data);
}

module.exports = { SITES, normalizeSite, getActiveSnapshot, publishSnapshot, toDashboardPayload };
