/* Building locations stay separate from map geometry and road-edit state. */
(() => {
  'use strict';
  const data = window.BUILDING_DIRECTORY_DATA;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = value => String(value).toLocaleLowerCase().replace(/\s/g,'');
  const label = floor => floor === null ? '주요시설' : floor === 'B1' ? '지하 1층' : floor+'층';
  const rows = [...data.entries];
  // Reuse the source-traced library room names, rather than maintaining a second list.
  const librarySource = 'library';
  const sources = {...data.sources, [librarySource]:{title:'중앙도서관 · 공식 층별안내',url:'https://library.kyungnam.ac.kr/webcontent/info/48',retrieved:data.retrieved}};
  for (const [floor, plan] of Object.entries(window.LibraryExplorer.floors)) {
    for (const room of plan.rooms) rows.push({building:'28',floor:floor==='B1'?floor:Number(floor),name:room.name,source:librarySource});
  }
  const seonghun=window.IndoorExplorer.buildings['20'];
  sources.seonghun={title:seonghun.sourceLabel,url:seonghun.source,provided:true};
  for(const [floor,plan] of Object.entries(seonghun.floors))for(const room of plan.rooms){
    if(!rows.some(r=>r.building==='20'&&String(r.floor)===floor&&normalize(r.name)===normalize(room.name)))rows.push({building:'20',floor:Number(floor),name:room.name,source:'seonghun'});
  }
  const byBuilding = new Map();
  for (const row of rows) {
    if(!byBuilding.has(row.building)) byBuilding.set(row.building,[]);
    byBuilding.get(row.building).push(row);
  }
  const floorOrder = floor => floor===null?Infinity:floor==='B1'?-1:Number(floor);
  for (const items of byBuilding.values()) items.sort((a,b)=>floorOrder(a.floor)-floorOrder(b.floor));
  function entries(id) { return byBuilding.get(String(id)) || []; }
  function find(id, query) { const q=normalize(query); return q ? entries(id).filter(row=>normalize(row.name).includes(q) || normalize(label(row.floor)+' '+row.name).includes(q)) : []; }
  function matches(place, query) {
    const q=normalize(query);
    const number=q.match(/^(?:no\.?|#|건물)?(\d{1,2})(?:번|번건물|호관)?$/);
    if(number)return Number(number[1])===place.officialNumber;
    return !q || normalize(place.name).includes(q) || normalize(place.officialNumber+' '+place.name).includes(q) || normalize(place.officialNumber+'번 '+place.name).includes(q) || (place.numberSourceName&&normalize(place.numberSourceName).includes(q)) || (data.aliases[place.id]||[]).some(name=>normalize(name).includes(q)) || find(place.id,q).length>0;
  }
  function summary(place, query) {
    const found=find(place.id,query);
    if(found.length) return label(found[0].floor)+' · '+found[0].name+(found.length>1?' 외 '+(found.length-1)+'곳':'');
    return '';
  }
  function render(id, query='') {
    const items=entries(id); if(!items.length) return '';
    const floors=new Map();
    for(const row of items) { if(!floors.has(row.floor))floors.set(row.floor,[]); floors.get(row.floor).push(row); }
    const hits=new Set(find(id,query)),plan=window.IndoorExplorer.buildings[String(id)];
    const floorLink=floor=>plan?.floors[floor]?'<button data-indoor-building="'+id+'" data-indoor-floor="'+escape(floor)+'" '+(String(id)==='28'?'data-library-floor="'+escape(floor)+'"':'')+' aria-label="'+escape(plan.name+' '+label(floor))+' 구조도 열기">'+escape(label(floor))+'<span aria-hidden="true"> ↗</span></button>':escape(label(floor));
    return '<section class="building-directory" aria-label="층별 학과·시설 안내"><div class="directory-heading"><h3>층별 안내</h3><span>학과 · 부서 · 시설</span></div><dl class="directory-floors">'+[...floors].map(([floor,facilities])=>'<div class="directory-floor"><dt>'+floorLink(floor)+'</dt><dd><ul>'+facilities.map(row=>'<li'+(hits.has(row)?' class="directory-match"':'')+'><span class="facility-name">'+escape(row.name)+'</span></li>').join('')+'</ul></dd></div>').join('')+'</dl></section>';
  }
  window.BuildingDirectory={entries,matches,summary,render,sources};
})();
