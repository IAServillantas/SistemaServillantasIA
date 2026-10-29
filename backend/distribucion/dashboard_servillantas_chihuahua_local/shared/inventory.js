(function (root) {
  'use strict';
  function number(value) {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
  }
  function calculate(systemStock, warehouses) {
    systemStock = number(systemStock);
    const availableStock = warehouses.reduce((sum, value) => sum + number(value), 0);
    const stockDifference = systemStock - availableStock;
    const reservedStock = Math.max(0, stockDifference);
    return {systemStock, availableStock, reservedStock, stockDifference,
      stockDiagnostics: stockDifference < -root.INVENTORY_RULES.inventory.stockDifferenceTolerance
        ? ['SYSTEM_STOCK_BELOW_AVAILABLE'] : []};
  }
  function upgrade(data) {
    if (!data || !Array.isArray(data.rows)) return data;
    return {...data, rows: data.rows.map(row => {
      if (Object.prototype.hasOwnProperty.call(row, 'systemStock')) return row;
      // Old payloads discarded the original EXIST. Preserve aliases without inventing it.
      return {...row, systemStock: null, availableStock: number(row.exist),
        reservedStock: number(row.reserved), stockDifference: null,
        stockDiagnostics: ['LEGACY_SYSTEM_STOCK_UNKNOWN']};
    })};
  }
  root.Inventory = Object.freeze({calculate, upgrade});
})(typeof window === 'undefined' ? globalThis : window);
