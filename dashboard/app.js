(() => {
  const bundledSource = window.INVENTORY_DATA || { cutoff: "", rows: [] };
  let source = bundledSource;
  try {
    const stored = localStorage.getItem("inventoryDashboardData");
    if (stored) source = JSON.parse(stored);
  } catch (_) { }
  const state = { page: 1, pageSize: 50, rows: [], measurePage: 1, measurePageSize: 25 };
  const $ = (id) => document.getElementById(id);
  const formatNumber = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
  const formatMoney = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  const statusLabels = { REPONER: "Reponer", REDUCIR: "Reducir", OBSERVAR: "Observar", SALUDABLE: "Saludable" };
  const requiredColumns = ["CVE_ART", "DESCRIPCION", "CTRL_ALM", "MEDIDA", "MARCA", "TIER", "SAT", "INS", "CUE", "TOR", "ULT_COSTO", "EXIST", "FCH_ULTCOM", "FCH_ULTVTA", "ACUM_VTS_3M", "ACUM_VTS_6M.SUM"];

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
    const columns = Object.keys(rawRows[0]);
    const missing = requiredColumns.filter((column) => !columns.includes(column));
    if (missing.length) throw new Error(`Faltan columnas obligatorias: ${missing.join(", ")}.`);

    const sourceRows = rawRows.filter((row) => String(row.CTRL_ALM || "").trim().toUpperCase() === "PLT");
    if (!sourceRows.length) throw new Error("No se encontraron articulos con CTRL_ALM = PLT.");
    const sourceDates = sourceRows.flatMap((row) => [asDate(row.FCH_ULTCOM), asDate(row.FCH_ULTVTA)]).filter(Boolean);
    const fallbackDate = new Date(file.lastModified || Date.now());
    const cutoff = sourceDates.length ? new Date(Math.max(...sourceDates.map((date) => date.valueOf()))) : fallbackDate;

    const rows = sourceRows.map((row) => {
      const sat = asNumber(row.SAT); const ins = asNumber(row.INS); const cue = asNumber(row.CUE); const tor = asNumber(row.TOR);
      const exist = sat + ins + cue + tor;
      const reserved = Math.max(0, asNumber(row.EXIST) - exist);
      const sales3 = asNumber(row.ACUM_VTS_3M);
      const sales6 = asNumber(row["ACUM_VTS_6M.SUM"]);
      const recentMonthly = sales3 / 3;
      const priorMonthly = Math.max(0, sales6 - sales3) / 3;
      const monthlyDemand = ((2 * recentMonthly) + priorMonthly) / 3;
      const dailyDemand = monthlyDemand / 30;
      const coverage = dailyDemand > 0 ? Math.round(exist / dailyDemand) : null;
      const purchase = Math.max(0, Math.ceil((dailyDemand * 105) - exist));
      const lastSale = asDate(row.FCH_ULTVTA);
      const lastPurchase = asDate(row.FCH_ULTCOM);
      const tier = Math.trunc(asNumber(row.TIER));
      return {
        sku: String(row.CVE_ART || ""), description: String(row.DESCRIPCION || row.DESCR || ""), line: String(row.LIN_PROD || ""), control: "PLT",
        measure: String(row.MEDIDA || ""), brand: String(row.MARCA || ""), tier, type: "LLANTA",
        sat: Math.trunc(sat), ins: Math.trunc(ins), cue: Math.trunc(cue), tor: Math.trunc(tor), exist: Math.trunc(exist), reserved: Math.trunc(reserved),
        cost: Math.round(asNumber(row.ULT_COSTO) * 100) / 100, price: Math.round(asNumber(row["Precio publico"] ?? row["Precio público"]) * 100) / 100,
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
      source = transformExcelRows(rawRows, file);
      try { localStorage.setItem("inventoryDashboardData", JSON.stringify(source)); } catch (_) { }
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
    $("sourceStatus").textContent = source.fileName ? `${source.fileName} | ${formatNumber.format(source.rows.length)} SKU PLT | corte ${source.cutoff}` : `Datos incluidos | ${formatNumber.format(source.rows.length)} SKU PLT | corte ${source.cutoff}`;
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
    if (row.coverage !== null && row.coverage > 120 && stock > 0) {
      if (row.daysSincePurchase === null) return { status: "REDUCIR", criterion: "Inventario anterior a 2023" };
      if (row.daysSincePurchase <= 30) return { status: "OBSERVAR", criterion: "Compra reciente" };
      return { status: "REDUCIR", criterion: "Exceso" };
    }
    if (row.daysWithoutSale >= 90 && stock > 0) return { status: "REDUCIR", criterion: "Sin movimiento" };
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
    const limits = { sat: 1000, ins: null, cue: 300, tor: 300 };
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

  function analyzeMeasures() {
    const groups = new Map();
    source.rows.forEach((row) => {
      if (!row.measure) return;
      if (!groups.has(row.measure)) groups.set(row.measure, { measure: row.measure, exist: 0, reserved: 0, sales3: 0, sales6: 0, monthlyDemand: 0, purchase: 0, capital: 0, tiers: new Set(), purchaseAges: [], saleAges: [] });
      const group = groups.get(row.measure);
      group.exist += row.exist;
      group.reserved += row.reserved;
      group.sales3 += row.sales3;
      group.sales6 += row.sales6;
      group.monthlyDemand += row.monthlyDemand;
      group.purchase += row.purchase;
      group.capital += row.exist * row.cost;
      if (row.exist > 0 && row.tier >= 1 && row.tier <= 4) group.tiers.add(row.tier);
      if (row.daysSincePurchase !== null) group.purchaseAges.push(row.daysSincePurchase);
      if (row.daysWithoutSale !== null) group.saleAges.push(row.daysWithoutSale);
    });

    return Array.from(groups.values()).map((group) => {
      const missing = [1, 2, 3, 4].filter((tier) => !group.tiers.has(tier));
      const dailyDemand = group.monthlyDemand / 30;
      const coverage = dailyDemand > 0 ? group.exist / dailyDemand : null;
      const lastPurchaseAge = group.purchaseAges.length ? Math.min(...group.purchaseAges) : null;
      const lastSaleAge = group.saleAges.length ? Math.min(...group.saleAges) : 9999;
      let priority = "SALUDABLE";
      let reason = "Disponibilidad y cobertura sin alertas";
      let rank = 6;
      if (group.sales6 > 0 && missing.length > 0) {
        priority = "CRITICA"; reason = `Faltan tiers ${missing.join(", ")} con demanda registrada`; rank = 1;
      } else if (coverage !== null && coverage < 105) {
        priority = "REPONER"; reason = `Cobertura de ${formatNumber.format(coverage)} dias, menor al objetivo de 105`; rank = 2;
      } else if (coverage !== null && coverage > 120 && (lastPurchaseAge === null || lastPurchaseAge > 30)) {
        priority = "REDUCIR"; reason = lastPurchaseAge === null ? "Cobertura mayor a 120 dias; inventario anterior a 2023" : `Cobertura mayor a 120 dias; ultima compra hace ${lastPurchaseAge} dias`; rank = 3;
      } else if (group.exist > 0 && lastSaleAge >= 90) {
        priority = "SIN_MOVIMIENTO"; reason = `${lastSaleAge} dias desde la venta mas reciente`; rank = 4;
      } else if (coverage !== null && coverage > 120 && lastPurchaseAge <= 30) {
        priority = "OBSERVAR"; reason = `Compra reciente hace ${lastPurchaseAge} dias`; rank = 5;
      }
      return { ...group, tiers: Array.from(group.tiers).sort(), missing, coverage, priority, reason, rank };
    }).sort((a, b) => a.rank - b.rank || b.missing.length - a.missing.length || b.purchase - a.purchase || b.capital - a.capital);
  }

  function renderMeasures() {
    const measures = analyzeMeasures();
    const attention = measures.filter((item) => item.priority !== "SALUDABLE");
    const critical = attention.filter((item) => item.priority === "CRITICA").length;
    const query = $("measureSearch").value.trim().toLocaleLowerCase("es-MX");
    const priority = $("measurePriority").value;
    const missingTier = $("missingTier").value;
    const purchase = $("measurePurchase").value;
    const filtered = measures.filter((item) => {
      return (!query || item.measure.toLocaleLowerCase("es-MX").includes(query)) &&
        (priority === "ALL" || (priority === "ATTENTION" ? item.priority !== "SALUDABLE" : item.priority === priority)) &&
        (missingTier === "ALL" || (missingTier === "NONE" ? item.missing.length === 0 : item.missing.includes(Number(missingTier)))) &&
        (purchase === "ALL" || (purchase === "YES" ? item.purchase > 0 : item.purchase <= 0));
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.measurePageSize));
    state.measurePage = Math.min(state.measurePage, totalPages);
    const start = (state.measurePage - 1) * state.measurePageSize;
    const visible = filtered.slice(start, start + state.measurePageSize);
    $("measureSummary").textContent = `${formatNumber.format(critical)} medidas criticas; ${formatNumber.format(attention.length)} requieren atencion. Filtros actuales: ${formatNumber.format(filtered.length)} resultados.`;
    $("measureBody").innerHTML = visible.map((item) => `<tr><td><span class="status status-${item.priority}">${item.priority === "SIN_MOVIMIENTO" ? "Sin movimiento" : item.priority.charAt(0) + item.priority.slice(1).toLowerCase()}</span></td><td>${item.reason}</td><td><strong>${item.measure}</strong></td><td>${item.tiers.length ? item.tiers.join(", ") : "Ninguno"}</td><td>${item.missing.length ? item.missing.join(", ") : "Ninguno"}</td><td class="number">${formatNumber.format(item.exist)}</td><td class="number">${formatNumber.format(item.reserved)}</td><td class="number">${formatNumber.format(item.sales6)}</td><td class="number">${item.coverage === null ? "Sin demanda" : `${formatNumber.format(item.coverage)} dias`}</td><td class="number">${formatNumber.format(item.purchase)}</td><td class="number">${formatMoney.format(item.capital)}</td></tr>`).join("");
    $("measurePageLabel").textContent = `Pagina ${state.measurePage} de ${totalPages}`;
    $("prevMeasurePage").disabled = state.measurePage <= 1;
    $("nextMeasurePage").disabled = state.measurePage >= totalPages;
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
      return `<tr><td><span class="status status-${status}">${statusLabels[status]}</span></td><td><strong>${evaluation.criterion}</strong></td><td>${row.sku}</td><td>${row.description}</td><td>${row.measure || "-"}</td><td>${row.brand || "-"}</td><td>${row.tier || "-"}</td><td class="number">${formatNumber.format(branchStock(row, branch))}</td><td class="number">${formatNumber.format(branch === "TOTAL" ? row.reserved : 0)}</td><td class="number">${coverage}</td><td>${row.lastPurchase || "Sin fecha"}</td><td class="number">${row.daysSincePurchase ?? "-"}</td><td class="number">${formatNumber.format(row.sales6)}</td><td class="number">${formatNumber.format(row.purchase)}</td><td class="number">${formatMoney.format(branchStock(row, branch) * row.cost)}</td></tr>`;
    }).join("");
    $("resultCount").textContent = `${formatNumber.format(state.rows.length)} resultados`;
    $("pageLabel").textContent = `Pagina ${state.page} de ${totalPages}`;
    $("prevPage").disabled = state.page <= 1;
    $("nextPage").disabled = state.page >= totalPages;
  }

  function render() { renderKpis(); renderCapacity(); renderTiers(); renderMeasures(); renderTable(); }

  function exportCsv() {
    const branch = $("branchFilter").value;
    const header = ["Accion", "Motivo", "SKU", "Descripcion", "Medida", "Marca", "Tier", "Existencia_disponible", "Apartadas_no_disponibles", "Cobertura_dias", "Ultima_compra", "Dias_desde_compra", "Venta_6M", "Compra_sugerida", "Ultimo_costo"];
    const lines = state.rows.map((row) => { const result = evaluate(row, branch); return [statusLabels[result.status], result.criterion, row.sku, row.description, row.measure, row.brand, row.tier, branchStock(row, branch), branch === "TOTAL" ? row.reserved : 0, row.coverage ?? "", row.lastPurchase ?? "", row.daysSincePurchase ?? "", row.sales6, row.purchase, row.cost]; });
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
  $("exportButton").addEventListener("click", exportCsv);
  $("excelInput").addEventListener("change", (event) => { const file = event.target.files[0]; if (file) loadExcel(file); });
  $("restoreDataButton").addEventListener("click", () => { source = bundledSource; try { localStorage.removeItem("inventoryDashboardData"); } catch (_) { } resetAllFilters(); updateSourceStatus(); });
  updateSourceStatus();
  applyFilters();
})();
