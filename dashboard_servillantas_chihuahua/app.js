(() => {
  const bundledSource = window.INVENTORY_DATA || { cutoff: "", rows: [] };
  const TARGET_COVERAGE_DAYS = 90;
  const RECENT_PURCHASE_DAYS = 90;
  const DATA_VERSION = "servillantas-plt-cvt-v1";
  let source = bundledSource;
  try {
    const stored = localStorage.getItem("inventoryDashboardDataServillantasChihuahua");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.dataVersion === DATA_VERSION) source = parsed;
    }
  } catch (_) { }
  const state = { page: 1, pageSize: 50, rows: [], measurePage: 1, measurePageSize: 25, measureView: "GENERAL", suppliers: { general: null, t53: null }, supplierResults: [], homologationPreview: [] };
  const $ = (id) => document.getElementById(id);
  const formatNumber = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
  const formatMoney = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  const statusLabels = { REPONER: "Reponer", REDUCIR: "Reducir", OBSERVAR: "Observar", SALUDABLE: "Saludable", SIN_OFERTA: "Sin accion" };
  const requiredColumns = ["CVE_ART", "DESCRIPCION", "CTRL_ALM", "MEDIDA", "MARCA", "TIER", "FCO", "PIS", "JUV", "PAR", "CAMP", "ULT_COSTO", "EXIST", "FCH_ULTCOM", "FCH_ULTVTA", "ACUM_VTS_3M", "ACUM_VTS_PAR"];
  const columnAliases = {
    ULT_COSTO: ["ULT_COST", "ULTIMO_COSTO", "ULTIMO_COST", "COSTO_ULTIMO", "ULT_COSTO_NETO"]
  };

  const normalizeColumn = (value) => String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  function normalizeExcelRows(rawRows) {
    const aliases = Object.fromEntries([
      ...requiredColumns.map((canonical) => [normalizeColumn(canonical), canonical]),
      ...Object.entries(columnAliases)
        .flatMap(([canonical, alternatives]) => alternatives.map((alternative) => [normalizeColumn(alternative), canonical]))
    ]);
    return rawRows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      const normalized = normalizeColumn(key);
      return [aliases[normalized] || normalized, value];
    })));
  }

  const asNumber = (value) => {
    if (value === null || value === undefined || value === "") return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  function normalizeMeasure(value) {
    const text = String(value || "").toUpperCase().replace(/,/g, ".").replace(/\bZR\b/g, "R");
    const passenger = text.match(/(?:^|\D)(\d{3})\s*[\/\- ]?\s*(\d{2})\s*(?:Z?R|RIN|[- ])?\s*(\d{2})(?:\D|$)/);
    if (!passenger) return null;
    const width = Number(passenger[1]); const profile = Number(passenger[2]); const rim = Number(passenger[3]);
    if (width < 125 || width > 395 || profile < 20 || profile > 95 || rim < 10 || rim > 26) return null;
    return `${width}/${profile}R${rim}`;
  }

  function classifyTire(value) {
    const text = normalizeColumn(value).replaceAll("_", " ");
    const loadEvidence = [];
    if (/(^| )LT ?\d{3}/.test(text)) loadEvidence.push("LT");
    if (/\d{3} ?\/? ?\d{2} ?R ?\d{2} ?C( |$)/.test(text)) loadEvidence.push("Medida C");
    if (/(^| )(CARGO|VAN)( |$)/.test(text)) loadEvidence.push("Cargo/Van");
    const construction = loadEvidence.length ? "Carga ligera" : "Pasajero";
    let tread = "General"; let treadEvidence = "Sin marca explicita"; let confidence = loadEvidence.length ? "Alta" : "Media";
    if (/(^| )(M T|MT)( |$)|MUD TERRAIN/.test(text)) { tread = "MT"; treadEvidence = "MT/Mud Terrain"; confidence = "Alta"; }
    else if (/(^| )(A T)( |$)|ALL TERRAIN/.test(text)) { tread = "AT"; treadEvidence = "A/T o All Terrain"; confidence = "Alta"; }
    else if (/(^| )AT( |$)/.test(text)) { tread = "AT"; treadEvidence = "Token AT"; confidence = /(^| )AT \d/.test(text) ? "Revisar" : "Media"; }
    else if (/(^| )(H T|HT)( |$)|HIGHWAY TERRAIN/.test(text)) { tread = "HT"; treadEvidence = "H/T o Highway Terrain"; confidence = "Alta"; }
    return { construction, tread, confidence, evidence: [...loadEvidence, treadEvidence].join(", ") };
  }

  async function readSupplier(file, kind) {
    if (typeof XLSX === "undefined") throw new Error("No se pudo cargar el lector local de Excel.");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const sheetName = kind === "general" ? "Inventario" : "T53";
    if (!workbook.SheetNames.includes(sheetName)) throw new Error(`${file.name} no contiene la hoja ${sheetName}.`);
    const firstDataRow = kind === "general" ? 4 : 10;
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true }).slice(firstDataRow);
    const offers = []; let excludedMeasure = 0; let excludedStock = 0; let excludedCost = 0; let excludedRetread = 0;
    rawRows.forEach((row) => {
      const type = String(row[(kind === "general" ? 5 : 6) - 1] || "").trim().toUpperCase();
      if (kind === "general" ? type !== "AUTO" : !["AUTO", "CAMIONETA"].includes(type)) return;
      const sku = String(row[(kind === "general" ? 1 : 2) - 1] || "").trim();
      const description = String(row[(kind === "general" ? 2 : 3) - 1] || "").trim();
      const subtype = String(row[5] || "").trim();
      if (kind === "general" && normalizeColumn(subtype) === "REENCAUCHE") { excludedRetread++; return; }
      const measureSource = kind === "general" ? description : `${row[6] || ""}/${row[7] || ""}${row[8] || ""} ${description}`;
      const measure = normalizeMeasure(measureSource);
      const stock = asNumber(row[(kind === "general" ? 10 : 17) - 1]);
      const rawCost = asNumber(row[(kind === "general" ? 17 : 13) - 1]);
      const cost = kind === "general" ? rawCost / 1.16 : rawCost;
      if (!measure) { excludedMeasure++; return; }
      if (!(stock > 0)) { excludedStock++; return; }
      if (!(cost > 0)) { excludedCost++; return; }
      offers.push({ provider: kind === "general" ? "Inventario General" : "T53", sku, description, measure, stock: Math.floor(stock), cost: Math.round(cost * 100) / 100, ...classifyTire(description) });
    });
    return { fileName: file.name, offers, quality: { total: rawRows.length, excludedMeasure, excludedStock, excludedCost, excludedRetread } };
  }

  async function loadSupplier(file, kind) {
    const error = $("supplierError"); error.hidden = true;
    const status = $(kind === "general" ? "generalSupplierStatus" : "t53SupplierStatus");
    status.textContent = `Procesando ${file.name}...`;
    try {
      state.suppliers[kind] = await readSupplier(file, kind);
      status.textContent = `${file.name} | ${formatNumber.format(state.suppliers[kind].offers.length)} ofertas validas`;
    } catch (problem) {
      state.suppliers[kind] = null; status.textContent = "Archivo no valido";
      error.textContent = problem.message; error.hidden = false;
    }
    $("compareSuppliersButton").disabled = !(state.suppliers.general && state.suppliers.t53);
    $("previewHomologationButton").disabled = !(state.suppliers.general && state.suppliers.t53);
  }

  function buildHomologationPreview() {
    const internalGroups = new Map();
    source.rows.filter((row) => row.control === "PLT" && row.tier === 4).forEach((row) => {
      const measure = normalizeMeasure(row.measure || row.description); if (!measure) return;
      const classification = classifyTire(row.description); const key = `${measure}|${classification.construction}|${classification.tread}`;
      if (!internalGroups.has(key)) internalGroups.set(key, { measure, construction: classification.construction, tread: classification.tread, confidence: classification.confidence, evidence: new Set(), skus: new Set() });
      const group = internalGroups.get(key); group.skus.add(row.sku); group.evidence.add(classification.evidence); if (classification.confidence === "Revisar") group.confidence = "Revisar";
    });
    const allOffers = [...state.suppliers.general.offers, ...state.suppliers.t53.offers];
    state.homologationPreview = [...internalGroups.values()].map((group) => {
      const sameMeasure = allOffers.filter((offer) => offer.measure === group.measure);
      const compatible = sameMeasure.filter((offer) => offer.construction === group.construction && offer.tread === group.tread);
      const discrepant = sameMeasure.filter((offer) => offer.construction !== group.construction || offer.tread !== group.tread);
      const best = [...compatible].sort((a, b) => a.cost - b.cost || b.stock - a.stock)[0] || null;
      const review = group.confidence === "Revisar" || compatible.some((offer) => offer.confidence === "Revisar") ? "Validar modelo" : (!compatible.length && discrepant.length ? "Solo hay segmentos distintos" : (!sameMeasure.length ? "Sin oferta en la medida" : "Coincidencia exacta"));
      const confidence = review === "Coincidencia exacta" && group.confidence === "Alta" && compatible.every((offer) => offer.confidence === "Alta") ? "Alta" : (review === "Coincidencia exacta" ? "Media" : "Revisar");
      return { ...group, evidence: [...group.evidence].join(" | "), compatible, discrepant, best, confidence, review };
    }).sort((a, b) => {
      const priority = { Revisar: 0, Media: 1, Alta: 2 };
      return priority[a.confidence] - priority[b.confidence] || a.measure.localeCompare(b.measure, "es-MX", { numeric: true });
    });
    renderHomologationPreview();
  }

  function renderHomologationPreview() {
    const rows = state.homologationPreview; const reviewCount = rows.filter((row) => row.confidence === "Revisar").length;
    $("homologationPanel").hidden = false;
    $("homologationSummary").textContent = `${formatNumber.format(rows.length)} grupos internos de medida y segmento; ${formatNumber.format(reviewCount)} requieren revision manual. Esta vista aun no modifica las compras.`;
    $("homologationBody").innerHTML = rows.map((row) => `<tr><td><strong>${row.measure}</strong></td><td>${row.construction}</td><td>${row.tread}</td><td class="number">${formatNumber.format(row.skus.size)}</td><td class="number">${formatNumber.format(row.compatible.length)}</td><td class="number">${formatNumber.format(row.discrepant.length)}</td><td>${row.best?.provider || "-"}${row.best ? ` | ${row.best.sku}` : ""}</td><td class="number">${row.best ? formatMoney.format(row.best.cost) : "-"}</td><td><span class="status status-${row.confidence === "Alta" ? "SALUDABLE" : row.confidence === "Media" ? "OBSERVAR" : "REDUCIR"}">${row.confidence}</span></td><td>${row.review}</td></tr>`).join("");
  }

  function exportHomologationPreview() {
    const output = state.homologationPreview.map((row) => ({ Medida: row.measure, Construccion_interna: row.construction, Piso_interno: row.tread, Evidencia_interna: row.evidence, SKU_internos: row.skus.size, Ofertas_compatibles: row.compatible.length, Ofertas_discrepantes: row.discrepant.length, Mejor_proveedor_compatible: row.best?.provider || "", SKU_proveedor: row.best?.sku || "", Mejor_costo: row.best?.cost || "", Confianza: row.confidence, Revision: row.review, Segmentos_discrepantes: [...new Set(row.discrepant.map((offer) => `${offer.construction} | ${offer.tread}`))].join(", ") }));
    const sheet = XLSX.utils.json_to_sheet(output); sheet["!cols"] = [14, 22, 14, 30, 13, 20, 21, 28, 22, 15, 12, 30, 35].map((wch) => ({ wch }));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "Revision homologaciones"); XLSX.writeFile(workbook, `servillantas_revision_homologaciones_tier4_${(source.cutoff || "sin_fecha").replaceAll("/", "-")}.xlsx`);
  }

  function calculateSupplierRecommendations() {
    const branch = $("branchFilter").value;
    const groups = new Map();
    source.rows.filter((row) => row.control === "PLT" && row.tier === 4).forEach((row) => {
      const measure = normalizeMeasure(row.measure || row.description); if (!measure) return;
      if (!groups.has(measure)) groups.set(measure, { measure, sales3: 0, stock: 0, costs: [], costCapital: 0, costUnits: 0, datedCosts: [] });
      const group = groups.get(measure); const stock = branchStock(row, branch); group.sales3 += branchSales3(row, branch); group.stock += stock;
      if (row.cost > 0) { group.costs.push(row.cost); if (row.daysSincePurchase !== null) group.datedCosts.push({ cost: row.cost, age: row.daysSincePurchase }); if (stock > 0) { group.costCapital += row.cost * stock; group.costUnits += stock; } }
    });
    const offersByMeasure = new Map();
    [...state.suppliers.general.offers, ...state.suppliers.t53.offers].forEach((offer) => { if (!offersByMeasure.has(offer.measure)) offersByMeasure.set(offer.measure, []); offersByMeasure.get(offer.measure).push(offer); });
    state.supplierResults = [...groups.values()].map((group) => {
      const replenishmentNeed = Math.max(0, Math.ceil(group.sales3 - group.stock));
      const offers = (offersByMeasure.get(group.measure) || []).sort((a, b) => a.cost - b.cost || b.stock - a.stock);
      const latestCost = group.datedCosts.sort((a, b) => a.age - b.age)[0]?.cost || null;
      const fallbackCost = group.costUnits > 0 ? group.costCapital / group.costUnits : (group.costs.length ? group.costs.reduce((sum, cost) => sum + cost, 0) / group.costs.length : null);
      const ownCost = latestCost || fallbackCost;
      const bestOffer = offers[0] || null;
      const savingsRate = bestOffer && ownCost > 0 ? (ownCost - bestOffer.cost) / ownCost : null;
      const opportunity = group.sales3 > 0 && savingsRate !== null && savingsRate >= 0.10 && group.stock < (group.sales3 * 4 / 3);
      const need = opportunity ? Math.max(0, Math.ceil((group.sales3 * 4 / 3) - group.stock)) : replenishmentNeed;
      const recommendation = opportunity ? (replenishmentNeed > 0 ? "Reposicion + oportunidad" : "Oportunidad") : "Reposicion";
      let remaining = need; let allocated = 0;
      const allocations = offers.map((offer) => {
        const meetsOpportunitySaving = ownCost > 0 && offer.cost <= ownCost * 0.90;
        const allowed = opportunity && !meetsOpportunitySaving ? Math.max(0, replenishmentNeed - allocated) : remaining;
        const quantity = Math.min(remaining, allowed, offer.stock); remaining -= quantity; allocated += quantity;
        return { ...offer, quantity, meetsOpportunitySaving };
      }).filter((offer) => offer.quantity > 0);
      const primary = allocations[0] || null;
      const primarySavings = primary && ownCost > 0 ? ownCost - primary.cost : null;
      return { ...group, replenishmentNeed, need, ownCost, offers, allocations, primary, pending: remaining, recommendation, opportunity, savingsRate: primarySavings === null ? null : primarySavings / ownCost, savingsUnit: primarySavings, savingsTotal: primarySavings === null ? null : primarySavings * primary.quantity };
    }).filter((group) => group.need > 0).sort((a, b) => (b.opportunity - a.opportunity) || b.need - a.need || b.sales3 - a.sales3);
    renderSupplierRecommendations();
  }

  function renderSupplierRecommendations() {
    const rows = state.supplierResults;
    const opportunities = rows.filter((row) => row.opportunity).length;
    $("supplierSummary").textContent = `${formatNumber.format(rows.length)} medidas Tier 4 con recomendacion en ${$("branchFilter").value === "PAR" ? "Parral" : "Chihuahua"}; ${formatNumber.format(opportunities)} incluyen oportunidad por ahorro de 10% o mas.`;
    $("exportSupplierButton").disabled = !rows.length;
    $("supplierBody").innerHTML = rows.length ? rows.map((row) => {
      const primary = row.primary;
      const alternatives = row.offers.slice(primary ? 1 : 0, 4).map((offer) => { const allocation = row.allocations.find((item) => item.provider === offer.provider && item.sku === offer.sku); return `${offer.provider}: ${offer.sku} (${formatNumber.format(offer.stock)} a ${formatMoney.format(offer.cost)}${allocation ? `, comprar ${formatNumber.format(allocation.quantity)}` : ""})`; }).join(" | ") || "Sin alternativa";
      return `<tr><td><strong>${row.measure}</strong></td><td><span class="status status-${row.opportunity ? "OBSERVAR" : "REPONER"}">${row.recommendation}</span></td><td class="number">${formatNumber.format(row.sales3)}</td><td class="number">${formatNumber.format(row.stock)}</td><td class="number">${formatNumber.format(row.need)}</td><td>${primary?.provider || "Sin oferta"}</td><td>${primary?.sku || "-"}</td><td class="number">${primary ? formatNumber.format(primary.stock) : "-"}</td><td class="number">${primary ? formatMoney.format(primary.cost) : "-"}</td><td class="number">${row.ownCost ? formatMoney.format(row.ownCost) : "-"}</td><td class="number">${row.savingsUnit !== null && row.savingsUnit > 0 ? formatMoney.format(row.savingsUnit) : "-"}</td><td class="number">${row.savingsRate !== null && row.savingsRate > 0 ? `${(row.savingsRate * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%` : "-"}</td><td class="number">${row.savingsTotal !== null && row.savingsTotal > 0 ? formatMoney.format(row.savingsTotal) : "-"}</td><td class="number"><strong>${primary ? formatNumber.format(primary.quantity) : "0"}</strong></td><td class="number">${formatNumber.format(row.pending)}</td><td>${alternatives}</td></tr>`;
    }).join("") : `<tr><td colspan="16" class="empty-state">No hay necesidades de compra ni oportunidades con los datos actuales.</td></tr>`;
    const qualities = Object.values(state.suppliers).map((item) => item.quality);
    $("supplierQuality").textContent = `Calidad de proveedores: ${formatNumber.format(qualities.reduce((s, q) => s + (q.excludedRetread || 0), 0))} ofertas de reencauche excluidas, ${formatNumber.format(qualities.reduce((s, q) => s + q.excludedMeasure, 0))} filas con medida no homologable, ${formatNumber.format(qualities.reduce((s, q) => s + q.excludedStock, 0))} sin existencia y ${formatNumber.format(qualities.reduce((s, q) => s + q.excludedCost, 0))} sin costo valido.`;
  }

  function exportSupplierRecommendations() {
    const output = state.supplierResults.flatMap((row) => row.allocations.length ? row.allocations.map((offer, index) => { const savingsUnit = row.ownCost ? row.ownCost - offer.cost : null; return { Unidad: $("branchFilter").value === "PAR" ? "Parral" : "Chihuahua consolidado", Clasificacion: "PLT", Tier: 4, Medida: row.measure, Recomendacion: row.recommendation, Venta_3M: row.sales3, Inventario_propio: row.stock, Reposicion_90_dias: row.replenishmentNeed, Cantidad_objetivo: row.need, Cobertura_maxima_dias: row.opportunity ? 120 : 90, Prioridad_oferta: index + 1, Proveedor: offer.provider, SKU_proveedor: offer.sku, Disponible_proveedor: offer.stock, Costo_proveedor: offer.cost, Ultimo_costo_propio: row.ownCost ? Math.round(row.ownCost * 100) / 100 : "", Ahorro_unitario: savingsUnit === null ? "" : Math.round(savingsUnit * 100) / 100, Ahorro_porcentaje: savingsUnit === null ? "" : Math.round((savingsUnit / row.ownCost) * 10000) / 100, Ahorro_estimado: savingsUnit === null ? "" : Math.round(savingsUnit * offer.quantity * 100) / 100, Compra_sugerida: offer.quantity, Pendiente_total: row.pending }; }) : [{ Unidad: $("branchFilter").value === "PAR" ? "Parral" : "Chihuahua consolidado", Clasificacion: "PLT", Tier: 4, Medida: row.measure, Recomendacion: row.recommendation, Venta_3M: row.sales3, Inventario_propio: row.stock, Reposicion_90_dias: row.replenishmentNeed, Cantidad_objetivo: row.need, Proveedor: "Sin oferta", Compra_sugerida: 0, Pendiente_total: row.pending }]);
    const sheet = XLSX.utils.json_to_sheet(output); sheet["!cols"] = [22, 13, 7, 14, 12, 18, 18, 15, 20, 20, 21, 18, 26, 18, 18, 16].map((wch) => ({ wch }));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "Recomendacion de compra");
    XLSX.writeFile(workbook, `servillantas_${$("branchFilter").value.toLowerCase()}_compra_tier4_${(source.cutoff || "sin_fecha").replaceAll("/", "-")}.xlsx`);
  }

  const asDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
    if (typeof value === "number") {
      const parts = XLSX.SSF.parse_date_code(value);
      return parts ? new Date(Date.UTC(parts.y, parts.m - 1, parts.d)) : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  };

  const formatDate = (date) => date ? new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date) : null;
  const daysBetween = (end, start) => Math.max(0, Math.floor((end.valueOf() - start.valueOf()) / 86400000));

  function transformExcelRows(rawRows, file) {
    if (!rawRows.length) throw new Error("La hoja Consulta1 esta vacia.");
    rawRows = normalizeExcelRows(rawRows);
    const columns = [...new Set(rawRows.flatMap((row) => Object.keys(row)))];
    const missing = requiredColumns.filter((column) => !columns.includes(column));
    if (missing.length) throw new Error(`Faltan columnas obligatorias: ${missing.join(", ")}.`);

    const sourceRows = rawRows.filter((row) => ["PLT", "CVT"].includes(String(row.CTRL_ALM || "").trim().toUpperCase()));
    if (!sourceRows.length) throw new Error("No se encontraron articulos con CTRL_ALM = PLT o CVT.");
    const sourceDates = sourceRows.flatMap((row) => [asDate(row.FCH_ULTCOM), asDate(row.FCH_ULTVTA)]).filter(Boolean);
    const fallbackDate = new Date(file.lastModified || Date.now());
    const cutoff = sourceDates.length ? new Date(Math.max(...sourceDates.map((date) => date.valueOf()))) : fallbackDate;

    const rows = sourceRows.map((row) => {
      const fco = asNumber(row.FCO); const pis = asNumber(row.PIS); const juv = asNumber(row.JUV); const par = asNumber(row.PAR); const camp = asNumber(row.CAMP);
      const chih = fco + pis + juv + camp;
      const exist = chih + par;
      const reserved = Math.max(0, asNumber(row.EXIST) - exist);
      const sales3 = asNumber(row.ACUM_VTS_3M);
      const sales3Par = Math.max(0, asNumber(row.ACUM_VTS_PAR));
      const sales3Chih = Math.max(0, sales3 - sales3Par);
      const lastSale = asDate(row.FCH_ULTVTA);
      const lastPurchase = asDate(row.FCH_ULTCOM);
      const tier = Math.trunc(asNumber(row.TIER));
      const control = String(row.CTRL_ALM || "").trim().toUpperCase();
      return {
        sku: String(row.CVE_ART || ""), description: String(row.DESCRIPCION || row.DESCR || ""), line: String(row.LIN_PROD || ""), control,
        measure: String(row.MEDIDA || ""), brand: String(row.MARCA || ""), tier, type: control,
        fco: Math.trunc(fco), pis: Math.trunc(pis), juv: Math.trunc(juv), par: Math.trunc(par), camp: Math.trunc(camp), chih: Math.trunc(chih), exist: Math.trunc(exist), reserved: Math.trunc(reserved),
        cost: Math.round(asNumber(row.ULT_COSTO) * 100) / 100, price: Math.round(asNumber(row.PRECIO_PUBLICO) * 100) / 100,
        sales3: Math.round(sales3 * 100) / 100, sales3Chih: Math.round(sales3Chih * 100) / 100, sales3Par: Math.round(sales3Par * 100) / 100,
        daysWithoutSale: lastSale ? daysBetween(cutoff, lastSale) : 9999,
        lastPurchase: formatDate(lastPurchase), daysSincePurchase: lastPurchase ? daysBetween(cutoff, lastPurchase) : null
      };
    });
    return { dataVersion: DATA_VERSION, cutoff: formatDate(cutoff), fileName: file.name, loadedAt: new Date().toISOString(), rows };
  }

  async function loadExcel(file) {
    const error = $("sourceError");
    error.hidden = true;
    $("sourceStatus").textContent = `Procesando ${file.name}...`;
    try {
      if (typeof XLSX === "undefined") throw new Error("No se pudo cargar el lector local de Excel.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      if (!workbook.SheetNames.includes("Consulta1")) throw new Error("El archivo no contiene la hoja Consulta1.");
      const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets.Consulta1, { defval: null, raw: true });
      source = transformExcelRows(rawRows, file);
      try { localStorage.setItem("inventoryDashboardDataServillantasChihuahua", JSON.stringify(source)); } catch (_) { }
      resetAllFilters();
      updateSourceStatus();
    } catch (problem) {
      error.textContent = `No se pudo cargar el archivo: ${problem.message}`;
      error.hidden = false;
      updateSourceStatus();
    } finally {
      $("excelInput").value = "";
    }
  }

  function updateSourceStatus() {
    $("cutoffDate").textContent = source.cutoff || "No disponible";
    $("sourceStatus").textContent = source.fileName ? `${source.fileName} | ${formatNumber.format(source.rows.length)} SKU PLT/CVT | corte ${source.cutoff}` : `Datos incluidos | ${formatNumber.format(source.rows.length)} SKU PLT/CVT | corte ${source.cutoff}`;
  }

  function resetAllFilters() {
    $("searchInput").value = ""; $("typeFilter").value = "PLT"; $("branchFilter").value = "CHIH"; $("tierFilter").value = "ALL"; $("statusFilter").value = "ALL";
    $("measureSearch").value = ""; $("measurePriority").value = "ATTENTION"; $("missingTier").value = "ALL"; $("measurePurchase").value = "ALL";
    state.page = 1; state.measurePage = 1;
    applyFilters();
  }

  const branchStock = (row, branch) => branch === "PAR" ? row.par : row.chih;
  const branchSales3 = (row, branch) => branch === "PAR" ? row.sales3Par : row.sales3Chih;
  const rowMetrics = (row, branch) => {
    const stock = branchStock(row, branch);
    const sales3 = branchSales3(row, branch);
    const monthlyDemand = sales3 / 3;
    const dailyDemand = monthlyDemand / 30;
    return {
      stock, sales3, monthlyDemand,
      coverage: dailyDemand > 0 ? stock / dailyDemand : null,
      purchase: dailyDemand > 0 ? Math.max(0, Math.ceil((dailyDemand * TARGET_COVERAGE_DAYS) - stock)) : 0
    };
  };
  const evaluate = (row, branch) => {
    const { stock, monthlyDemand, coverage, purchase } = rowMetrics(row, branch);
    if (stock <= 0 && monthlyDemand > 0) return { status: "REPONER", criterion: "Quiebre" };
    if (purchase > 0) return { status: "REPONER", criterion: "Cobertura insuficiente" };
    if (stock > 0 && monthlyDemand <= 0 && row.daysSincePurchase !== null && row.daysSincePurchase <= RECENT_PURCHASE_DAYS) return { status: "OBSERVAR", criterion: "Compra reciente sin ventas" };
    if (coverage !== null && coverage > 120 && stock > 0) {
      if (row.daysSincePurchase === null) return { status: "REDUCIR", criterion: "Inventario anterior a 2023" };
      if (row.daysSincePurchase <= RECENT_PURCHASE_DAYS) return { status: "OBSERVAR", criterion: "Compra reciente" };
      return { status: "REDUCIR", criterion: "Exceso" };
    }
    if (row.daysWithoutSale >= 90 && stock > 0) return { status: "REDUCIR", criterion: "Sin movimiento" };
    return { status: "SALUDABLE", criterion: "Sin alerta" };
  };
  const activeStatus = (row, branch) => evaluate(row, branch).status;

  function applyFilters() {
    const query = $("searchInput").value.trim().toLocaleLowerCase("es-MX");
    const type = $("typeFilter").value;
    const branch = $("branchFilter").value;
    const tier = $("tierFilter").value;
    const status = $("statusFilter").value;
    state.rows = source.rows.filter((row) => {
      const haystack = `${row.sku} ${row.description} ${row.measure} ${row.brand}`.toLocaleLowerCase("es-MX");
      return (!query || haystack.includes(query)) &&
        row.control === type &&
        (tier === "ALL" || String(row.tier) === tier) &&
        (status === "ALL" || activeStatus(row, branch) === status) &&
        (branchStock(row, branch) > 0 || status === "REPONER" || status === "ALL");
    });
    state.page = 1;
    render();
  }

  function renderKpis() {
    const branch = $("branchFilter").value;
    const units = state.rows.reduce((sum, row) => sum + branchStock(row, branch), 0);
    const capital = state.rows.reduce((sum, row) => sum + branchStock(row, branch) * row.cost, 0);
    const countCriterion = (criterion) => state.rows.filter((row) => evaluate(row, branch).criterion === criterion).length;
    $("kpiUnits").textContent = formatNumber.format(units);
    $("kpiSku").textContent = `${formatNumber.format(state.rows.length)} SKU visibles`;
    $("kpiCapital").textContent = formatMoney.format(capital);
    $("kpiStockouts").textContent = formatNumber.format(countCriterion("Quiebre"));
    $("kpiExcess").textContent = formatNumber.format(countCriterion("Exceso"));
    $("kpiStale").textContent = formatNumber.format(countCriterion("Sin movimiento"));
  }

  function renderCapacity() {
    const limits = { fco: null, pis: null, juv: null, camp: null, par: null };
    const labels = { fco: "Fco. Villa", pis: "Pistolas", juv: "Juventud", camp: "Campesina", par: "Parral" };
    const type = $("typeFilter").value;
    const tires = source.rows.filter((row) => row.control === type);
    const totals = Object.keys(limits).map((key) => ({ key, value: tires.reduce((sum, row) => sum + row[key], 0), limit: limits[key] }));
    const max = Math.max(...totals.map((item) => Math.max(item.value, item.limit || 0)), 1);
    $("capacityChart").innerHTML = totals.map((item) => `<div class="capacity-row"><strong>${labels[item.key]}</strong><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, item.value / max * 100)}%"></div></div><div class="capacity-value">${formatNumber.format(item.value)} unidades</div></div>`).join("");
  }

  function renderTiers() {
    const branch = $("branchFilter").value;
    const rows = state.rows;
    const totals = [1, 2, 3, 4].map((tier) => ({ tier, value: rows.filter((row) => row.tier === tier).reduce((sum, row) => sum + branchStock(row, branch), 0) }));
    const max = Math.max(...totals.map((item) => item.value), 1);
    $("tierChart").innerHTML = totals.map((item) => `<div class="tier-row"><div class="tier-label"><strong>Tier ${item.tier}</strong><span>${formatNumber.format(item.value)} unidades</span></div><div class="bar-track"><div class="tier-fill tier-${item.tier}" style="width:${item.value / max * 100}%"></div></div></div>`).join("");
  }

  function analyzeMeasureTiers() {
    const branch = $("branchFilter").value;
    const type = $("typeFilter").value;
    const measureMap = new Map();
    source.rows.forEach((row) => {
      if (row.control !== type || !row.measure || row.tier < 1 || row.tier > 4) return;
      if (!measureMap.has(row.measure)) measureMap.set(row.measure, { measure: row.measure, rows: [], groups: new Map() });
      const measure = measureMap.get(row.measure);
      measure.rows.push(row);
      if (!measure.groups.has(row.tier)) measure.groups.set(row.tier, []);
      measure.groups.get(row.tier).push(row);
    });

    return Array.from(measureMap.values()).map((measure) => {
      const measureSales3 = measure.rows.reduce((sum, row) => sum + branchSales3(row, branch), 0);
      const measureExist = measure.rows.reduce((sum, row) => sum + branchStock(row, branch), 0);
      const tiers = [1, 2, 3, 4].map((tier) => {
        const rows = measure.groups.get(tier) || [];
        if (!rows.length) {
          return { measure: measure.measure, tier, rows, skuCount: 0, exist: null, reserved: null, sales3: null, monthlyDemand: null, coverage: null, purchase: null, capital: null, action: "SIN_OFERTA", criterion: "Sin oferta", rank: 7, primary: null, alternatives: [] };
        }
        const exist = rows.reduce((sum, row) => sum + branchStock(row, branch), 0);
        const reserved = rows.reduce((sum, row) => sum + row.reserved, 0);
        const sales3 = rows.reduce((sum, row) => sum + branchSales3(row, branch), 0);
        const monthlyDemand = sales3 / 3;
        const dailyDemand = monthlyDemand / 30;
        const coverage = dailyDemand > 0 ? exist / dailyDemand : null;
        const purchase = dailyDemand > 0 ? Math.max(0, Math.ceil((dailyDemand * TARGET_COVERAGE_DAYS) - exist)) : 0;
        const purchaseAges = rows.map((row) => row.daysSincePurchase).filter((age) => age !== null);
        const lastPurchaseAge = purchaseAges.length ? Math.min(...purchaseAges) : null;
        let action = "SALUDABLE"; let criterion = "Cobertura adecuada"; let rank = 6;
        if (exist <= 0 && monthlyDemand > 0) { action = "REPONER"; criterion = "Quiebre"; rank = 1; }
        else if (coverage !== null && coverage < TARGET_COVERAGE_DAYS) { action = "REPONER"; criterion = "Cobertura insuficiente"; rank = 2; }
        else if (monthlyDemand <= 0 && lastPurchaseAge !== null && lastPurchaseAge <= RECENT_PURCHASE_DAYS) { action = "OBSERVAR"; criterion = "Compra reciente sin ventas"; rank = 4; }
        else if (coverage !== null && coverage > 120 && lastPurchaseAge !== null && lastPurchaseAge <= RECENT_PURCHASE_DAYS) { action = "OBSERVAR"; criterion = "Compra reciente"; rank = 4; }
        else if (coverage !== null && coverage > 120) { action = "REDUCIR"; criterion = lastPurchaseAge === null ? "Inventario anterior a 2023" : "Exceso"; rank = 3; }
        else if (monthlyDemand <= 0) { action = "OBSERVAR"; criterion = "Sin demanda estimada"; rank = 5; }
        const rankedSkus = [...rows].sort((a, b) => branchSales3(b, branch) - branchSales3(a, branch) || ((b.price > 0 ? (b.price - b.cost) / b.price : 0) - (a.price > 0 ? (a.price - a.cost) / a.price : 0)) || a.cost - b.cost);
        return { measure: measure.measure, tier, rows, skuCount: rows.length, exist, reserved, sales3, monthlyDemand, coverage, purchase, capital: rows.reduce((sum, row) => sum + branchStock(row, branch) * row.cost, 0), action, criterion, rank, primary: rankedSkus[0]?.sku || "Seleccionar SKU", alternatives: rankedSkus.slice(1, 3).map((row) => row.sku) };
      });
      return { measure: measure.measure, tiers, sales3: measureSales3, exist: measureExist, rank: Math.min(...tiers.map((group) => group.rank)) };
    }).sort((a, b) => a.rank - b.rank || b.sales3 - a.sales3);
  }

  function renderTierCell(group) {
    if (!group.skuCount) return `<span class="subtle"><strong>Sin oferta</strong><br>Sin SKU registrado<br>Sin accion sugerida</span>`;
    const coverage = group.coverage === null ? "Sin demanda" : `${formatNumber.format(group.coverage)} dias`;
    const purchase = group.purchase === null ? "Definir surtido" : `Comprar ${formatNumber.format(group.purchase)}`;
    const alternatives = group.alternatives.length ? ` | Alt: ${group.alternatives.join(", ")}` : "";
    return `<button class="tier-cell-button cell-${group.action}" data-measure="${group.measure}" data-tier="${group.tier}" title="${group.criterion}. SKU principal: ${group.primary}${alternatives}"><span class="status status-${group.action}">${statusLabels[group.action]}</span><strong>${group.criterion}</strong><small>${formatNumber.format(group.exist)} disp. | ${coverage}</small><small>${purchase}</small><small>SKU: ${group.primary}</small></button>`;
  }

  function renderCriticalTierCell(group) {
    if (!group.skuCount) return `<span class="subtle"><strong>Sin oferta</strong><br>Sin SKU registrado</span>`;
    if (group.sales3 <= 0) return `<span class="subtle">Sin venta comprobable</span>`;
    return renderTierCell(group);
  }

  function updateMeasureView() {
    const critical = state.measureView === "CRITICAL";
    $("generalMeasureTab").classList.toggle("active", !critical);
    $("criticalMeasureTab").classList.toggle("active", critical);
    $("generalMeasureTab").setAttribute("aria-selected", String(!critical));
    $("criticalMeasureTab").setAttribute("aria-selected", String(critical));
    $("measureTitle").textContent = critical ? "Medidas sin inventario en ningun tier" : "Cobertura por medida y tier";
    $("measureRule").innerHTML = critical
      ? "<strong>Regla de esta vista:</strong> una medida solo aparece cuando la suma disponible de todos sus SKU y tiers es exactamente cero en la unidad seleccionada, y registra ventas comprobables mayores que cero en los ultimos tres meses. Los tiers sin SKU se muestran como Sin oferta y no generan accion."
      : "<strong>Unidad de decision:</strong> cada celda agrupa los SKU de una medida y tier para la unidad operativa seleccionada. La compra sugerida cubre 90 dias de demanda del grupo; un tier sin SKU se muestra como Sin oferta y no genera accion.";
    $("measurePriority").disabled = critical;
    $("measurePurchase").disabled = critical;
  }

  function renderMeasures() {
    const measures = analyzeMeasureTiers();
    const critical = state.measureView === "CRITICAL";
    const allGroups = measures.flatMap((item) => item.tiers);
    const attentionGroups = allGroups.filter((group) => ["REPONER", "REDUCIR", "OBSERVAR"].includes(group.action));
    const query = $("measureSearch").value.trim().toLocaleLowerCase("es-MX");
    const action = $("measurePriority").value;
    const tier = $("missingTier").value;
    const purchase = $("measurePurchase").value;
    const groupMatches = (group) => (action === "ALL" || (action === "ATTENTION" ? ["REPONER", "REDUCIR", "OBSERVAR"].includes(group.action) : group.action === action)) && (tier === "ALL" || group.tier === Number(tier)) && (purchase === "ALL" || (purchase === "YES" ? group.purchase > 0 : !(group.purchase > 0)));
    const filtered = measures.filter((item) => (!critical || (item.exist === 0 && item.sales3 > 0)) && (!query || item.measure.toLocaleLowerCase("es-MX").includes(query)) && item.tiers.some((group) => critical ? group.skuCount > 0 && group.sales3 > 0 && (tier === "ALL" || group.tier === Number(tier)) : groupMatches(group)));
    const totalPages = Math.max(1, Math.ceil(filtered.length / 15));
    state.measurePage = Math.min(state.measurePage, totalPages);
    const visible = filtered.slice((state.measurePage - 1) * 15, state.measurePage * 15);
    $("measureSummary").textContent = critical ? `${formatNumber.format(filtered.length)} medidas sin inventario en ningun tier y con ventas comprobables en 3 meses.` : `${formatNumber.format(attentionGroups.length)} grupos medida-tier requieren atencion. Filtros actuales: ${formatNumber.format(filtered.length)} medidas.`;
    $("measureBody").innerHTML = visible.map((item) => `<tr><td><strong>${item.measure}</strong></td>${item.tiers.map((group) => `<td>${critical ? renderCriticalTierCell(group) : renderTierCell(group)}</td>`).join("")}<td class="number">${formatNumber.format(item.sales3)}</td><td class="number">${formatNumber.format(item.exist)}</td></tr>`).join("");
    $("measurePageLabel").textContent = `Pagina ${state.measurePage} de ${totalPages}`;
    $("prevMeasurePage").disabled = state.measurePage <= 1;
    $("nextMeasurePage").disabled = state.measurePage >= totalPages;
  }

  function exportMeasuresExcel() {
    const critical = state.measureView === "CRITICAL";
    const query = $("measureSearch").value.trim().toLocaleLowerCase("es-MX");
    const action = $("measurePriority").value;
    const tier = $("missingTier").value;
    const purchase = $("measurePurchase").value;
    const groupMatches = (group) => (action === "ALL" || (action === "ATTENTION" ? ["REPONER", "REDUCIR", "OBSERVAR"].includes(group.action) : group.action === action)) && (tier === "ALL" || group.tier === Number(tier)) && (purchase === "ALL" || (purchase === "YES" ? group.purchase > 0 : !(group.purchase > 0)));
    const output = analyzeMeasureTiers().flatMap((item) => {
      if (critical && !(item.exist === 0 && item.sales3 > 0)) return [];
      if (query && !item.measure.toLocaleLowerCase("es-MX").includes(query)) return [];
      return item.tiers.filter((group) => critical ? group.skuCount > 0 && group.sales3 > 0 && (tier === "ALL" || group.tier === Number(tier)) : groupMatches(group)).map((group) => ({
        Clasificacion: $("typeFilter").value, Medida: item.measure, Tier: group.tier, Accion: statusLabels[group.action], Criterio: group.criterion,
        SKU_registrados: group.skuCount, Existencia_disponible: group.exist, Apartadas_no_disponibles: group.reserved,
        Venta_3M: group.sales3, Demanda_mensual_estimada: Math.round(group.monthlyDemand * 100) / 100,
        Cobertura_dias: group.coverage === null ? "" : Math.round(group.coverage), Compra_sugerida: group.purchase ?? "",
        SKU_principal: group.primary, SKU_alternativos: group.alternatives.join(", ")
      }));
    });
    if (!output.length) return alert("No hay medidas que coincidan con los filtros actuales.");
    const sheet = XLSX.utils.json_to_sheet(output);
    sheet["!cols"] = [14, 8, 12, 27, 15, 20, 23, 12, 24, 16, 17, 18, 24].map((wch) => ({ wch }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Medidas por tier");
    const unit = $("branchFilter").value.toLowerCase();
    XLSX.writeFile(workbook, `servillantas_${unit}_${critical ? "medidas_criticas_sin_inventario" : "medidas_por_tier"}_${(source.cutoff || "sin_fecha").replaceAll("/", "-")}.xlsx`);
  }

  function renderTable() {
    const branch = $("branchFilter").value;
    const totalPages = Math.max(1, Math.ceil(state.rows.length / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * state.pageSize;
    const rows = state.rows.slice(start, start + state.pageSize);
    $("inventoryBody").innerHTML = rows.map((row) => {
      const evaluation = evaluate(row, branch);
      const metrics = rowMetrics(row, branch);
      const status = evaluation.status;
      const coverage = metrics.coverage === null ? "Sin demanda" : `${formatNumber.format(metrics.coverage)} dias`;
      return `<tr><td><span class="status status-${status}">${statusLabels[status]}</span></td><td><strong>${evaluation.criterion}</strong></td><td>${row.sku}</td><td>${row.description}</td><td>${row.measure || "-"}</td><td>${row.brand || "-"}</td><td>${row.control}</td><td>${row.tier || "-"}</td><td class="number">${formatNumber.format(metrics.stock)}</td><td class="number">${formatNumber.format(row.reserved)}</td><td class="number">${coverage}</td><td>${row.lastPurchase || "Sin fecha"}</td><td class="number">${row.daysSincePurchase ?? "-"}</td><td class="number">${formatNumber.format(metrics.sales3)}</td><td class="number">${formatMoney.format(metrics.stock * row.cost)}</td></tr>`;
    }).join("");
    $("resultCount").textContent = `${formatNumber.format(state.rows.length)} resultados`;
    $("pageLabel").textContent = `Pagina ${state.page} de ${totalPages}`;
    $("prevPage").disabled = state.page <= 1;
    $("nextPage").disabled = state.page >= totalPages;
  }

  function render() { renderKpis(); renderCapacity(); renderTiers(); renderMeasures(); renderTable(); }

  function exportCsv() {
    const branch = $("branchFilter").value;
    const header = ["Unidad_operativa", "Clasificacion", "Accion", "Motivo", "SKU", "Descripcion", "Medida", "Marca", "Tier", "Existencia_disponible", "Apartadas_generales_no_disponibles", "Cobertura_dias", "Ultima_compra", "Dias_desde_compra", "Venta_3M", "Ultimo_costo"];
    const lines = state.rows.map((row) => { const result = evaluate(row, branch); const metrics = rowMetrics(row, branch); return [branch === "PAR" ? "Parral" : "Chihuahua consolidado", row.control, statusLabels[result.status], result.criterion, row.sku, row.description, row.measure, row.brand, row.tier, metrics.stock, row.reserved, metrics.coverage ?? "", row.lastPurchase ?? "", row.daysSincePurchase ?? "", metrics.sales3, row.cost]; });
    const csv = [header, ...lines].map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    link.download = `servillantas_${branch.toLowerCase()}_inventario_filtrado_${source.cutoff.replaceAll("/", "-")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  ["searchInput", "typeFilter", "branchFilter", "tierFilter", "statusFilter"].forEach((id) => $(id).addEventListener(id === "searchInput" ? "input" : "change", applyFilters));
  $("resetButton").addEventListener("click", () => { $("searchInput").value = ""; $("typeFilter").value = "PLT"; $("branchFilter").value = "CHIH"; $("tierFilter").value = "ALL"; $("statusFilter").value = "ALL"; applyFilters(); });
  $("prevPage").addEventListener("click", () => { state.page--; renderTable(); });
  $("nextPage").addEventListener("click", () => { state.page++; renderTable(); });
  ["measureSearch", "measurePriority", "missingTier", "measurePurchase"].forEach((id) => $(id).addEventListener(id === "measureSearch" ? "input" : "change", () => { state.measurePage = 1; renderMeasures(); }));
  $("prevMeasurePage").addEventListener("click", () => { state.measurePage--; renderMeasures(); });
  $("nextMeasurePage").addEventListener("click", () => { state.measurePage++; renderMeasures(); });
  $("measureBody").addEventListener("click", (event) => {
    const cell = event.target.closest(".tier-cell-button");
    if (!cell) return;
    $("searchInput").value = cell.dataset.measure;
    $("tierFilter").value = cell.dataset.tier;
    $("statusFilter").value = "ALL";
    applyFilters();
    document.querySelector(".table-section").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("exportButton").addEventListener("click", exportCsv);
  $("exportMeasuresButton").addEventListener("click", exportMeasuresExcel);
  $("generalMeasureTab").addEventListener("click", () => { state.measureView = "GENERAL"; state.measurePage = 1; updateMeasureView(); renderMeasures(); });
  $("criticalMeasureTab").addEventListener("click", () => { state.measureView = "CRITICAL"; state.measurePage = 1; updateMeasureView(); renderMeasures(); });
  $("generalSupplierInput").addEventListener("change", (event) => { const file = event.target.files[0]; if (file) loadSupplier(file, "general"); event.target.value = ""; });
  $("t53SupplierInput").addEventListener("change", (event) => { const file = event.target.files[0]; if (file) loadSupplier(file, "t53"); event.target.value = ""; });
  $("previewHomologationButton").addEventListener("click", buildHomologationPreview);
  $("exportHomologationButton").addEventListener("click", exportHomologationPreview);
  $("compareSuppliersButton").addEventListener("click", calculateSupplierRecommendations);
  $("exportSupplierButton").addEventListener("click", exportSupplierRecommendations);
  $("branchFilter").addEventListener("change", () => { if (state.suppliers.general && state.suppliers.t53) calculateSupplierRecommendations(); });
  $("excelInput").addEventListener("change", (event) => { const file = event.target.files[0]; if (file) loadExcel(file); });
  $("restoreDataButton").addEventListener("click", () => { source = bundledSource; try { localStorage.removeItem("inventoryDashboardDataServillantasChihuahua"); } catch (_) { } resetAllFilters(); updateSourceStatus(); });
  updateMeasureView();
  updateSourceStatus();
  applyFilters();
})();
