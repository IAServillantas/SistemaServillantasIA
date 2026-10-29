const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

/** alias legacy → ruta actual (economiza tokens en tests) */
const PAGES = {
  dashboard: 'frontend/inventario',
  dashboard_criticas_sin_existencia: 'frontend/criticas',
  dashboard_servillantas_chihuahua: 'frontend/chihuahua',
  inventario: 'frontend/inventario',
  criticas: 'frontend/criticas',
  chihuahua: 'frontend/chihuahua'
};
const LEGACY = {
  'frontend/inventario': 'dashboard',
  'frontend/criticas': 'dashboard_criticas_sin_existencia',
  'frontend/chihuahua': 'dashboard_servillantas_chihuahua'
};

function resolvePage(folder) {
  if (PAGES[folder]) return PAGES[folder];
  if (folder.startsWith('frontend/') || folder.startsWith('backend/')) return folder;
  return folder;
}

function dashboard(folder, options = {}) {
  const page = resolvePage(folder);
  const legacy = LEGACY[page] || folder;
  const elements = new Map();
  const values = {branchFilter: page.includes('chihuahua') ? 'CHIH' : 'TOTAL', typeFilter:'PLT', tierFilter:'ALL', statusFilter:'ALL', missingTier:'ALL', measurePriority:'ALL', measurePurchase:'ALL'};
  const get = id => {
    if (!elements.has(id)) elements.set(id, {value: values[id] || '', classList:{toggle(){}}, setAttribute(){}, addEventListener(){}, click(){}});
    return elements.get(id);
  };
  const context = vm.createContext({console, Date, Intl, Blob, URL, alert(){}, document:{getElementById:get,createElement:()=>({click(){}})}, localStorage:{getItem:()=> options.stored ? JSON.stringify(options.stored) : null,setItem(){},removeItem(){}}});
  context.window = context;
  for (const file of ['frontend/shared/inventory-config.js','frontend/shared/inventory.js']) {
    if (fs.existsSync(path.join(root,file))) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  }
  if(options.rules) context.INVENTORY_RULES = options.rules;
  vm.runInContext(fs.readFileSync(path.join(root,'frontend/vendor/xlsx.full.min.js'),'utf8'),context);
  let source = options.baseline
    ? execFileSync('git',['show',`b83e6f3:${legacy}/app.js`],{cwd:root,encoding:'utf8'})
    : fs.readFileSync(path.join(root,page,'app.js'),'utf8');
  source = source.replace(/\}\)\(\);\s*$/, `window.testApi = {transformExcelRows,evaluate,analyzeMeasureTiers,exportMeasuresExcel,exportCsv,state,supplierRecommendations:typeof calculateSupplierRecommendations === 'function' ? calculateSupplierRecommendations : null,getSource:()=>source,setSource:data=>{source=data;},metrics:typeof rowMetrics === 'function' ? rowMetrics : null};\n})();`);
  vm.runInContext(source,context,{filename:page+'/app.js'});
  return {api:context.testApi,context,get,page,legacy};
}
function raw(overrides={}) {
  return {CVE_ART:'SKU',DESCRIPCION:'Llanta sintetica',CTRL_ALM:'PLT',MEDIDA:'205/55R16',MARCA:'SINTETICA',TIER:4,SAT:0,INS:0,CUE:0,TOR:0,FCO:0,PIS:0,JUV:0,PAR:0,CAMP:0,ULT_COSTO:100,EXIST:0,FCH_ULTCOM:'2026-03-23',FCH_ULTVTA:'2026-08-20',ACUM_VTS_3M:30,'ACUM_VTS_6M.SUM':60,ACUM_VTS_PAR:0,...overrides};
}
module.exports={dashboard,raw,root,PAGES,LEGACY,resolvePage};
