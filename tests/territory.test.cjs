const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..'),api=require('../territory.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,'map-data',p),'utf8'));
const audit=read('audit.json'),names=read('polities.json'),index=read('index.json');
let unique=new Map(),coordinates=0,rings=0;
for(let century=-300;century<=1900;century+=100){
 const d=read(`era-${century}.geojson`);
 assert.equal(d.type,'FeatureCollection');
 for(const f of d.features){
  const p=f.properties;
  assert(p.Name in names);assert.equal(p.Type,'POLITY');assert(p.FromYear<=century+99 && p.ToYear>=century);
  assert(p.FromYear<=p.ToYear);assert(['Polygon','MultiPolygon'].includes(f.geometry.type));
  if(unique.has(f.id))assert.deepEqual(f,unique.get(f.id),'Shards must preserve identical source records');
  else{unique.set(f.id,f);const ps=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
   for(const poly of ps)for(const ring of poly){rings++;assert(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));for(const c of ring){coordinates++;assert(Number.isFinite(c[0])&&Number.isFinite(c[1]));assert(Math.abs(c[0])<=180&&Math.abs(c[1])<=90);}}
   const d=api.geometryPath(f.geometry);assert(!d.includes('NaN'));assert(d.endsWith('Z'));
  }
 }
}
assert.equal(unique.size,877);assert.equal(Object.keys(names).length,132);
assert.equal(index.records.length,unique.size);
for(const r of index.records){const p=unique.get(r.id).properties;assert.equal(r.name,p.Name);assert.equal(r.from,p.FromYear);assert.equal(r.to,p.ToYear);}
for(let slider=-221;slider<=1910;slider++){const y=api.fromSlider(slider);assert.notEqual(y,0);assert.equal(api.toSlider(y),slider);assert(api.validYear(y));}
assert.equal(api.fromSlider(-1),-1);assert.equal(api.fromSlider(0),1);assert.equal(api.bucketFor(-1),-100);assert.equal(api.bucketFor(1),0);assert(!api.validYear(0));assert(!api.validYear(1.5));
const sourceAt=y=>api.activeAt(read(`era-${api.bucketFor(y)}.geojson`).features,y);
const accepted=y=>sourceAt(y).filter(f=>api.acceptedAt(f,y,audit));
const at=y=>accepted(y).map(f=>f.properties.Name);
for(const name of ['Cao Wei','Shu Han','Eastern Wu'])assert(at(250).includes(name));
for(const name of ['Northern Wei','Southern Qi'])assert(at(500).includes(name));
for(const name of ['Southern Song','Great Jin','Western Xia','Kingdom of Dali','Kara-Khitans'])assert(at(1142).includes(name));
assert(at(1750).includes('Dzungar Khanate'));assert(at(1750).includes('Qing Dynasty'));
for(const [y,wrong] of [[421,'Western Jin'],[1130,'Northern Song'],[1369,'Yuan Dynasty'],[1644,'Later Jin Dynasty'],[224,'Han Dynasty'],[695,'Tang Dynasty']]){
 assert(sourceAt(y).some(f=>f.properties.Name===wrong),`Fixture ${wrong}@${y} must exist in source`);
 assert(!at(y).includes(wrong),`Known chronology conflict ${wrong}@${y} must not be painted`);
}
assert(at(-210).includes('Qin Dynasty'));assert(!at(-221).includes('Qin Dynasty'));
assert(sourceAt(1138).some(f=>f.properties.Name==='Northern Song'),'Pin actual v0.2.1 Northern Song end despite release-note discrepancy');
for(const f of unique.values())for(const year of [f.properties.FromYear,f.properties.ToYear])if(api.validYear(year))assert(api.activeAt([f],year).length===1,'Source bounds inclusive');
const changes=api.getChanges(index.records,audit);assert(!changes.includes(0));assert.equal(changes[0],-221);assert.equal(changes.at(-1),1911);
for(const year of [-221,-210,-1,1,220,250,420,421,500,580,695,750,950,1000,1120,1130,1142,1279,1320,1368,1400,1644,1750,1855,1911])console.log(`${year}: ${accepted(year).length} drawn, ${sourceAt(year).length-accepted(year).length} source chronology conflicts withheld`);
console.log(`PASS: ${unique.size} original records, ${rings} rings, ${coordinates} coordinates; dates, shards, no year zero, concurrent regimes, exclusions, geometry paths.`);
