// New contract tests: intentionally separate from legacy characterization.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {dashboard,raw,root} = require('./dashboard-harness.cjs');
const cases = require('./fixtures/inventory-cases.json');
const file={name:'synthetic.xlsx',lastModified:Date.parse('2026-08-20')};
const pages = ['inventario','criticas','chihuahua'];
for(const folder of pages) {
  for(const c of cases.stock) test(`${folder}: contract ${c.name}`,()=>{
    const {api}=dashboard(folder);
    const row=api.transformExcelRows([raw({SAT:10,INS:8,FCO:10,PIS:8,EXIST:c.systemStock})],file).rows[0];
    assert.equal(row.systemStock,c.systemStock);
    assert.equal(row.availableStock,c.availableStock);
    assert.equal(row.reservedStock,c.reservedStock);
    assert.deepEqual(Array.from(row.stockDiagnostics),c.diagnostics);
    assert.equal(row.exist,18); assert.equal(row.reserved,c.reservedStock);
  });
  test(`${folder}: old cache retains aliases without claiming original EXIST is known`,()=>{
    const cached={dataVersion:'servillantas-plt-cvt-v1',cutoff:'20/08/2026',rows:[{...raw(),exist:18,reserved:7,monthlyDemand:10}]};
    const {api}=dashboard(folder,{stored:cached});
    const row=api.getSource().rows[0];
    assert.equal(row.exist,18); assert.equal(row.reserved,7);
    assert.equal(row.availableStock,18); assert.equal(row.reservedStock,7);
    assert.equal(row.systemStock,null);
    assert.ok(row.stockDiagnostics.includes('LEGACY_SYSTEM_STOCK_UNKNOWN'));
  });
}
test('generated browser config equals the only editable configuration',()=>{
  const {context}=dashboard('inventario');
  assert.deepEqual(JSON.parse(JSON.stringify(context.INVENTORY_RULES)),JSON.parse(fs.readFileSync(path.join(root,'backend/config/inventory-rules.json'),'utf8')));
});
test('dashboard reads configured excess threshold',()=>{
  const rules=JSON.parse(fs.readFileSync(path.join(root,'backend/config/inventory-rules.json'),'utf8'));
  rules.inventory.excessDays=160;
  const {api}=dashboard('inventario',{rules});
  const row=api.transformExcelRows([raw({SAT:50,EXIST:50})],file).rows[0];
  assert.equal(api.evaluate(row,'TOTAL').criterion,'Sin alerta');
});
