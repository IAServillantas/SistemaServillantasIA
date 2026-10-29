(() => {
  const SITE = "general";
  const STORAGE_KEY = "inventoryDashboardData";
  const bundledSource = Inventory.upgrade(window.INVENTORY_DATA || { cutoff: "", rows: [] });
  const RULES = window.INVENTORY_RULES;
  const TARGET_COVERAGE_DAYS = RULES.inventory.targetCoverageDays;
  const RECENT_PURCHASE_DAYS = RULES.inventory.recentPurchaseDays;
  function applyCurrentPurchaseTarget(data) {
    if (!data || !Array.isArray(data.rows)) return data;
    return { ...data, rows: data.rows.map((row) => ({
      ...row,
      purchase: Math.max(0, Math.ceil(((Number(row.monthlyDemand) || 0) / 30 * TARGET_COVERAGE_DAYS) - (Number(row.exist) || 0)))
    })) };
  }
  let source = bundledSource;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) source = Inventory.upgrade(JSON.parse(stored));
  } catch (_) { }
  source = applyCurrentPurchaseTarget(source);

  async function persistSource(next, { saveCloud = true } = {}) {
    source = applyCurrentPurchaseTarget(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(source)); } catch (_) { }
    if (saveCloud && window.InventorySync) {
      try { await InventorySync.save(SITE, source); }
      catch (err) { console.warn("No se pudo guardar en Supabase:", err.message || err); }
    }
  }

  async function loadFromCloud() {
    const error = $("sourceError");
    error.hidden = true;
    $("sourceStatus").textContent = "Cargando desde Supabase...";
    try {
      if (!window.InventorySync) throw new Error("InventorySync no disponible.");
      const remote = await InventorySync.loadActive(SITE);
      if (!remote || !Array.isArray(remote.rows) || !remote.rows.length) {
        throw new Error("No hay snapshot activo en Supabase para este sitio.");
      }
      await persistSource(Inventory.upgrade(remote), { saveCloud: false });
      resetAllFilters();
      updateSourceStatus("Supabase");
    } catch (problem) {
      error.textContent = `Supabase: ${problem.message}`;
      error.hidden = false;
      updateSourceStatus();
    }
  }
  const state = { page: 1, pageSize: 50, rows: [], measurePage: 1, measurePageSize: 25, measureView: "GENERAL" };
  const $ = (id) => document.getElementById(id);
  const formatNumber = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
  const formatMoney = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  const statusLabels = { REPONER: "Reponer", REDUCIR: "Reducir", OBSERVAR: "Observar", SALUDABLE: "Saludable", SIN_OFERTA: "Sin accion" };
  const requiredColumns = ["CVE_ART", "DESCRIPCION", "CTRL_ALM", "MEDIDA", "MARCA", "TIER", "SAT", "INS", "CUE", "TOR", "ULT_COSTO", "EXIST", "FCH_ULTCOM", "FCH_ULTVTA", "ACUM_VTS_3M", "ACUM_VTS_6M.SUM"];
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

    const sourceRows = rawRows.filter((row) => String(row.CTRL_ALM || "").trim().toUpperCase() === "PLT");
    if (!sourceRows.length) throw new Error("No se encontraron articulos con CTRL_ALM = PLT.");
    const sourceDates = sourceRows.flatMap((row) => [asDate(row.FCH_ULTCOM), asDate(row.FCH_ULTVTA)]).filter(Boolean);
    const fallbackDate = new Date(file.lastModified || Date.now());
    const cutoff = sourceDates.length ? new Date(Math.max(...sourceDates.map((date) => date.valueOf()))) : fallbackDate;

    const rows = sourceRows.map((row) => {
      const sat = asNumber(row.SAT); const ins = asNumber(row.INS); const cue = asNumber(row.CUE); const tor = asNumber(row.TOR);
      const stock = Inventory.calculate(asNumber(row.EXIST), [sat, ins, cue, tor]);
      const exist = stock.availableStock;
      const reserved = stock.reservedStock;
      const sales3 = asNumber(row.ACUM_VTS_3M);
      const sales6 = asNumber(row["ACUM_VTS_6M.SUM"]);
      const recentMonthly = sales3 / 3;
      const priorMonthly = Math.max(0, sales6 - sales3) / 3;
      const monthlyDemand = ((2 * recentMonthly) + priorMonthly) / 3;
      const dailyDemand = monthlyDemand / 30;
      const coverage = dailyDemand > 0 ? Math.round(exist / dailyDemand) : null;
      const purchase = Math.max(0, Math.ceil((dailyDemand * TARGET_COVERAGE_DAYS) - exist));
      const lastSale = asDate(row.FCH_ULTVTA);
      const lastPurchase = asDate(row.FCH_ULTCOM);
      const tier = Math.trunc(asNumber(row.TIER));
      return {
        ...stock,
        sku: String(row.CVE_ART || ""), description: String(row.DESCRIPCION || row.DESCR || ""), line: String(row.LIN_PROD || ""), control: "PLT",
        measure: String(row.MEDIDA || ""), brand: String(row.MARCA || ""), tier, type: "LLANTA",
        sat: Math.trunc(sat), ins: Math.trunc(ins), cue: Math.trunc(cue), tor: Math.trunc(tor), exist: Math.trunc(exist), reserved: Math.trunc(reserved),
        cost: Math.round(asNumber(row.ULT_COSTO) * 100) / 100, price: Math.round(asNumber(row.PRECIO_PUBLICO) * 100) / 100,
        sales3: Math.round(sales3 * 100) / 100, sales6: Math.round(sales6 * 100) / 100, monthlyDemand: Math.round(monthlyDemand * 100) / 100,
        coverage, purchase, daysWithoutSale: lastSale ? daysBetween(cutoff, lastSale) : 9999,
        lastPurchase: formatDate(lastPurchase), daysSincePurchase: lastPurchase ? daysBetween(cutoff, lastPurchase) : null
      };
    });
    return { cutoff: formatDate(cutoff), fileName: file.name, loadedAt: new Date().toISOString(), rows };
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
      await persistSource(transformExcelRows(rawRows, file));
      resetAllFilters();
      updateSourceStatus("Excel + Supabase");
    } catch (problem) {
      error.textContent = `No se pudo cargar el archivo: ${problem.message}`;
      error.hidden = false;
      updateSourceStatus();
    } finally {
      $("excelInput").value = "";
    }
  }

  function updateSourceStatus(origin) {
    $("cutoffDate").textContent = source.cutoff || "No disponible";
    const base = source.fileName
      ? `${source.fileName} | ${formatNumber.format(source.rows.length)} SKU PLT | corte ${source.cutoff}`
      : `Datos incluidos | ${formatNumber.format(source.rows.length)} SKU PLT | corte ${source.cutoff}`;
    $("sourceStatus").textContent = origin ? `${base} · ${origin}` : base;
  }

  function resetAllFilters() {
    $("searchInput").value = ""; $("branchFilter").value = "TOTAL"; $("tierFilter").value = "ALL"; $("statusFilter").value = "ALL";
    $("measureSearch").value = ""; $("measurePriority").value = "ATTENTION"; $("missingTier").value = "ALL"; $("measurePurchase").value = "ALL";
    state.page = 1; state.measurePage = 1;
    applyFilters();
  }

  const branchStock = (row, branch) => branch === "TOTAL" ? row.exist : row[branch.toLowerCase()];
  const evaluate = (row, branch) => {
    const stock = branchStock(row, branch);
    if (stock <= 0 && row.monthlyDemand > 0) return { status: "REPONER", criterion: "Quiebre" };
    if (row.purchase > 0) return { status: "REPONER", criterion: "Cobertura insuficiente" };
    if (stock > 0 && row.monthlyDemand <= 0 && row.daysSincePurchase !== null && row.daysSincePurchase <= RECENT_PURCHASE_DAYS) return { status: "OBSERVAR", criterion: "Compra reciente sin ventas" };
    if (row.coverage !== null && row.coverage > RULES.inventory.excessDays && stock > 0) {
      if (row.daysSincePurchase === null) return { status: "REDUCIR", criterion: "Inventario anterior a 2023" };
      if (row.daysSincePurchase <= RECENT_PURCHASE_DAYS) return { status: "OBSERVAR", criterion: "Compra reciente" };
      return { status: "REDUCIR", criterion: "Exceso" };
    }
    if (row.daysWithoutSale >= RULES.inventory.noMovementDays && stock > 0) return { status: "REDUCIR", criterion: "Sin movimiento" };
    return { status: "SALUDABLE", criterion: "Sin alerta" };
  };
  const activeStatus = (row, branch) => evaluate(row, branch).status;

  function applyFilters() {
    const query = $("searchInput").value.trim().toLocaleLowerCase("es-MX");
    const branch = $("branchFilter").value;
    const tier = $("tierFilter").value;
    const status = $("statusFilter").value;
    state.rows = source.rows.filter((row) => {
      const haystack = `${row.sku} ${row.description} ${row.measure} ${row.brand}`.toLocaleLowerCase("es-MX");
      return (!query || haystack.includes(query)) &&
        (tier === "ALL" || String(row.tier) === tier) &&
        (status === "ALL" || activeStatus(row, branch) === status) &&
        (branch === "TOTAL" || branchStock(row, branch) > 0 || status === "REPONER");
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
    const limits = RULES.general.capacity;
    const labels = { sat: "Satelite", ins: "Insurgentes", cue: "Cuesta", tor: "Torres" };
    const tires = source.rows.filter((row) => row.type === "LLANTA");
    const totals = Object.keys(limits).map((key) => ({ key, value: tires.reduce((sum, row) => sum + row[key], 0), limit: limits[key] }));
    const max = Math.max(...totals.map((item) => Math.max(item.value, item.limit || 0)), 1);
    $("capacityChart").innerHTML = totals.map((item) => `<div class="capacity-row"><strong>${labels[item.key]}</strong><div class="bar-track"><div class="bar-fill ${item.limit && item.value > item.limit ? "over" : ""}" style="width:${Math.min(100, item.value / max * 100)}%"></div></div><div class="capacity-value">${formatNumber.format(item.value)}${item.limit ? ` / ${formatNumber.format(item.limit)}` : " / sin limite"}</div></div>`).join("");
  }

  function renderTiers() {
    const rows = state.rows.filter((row) => row.type === "LLANTA");
    const totals = [1, 2, 3, 4].map((tier) => ({ tier, value: rows.filter((row) => row.tier === tier).reduce((sum, row) => sum + row.exist, 0) }));
    const max = Math.max(...totals.map((item) => item.value), 1);
    $("tierChart").innerHTML = totals.map((item) => `<div class="tier-row"><div class="tier-label"><strong>Tier ${item.tier}</strong><span>${formatNumber.format(item.value)} unidades</span></div><div class="bar-track"><div class="tier-fill tier-${item.tier}" style="width:${item.value / max * 100}%"></div></div></div>`).join("");
  }

  function analyzeMeasureTiers() {
    const measureMap = new Map();
    source.rows.forEach((row) => {
      if (!row.measure || row.tier < 1 || row.tier > 4) return;
      if (!measureMap.has(row.measure)) measureMap.set(row.measure, { measure: row.measure, rows: [], groups: new Map() });
      const measure = measureMap.get(row.measure);
      measure.rows.push(row);
      if (!measure.groups.has(row.tier)) measure.groups.set(row.tier, []);
      measure.groups.get(row.tier).push(row);
    });

    return Array.from(measureMap.values()).map((measure) => {
      const measureSales6 = measure.rows.reduce((sum, row) => sum + row.sales6, 0);
      const measureExist = measure.rows.reduce((sum, row) => sum + row.exist, 0);
      const tiers = [1, 2, 3, 4].map((tier) => {
        const rows = measure.groups.get(tier) || [];
        if (!rows.length) {
          return { measure: measure.measure, tier, rows, skuCount: 0, exist: null, reserved: null, sales6: null, monthlyDemand: null, coverage: null, purchase: null, capital: null, action: "SIN_OFERTA", criterion: "Sin oferta", rank: 7, primary: null, alternatives: [] };
        }
        const exist = rows.reduce((sum, row) => sum + row.exist, 0);
        const reserved = rows.reduce((sum, row) => sum + row.reserved, 0);
        const sales6 = rows.reduce((sum, row) => sum + row.sales6, 0);
        const monthlyDemand = rows.reduce((sum, row) => sum + row.monthlyDemand, 0);
        const dailyDemand = monthlyDemand / 30;
        const coverage = dailyDemand > 0 ? exist / dailyDemand : null;
        const purchase = dailyDemand > 0 ? Math.max(0, Math.ceil((dailyDemand * TARGET_COVERAGE_DAYS) - exist)) : 0;
        const purchaseAges = rows.map((row) => row.daysSincePurchase).filter((age) => age !== null);
        const lastPurchaseAge = purchaseAges.length ? Math.min(...purchaseAges) : null;
        let action = "SALUDABLE"; let criterion = "Cobertura adecuada"; let rank = 6;
        if (exist <= 0 && monthlyDemand > 0) { action = "REPONER"; criterion = "Quiebre"; rank = 1; }
        else if (coverage !== null && coverage < TARGET_COVERAGE_DAYS) { action = "REPONER"; criterion = "Cobertura insuficiente"; rank = 2; }
        else if (monthlyDemand <= 0 && lastPurchaseAge !== null && lastPurchaseAge <= RECENT_PURCHASE_DAYS) { action = "OBSERVAR"; criterion = "Compra reciente sin ventas"; rank = 4; }
        else if (coverage !== null && coverage > RULES.inventory.excessDays && lastPurchaseAge !== null && lastPurchaseAge <= RECENT_PURCHASE_DAYS) { action = "OBSERVAR"; criterion = "Compra reciente"; rank = 4; }
        else if (coverage !== null && coverage > RULES.inventory.excessDays) { action = "REDUCIR"; criterion = lastPurchaseAge === null ? "Inventario anterior a 2023" : "Exceso"; rank = 3; }
        else if (monthlyDemand <= 0) { action = "OBSERVAR"; criterion = "Sin demanda estimada"; rank = 5; }
        const rankedSkus = [...rows].sort((a, b) => b.sales3 - a.sales3 || ((b.price > 0 ? (b.price - b.cost) / b.price : 0) - (a.price > 0 ? (a.price - a.cost) / a.price : 0)) || a.cost - b.cost);
        return { measure: measure.measure, tier, rows, skuCount: rows.length, exist, reserved, sales6, monthlyDemand, coverage, purchase, capital: rows.reduce((sum, row) => sum + row.exist * row.cost, 0), action, criterion, rank, primary: rankedSkus[0]?.sku || "Seleccionar SKU", alternatives: rankedSkus.slice(1, 3).map((row) => row.sku) };
      });
      return { measure: measure.measure, tiers, sales6: measureSales6, exist: measureExist, rank: Math.min(...tiers.map((group) => group.rank)) };
    }).sort((a, b) => a.rank - b.rank || b.sales6 - a.sales6);
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
    if (group.sales6 <= 0) return `<span class="subtle">Sin venta comprobable</span>`;
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
      ? "<strong>Regla de esta vista:</strong> una medida solo aparece cuando la suma disponible de todos sus SKU, tiers y sucursales es exactamente cero, y registra ventas comprobables mayores que cero en los ultimos seis meses. Los tiers sin SKU se muestran como Sin oferta y no generan accion."
      : "<strong>Unidad de decision:</strong> cada celda agrupa todos los SKU de una medida y tier. La compra sugerida cubre 90 dias de demanda del grupo; no se suma una compra por cada codigo. Un tier sin SKU se muestra como Sin oferta y no genera accion.";
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
    const filtered = measures.filter((item) => (!critical || (item.exist === 0 && item.sales6 > 0)) && (!query || item.measure.toLocaleLowerCase("es-MX").includes(query)) && item.tiers.some((group) => critical ? group.skuCount > 0 && group.sales6 > 0 && (tier === "ALL" || group.tier === Number(tier)) : groupMatches(group)));
    const totalPages = Math.max(1, Math.ceil(filtered.length / 15));
    state.measurePage = Math.min(state.measurePage, totalPages);
    const visible = filtered.slice((state.measurePage - 1) * 15, state.measurePage * 15);
    $("measureSummary").textContent = critical ? `${formatNumber.format(filtered.length)} medidas sin inventario en ningun tier y con ventas comprobables en 6 meses.` : `${formatNumber.format(attentionGroups.length)} grupos medida-tier requieren atencion. Filtros actuales: ${formatNumber.format(filtered.length)} medidas.`;
    $("measureBody").innerHTML = visible.map((item) => `<tr><td><strong>${item.measure}</strong></td>${item.tiers.map((group) => `<td>${critical ? renderCriticalTierCell(group) : renderTierCell(group)}</td>`).join("")}<td class="number">${formatNumber.format(item.sales6)}</td><td class="number">${formatNumber.format(item.exist)}</td></tr>`).join("");
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
      if (critical && !(item.exist === 0 && item.sales6 > 0)) return [];
      if (query && !item.measure.toLocaleLowerCase("es-MX").includes(query)) return [];
      return item.tiers.filter((group) => critical ? group.skuCount > 0 && group.sales6 > 0 && (tier === "ALL" || group.tier === Number(tier)) : groupMatches(group)).map((group) => ({
        Medida: item.measure, Tier: group.tier, Accion: statusLabels[group.action], Criterio: group.criterion,
        SKU_registrados: group.skuCount, Existencia_disponible: group.exist, Apartadas_no_disponibles: group.reserved,
        Venta_6M: group.sales6, Demanda_mensual_estimada: Math.round(group.monthlyDemand * 100) / 100,
        Cobertura_dias: group.coverage === null ? "" : Math.round(group.coverage), Compra_sugerida: group.purchase ?? "",
        SKU_principal: group.primary, SKU_alternativos: group.alternatives.join(", ")
      }));
    });
    if (!output.length) return alert("No hay medidas que coincidan con los filtros actuales.");
    const sheet = XLSX.utils.json_to_sheet(output);
    sheet["!cols"] = [14, 8, 12, 27, 15, 20, 23, 12, 24, 16, 17, 18, 24].map((wch) => ({ wch }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Medidas por tier");
    XLSX.writeFile(workbook, `${critical ? "medidas_criticas_sin_inventario" : "medidas_por_tier"}_${(source.cutoff || "sin_fecha").replaceAll("/", "-")}.xlsx`);
  }

  function renderTable() {
    const branch = $("branchFilter").value;
    const totalPages = Math.max(1, Math.ceil(state.rows.length / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * state.pageSize;
    const rows = state.rows.slice(start, start + state.pageSize);
    $("inventoryBody").innerHTML = rows.map((row) => {
      const evaluation = evaluate(row, branch);
      const status = evaluation.status;
      const coverage = row.coverage === null ? "Sin demanda" : `${formatNumber.format(row.coverage)} dias`;
      return `<tr><td><span class="status status-${status}">${statusLabels[status]}</span></td><td><strong>${evaluation.criterion}</strong></td><td>${row.sku}</td><td>${row.description}</td><td>${row.measure || "-"}</td><td>${row.brand || "-"}</td><td>${row.tier || "-"}</td><td class="number">${formatNumber.format(branchStock(row, branch))}</td><td class="number">${formatNumber.format(branch === "TOTAL" ? row.reserved : 0)}</td><td class="number">${coverage}</td><td>${row.lastPurchase || "Sin fecha"}</td><td class="number">${row.daysSincePurchase ?? "-"}</td><td class="number">${formatNumber.format(row.sales6)}</td><td class="number">${formatMoney.format(branchStock(row, branch) * row.cost)}</td></tr>`;
    }).join("");
    $("resultCount").textContent = `${formatNumber.format(state.rows.length)} resultados`;
    $("pageLabel").textContent = `Pagina ${state.page} de ${totalPages}`;
    $("prevPage").disabled = state.page <= 1;
    $("nextPage").disabled = state.page >= totalPages;
  }

  function render() { renderKpis(); renderCapacity(); renderTiers(); renderMeasures(); renderTable(); }

  function exportCsv() {
    const branch = $("branchFilter").value;
    const header = ["Accion", "Motivo", "SKU", "Descripcion", "Medida", "Marca", "Tier", "Existencia_disponible", "Apartadas_no_disponibles", "Cobertura_dias", "Ultima_compra", "Dias_desde_compra", "Venta_6M", "Ultimo_costo"];
    const lines = state.rows.map((row) => { const result = evaluate(row, branch); return [statusLabels[result.status], result.criterion, row.sku, row.description, row.measure, row.brand, row.tier, branchStock(row, branch), branch === "TOTAL" ? row.reserved : 0, row.coverage ?? "", row.lastPurchase ?? "", row.daysSincePurchase ?? "", row.sales6, row.cost]; });
    const csv = [header, ...lines].map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    link.download = `inventario_filtrado_${source.cutoff.replaceAll("/", "-")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  ["searchInput", "branchFilter", "tierFilter", "statusFilter"].forEach((id) => $(id).addEventListener(id === "searchInput" ? "input" : "change", applyFilters));
  $("resetButton").addEventListener("click", () => { $("searchInput").value = ""; $("branchFilter").value = "TOTAL"; $("tierFilter").value = "ALL"; $("statusFilter").value = "ALL"; applyFilters(); });
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
  $("excelInput").addEventListener("change", (event) => { const file = event.target.files[0]; if (file) loadExcel(file); });
  $("cloudLoadButton").addEventListener("click", () => { loadFromCloud(); });
  $("restoreDataButton").addEventListener("click", () => { source = bundledSource; try { localStorage.removeItem(STORAGE_KEY); } catch (_) { } resetAllFilters(); updateSourceStatus("local"); });
  updateMeasureView();
  (async () => {
    updateSourceStatus();
    applyFilters();
    try {
      if (!window.InventorySync) return;
      const remote = await InventorySync.loadActive(SITE);
      if (remote && Array.isArray(remote.rows) && remote.rows.length) {
        await persistSource(Inventory.upgrade(remote), { saveCloud: false });
        resetAllFilters();
        updateSourceStatus("Supabase");
      }
    } catch (err) {
      console.warn("Arranque Supabase:", err.message || err);
    }
  })();
})();
