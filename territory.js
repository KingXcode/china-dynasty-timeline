/* Source-interval viewer, not an annual reconstruction. No external JS or map tiles. */
(() => {
  'use strict';
  const MIN = -221, MAX = 1911, VERSION = 'v021-map1';
  const inRange = (year, range) => range[0] <= year && year <= range[1];
  const fromSlider = n => n < 0 ? n : n + 1;
  const toSlider = y => y < 0 ? y : y - 1;
  const yearText = y => y < 0 ? `公元前 ${-y} 年` : `公元 ${y} 年`;
  const shortYear = y => y < 0 ? `前${-y}` : String(y);
  const period = (from, to) => `${shortYear(from)}—${shortYear(to)} 年`;
  const bucketFor = year => Math.floor(year / 100) * 100;
  const validYear = y => Number.isInteger(y) && y !== 0 && y >= MIN && y <= MAX;
  const activeAt = (features, year) => features.filter(f => f.properties.FromYear <= year && f.properties.ToYear >= year);
  function acceptedAt(feature, year, audit) {
    const identity = audit.identities[feature.properties.Name];
    return !identity || !identity.canonicalRanges.length || identity.canonicalRanges.some(r => inRange(year, r));
  }
  function project(coordinate) {
    const lon = coordinate[0], lat = Math.max(-80, Math.min(80, coordinate[1]));
    const merc = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;
    return [(lon - 68) * 13.15, (71.16 - merc) * 13.15];
  }
  function ringsOf(geometry) { return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(); }
  function geometryPath(geometry) {
    return ringsOf(geometry).map(ring => ring.map((p, i) => {
      const [x, y] = project(p); return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join('') + 'Z').join('');
  }
  function labelPoint(geometry) {
    // Largest exterior only: labels never rely on corrupt source identity codes.
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let winner = null, maxArea = -1;
    for (const poly of polys) {
      const ps = poly[0].map(project); let twiceArea = 0, cx = 0, cy = 0;
      for (let i = 0; i < ps.length - 1; i++) {
        const cross = ps[i][0] * ps[i + 1][1] - ps[i + 1][0] * ps[i][1];
        twiceArea += cross; cx += (ps[i][0] + ps[i + 1][0]) * cross; cy += (ps[i][1] + ps[i + 1][1]) * cross;
      }
      if (Math.abs(twiceArea) > maxArea && twiceArea) {
        maxArea = Math.abs(twiceArea); winner = {x: cx / (3 * twiceArea), y: cy / (3 * twiceArea), area: maxArea / 2};
      }
    }
    return winner;
  }
  function getChanges(records, audit) {
    const changes = new Set([MIN, MAX]);
    for (const r of records) {
      for (const y of [r.from, r.to + 1]) if (validYear(y)) changes.add(y);
      const identity = audit.identities[r.name];
      for (const interval of identity?.canonicalRanges || []) {
        for (const y of [interval[0], interval[1] + 1]) if (validYear(y)) changes.add(y);
      }
    }
    return [...changes].sort((a, b) => a - b);
  }
  const api = {fromSlider, toSlider, yearText, bucketFor, validYear, activeAt, acceptedAt, project, geometryPath, labelPoint, getChanges};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attributes = {}) => {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  };
  const textEl = (tag, text, className) => {
    const element = document.createElement(tag); element.textContent = text;
    if (className) element.className = className; return element;
  };
  const cache = new Map(), paths = new Map(), pointers = new Map();
  let names = {}, audit = {identities:{}, warnings:[], sourceCoverageGaps:[], missingStandaloneIdentities:[]}, index = {records:[]};
  let year = 1142, requestVersion = 0, active = [], excluded = [], selected = null, changes = [];
  let scale = 1, tx = 0, ty = 0, lastGesture = null, dragDistance = 0, labelsEnabled = true;
  let tapPointer = null;
  let timer = null, playing = false, ready = false, lastLoadedYear = null;
  const allowed = new Set();
  const colors = new Map();
  function label(name) {
    if (name === 'Western Jin') return '晋〔来源未分西晋/东晋〕';
    if (name === 'Han Dynasty') return '汉〔来源统称〕';
    return names[name] || name;
  }
  function shortLabel(name) {
    return label(name).replace(/〔.*?〕/g, '').replace(/（.*?）/g, '');
  }
  function colorFor(name) {
    if (!colors.has(name)) {
      const position = Object.keys(names).sort().indexOf(name);
      const hue = (position * 137.508 + 18) % 360;
      colors.set(name, `hsl(${hue.toFixed(0)} 38% 52%)`);
    }
    return colors.get(name);
  }
  async function getJSON(path) {
    const response = await fetch(`${path}?v=${VERSION}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
    return response.json();
  }
  async function getEra(bucket) {
    if (!cache.has(bucket)) {
      cache.set(bucket, getJSON(`map-data/era-${bucket}.geojson`).catch(error => { cache.delete(bucket); throw error; }));
    }
    return cache.get(bucket);
  }
  function drawLand(land) {
    const fragment = document.createDocumentFragment();
    land.features.forEach(f => fragment.append(svgEl('path', {d:geometryPath(f.geometry), class:'map-land'})));
    $('map-land').replaceChildren(fragment);
    const grid = document.createDocumentFragment();
    for (let lon = 0; lon <= 180; lon += 10) {
      const a = project([lon, -10]), b = project([lon, 78]);
      grid.append(svgEl('path', {d:`M${a}L${b}`, class:'graticule-line'}));
    }
    for (let lat = 0; lat <= 70; lat += 10) {
      const a = project([0,lat]), b = project([180,lat]);
      grid.append(svgEl('path', {d:`M${a}L${b}`, class:'graticule-line'}));
    }
    $('map-graticule').replaceChildren(grid);
  }
  function clearYearLayers() {
    active = []; selected = null;
    $('map-polygons').replaceChildren(); $('map-labels').replaceChildren(); $('polity-list').replaceChildren();
    $('polity-detail').hidden = true; $('polity-count').textContent = '';
  }
  function updateYearUI() {
    $('map-year').textContent = yearText(year); $('dock-year').textContent = year < 0 ? `前${-year} 年` : `${year} 年`;
    $('year-slider').value = toSlider(year); $('year-slider').setAttribute('aria-valuetext', yearText(year));
    $('svg-title').textContent = `${yearText(year)}来源区间疆域示意`;
    $('previous-year').disabled = year === MIN; $('next-year').disabled = year === MAX;
    $('previous-change').disabled = !changes.some(y => y < year); $('next-change').disabled = !changes.some(y => y > year);
    document.querySelectorAll('[data-year]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.year) === year)));
    $('year-number').max = year < 0 ? '221' : '1911'; $('year-number').value = Math.abs(year); $('year-era').value = year < 0 ? 'bce' : 'ce';
    const url = new URL(location.href); url.searchParams.set('year', year); history.replaceState(null, '', url);
  }
  function showWarnings() {
    const block = document.createDocumentFragment();
    const spans = active.map(f => `${f.properties.FromYear}:${f.properties.ToYear}`);
    block.append(textEl('p', `已绘 ${active.length} 条来源记录。轮廓取自各自的多年区间，不表示这些边界在本年都已被精确核实。`));
    const warnings = audit.warnings.filter(w => year >= w.fromYear && year <= w.toYear).map(w => w.messageZh);
    if (excluded.length) {
      warnings.push(`已不绘制 ${excluded.length} 条明显时间错位的原始记录：${[...new Set(excluded.map(f => label(f.properties.Name)))].join('、')}。这些空缺没有用其他年份的疆域补齐。`);
    }
    const missing = audit.sourceCoverageGaps.filter(g => g.missingSourceIntervals.some(r => inRange(year, r))).map(g => g.labelZh);
    missing.push(...audit.missingStandaloneIdentities.filter(g => inRange(year, g.canonicalRange)).map(g => g.labelZh));
    if (missing.length) warnings.push(`已知未能单独绘制：${[...new Set(missing)].join('、')}。没有颜色不表示这些政权不存在。`);
    if (active.some(f => f.properties.Name === 'Western Jin')) warnings.push('“晋”轮廓在源文件里统一写作 Western Jin（西晋），未可靠区分西晋、东晋。本版保留这一命名问题，不能据此精确复原两晋疆域。');
    if (active.some(f => f.properties.Name === 'Protectorate of the Western Regions')) warnings.push('“西域都护府”是原数据名称，其延续年代及隶属关系需要单独考证，不应理解为本年仍由汉朝直接管辖。');
    if (!warnings.length) warnings.push('本年没有额外的已知年表冲突提示，不等于数据完整或已经历史学核验。地方势力、短期政权与部分边疆记录仍可能缺失。');
    const list = document.createElement('ul'); warnings.forEach(w => list.append(textEl('li', w))); block.append(list);
    $('year-warning-content').replaceChildren(block);
    $('year-warning').dataset.warningCount = warnings.length;
    $('year-warning').dataset.excludedCount = excluded.length;
    $('year-warning').dataset.intervalCount = new Set(spans).size;
  }
  function showChronology() {
    const records = (window.HISTORY_DATA?.dynasties || []).filter(d => d.start <= year && d.end >= year);
    $('chronology-count').textContent = `（${records.length}）`;
    const fragment = document.createDocumentFragment();
    records.forEach(d => fragment.append(textEl('span', `${d.name} · ${period(d.start, d.end)}`)));
    $('chronology-list').replaceChildren(fragment);
  }
  function renderPolities() {
    const polygonFragment = document.createDocumentFragment(), labelFragment = document.createDocumentFragment(), listFragment = document.createDocumentFragment();
    // Large geometry first, smaller concurrent polities remain clickable above it.
    const ordered = [...active].sort((a, b) => b.properties.Area - a.properties.Area);
    const occupied = [];
    for (const f of ordered) {
      const p = f.properties;
      if (!paths.has(f.id)) paths.set(f.id, geometryPath(f.geometry));
      const path = svgEl('path', {d:paths.get(f.id), fill:colorFor(p.Name), class:'map-polity', 'data-id':f.id});
      const title = svgEl('title'); title.textContent = `${label(p.Name)}；来源 ${period(p.FromYear,p.ToYear)}`; path.append(title);
      polygonFragment.append(path);
      const point = labelPoint(f.geometry);
      if (point && point.area > 700 && point.x > -100 && point.x < 1100 && point.y > -100 && point.y < 900 && !occupied.some(q => Math.abs(q.x-point.x) < 80 && Math.abs(q.y-point.y) < 28)) {
        occupied.push(point);
        const text = svgEl('text', {x:point.x.toFixed(1), y:point.y.toFixed(1), class:'map-place-label', 'data-id':f.id});
        text.textContent = shortLabel(p.Name); labelFragment.append(text);
      }
    }
    for (const f of [...active].sort((a,b) => b.properties.Area-a.properties.Area)) {
      const p = f.properties, button = textEl('button', '', 'polity-item'); button.type = 'button'; button.dataset.id = f.id;
      button.setAttribute('aria-pressed','false');
      const swatch = textEl('span','','swatch'); swatch.style.background = colorFor(p.Name); swatch.setAttribute('aria-hidden','true');
      const content = textEl('span','','polity-text'); content.append(textEl('strong',label(p.Name)),textEl('small',`来源时段 ${period(p.FromYear,p.ToYear)}`));
      button.append(swatch,content,textEl('span','↗','polity-arrow')); button.addEventListener('click',()=>selectFeature(f.id)); listFragment.append(button);
    }
    $('map-polygons').replaceChildren(polygonFragment); $('map-labels').replaceChildren(labelFragment); $('map-labels').style.display = labelsEnabled ? '' : 'none';
    $('polity-list').replaceChildren(listFragment); $('polity-count').textContent = `${active.length} 条记录`;
    if (!active.length) $('polity-list').append(textEl('p','本版在此年没有可绘制的记录。请查看下方年表对照与缺漏提示。','aside-hint'));
  }
  function selectFeature(id) {
    const feature = active.find(f => f.id === id); if (!feature) return;
    selected = selected === id ? null : id;
    document.querySelectorAll('.map-polity').forEach(el => {el.classList.toggle('selected', Number(el.dataset.id)===selected);el.classList.toggle('dimmed',selected!==null && Number(el.dataset.id)!==selected);});
    document.querySelectorAll('.polity-item').forEach(el => el.setAttribute('aria-pressed',String(Number(el.dataset.id)===selected)));
    const detail = $('polity-detail'); detail.hidden = selected === null; if (selected === null) return;
    const p = feature.properties, fragment = document.createDocumentFragment();
    const close = textEl('button','取消选中'); close.addEventListener('click',()=>selectFeature(id)); fragment.append(close);
    fragment.append(textEl('span','SOURCE RECORD','tiny-label'));
    const heading = textEl('h3', label(p.Name)); heading.id = 'detail-heading'; fragment.append(heading);
    fragment.append(textEl('p',`来源原名：${p.Name}`,'raw-name'));
    fragment.append(textEl('p',`这块轮廓对应来源区间：${period(p.FromYear,p.ToYear)}`,'detail-span'));
    fragment.append(textEl('p',`当前筛选 ${yearText(year)}。该区间内沿用同一来源轮廓，不能据此推断逐年的真实边界变化。`));
    const identity = audit.identities[p.Name];
    if (identity?.canonicalRanges?.length) fragment.append(textEl('p',`年表纪年参考：${identity.canonicalRanges.map(r=>period(r[0],r[1])).join('；')}。年表区间不是这块轮廓的有效性认证。`));
    if (identity?.note || identity?.chronologyNote) fragment.append(textEl('p', identity.note || identity.chronologyNote));
    if (p.MemberOf) fragment.append(textEl('p',`原数据关系字段：${p.MemberOf}。仅保留来源记录，不代表本版认定的直接统治关系。`));
    fragment.append(textEl('p',`固定来源记录 #${feature.id} · Cliopatria v0.2.1 · POLITY`,'raw-name'));
    const source = textEl('a','查看固定版本来源 ↗'); source.href='https://github.com/Seshat-Global-History-Databank/cliopatria/tree/5f433377139a6eeaeacbdc894b70f8805b72c8b5';source.target='_blank';source.rel='noopener noreferrer';fragment.append(source);
    detail.replaceChildren(fragment);
    // Mobile details stay in document flow: no modal, no forced scroll jump.
  }
  async function setYear(next, options={}) {
    if (!validYear(next)) return false;
    if (!options.keepPlaying) stopPlaying();
    year=next; const token=++requestVersion; updateYearUI(); clearYearLayers(); showChronology();
    $('map-error').hidden=true; $('map-loading').hidden=false; $('coverage-count').textContent='正在读取资料';
    $('year-warning-content').replaceChildren(textEl('p',`正在读取${yearText(year)}的来源记录…`));
    try {
      if (!ready) throw new Error('Metadata unavailable');
      const data=await getEra(bucketFor(year)); if (token!==requestVersion) return false;
      const sourceRows=activeAt(data.features,year).filter(f=>allowed.has(f.properties.Name));
      active=sourceRows.filter(f=>acceptedAt(f,year,audit)); excluded=sourceRows.filter(f=>!acceptedAt(f,year,audit));
      renderPolities(); showWarnings(); $('map-loading').hidden=true;
      $('coverage-count').textContent=`${active.length} 条来源记录 · 区间示意`;
      lastLoadedYear=year; return true;
    } catch (error) {
      if(token!==requestVersion)return false;
      clearYearLayers(); $('map-loading').hidden=true; $('map-error').hidden=false; $('coverage-count').textContent='此年数据未加载';
      $('year-warning-content').replaceChildren(textEl('p','加载失败，当前不显示疆域。年表对照仍可阅读。请重新加载后再判断数据覆盖。'));
      stopPlaying(); console.warn('Map data unavailable:',error.message);return false;
    }
  }
  function setTransform() { $('map-world').setAttribute('transform',`translate(${tx} ${ty}) scale(${scale})`); }
  function zoom(factor,center={x:500,y:390}) {
    const next=Math.max(.35,Math.min(6,scale*factor)),ratio=next/scale;
    tx=center.x-(center.x-tx)*ratio;ty=center.y-(center.y-ty)*ratio;scale=next;setTransform();
  }
  function svgPoint(event) {
    const matrix=$('territory-svg').getScreenCTM();
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return {x:point.x,y:point.y};
  }
  function gesture() {
    const ps=[...pointers.values()];
    if(ps.length===1)return{x:ps[0].x,y:ps[0].y,distance:0};
    if(ps.length>=2)return{x:(ps[0].x+ps[1].x)/2,y:(ps[0].y+ps[1].y)/2,distance:Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y)};
    return null;
  }
  const stage=$('map-stage');
  stage.addEventListener('pointerdown',event=>{
    if(event.target.closest('button') || event.target.closest('.map-error'))return;
    if(event.pointerType==='mouse' && event.button!==0)return;
    if (!pointers.size) { dragDistance=0; tapPointer=event.pointerId; }
    else tapPointer=null; // Any multi-pointer gesture is never a selection tap.
    pointers.set(event.pointerId,svgPoint(event));lastGesture=gesture();
    stage.setPointerCapture(event.pointerId);stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,svgPoint(event));const current=gesture();
    if(lastGesture && current){const dx=current.x-lastGesture.x,dy=current.y-lastGesture.y;tx+=dx;ty+=dy;dragDistance+=Math.hypot(dx,dy);
      if(current.distance && lastGesture.distance){zoom(current.distance/lastGesture.distance,current);dragDistance+=2;}
      setTransform();}lastGesture=current;
  });
  function endPointer(event){
    if(!pointers.has(event.pointerId))return;
    const canSelect=event.type==='pointerup' && tapPointer===event.pointerId && dragDistance<7;
    if(tapPointer===event.pointerId)tapPointer=null;
    pointers.delete(event.pointerId);lastGesture=gesture();
    if(!pointers.size)stage.classList.remove('dragging');
    // Capture retargets pointerup to stage; hit-test only a valid single-pointer tap.
    if(canSelect){
      const element=document.elementFromPoint(event.clientX,event.clientY)?.closest('.map-polity');
      if(element){event.preventDefault();selectFeature(Number(element.dataset.id));}
    }
  }
  stage.addEventListener('pointerup',endPointer);stage.addEventListener('pointercancel',endPointer);stage.addEventListener('lostpointercapture',endPointer);
  stage.addEventListener('wheel',event=>{if(!event.ctrlKey && !event.metaKey)return;event.preventDefault();zoom(event.deltaY<0?1.15:1/1.15,svgPoint(event));},{passive:false});
  stage.addEventListener('keydown',event=>{
    let handled=true;
    if(event.key==='+'||event.key==='=')zoom(1.25);else if(event.key==='-')zoom(.8);
    else if(event.key==='ArrowLeft')tx+=45;else if(event.key==='ArrowRight')tx-=45;else if(event.key==='ArrowUp')ty+=45;else if(event.key==='ArrowDown')ty-=45;
    else if(event.key==='Home'){scale=1;tx=ty=0;}else handled=false;
    if(handled){event.preventDefault();setTransform();}
  });
  $('map-zoom-in').addEventListener('click',()=>zoom(1.35));$('map-zoom-out').addEventListener('click',()=>zoom(1/1.35));
  $('map-reset').addEventListener('click',()=>{scale=1;tx=ty=0;setTransform();});
  $('toggle-labels').addEventListener('click',()=>{labelsEnabled=!labelsEnabled;$('map-labels').style.display=labelsEnabled?'':'none';$('toggle-labels').setAttribute('aria-pressed',String(labelsEnabled));$('toggle-labels').textContent=`名称 ${labelsEnabled?'开':'关'}`;});
  function stopPlaying(){playing=false;clearTimeout(timer);timer=null;$('play-years').setAttribute('aria-pressed','false');$('play-years').innerHTML='▶ <span>播放</span>';$('play-years').setAttribute('aria-label','自动浏览年份');}
  async function tick(){if(!playing)return;const next=changes.find(y=>y>year);if(next===undefined){stopPlaying();return;}const success=await setYear(next,{keepPlaying:true});if(playing&&success)timer=setTimeout(tick,1800);}
  $('play-years').addEventListener('click',()=>{if(playing){stopPlaying();return;}if(!ready||lastLoadedYear!==year)return;playing=true;$('play-years').setAttribute('aria-pressed','true');$('play-years').innerHTML='Ⅱ <span>暂停</span>';$('play-years').setAttribute('aria-label','暂停自动浏览');timer=setTimeout(tick,900);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPlaying();});
  $('year-slider').addEventListener('input',event=>setYear(fromSlider(Number(event.target.value))));
  $('previous-year').addEventListener('click',()=>setYear(fromSlider(toSlider(year)-1)));$('next-year').addEventListener('click',()=>setYear(fromSlider(toSlider(year)+1)));
  $('previous-change').addEventListener('click',()=>{const next=[...changes].reverse().find(y=>y<year);if(next!==undefined)setYear(next);});
  $('next-change').addEventListener('click',()=>{const next=changes.find(y=>y>year);if(next!==undefined)setYear(next);});
  document.querySelectorAll('[data-year]').forEach(button=>button.addEventListener('click',()=>setYear(Number(button.dataset.year))));
  $('jump-toggle').addEventListener('click',()=>{const hidden=!$('year-form').hidden;$('year-form').hidden=hidden;$('jump-toggle').setAttribute('aria-expanded',String(!hidden));if(!hidden){stopPlaying();$('year-number').focus({preventScroll:true});}});
  $('year-era').addEventListener('change',()=>{$('year-number').max=$('year-era').value==='bce'?'221':'1911';});
  $('year-form').addEventListener('submit',event=>{event.preventDefault();const next=Number($('year-number').value)*($('year-era').value==='bce'?-1:1);if(!validYear(next)){$('year-form-error').textContent='请输入公元前221年至公元1911年内的整数；没有公元0年。';return;}$('year-form-error').textContent='';$('year-form').hidden=true;$('jump-toggle').setAttribute('aria-expanded','false');setYear(next);});
  $('retry-map').addEventListener('click',()=>ready?setYear(year):initialize());
  window.addEventListener('popstate',()=>{const query=Number(new URLSearchParams(location.search).get('year'));if(validYear(query))setYear(query);});
  async function initialize(){
    const query=Number(new URLSearchParams(location.search).get('year'));if(validYear(query))year=query;
    updateYearUI();showChronology();$('map-error').hidden=true;$('map-loading').hidden=false;
    try{
      const loaded=await Promise.all([getJSON('map-data/polities.json'),getJSON('map-data/audit.json'),getJSON('map-data/index.json'),getJSON('map-data/land.geojson')]);
      [names,audit,index]=loaded;Object.keys(names).forEach(n=>allowed.add(n));changes=getChanges(index.records,audit);drawLand(loaded[3]);ready=true;await setYear(year);
    }catch(error){ready=false;clearYearLayers();$('map-loading').hidden=true;$('map-error').hidden=false;$('coverage-count').textContent='资料初始化失败';$('year-warning-content').replaceChildren(textEl('p','元数据尚未读取成功。请重新加载。'));console.warn('Map initialization unavailable:',error.message);}
  }
  // Read-only diagnostics make local/live regression checks precise, without exposing data mutators.
  window.TERRITORY_STATE=()=>({year,ready,loadedYear:lastLoadedYear,activeIds:active.map(f=>f.id),activeNames:active.map(f=>f.properties.Name),excludedNames:excluded.map(f=>f.properties.Name),selected,playing,scale,tx,ty});
  initialize();
})();
