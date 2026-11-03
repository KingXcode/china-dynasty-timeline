/* Plain browser JavaScript. No dependencies, build step, storage, or requests. */
(() => {
  'use strict';
  const data = window.HISTORY_DATA;
  if (!data || !Array.isArray(data.dynasties)) {
    document.querySelector('#chart').innerHTML = '<p class="empty-state">历史资料暂未载入，请刷新页面重试。</p>';
    return;
  }
  const now = new Date().getFullYear();
  const records = data.dynasties.map(d => ({...d, end: d.ongoing || d.end == null ? now : d.end})).filter(d => Number.isFinite(d.start) && Number.isFinite(d.end));
  const sourceList = Array.isArray(data.sources) ? data.sources : Object.entries(data.sources).map(([id,s]) => ({id,...s}));
  const sourceMap = new Map(sourceList.map(s => [s.id,s]));
  const eras = (data.eras || []).filter(e => Number.isFinite(e.start) && Number.isFinite(e.end));
  const byId = new Map(records.map(d => [d.id,d]));
  const groupName = d => eras.find(e => e.id === d.group)?.name || d.group || '其他';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const year = n => n < 0 ? `前${-n}` : `${n}`;
  const fullYear = n => n < 0 ? `公元前 ${-n} 年` : `公元 ${n} 年`;
  const ordinal = n => n < 0 ? n + 1 : n;
  const span = (a,b) => ordinal(b) - ordinal(a);
  const dateRange = d => d.dateLabel || `${d.approximate ? '约 ' : ''}${year(d.start)} — ${d.ongoing || d.end === now ? '至今' : year(d.end)}`;
  const palette = ['#a2573d','#547b67','#8e7b9f','#527d91','#ae9453','#6b8c80','#b67870','#77864d','#5c759d','#a58a77','#7c8a90','#ae7250'];
  const groups = [...new Set(records.map(d => d.group || '其他'))];
  const color = d => d.color || palette[records.findIndex(r => r.id === d.id) % palette.length];
  const state = {era:'overview', view:'graph', query:'', exact:false, zoom:1, selected:null};
  let lastTrigger = null;
  const shade = document.createElement('div'); shade.className='mobile-detail-shade'; document.body.append(shade);
  const motion = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

  function filterRecords() {
    let result = records;
    if (state.query) {
      const q = state.query.toLocaleLowerCase();
      result = result.filter(d => [d.name,groupName(d),d.region,d.note,d.english,...(d.aliases||[])].join(' ').toLocaleLowerCase().includes(q));
    } else if (state.era === 'overview') {
      result = result.filter(d => d.core);
    } else if (state.era !== 'all') {
      const era = eras.find(e => e.id === state.era);
      if (era) result = result.filter(d => state.era === 'regional' ? d.group === 'regional' : d.start < era.end && d.end > era.start);
    }
    return [...result].sort((a,b) => a.start-b.start || Number(b.core)-Number(a.core) || b.end-a.end || a.name.localeCompare(b.name,'zh-CN'));
  }

  function makeScale(start,end,selected) {
    const range = Math.max(1,span(start,end));
    const base = state.era === 'overview' || state.era === 'all' ? 1.25 : Math.min(8,Math.max(2,650/range));
    const px = base * state.zoom;
    const folds = [];
    if (!state.exact) {
      const events = [...new Set([start,end,...selected.flatMap(d=>[Math.max(start,d.start),Math.min(end,d.end)])])].sort((a,b)=>a-b);
      for (let i=1;i<events.length;i++) {
        const a=events[i-1], b=events[i];
        if (span(a,b)>220) folds.push({start:a+45,end:b-45,height:40});
      }
    }
    const y = n => {
      let value=span(start,n)*px;
      folds.forEach(f=>{if(n>f.start) value-=span(f.start,Math.min(n,f.end))*px-(span(f.start,Math.min(n,f.end))/span(f.start,f.end))*f.height;});
      return 75+value;
    };
    return {y,folds,height:y(end)+90,px};
  }

  function svgEl(tag,attrs,text) {
    const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
    Object.entries(attrs||{}).forEach(([k,v])=>el.setAttribute(k,v));
    if(text!==undefined) el.textContent=text;
    return el;
  }

  function renderMobileGraph(selected) {
    const chart=$('#chart');
    if(!selected.length){chart.replaceChildren();return;}
    const currentEra=eras.find(e=>e.id===state.era);
    let start=Math.min(...selected.map(d=>d.start)),end=Math.max(...selected.map(d=>d.end));
    if(currentEra&&!state.query){start=currentEra.start;end=currentEra.end;}
    const width=Math.max(280,$('#chart-scroll').clientWidth||document.documentElement.clientWidth-34);
    const events=[...new Set([start,end,...selected.flatMap(d=>[Math.max(start,d.start),Math.min(end,d.end)])])].sort((a,b)=>a-b);
    const starts=new Map(events.map(t=>[t,selected.filter(d=>Math.max(start,d.start)===t)]));
    const positions=new Map();
    let cursor=48;
    for(let i=0;i<events.length;i++){
      const t=events[i]; positions.set(t,cursor);
      if(i<events.length-1){
        const gap=span(t,events[i+1]);
        // Compact mobile is explicitly non-linear: reserve readable event labels,
        // then cap otherwise empty time. Every lane uses the SAME mapping.
        const labelSpace=Math.max(0,(starts.get(t)?.length||0)*37);
        cursor+=Math.max(24,labelSpace+10)+Math.min(46,Math.max(12,Math.log2(gap+1)*5))*state.zoom;
      }
    }
    const exactPx=1.1*state.zoom;
    const y=t=>state.exact?48+span(start,t)*exactPx:positions.get(t);
    const lanes=[],layout=[];
    for(const d of selected){
      const a=Math.max(start,d.start),b=Math.min(end,d.end);
      let lane=lanes.findIndex(last=>last<=a);if(lane<0)lane=lanes.length;
      lanes[lane]=b;layout.push({d,a,b,lane,s:y(a),e:y(b)});
    }
    const laneStep=Math.min(10,(width-194)/Math.max(1,lanes.length));
    const railStart=45,labelX=railStart+lanes.length*laneStep+13;
    const labelWidth=width-labelX-10;
    let lastLabel=-Infinity;
    for(const item of layout){
      item.labelY=Math.max(item.s-12,lastLabel+37);lastLabel=item.labelY;
    }
    const height=Math.max(y(end)+55,lastLabel+62);
    const svg=svgEl('svg',{class:'history-svg mobile-history-svg',width,height,viewBox:`0 0 ${width} ${height}`,role:'group','aria-label':`手机紧凑历史脉络图，${selected.length} 条记录`});
    svg.append(svgEl('title',{},state.exact?'等比例时间轴；名称标签通过引线连接到准确年份。':'紧凑时间轴，各段比例不同；同一高度代表同一年，全部并立分支在屏幕内。'));
    const bg=svgEl('g',{'aria-hidden':'true'});svg.append(bg);
    bg.append(svgEl('text',{x:7,y:20,class:'lane-label'},'年份'));
    bg.append(svgEl('text',{x:labelX,y:20,class:'lane-label'},'朝代 / 政权 · 点按查看'));
    const seen=[];
    for(const t of events){const py=y(t);if(seen.some(v=>Math.abs(v-py)<22))continue;seen.push(py);
      bg.append(svgEl('line',{x1:37,y1:py,x2:width-8,y2:py,class:'grid-line'}));
      bg.append(svgEl('text',{x:36,y:py+3,'text-anchor':'end',class:'year'},year(t)));
    }
    const paths=svgEl('g',{}),labels=svgEl('g',{});svg.append(paths,labels);
    for(const n of layout){const {d,s,e,lane,labelY}=n,x=railStart+lane*laneStep,c=color(d);
      const lineGroup=svgEl('g',{class:`record${state.selected===d.id?' selected':''}`,'data-id':d.id,'aria-hidden':'true'});
      lineGroup.append(svgEl('line',{x1:x,y1:s,x2:x,y2:e,stroke:c,class:'dynasty-line',...(d.approximate?{'stroke-dasharray':'4 3'}:{})}));
      lineGroup.append(svgEl('circle',{cx:x,cy:s,r:3.5,fill:'#fffef9',stroke:c,'stroke-width':1.8}));
      lineGroup.append(svgEl('circle',{cx:x,cy:e,r:2,fill:'#fffef9',stroke:c,'stroke-width':1.4}));
      if(d.start<start)lineGroup.append(svgEl('path',{d:`M${x-3} ${s+5}L${x} ${s-1}L${x+3} ${s+5}`,fill:'none',stroke:c,'stroke-width':1.5,class:'continuation-start'}));
      if(d.end>end)lineGroup.append(svgEl('path',{d:`M${x-3} ${e-5}L${x} ${e+1}L${x+3} ${e-5}`,fill:'none',stroke:c,'stroke-width':1.5,class:'continuation-end'}));
      lineGroup.append(svgEl('path',{d:`M${x+3.5} ${s}H${labelX-8}L${labelX} ${labelY+13}`,stroke:c,'stroke-width':.7,opacity:.45,fill:'none'}));paths.append(lineGroup);
      const button=svgEl('g',{class:`record mobile-record${state.selected===d.id?' selected':''}`,role:'button',tabindex:0,'data-id':d.id,'aria-pressed':String(state.selected===d.id),'aria-label':`${d.name}，${dateRange(d)}。查看详情`});
      button.append(svgEl('rect',{x:labelX-3,y:labelY-2,width:labelWidth+3,height:35,rx:4,fill:'#fffef9',class:'mobile-label-bg'}));
      button.append(svgEl('rect',{x:labelX-3,y:labelY-2,width:labelWidth+3,height:35,rx:4,class:'hit-area'}));
      button.append(svgEl('text',{x:labelX+3,y:labelY+12,class:'node-name'},d.name));
      button.append(svgEl('text',{x:labelX+3,y:labelY+26,class:'node-dates'},dateRange(d)));
      button.addEventListener('click',()=>selectRecord(d.id,button));button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectRecord(d.id,button);}});labels.append(button);
    }
    if(!state.exact){for(let i=0;i<events.length-1;i++){
      const a=events[i],b=events[i+1],gap=span(a,b);if(gap<80)continue;
      const top=y(a)+Math.max(0,(starts.get(a)?.length||0)*37)+10;
      const bottom=y(b)-14;if(bottom-top<7)continue;
      const mid=(top+bottom)/2;
      bg.append(svgEl('text',{x:labelX+3,y:mid+3,class:'fold-label'},`⋯ ${gap} 年间隔 · 已压缩`));
    }}
    // Never force layout with an empty chart: a long page can lose its scroll position.
    chart.replaceChildren(svg);
    $('#chart-hint').textContent=state.exact?'等比例刻度；各支流同年对齐。为避免重叠，名称标签用细引线连接到准确节点。':'手机紧凑刻度：所有分支一屏宽，同年对齐。各段比例不同，完整年代见名称下方。';
    if(currentEra&&!state.query)$('#chart-hint').textContent+=' 边界箭头表示超出所选时代，非真实起讫。';
  }

  function renderGraph(selected) {
    if(matchMedia('(max-width:800px)').matches){renderMobileGraph(selected);return;}
    const chart=$('#chart');
    if (!selected.length) {chart.replaceChildren();return;}
    const content=document.createDocumentFragment();
    const currentEra=eras.find(e=>e.id===state.era);
    let start=Math.min(...selected.map(d=>d.start)),end=Math.max(...selected.map(d=>d.end));
    if(currentEra&&!state.query){start=currentEra.start;end=currentEra.end;}
    const scale=makeScale(start,end,selected),{y,folds,height}=scale;
    const layout=[]; const lanes=[];
    for(const d of selected){
      const s=y(Math.max(start,d.start)),e=y(Math.min(end,d.end));
      let lane=lanes.findIndex(last=>last<=s);
      if(lane===-1) lane=lanes.length;
      lanes[lane]=Math.max(e,s+45);
      layout.push({d,s,e,lane});
    }
    const laneWidth=166;
    const width=Math.max(690,116+lanes.length*laneWidth);
    const svg=svgEl('svg',{class:'history-svg',width,height,viewBox:`0 0 ${width} ${height}`,role:'group','aria-label':`${state.query?'搜索结果':currentEra?.name||'中国历史'}脉络图，${selected.length} 条记录`});
    svg.append(svgEl('title',{},'政权存续时间轴。上古在上，近代在下，同一高度对应同一年。'));
    const background=svgEl('g',{'aria-hidden':'true'}); svg.append(background);
    background.append(svgEl('text',{x:23,y:30,class:'lane-label'},'年代 / YEAR'));
    background.append(svgEl('text',{x:116,y:30,class:'lane-label'},'并行政权 · 点击探索'));
    const step = span(start,end)>2500 ? 200 : span(start,end)>900 ? 100 : span(start,end)>300 ? 50 : span(start,end)>100 ? 20 : 10;
    const ticks=new Set([start,end]);
    for(let t=Math.ceil(start/step)*step;t<end;t+=step) if(t!==0) ticks.add(t);
    if(start<1&&end>1) ticks.add(1);
    const tickYs=[];
    [...ticks].sort((a,b)=>a-b).forEach(t=>{
      if(folds.some(f=>t>f.start&&t<f.end))return;
      const pos=y(t);
      if(tickYs.some(p=>Math.abs(pos-p)<24))return;
      tickYs.push(pos);
      background.append(svgEl('line',{x1:83,y1:pos,x2:width-20,y2:pos,class:'grid-line'}));
      background.append(svgEl('text',{x:67,y:pos+3,'text-anchor':'end',class:'year'},t===1?'公元 1':year(t)));
    });
    // Connections encode only a short, explicit transition list, never inferred legitimacy.
    const connections=[['xia','shang'],['shang','western-zhou'],['western-zhou','eastern-zhou'],['qin','western-han'],['western-han','xin'],['xin','eastern-han'],['eastern-han','cao-wei'],['eastern-han','shu-han'],['eastern-han','eastern-wu'],['cao-wei','western-jin'],['western-jin','eastern-jin'],['eastern-jin','liu-song'],['liu-song','southern-qi'],['southern-qi','liang'],['liang','chen'],['northern-wei','eastern-wei'],['northern-wei','western-wei'],['eastern-wei','northern-qi'],['western-wei','northern-zhou'],['northern-zhou','sui'],['sui','tang-first'],['tang-first','wu-zhou'],['wu-zhou','tang-restored'],['tang-restored','later-liang-five'],['later-liang-five','later-tang'],['later-tang','later-jin-five'],['later-jin-five','later-han'],['later-han','later-zhou'],['later-zhou','northern-song'],['northern-song','southern-song'],['yuan','ming'],['ming','qing']];
    const map=new Map(layout.map(n=>[n.d.id,n]));
    const edges=svgEl('g',{'aria-hidden':'true'}); svg.append(edges);
    connections.forEach(([a,b])=>{
      const p=map.get(a),q=map.get(b);if(!p||!q)return;
      const ax=113+p.lane*laneWidth,bx=113+q.lane*laneWidth;
      const ay=p.e,by=q.s;
      if(by<ay-50||by-ay>220||Math.abs(ay-by)<2&&ax===bx)return;
      edges.append(svgEl('path',{d:`M ${ax} ${ay} C ${ax} ${(ay+by)/2}, ${bx} ${(ay+by)/2}, ${bx} ${by}`,class:'connector'}));
    });
    const nodes=svgEl('g',{});svg.append(nodes);
    layout.forEach(({d,s,e,lane})=>{
      const x=113+lane*laneWidth,c=color(d);
      const group=svgEl('g',{class:`record${state.selected===d.id?' selected':''}`,role:'button',tabindex:'0','aria-label':`${d.name}，${dateRange(d)}。查看详情`,'aria-pressed':state.selected===d.id?'true':'false','data-id':d.id});
      group.append(svgEl('title',{},`${d.name} · ${dateRange(d)} · ${d.region||d.group}`));
      group.append(svgEl('rect',{x:x-10,y:s-11,width:laneWidth-12,height:Math.max(58,e-s+20),rx:7,class:'hit-area'}));
      group.append(svgEl('line',{x1:x,y1:s,x2:x,y2:e,stroke:c,class:'dynasty-line',...(d.approximate?{'stroke-dasharray':'5 3'}:{})}));
      group.append(svgEl('circle',{cx:x,cy:s,r:5.5,fill:'#fffef9',stroke:c,'stroke-width':2.5}));
      group.append(svgEl('circle',{cx:x,cy:e,r:3,fill:'#fffef9',stroke:c,'stroke-width':1.8}));
      if(d.start<start)group.append(svgEl('path',{d:`M ${x-4} ${s+5} L ${x} ${s} L ${x+4} ${s+5}`,stroke:c,fill:'none'}));
      if(d.end>end)group.append(svgEl('path',{d:`M ${x-4} ${e-5} L ${x} ${e} L ${x+4} ${e-5}`,stroke:c,fill:'none'}));
      const name=svgEl('text',{x:x+14,y:s+5,class:'node-name'},d.name);if(d.name.length>8)name.setAttribute('font-size','11');group.append(name);
      group.append(svgEl('text',{x:x+14,y:s+23,class:'node-dates'},dateRange(d)));
      if(e-s>78)group.append(svgEl('text',{x:x+14,y:s+41,class:'node-region'},(d.region||d.group||'').slice(0,16)));
      group.addEventListener('click',()=>selectRecord(d.id,group));
      group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectRecord(d.id,group);}});
      nodes.append(group);
    });
    // Folds are global bands across ALL lanes, never independent per-dynasty truncation.
    const foldLayer=svgEl('g',{'aria-hidden':'true'});svg.append(foldLayer);
    folds.forEach(f=>{
      const a=y(f.start),b=y(f.end),mid=(a+b)/2;
      foldLayer.append(svgEl('rect',{x:0,y:a+5,width,height:b-a-10,fill:'#faf8ef','fill-opacity':'.96','pointer-events':'none'}));
      let path='';for(let x=87;x<width-30;x+=23)path+=`M${x} ${mid-3}q5 -5 10 0t10 0 `;
      foldLayer.append(svgEl('path',{d:path,class:'fold-line','pointer-events':'none'}));
      foldLayer.append(svgEl('rect',{x:width/2-105,y:mid-13,width:210,height:26,rx:13,fill:'#faf8ef'}));
      foldLayer.append(svgEl('text',{x:width/2,y:mid+3,'text-anchor':'middle',class:'fold-label'},`${year(f.start)}—${year(f.end)} · 折叠 ${span(f.start,f.end)} 年`));
    });
    if(state.era==='overview'&&!state.query){
      const banner=document.createElement('div');banner.className='tradition-banner';
      banner.innerHTML='<span class="symbol" aria-hidden="true">∿</span><div><strong>史前文化与三皇五帝</strong><p>史前考古文化与后世传说不是同一种时间证据。传说人物缺乏可核定的绝对年代，因此另列于精确时间轴之前，不虚设起讫年份。</p></div>';
      content.append(banner);
    }
    content.append(svg);chart.replaceChildren(content);
    $('#chart-hint').textContent=`同一水平线代表同一年。${folds.length?`本图有 ${folds.length} 处明确标记的折叠时段。`:'本图采用统一的年份比例。'}${currentEra&&!state.query?'超出本时代的政权线段在边界裁切，标签保留完整起讫年。':'虚线仅提示历史关联，不表示完整继承关系。'}`;
  }

  function renderList(selected) {
    const list=$('#list');list.replaceChildren();
    for(const d of selected){
      const button=document.createElement('button');button.type='button';button.className='record-row';button.dataset.id=d.id;button.setAttribute('aria-pressed',String(state.selected===d.id));
      button.innerHTML=`<strong>${esc(d.name)}</strong><time>${esc(dateRange(d))}</time><small>${esc(groupName(d))} · ${esc(d.region)}</small><i aria-hidden="true">↗</i>`;
      button.addEventListener('click',()=>selectRecord(d.id,button));list.append(button);
    }
  }

  function render() {
    const selected=filterRecords(),era=eras.find(e=>e.id===state.era);
    $('#graph-view').setAttribute('aria-pressed',String(state.view==='graph'));
    $('#list-view').setAttribute('aria-pressed',String(state.view==='list'));
    document.querySelectorAll('.era-nav button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.era===state.era&&!state.query)));
    $('#mobile-era').value=state.era;
    $('#era-label').textContent=state.query?'SEARCH RESULTS':state.era==='overview'?'全局视角 / OVERVIEW':state.era==='all'?'完整收录 / ALL RECORDS':`${year(era?.start)}—${year(era?.end)}`;
    $('#chart-title').textContent=state.query?`搜索「${state.query}」`:state.era==='overview'?'朝代主线':state.era==='all'?'全部历史支流':era?.name||'历史脉络';
    $('#chart-subtitle').textContent=state.query?'搜索覆盖全部已收录记录':state.era==='overview'?'主干朝代与主要并行政权，选择时代展开更多':state.era==='all'?'完整记录较多，可选择具体时代缩小范围':era?.description||'同一时代，并行存在的历史支流';
    $('#chart-scroll').hidden=state.view!=='graph'||!selected.length;
    $('#list').hidden=state.view!=='list'||!selected.length;
    $('#empty').hidden=Boolean(selected.length);
    $('#visible-count').textContent=`显示 ${selected.length} / ${records.length} 条记录${state.era==='overview'&&!state.query?' · 总览主线':''}`;
    $('#result-status').textContent=`找到 ${selected.length} 条历史记录`;
    $('#zoom-label').textContent=`${Math.round(state.zoom*100)}%`;
    const mobile=matchMedia('(max-width:800px)').matches;
    $('#chart-scroll').setAttribute('aria-label',mobile?'历史脉络图，随页面上下阅读':'历史脉络图，可上下和左右滚动');
    document.querySelector('.chart-footer span:last-child').textContent=mobile?'分支一屏宽 · 上下阅读':'横向滑动查看并立支流 ↔';
    $('#zoom-out').disabled=state.zoom<=.5;
    $('#zoom-in').disabled=state.zoom>=2;
    $('#exact-scale').checked=state.exact;
    renderGraph(selected);renderList(selected);
    $('#chart-scroll').scrollTop=0;$('#chart-scroll').scrollLeft=0;$('#list').scrollTop=0;
  }

  function defaultDetail() {
    $('#detail-content').innerHTML='<div class="detail-top"><div class="detail-kicker"><i></i> HISTORY IN CONTEXT</div><h3 id="detail-title">读懂分与合</h3><div class="detail-dates">让每一条支流，都有来处。</div><span class="detail-symbol" aria-hidden="true">史</span></div><div class="detail-body"><p class="detail-intro">把一个朝代，<br>放回它的时代。</p><p>点击图中的朝代，查看起讫年、历史背景与同时存在的其他政权。</p><div class="detail-help">从“魏晋十六国”或“五代十国”开始，最能看见历史并非只有一条线。</div><div class="detail-section"><h4>阅读提示</h4><p>线段长短对应时间。左右位置仅用于排版，不代表地理方位或正统归属。</p></div><div class="detail-section"><h4>完整范围</h4><p>总览保留主线，时代标签展开细节。“全部记录”与搜索均可访问完整数据。</p></div></div>';
  }

  function selectRecord(id,trigger) {
    const d=byId.get(id);if(!d)return;state.selected=id;if (trigger && !$('#detail-panel').contains(trigger)) lastTrigger=trigger;
    document.querySelectorAll('[data-id]').forEach(el=>{const yes=el.dataset.id===id;el.classList.toggle('selected',yes);el.setAttribute('aria-pressed',String(yes));});
    const peers=records.filter(p=>p.id!==d.id&&p.start<d.end&&p.end>d.start).sort((a,b)=>Number(b.core)-Number(a.core)||a.start-b.start);
    const refs=(d.sourceIds||[]).map(s=>sourceMap.get(s)).filter(Boolean);
    const duration=span(d.start,d.end);
    $('#detail-content').innerHTML=`<button class="detail-close" aria-label="关闭朝代详情">×</button><div class="detail-top"><div class="detail-kicker"><i style="background:${color(d)}"></i>${esc(groupName(d))}</div><h3 id="detail-title" tabindex="-1">${esc(d.name)}</h3><div class="detail-dates">${esc(dateRange(d))}</div><span class="detail-symbol" aria-hidden="true">${esc(d.name[0])}</span></div><div class="detail-body"><div class="detail-meta"><div><span>存续跨度</span><strong>${d.approximate?'约 ':''}${duration} 年${d.ongoing?'，持续中':''}</strong></div><div><span>主要范围</span><strong>${esc(d.region||'见历史说明')}</strong></div></div><div class="detail-section"><h4>历史与纪年</h4><p>${esc(d.note||'采用常用历史纪年。起讫年份依政权建立与终结的常用口径记载。')}</p></div>${d.approximate?'<p class="detail-note">早期年代或建政边界具有不确定性。图中虚线标记为近似纪年，不应理解为已确定的具体年份。</p>':''}<div class="detail-section"><h4>同时存在的政权 · ${peers.length} 项</h4><div class="peer-list">${peers.slice(0,16).map(p=>`<button class="detail-tag" data-peer="${esc(p.id)}">${esc(p.name)}</button>`).join('')||'<p>当前收录范围内，无其他同期记录。</p>'}</div>${peers.length>16?`<p>另有 ${peers.length-16} 项，可在该时代或年代表中查看。</p>`:''}</div><div class="detail-section"><h4>参考来源</h4>${refs.map(s=>`<a class="detail-source" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`).join('')||'<p>参见页面下方的通用历史年表。</p>'}</div><div class="detail-section"><p style="font-size:9px;margin:0">“存续跨度”为起讫年份的距离，不计虚构的公元零年；不是首尾年均计入的纪年数。</p></div></div>`;
    $('#detail-content').querySelectorAll('[data-peer]').forEach(b=>b.addEventListener('click',()=>selectRecord(b.dataset.peer,b)));
    $('.detail-close').addEventListener('click',closeDetail);
    if(matchMedia('(max-width:800px)').matches){$('#detail-panel').classList.add('is-open');shade.classList.add('visible');setModal(true);$('#detail-title').focus({preventScroll:true});}
  }

  function setModal(open) {
    const panel=$('#detail-panel');
    if(open){panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');}
    else{panel.removeAttribute('role');panel.removeAttribute('aria-modal');}
    document.querySelectorAll('.masthead,.hero,.stats,.section-heading,.control-bar,.era-nav,.mobile-era-picker,.chart-card,.reading-notes,.source-section,.site-footer').forEach(el=>el.inert=open);
    document.body.style.overflow=open?'hidden':'';
  }
  function closeDetail(){
    const wasOpen=$('#detail-panel').classList.contains('is-open');
    $('#detail-panel').classList.remove('is-open');shade.classList.remove('visible');setModal(false);
    if(wasOpen&&lastTrigger?.isConnected)lastTrigger.focus({preventScroll:true});
  }
  shade.addEventListener('click',closeDetail);
  $('#record-count').innerHTML=`${records.length}<span>项</span>`;
  const nav=$('#era-nav');
  const mobileSelect=$('#mobile-era');
  [{id:'overview',name:'总览主线'},...eras,{id:'all',name:'全部记录'}].forEach(e=>{
    const button=document.createElement('button');button.type='button';button.dataset.era=e.id;button.textContent=e.name;button.setAttribute('aria-pressed',e.id==='overview'?'true':'false');
    button.addEventListener('click',()=>{state.era=e.id;state.query='';$('#search').value='';render();});nav.append(button);
    const option=document.createElement('option');option.value=e.id;option.textContent=e.name;mobileSelect.append(option);
  });
  mobileSelect.addEventListener('change',event=>{state.era=event.target.value;state.query='';$('#search').value='';render();});
  $('#source-list').innerHTML=sourceList.map(s=>`<a class="source-card" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span>${esc(s.title)}<small>${esc(new URL(s.url).hostname)}</small></a>`).join('');
  $('#graph-view').addEventListener('click',()=>{state.view='graph';render();});
  $('#list-view').addEventListener('click',()=>{state.view='list';render();});
  $('#search').addEventListener('input',event=>{state.query=event.target.value.trim();render();});
  $('#clear-search').addEventListener('click',()=>{state.query='';$('#search').value='';render();$('#search').focus();});
  $('#exact-scale').addEventListener('change',event=>{state.exact=event.target.checked;render();});
  $('#zoom-out').addEventListener('click',()=>{state.zoom=Math.max(.5,state.zoom-.25);render();});
  $('#zoom-in').addEventListener('click',()=>{state.zoom=Math.min(2,state.zoom+.25);render();});
  $('#show-all').addEventListener('click',()=>{state.era='all';state.query='';$('#search').value='';render();});
  $('#reset').addEventListener('click',()=>{Object.assign(state,{era:'overview',view:'graph',query:'',exact:false,zoom:1,selected:null});$('#search').value='';closeDetail();defaultDetail();render();});
  const dialog=$('#method-dialog');let methodTrigger=null;
  $('#method-button').addEventListener('click',event=>{methodTrigger=event.currentTarget;dialog.showModal();});
  const closeMethod=()=>{dialog.close();methodTrigger?.focus();};
  $('#close-method').addEventListener('click',closeMethod);$('#got-it').addEventListener('click',closeMethod);
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeMethod();}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDetail();
    if($('#detail-panel').classList.contains('is-open')){
      if(event.key==='Tab'){
        const focusable=[...$('#detail-panel').querySelectorAll('button,a[href],[tabindex="0"]')];
        const first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey&&(document.activeElement===first||document.activeElement===$('#detail-title'))){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
      return;
    }
    if(event.key==='/'&&!/INPUT|TEXTAREA/.test(document.activeElement.tagName)&&!dialog.open){event.preventDefault();$('#search').focus();$('#explorer').scrollIntoView({behavior:motion()});}});
  // Close mobile-only overlay when moving to desktop; keeps resize/repeated flows clean.
  matchMedia('(max-width:800px)').addEventListener('change',e=>{if(!e.matches)closeDetail();render();});
  // Safari's toolbar/keyboard changes viewport HEIGHT during ordinary scrolling.
  // Only a real layout WIDTH change can require a different mobile SVG.
  // Do not use visualViewport width: pinch zoom must not rebuild the document.
  let resizeTimer,layoutWidth=document.documentElement.clientWidth;
  window.addEventListener('resize',()=>{
    const width=document.documentElement.clientWidth;
    if(width===layoutWidth)return;
    layoutWidth=width;clearTimeout(resizeTimer);
    resizeTimer=setTimeout(()=>{
      if(matchMedia('(max-width:800px)').matches&&state.view==='graph')renderGraph(filterRecords());
    },150);
  });
  window.HistoryTimeline = {ordinal,span,formatYear:year,makeScale,renderMobileGraph,filterRecords,getState:()=>({...state}),records};
  defaultDetail();render();
})();

