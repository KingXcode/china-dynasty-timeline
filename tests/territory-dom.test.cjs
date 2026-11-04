/* Dependency-free DOM/async regressions. Visual checks remain a separate stage. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),nodes=new Map(),timers=new Map();let nextTimer=0;
function node(){const classes=new Set();return{attrs:{},children:[],listeners:{},style:{},dataset:{},hidden:false,value:'',textContent:'',innerHTML:'',
 classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),toggle:(v,on)=>on?classes.add(v):classes.delete(v)},
 addEventListener(k,v){(this.listeners[k]??=[]).push(v)},setAttribute(k,v){this.attrs[k]=v},append(...v){for(const child of v)this.children.push(...child?.fragment?child.children:[child])},
 replaceChildren(...v){this.children=[];this.append(...v)},focus(){},closest(){return null},setPointerCapture(){}};}
const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
['year-form','map-error','polity-detail'].forEach(id=>get(id).hidden=true);
const snapshot=[-210,100,250,500,750,950,1100,1142,1320,1400,1750].map(year=>{const n=node();n.dataset.year=year;return n;});
function descend(n){return n.children.flatMap(c=>[c,...descend(c)]);}
const document={getElementById:get,querySelectorAll(selector){if(selector==='[data-year]')return snapshot;let n=selector==='.map-polity'?get('map-polygons'):selector==='.polity-item'?get('polity-list'):node();return descend(n).filter(c=>selector==='.map-polity'?c.attrs.class==='map-polity':c.className==='polity-item');},createElement:node,createElementNS:node,createDocumentFragment(){const n=node();n.fragment=true;return n;},addEventListener(){},hidden:false};
const delays=new Map(),failed=new Set(),requests=[];
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function fetch(url){const p=url.split('?')[0];requests.push(p);if(delays.has(p))return delays.get(p).promise;if(failed.has(p))return Promise.resolve({ok:false,status:503});return Promise.resolve({ok:true,json:async()=>read(p)});}
const location={href:'https://example.test/territory.html'},context={document,window:{addEventListener(){}},location,history:{replaceState(a,b,url){location.href=String(url);}},fetch,URL,URLSearchParams,console:{warn(){}},setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer;},clearTimeout(id){timers.delete(id);},Map,Set,Math,Number,Promise,DOMPoint:class{constructor(x,y){this.x=x;this.y=y;}matrixTransform(){return this;}}};
vm.runInNewContext(fs.readFileSync(path.join(root,'data.js'),'utf8'),context);
vm.runInNewContext(fs.readFileSync(path.join(root,'territory.js'),'utf8'),context);
const state=()=>context.window.TERRITORY_STATE();
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function fire(id,event='click',detail={}){for(const f of get(id).listeners[event]||[])f({type:event,target:get(id),preventDefault(){},...detail});await flush();}
async function slider(year){get('year-slider').value=year<0?year:year-1;await fire('year-slider','input');}
function deferred(p){let resolve;const promise=new Promise(r=>resolve=r);delays.set(p,{promise,resolve});return()=>{resolve({ok:true,json:async()=>read(p)});delays.delete(p);};}
(async()=>{
 await flush();assert.equal(state().loadedYear,1142);assert.equal(state().activeNames.length,7);assert.equal(get('map-polygons').children.length,7);assert(!get('map-loading').hidden===false);
 await fire('map-zoom-in');assert(state().scale>1);await fire('map-reset');assert.equal(state().scale,1);
 await fire('toggle-labels');assert.equal(get('map-labels').style.display,'none');await fire('toggle-labels');assert.equal(get('map-labels').style.display,'');
 get('territory-svg').getScreenCTM=()=>({inverse:()=>({})});
 const hit={dataset:{id:state().activeIds[0]},closest(){return this;}};
 document.elementFromPoint=()=>hit;
 const pointer=(pointerId,extra={})=>({pointerId,pointerType:'mouse',button:0,clientX:10,clientY:10,...extra});
 await fire('map-stage','pointerdown',pointer(1,{button:2}));await fire('map-stage','pointerup',pointer(1,{button:2}));assert.equal(state().selected,null,'Right click does not select');
 await fire('map-stage','pointerup',pointer(2));assert.equal(state().selected,null,'Pointer begun outside map does not select');
 await fire('map-stage','pointerdown',pointer(3));await fire('map-stage','pointerup',pointer(3));assert.equal(state().selected,hit.dataset.id,'Single captured tap selects');
 await fire('map-stage','pointerdown',pointer(4));await fire('map-stage','pointerup',pointer(4));assert.equal(state().selected,null,'Second tap deselects');
 await fire('map-stage','pointerdown',pointer(5,{pointerType:'touch'}));await fire('map-stage','pointerdown',pointer(6,{pointerType:'touch'}));
 await fire('map-stage','pointerup',pointer(6,{pointerType:'touch'}));await fire('map-stage','pointerup',pointer(5,{pointerType:'touch'}));assert.equal(state().selected,null,'Multi-touch never selects even with no motion');
 await fire('map-stage','pointerdown',pointer(7));await fire('map-stage','pointercancel',pointer(7));await fire('map-stage','pointerup',pointer(7));assert.equal(state().selected,null,'Canceled pointer does not select');
 await fire('map-stage','pointerdown',pointer(8));await fire('map-stage','pointermove',pointer(8,{clientX:30}));await fire('map-stage','pointerup',pointer(8,{clientX:30}));assert.equal(state().selected,null,'Drag does not select');
 const btn=get('polity-list').children[0];btn.listeners.click[0]();assert(state().selected!==null);btn.listeners.click[0]();assert.equal(state().selected,null);
 await slider(-1);await fire('next-year');assert.equal(state().year,1);await fire('previous-year');assert.equal(state().year,-1);assert(!requests.some(p=>p.includes('era-NaN')));
 const finishOld=deferred('map-data/era-500.geojson'),finishNew=deferred('map-data/era-700.geojson');
 await slider(500);assert.equal(get('map-polygons').children.length,0,'Changing century immediately clears old polygons');
 await slider(750);finishOld();await flush();assert.equal(state().year,750);assert.equal(get('map-polygons').children.length,0,'Stale response never paints old year');
 finishNew();await flush();assert.equal(state().loadedYear,750);assert(state().activeNames.includes('Tang Dynasty'));
 failed.add('map-data/era-1800.geojson');await slider(1855);assert.equal(get('map-polygons').children.length,0);assert.equal(get('map-error').hidden,false);assert.equal(state().playing,false);
 failed.clear();await fire('retry-map');assert.equal(state().loadedYear,1855);assert.equal(get('map-error').hidden,true);assert(state().activeNames.includes('Taiping Heavenly Kingdom'));
 await slider(1130);assert(!state().activeNames.includes('Northern Song'));assert(state().excludedNames.includes('Northern Song'));assert.equal(get('year-warning').dataset.excludedCount,1);
 await slider(-221);assert.equal(get('previous-year').disabled,true);await slider(1911);assert.equal(get('next-year').disabled,true);
 await slider(250);await fire('play-years');assert(state().playing);assert.equal(timers.size,1);await fire('play-years');assert(!state().playing);assert.equal(timers.size,0);
 await fire('play-years');await slider(500);assert(!state().playing,'Manual year changes pause autoplay');assert.equal(timers.size,0);
 await fire('play-years');assert(state().playing);await fire('jump-toggle');assert(!state().playing,'Opening year entry pauses autoplay');assert.equal(timers.size,0);assert(!get('year-form').hidden);get('year-number').value=0;await fire('year-form','submit');assert.equal(state().year,500);assert(get('year-form-error').textContent.includes('0'));
 get('year-number').value=1;get('year-era').value='bce';await fire('year-form','submit');assert.equal(state().year,-1);assert(get('year-form').hidden);
 assert.equal(get('year-number').max,'221');await fire('next-year');assert.equal(get('year-number').max,'1911','Era changes update numeric input limit');
 console.log('PASS: pointer lifecycle (tap, right-click, outside, multitouch, cancel, drag), initial render, selection toggles, label toggle, zoom/reset, BCE/CE crossing, async stale-response guard, failure/retry, exclusions, boundaries, play/pause, manual interruption, year form validation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
