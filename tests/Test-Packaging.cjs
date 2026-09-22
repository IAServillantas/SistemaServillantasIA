const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {root,dashboard}=require('./dashboard-harness.cjs');
for(const folder of ['dashboard','dashboard_criticas_sin_existencia','dashboard_servillantas_chihuahua']) {
 test(`${folder}: unchanged HTML structure`,()=>{
  const before=execFileSync('git',['show',`b83e6f3:${folder}/index.html`],{cwd:root,encoding:'utf8'});
  const after=fs.readFileSync(path.join(root,folder,'index.html'),'utf8');
  const clean=s=>s.replace(/^.*<script src="\.\.\/shared\/.*\r?\n/gm,'').replace(/\r\n/g,'\n');
  assert.equal(clean(after),clean(before));
 });
}
for(const name of ['dashboard_inventario_local','dashboard_servillantas_chihuahua_local']) {
 const folder='distribucion/'+name;
 test(`${name}: scripts available offline and startup succeeds`,()=>{
  const html=fs.readFileSync(path.join(root,folder,'index.html'),'utf8');
  for(const match of html.matchAll(/<script src="([^"]+)"/g)) {
   assert.ok(fs.existsSync(path.resolve(root,folder,match[1])),match[1]);
  }
  for(const asset of ['inventory.js','inventory-config.js']) {
   assert.equal(fs.readFileSync(path.join(root,folder,'shared',asset),'utf8'),fs.readFileSync(path.join(root,'shared',asset),'utf8'));
  }
  const {api}=dashboard(folder);
  assert.equal(api.getSource().rows.length,0);
 });
}
