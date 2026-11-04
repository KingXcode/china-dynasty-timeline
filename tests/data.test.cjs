const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const context = {window:{addEventListener(){}}};
vm.runInNewContext(fs.readFileSync(path.join(root,'data.js'),'utf8'),context);
const {dynasties:ds, sources, eras} = context.window.HISTORY_DATA;
assert(ds.length >= 100, 'Expanded historical coverage');
assert.equal(new Set(ds.map(d=>d.id)).size,ds.length,'Unique record IDs');
assert.equal(new Set(sources.map(s=>s.id)).size,sources.length,'Unique source IDs');
for(const d of ds){
  assert(Number.isInteger(d.start)&&Number.isInteger(d.end),d.id+' integer dates');
  assert(d.start!==0&&d.end!==0&&d.start<d.end,d.id+' valid dates without year zero');
  assert(eras.some(e=>e.id===d.group),d.id+' valid era');
  assert(d.name&&d.region,d.id+' metadata');
  if(d.id!=='roc')assert(d.note,d.id+' note');
  if(d.id!=='roc')assert(d.sourceIds.length>0,d.id+' has sources');
  for(const s of d.sourceIds)assert(sources.some(x=>x.id===s),d.id+' source '+s);
}
for(const s of sources)assert(/^https?:\/\//.test(s.url),'Web source '+s.id);
assert.equal(ds.filter(d=>d.traditionalSixteen).length,16);
assert.equal(ds.filter(d=>d.group==='five').length,5);
assert.equal(ds.filter(d=>d.group==='ten').length,10);
const record=id=>ds.find(d=>d.id===id);
const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
assert(overlap(record('northern-song'),record('liao')));
assert(overlap(record('southern-song'),record('jin-jurchen')));
assert(overlap(record('eastern-jin'),record('northern-wei')));
assert.equal(record('western-jin').end,316);
assert.equal(record('qing').start,1636);
assert.equal(record('roc').name,'中华民国');
assert.equal(record('roc').start,1912);
assert.equal(record('roc').end,1949);
assert(!record('roc').ongoing,'The timeline entry must end in 1949');
assert.equal(record('roc').period,true);
assert.equal(record('prc').start,1949);
assert.equal(record('prc').ongoing,true);
assert.equal(record('roc').english,'Republic of China');
assert.equal(record('roc').region,'中国');
assert.equal(record('roc').note,'');
assert.equal(record('roc').sourceIds.length,0);
assert(!context.window.HISTORY_DATA.meta.regions.includes('大陆历史分期'));
assert.equal(ds.length,102);
assert.equal(sources.length,52);
for(const id of ['roc-mainland-period','roc-relocation-1949','taiwan-current-administration','hainan-transition-1950'])assert(!sources.some(s=>s.id===id));
assert.equal(record('prc').sourceIds.join(','),'prc-founded-1949');
assert.equal(eras.find(e=>e.id==='modern').description,'中华民国1912—1949，中华人民共和国1949年至今。');
assert(record('prc').note.includes('1949年10月1日'),'Precise founding date in note');
assert(!overlap(record('tang-first'),record('wu-zhou')));
assert(!overlap(record('wu-zhou'),record('tang-restored')));
// Capture pure date/scale helpers with a tiny DOM substitute, no browser dependency.
function node(){return {attrs:{},children:[],listeners:{},contains(){return false},classList:{add(){},remove(){},toggle(){}},style:{},dataset:{},addEventListener(k,v){this.listeners[k]=v},setAttribute(k,v){this.attrs[k]=v},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},querySelectorAll(){return []},focus(){},getBoundingClientRect(){return {}},innerHTML:'',textContent:'',tagName:'BODY'};}
const dom=new Map();const get=s=>{if(!dom.has(s))dom.set(s,node());return dom.get(s)};
const document={querySelector:get,querySelectorAll:()=>[],createElement:node,createDocumentFragment:node,createElementNS:node,body:node(),addEventListener(){},activeElement:node(),documentElement:{clientWidth:390}};
Object.assign(context,{document,Date,URL,matchMedia:()=>({matches:false,addEventListener(){}})});
vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
const h=context.window.HistoryTimeline;
assert.equal(h.span(-1,1),1,'No year zero');
assert.equal(h.span(-206,9),214);
assert.equal(h.formatYear(-221),'前221');
for(const selected of [ds.filter(d=>d.core),ds]){
  const start=Math.min(...selected.map(d=>d.start)),end=Math.max(...selected.map(d=>d.end));
  const scale=h.makeScale(start,end,selected);
  let last=-Infinity;
  for(let y=start;y<=end;y++)if(y!==0){assert(scale.y(y)>last,'Scale is monotone at '+y);last=scale.y(y);}
  for(const f of scale.folds){assert(f.start<f.end);assert(!selected.some(d=>(d.start>f.start&&d.start<f.end)||(d.end>f.start&&d.end<f.end)),'Fold does not hide boundaries');}
}
assert.equal(h.records.find(d=>d.id==='roc').end,1949,'Runtime must keep historical endpoint');
assert.equal(h.filterRecords().length,ds.filter(d=>d.core).length);
console.log(`PASS: ${ds.length} records, ${sources.length} sources, ${eras.length} eras; data, chronology, overlaps, and scale checks.`);

