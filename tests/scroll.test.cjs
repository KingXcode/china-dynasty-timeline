const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const listeners=new Map(),timers=new Map();let nextTimer=0,guard=false,clears=0,widthReads=0;
const dom=new Map();
function node(){return {attrs:{},children:[],listeners:{},style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(k,v){this.listeners[k]=v},setAttribute(k,v){this.attrs[k]=v},append(...v){this.children.push(...v)},replaceChildren(...v){if(guard&&this===dom.get('#chart')&&!v.length)clears++;this.children=v},querySelectorAll(){return []},contains(){return false},focus(){},getBoundingClientRect(){return {}},innerHTML:'',textContent:'',tagName:'BODY'};}
const get=s=>{if(!dom.has(s))dom.set(s,node());return dom.get(s)};
const document={querySelector:get,querySelectorAll:()=>[],createElement:node,createElementNS:node,createDocumentFragment:node,body:node(),activeElement:node(),addEventListener(){},documentElement:{clientWidth:390,clientHeight:700}};
Object.defineProperty(get('#chart-scroll'),'clientWidth',{get(){widthReads++;if(guard)assert(get('#chart').children.length,'A layout read must never see a temporarily empty chart');return document.documentElement.clientWidth-34}});
const context={document,Date,URL,window:{addEventListener:(k,fn)=>listeners.set(k,fn)},matchMedia:q=>({matches:q.includes('max-width')&&document.documentElement.clientWidth<=800,addEventListener(){}}),setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id)};
vm.runInNewContext(fs.readFileSync(path.join(root,'data.js'),'utf8'),context);
vm.runInNewContext(fs.readFileSync(process.env.APP_UNDER_TEST||path.join(root,'app.js'),'utf8'),context);
const flush=()=>{const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn())};
const resize=()=>listeners.get('resize')();
get('#show-all').listeners.click();guard=true;
const original=get('#chart').children[0],initialReads=widthReads;
for(let i=0;i<100;i++){document.documentElement.clientHeight=600+i%2*100;resize();flush();}
assert.strictEqual(get('#chart').children[0],original,'Toolbar height changes must preserve the exact SVG DOM node');
assert.equal(widthReads,initialReads,'Height-only resize must not rebuild or measure the chart');
assert.equal(clears,0,'Chart must never be emptied before constructing its replacement');
for(const width of [375,430,320,390]){
 document.documentElement.clientWidth=width;resize();flush();
 const svg=get('#chart').children[0];assert.equal(Number(svg.attrs.width),width-34);
 assert.equal(clears,0,'Width changes replace SVG atomically');
 const same=svg;resize();flush();assert.strictEqual(get('#chart').children[0],same,'Same-width notification does not render');
}
get('#exact-scale').listeners.change({target:{checked:true}});
const exact=get('#chart').children[0];resize();flush();assert.strictEqual(get('#chart').children[0],exact,'Exact scale stays stable during toolbar resize');
get('#list-view').listeners.click();const listGraph=get('#chart').children[0];document.documentElement.clientWidth=375;resize();flush();assert.strictEqual(get('#chart').children[0],listGraph,'List mode does not rerender hidden chart on resize');
get('#graph-view').listeners.click();
guard=false;get('#search').listeners.input({target:{value:'no-such-dynasty'}});assert.equal(get('#chart').children.length,0,'Empty results intentionally clear the graph');
get('#search').listeners.input({target:{value:''}});assert(get('#chart').children.length,'Results return after clearing search');
console.log('PASS: 100 height-only resize events preserve SVG identity; real width changes are atomic; exact/list/empty-result regressions pass.');
