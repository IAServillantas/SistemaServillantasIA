// Characterization: expected legacy behavior, including known inconsistencies.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {dashboard,raw} = require('./dashboard-harness.cjs');
const cases = require('./fixtures/inventory-cases.json');
const pages = ['inventario','criticas','chihuahua'];
const file = {name:'synthetic.xlsx',lastModified:Date.parse('2026-08-20')};
for(const folder of pages) {
  for(const c of cases.statuses) test(`${folder}: ${c.name} (legacy)`,()=>{
    const {api}=dashboard(folder);
    const age = days => days === null ? null : new Date(Date.parse('2026-08-20')-days*86400000).toISOString();
    const data=api.transformExcelRows([raw({SAT:c.stock,FCO:c.stock,EXIST:c.stock,ACUM_VTS_3M:c.sales3,'ACUM_VTS_6M.SUM':c.sales6,FCH_ULTCOM:age(c.purchaseAge),FCH_ULTVTA:age(c.saleAge)}),raw({CVE_ART:'CLOCK',MEDIDA:'CLOCK'})],file);
    assert.equal(api.evaluate(data.rows[0],folder==='chihuahua'?'CHIH':'TOTAL').criterion,c.criterion);
  });
  for(const c of cases.stock) test(`${folder}: ${c.name} retains legacy aliases`,()=>{
    const {api}=dashboard(folder);
    const row=api.transformExcelRows([raw({SAT:10,INS:8,FCO:10,PIS:8,EXIST:c.systemStock})],file).rows[0];
    assert.equal(row.exist,18); assert.equal(row.reserved,c.reservedStock);
  });
  test(`${folder}: aggregate purchase by measure-tier, not sum of SKU purchases`,()=>{
    const {api}=dashboard(folder);
    api.setSource(api.transformExcelRows([raw({CVE_ART:'A',SAT:40,FCO:40,EXIST:40}),raw({CVE_ART:'B'})],file));
    const group=api.analyzeMeasureTiers()[0].tiers[3];
    assert.equal(group.skuCount,2); assert.equal(group.purchase,20); assert.equal(group.exist,40);
  });
}
test('CHIH/PAR retain separate stocks and three-month demand',()=>{
  const {api}=dashboard('chihuahua');
  const row=api.transformExcelRows([raw({FCO:1,PIS:2,JUV:3,CAMP:4,PAR:8,EXIST:25,ACUM_VTS_3M:60,ACUM_VTS_PAR:15})],file).rows[0];
  assert.equal(row.chih,10); assert.equal(row.par,8); assert.equal(row.sales3Chih,45); assert.equal(row.sales3Par,15);
  assert.equal(api.metrics(row,'CHIH').purchase,35); assert.equal(api.metrics(row,'PAR').purchase,7);
});
test('General retains weighted demand, distinct from Chihuahua',()=>{
  const {api}=dashboard('inventario');
  const row=api.transformExcelRows([raw({ACUM_VTS_3M:60,'ACUM_VTS_6M.SUM':90})],file).rows[0];
  assert.equal(row.monthlyDemand,16.67); assert.equal(row.purchase,50);
});
for(const folder of pages) {
  test(`${folder}: CSV and measure Excel exports match baseline`,async()=>{
    async function capture(baseline) {
      const {api,context}=dashboard(folder,{baseline});
      const data=api.transformExcelRows([raw({EXIST:25}),raw({CVE_ART:'B',MEDIDA:'215/55R16',SAT:10,FCO:10,EXIST:12})],file);
      api.setSource(data); api.state.rows=data.rows;
      const output=[];
      context.XLSX.writeFile=(workbook,name)=>output.push({name,sheets:JSON.parse(JSON.stringify(workbook))});
      api.exportMeasuresExcel();
      let csvBlob;
      context.URL={createObjectURL(blob){csvBlob=blob;return 'blob:synthetic';},revokeObjectURL(){}};
      api.exportCsv();
      return {output,csv:await csvBlob.text()};
    }
    assert.deepEqual(await capture(false),await capture(true));
  });
}
test('Chihuahua supplier allocation and opportunity preserve baseline',()=>{
  function calculate(baseline) {
    const {api}=dashboard('chihuahua',{baseline});
    api.setSource(api.transformExcelRows([raw({FCO:5,EXIST:12})],file));
    api.state.suppliers={general:{offers:[{provider:'G',sku:'G1',measure:'205/55R16',stock:50,cost:80}],quality:{}},t53:{offers:[{provider:'T',sku:'T1',measure:'205/55R16',stock:20,cost:95}],quality:{}}};
    api.supplierRecommendations();
    return JSON.parse(JSON.stringify(api.state.supplierResults));
  }
  assert.deepEqual(calculate(false),calculate(true));
});