// Realistic phone widths: every branch and every label stays in the viewport.
function descendants(n){return [n,...(n.children||[]).flatMap(descendants)]}
for(const viewport of [320,375,390,430]){
  document.documentElement.clientWidth=viewport;get('#chart-scroll').clientWidth=viewport-34;
  h.renderMobileGraph(ds);
  const svg=get('#chart').children[0];assert.equal(Number(svg.attrs.width),viewport-34);
  const els=descendants(svg);
  assert.equal(els.filter(x=>x.attrs?.role==='button').length,ds.length);
  for(const e of els.filter(x=>x.attrs?.class==='mobile-label-bg'))assert(Number(e.attrs.x)+Number(e.attrs.width)<=viewport-34,'Phone labels fit');
  const sameYear=new Map();
  for(const g of els.filter(x=>x.attrs?.['aria-hidden']==='true'&&x.attrs?.['data-id'])){
    const d=record(g.attrs['data-id']);const cy=g.children.find(x=>x.attrs?.cy!==undefined).attrs.cy;
    if(sameYear.has(d.start))assert.equal(cy,sameYear.get(d.start),'Same year aligns across all mobile lanes');
    sameYear.set(d.start,cy);
  }
}
console.log('PASS: 320 / 375 / 390 / 430 px mobile SVG fit, complete record count, same-year alignment.');



// Exercise actual rendered detail through its graph click handler.
h.renderMobileGraph(ds);
const graphNodes=descendants(get('#chart'));
const clickRecord=id=>graphNodes.find(n=>n.attrs?.['data-id']===id&&n.listeners.click).listeners.click();
for(const id of ['roc','qing','prc','roc']){
  clickRecord(id);const detail=get('#detail-content').innerHTML;
  if(id==='roc'){
    assert(detail.includes('>中华民国</h3>'));
    assert(detail.includes('1912')&&detail.includes('1949'));
    assert(detail.includes('年表跨度'));
    for(const obsolete of ['大陆时期','迁台','迁至台湾','实际管辖','海南','参考来源','历史与纪年','采用常用历史纪年','参见页面下方','存续跨度'])assert(!detail.includes(obsolete),obsolete+' must not appear in ROC detail');
    assert(!detail.includes('detail-source'));
  }else{
    assert(detail.includes('参考来源')&&detail.includes('detail-source'),'Other records retain references');
    assert(detail.includes('历史与纪年'),'Other records retain notes');
  }
}
console.log('PASS: repeated ROC/Qing/PRC detail navigation hides empty note/source sections without affecting other records.');
