(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const iconPaths = {
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>',
    route:'<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h8a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h8"/>',
    bookmark:'<path d="M6 3h12v18l-6-4-6 4Z"/>',
    pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.4"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    minus:'<path d="M5 12h14"/>',
    fit:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="3"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    building:'<path d="M4 21V7l8-4 8 4v14ZM9 21v-5h6v5M8 9h.1M16 9h.1M8 12h.1M16 12h.1M12 8h.1M12 12h.1"/>',
    book:'<path d="M12 5C8 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-5-1-9 1Zm0 0v15"/>',
    leaf:'<path d="M20 3C8 2 2 7 5 15c3 8 15 4 15-12ZM4 21 16 8"/>',
    home:'<path d="m3 11 9-8 9 8M5 9v12h14V9M9 21v-7h6v7"/>',
    gate:'<path d="M3 21V8h18v13M2 8l10-5 10 5M8 21V8M16 21V8"/>',
    external:'<path d="M14 3h7v7M21 3l-11 11M10 4H4v16h16v-6"/>',
    swap:'<path d="M8 3v17m-4-4 4 4 4-4M16 21V4m-4 4 4-4 4 4"/>'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.pin}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => el.outerHTML = icon(el.dataset.icon));
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let toastTimer;
  function notify(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3000); }
  $('about-open').addEventListener('click', () => $('about-dialog').showModal());
  $('about-close').addEventListener('click', () => $('about-dialog').close());
  $('about-dialog').addEventListener('click', e => { if (e.target === $('about-dialog')) { const r=e.target.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close(); } });
  if (!window.CampusGPS || !window.CAMPUS_DATA || !window.CAMPUS_PARKING || !window.CampusCore || !window.CampusScene || !window.RoadNetwork || !window.RoadEditor || !window.BuildingDirectory || !window.FINAL_ROADS) { $('loading').hidden = true; $('map-error').hidden = false; return; }
  const data = window.CAMPUS_DATA, core = window.CampusCore, places = data.places, byId = new Map(places.map(p => [p.id, p]));
  const categories = { study:'캠퍼스 건물', life:'생활 공간', outdoor:'야외 공간', gate:'출입구·안내' };
  const walkingSpeedKmh=4.5;
  const placeIcon = p => p.id === '28' ? 'book' : ({study:'building', life:'home', outdoor:'leaf', gate:'gate'}[p.category]);
  const featured = ['28','13','16','34','49','6','25','15','35','41','45','36','38','48','24'];
  const sortPlaces = [...places].sort((a,b) => {const aa=featured.indexOf(a.id),bb=featured.indexOf(b.id);return (aa<0?100:aa)-(bb<0?100:bb)||a.name.localeCompare(b.name,'ko');});
  let saved;
  try { const value = JSON.parse(localStorage.getItem('kyungnam-saved') || '[]'); saved = new Set(Array.isArray(value) ? value.filter(id=>byId.has(id)) : []); } catch { saved = new Set(); }
  const parking=window.CAMPUS_PARKING||[];
  const state = { tab:'explore', category:'all', query:'', selected:null, depth:true, rotation:0, inclination:.6, route:null, saved, parkingVisible:true, parkingSelected:null };
  let graph = core.createGraph(data.ways);
  const svg=$('campus-map');
  const scene=window.CampusScene, model=scene.makeModel(data,core,graph);
  const finalRoads=window.FINAL_ROADS,originalLinks=new Map(finalRoads.anchors.map(a=>[a.id,{anchor:a.point,place:byId.get(a.id)}])),baseRoads=window.RoadNetwork.deserialize(JSON.stringify(finalRoads.roads));
  const P=point=>scene.screen(point,state.depth,state.rotation,state.inclination), placePoint=p=>P(core.project(p));
  const buildingByPlace=new Map(model.buildings.map(b=>[b.place.id,b]));
  let camera, fitted, pointer=null, dragMoved=false, suppressClick=false, rotationFrame=0,editor,gps,gpsFix=null;
  const pathOf=(points,close=false)=>scene.path(points.map(P),close);
  function renderBase(){
    svg.innerHTML='<title>경남대학교 월영캠퍼스 도식형 안내도</title>'+scene.surface(model,core,state.depth,state.rotation,state.inclination)+'<g id="route-lines" aria-hidden="true"></g><g id="buildings">'+scene.structures(model,core,state)+'</g><g id="place-pins"></g><g id="parking-pins" aria-label="주차장 위치"></g>';
    const north=P({x:Math.sin(-25*Math.PI/180),y:-Math.cos(-25*Math.PI/180)});
    document.querySelector('.north svg').style.transform='rotate('+Math.atan2(north.x,-north.y)*180/Math.PI+'deg)';
    renderPins();renderRouteLine();renderGPS();editor?.renderOverlay();
  }
  function matches(p) { return (state.category==='all'||state.category===p.category)&&window.BuildingDirectory.matches(p,state.query); }
  function shownPlaces(){return sortPlaces.filter(p=>matches(p)&&(state.tab!=='saved'||state.saved.has(p.id)));}
  function renderPins(){
    if(!camera||!$('place-pins'))return;
    const unit=camera.w/$('map-wrap').clientWidth,zoom=fitted.w/camera.w,occupied=[],labels=new Set(),major=document.body.clientWidth<=700?['28','13','16','6']:featured.slice(0,9);
    const pins=places.filter(p=>p.id!=='7').map(p=>{const pos=placePoint(p),b=buildingByPlace.get(p.id);return{p,pos:{x:pos.x,y:pos.y-(state.depth&&b?b.height:0)}};});
    const priority=[...pins].sort((a,b)=>Number(b.p.id===state.selected)-Number(a.p.id===state.selected)||Number(featured.includes(b.p.id))-Number(featured.includes(a.p.id)));
    priority.forEach(({p,pos})=>{const active=p.id===state.selected,important=major.includes(p.id);if(!active&&!important&&zoom<1.8)return;const w=p.name.length*10*unit,r={x:pos.x-w/2,y:pos.y-31*unit,w,h:14*unit};if(active||!occupied.some(q=>Math.abs(q.x+q.w/2-r.x-r.w/2)<(q.w+r.w)/2+7*unit&&Math.abs(q.y-r.y)<20*unit)){labels.add(p.id);occupied.push(r);}});
    $('place-pins').innerHTML=pins.map(({p,pos})=>{
      const selected=state.selected===p.id,important=major.includes(p.id),dimmed=state.tab!=='route'&&(!matches(p)||(state.tab==='saved'&&!state.saved.has(p.id)));
      const large=selected||important,number=p.officialNumber;
      return '<g class="map-pin cat-'+p.category+(selected?' selected':'')+(dimmed?' dimmed':'')+'" data-place="'+p.id+'" role="button" tabindex="'+(editor?.enabled||gps?.active?-1:0)+'" '+(editor?.enabled||gps?.active?'aria-hidden="true" ':'')+'aria-label="'+number+'번 '+escape(p.name)+', '+categories[p.category]+'" aria-pressed="'+selected+'" transform="translate('+pos.x+' '+pos.y+') scale('+unit+')"><circle r="22" fill="transparent"/>'+(large?'<path class="number-pin" d="M0 2C-3-3-10-9-10-15a10 10 0 1 1 20 0C10-9 3-3 0 2Z"/><circle class="number-face" cy="-15" r="8"/><text class="number-text" y="-11.5" text-anchor="middle">'+number+'</text>':(p.category==='gate'?'<rect class="pin-disc" x="-8" y="-8" width="16" height="16" rx="3"/>':'<circle class="pin-disc" r="8.5"/>')+'<text class="small-number" y="3.1" text-anchor="middle">'+number+'</text>')+(labels.has(p.id)?'<text class="pin-label" y="'+(large?-31:-15)+'" text-anchor="middle">'+escape(p.name)+'</text>':'')+'</g>';
    }).join('');
    renderParkingPins();
  }
  function renderParkingPins(){
    const layer=$('parking-pins');if(!camera||!layer)return;
    $('parking-toggle').disabled=!!editor?.enabled;
    if(!state.parkingVisible||editor?.enabled||gps?.active){layer.innerHTML='';return;}
    const unit=camera.w/$('map-wrap').clientWidth,placed=[],offsets=[[0,0]];
    for(const r of [46,92,138])for(const [x,y] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])offsets.push([x*r,y*r]);
    layer.innerHTML=parking.map(p=>{
      const pos=placePoint(p),active=state.parkingSelected===p.id,width=Math.max(110,p.name.length*7.4+24);
      const px=(pos.x-camera.x)/unit,py=(pos.y-camera.y)/unit,vw=camera.w/unit,vh=camera.h/unit;
      const [dx,dy]=offsets.find(([x,y])=>px+x>=24&&px+x<=vw-24&&py+y>=24&&py+y<=vh-55&&!placed.some(q=>Math.abs(q.x-px-x)<45&&Math.abs(q.y-py-y)<45))||[0,0];
      placed.push({x:px+dx,y:py+dy});
      const labelX=Math.max(8,Math.min(px+dx-width/2,vw-width-8))-px-dx,labelY=py+dy<60?20:-40;
      return '<g class="parking-pin'+(active?' selected':'')+'" data-parking="'+p.id+'" role="button" tabindex="0" aria-label="'+escape(p.name)+'" aria-pressed="'+active+'" transform="translate('+pos.x+' '+pos.y+') scale('+unit+')"><title>'+escape(p.name)+'</title>'+(dx||dy?'<path class="parking-leader" d="M0 0L'+dx+' '+dy+'"/><circle class="parking-location" r="2.5"/>':'')+'<g class="parking-badge" transform="translate('+dx+' '+dy+')"><rect class="parking-hit" x="-22" y="-22" width="44" height="44"/><rect class="parking-symbol" x="-10" y="-10" width="20" height="20" rx="4"/><text class="parking-letter" text-anchor="middle" y="4">P</text>'+(p.kind==='entrance'?'<path class="parking-entry-arrow" d="M-5 15H5M1 11L5 15 1 19"/>':'')+'<g class="parking-label" transform="translate('+labelX+' '+labelY+')"><rect width="'+width+'" height="27" rx="5"/><text x="'+width/2+'" y="17" text-anchor="middle">'+escape(p.name)+'</text></g></g></g>';
    }).join('');
  }
  function activateParking(id){if(editor?.enabled)return;state.parkingSelected=state.parkingSelected===id?null:id;renderParkingPins();$('announcer').textContent=parking.find(p=>p.id===id)?.name||'';}
  $('parking-toggle').addEventListener('click',()=>{state.parkingVisible=!state.parkingVisible;state.parkingSelected=null;$('parking-toggle').setAttribute('aria-pressed',state.parkingVisible);renderParkingPins();$('announcer').textContent=state.parkingVisible?'주차장 위치 표시':'주차장 위치 숨김';});
  function updateCamera(){svg.setAttribute('viewBox',camera.x+' '+camera.y+' '+camera.w+' '+camera.h);renderPins();renderGPS();editor?.renderOverlay();$('zoom-in').disabled=fitted.w/camera.w>=4.95;$('zoom-out').disabled=fitted.w/camera.w<=.7;}
  function fit(points,padding=40){const all=!points;const screenPoints=(points||model.boundary).map(P);const b=core.bounds(screenPoints,padding),r=$('map-wrap').getBoundingClientRect(),ratio=r.width/r.height;
    const w=Math.max(b.w,b.h*ratio),h=w/ratio;camera={x:b.x+b.w/2-w/2,y:b.y+b.h/2-h/2-10,w,h};if(all||!fitted)fitted={...camera};updateCamera();}
  function zoomBy(factor,clientX,clientY){const rect=$('map-wrap').getBoundingClientRect(),rx=clientX===undefined?.5:(clientX-rect.left)/rect.width,ry=clientY===undefined?.5:(clientY-rect.top)/rect.height;const nw=Math.max(fitted.w/5,Math.min(fitted.w/0.7,camera.w/factor)),nh=nw*rect.height/rect.width;camera={x:camera.x+rx*(camera.w-nw),y:camera.y+ry*(camera.h-nh),w:nw,h:nh};updateCamera();}
  function renderList(){const result=shownPlaces();$('list-title').textContent=state.tab==='saved'?'저장한 장소':state.query?'검색 결과':'캠퍼스의 장소';$('result-count').textContent=`${result.length}곳`;
    $('places-list').innerHTML=result.length?result.map(p=>`<button class="place-row${state.selected===p.id?' selected':''}" data-select="${p.id}" aria-pressed="${state.selected===p.id}"><span class="place-icon">${icon(placeIcon(p))}</span><span class="place-text"><strong><span class="place-number cat-${p.category}">${p.officialNumber}</span>${escape(p.name)}</strong><small class="${window.BuildingDirectory.summary(p,state.query)?'facility-summary':''}">${escape(window.BuildingDirectory.summary(p,state.query)||categories[p.category])}</small></span>${icon(state.saved.has(p.id)?'bookmark':'chevron')}</button>`).join(''):`<div class="empty-state">${icon(state.tab==='saved'?'bookmark':'search')}<strong>${state.tab==='saved'&&!state.query?'저장한 장소가 없어요':'검색 결과가 없어요'}</strong><span>${state.tab==='saved'&&!state.query?'장소를 선택한 뒤 북마크를 눌러 보세요.':'다른 이름이나 짧은 검색어로 찾아보세요.'}</span><br><button class="text-button" id="clear-search">${state.tab==='saved'?'전체 장소 둘러보기':'검색 초기화'}</button></div>`;
    $('announcer').textContent=`${$('list-title').textContent} ${result.length}곳`;
  }
  function renderDetail(){
    $('desktop-detail').innerHTML='';$('mobile-detail').innerHTML='';document.body.classList.remove('has-mobile-detail');
    if(!state.selected||state.tab==='route')return;
    const p=byId.get(state.selected),isSaved=state.saved.has(p.id);
    const indoor=window.IndoorExplorer.buildings[p.id];
    const floorEntry=indoor?'<section class="library-entry" aria-label="'+escape(p.name)+' 층별 구조도"><strong>층별 구조도</strong><div>'+indoor.order.map(f=>'<button data-indoor-building="'+p.id+'" data-indoor-floor="'+f+'" '+(p.id==='28'?'data-library-floor="'+f+'"':'')+'>'+(f==='B1'?'B1':f+'층')+'</button>').join('')+'</div><small>층을 누르면 내부 공간을 볼 수 있어요.</small></section>':'';
    const content=`<article class="detail-card" aria-label="${escape(p.name)} 상세 정보"><div class="detail-photo">${p.photo?`<img src="${escape(p.photo)}" alt="경남대학교 ${escape(p.name)} 외관">`:`<div class="photo-placeholder">${icon(placeIcon(p))}<span>${escape(p.name)}</span></div>`}<button class="detail-close" aria-label="장소 상세 닫기">${icon('close')}</button></div><div class="detail-body"><div class="detail-category">${categories[p.category]}<i></i>월영캠퍼스</div><div class="detail-title-row"><h2><span class="detail-number cat-${p.category}">${p.officialNumber}</span>${escape(p.name)}</h2><button class="save-place" aria-label="${isSaved?'저장 해제':'장소 저장'}" aria-pressed="${isSaved}">${icon('bookmark')}</button></div><p class="detail-location">경남대학교 · 경남대학로 7</p>${floorEntry}${window.BuildingDirectory.render(p.id,state.query)}<div class="detail-actions"><button class="primary-button" id="destination-button">${icon('route')}여기로 가는 경로</button></div></div></article>`;
    const container=document.body.clientWidth<=700?$('mobile-detail'):$('desktop-detail');container.innerHTML=content;if(document.body.clientWidth<=700)document.body.classList.add('has-mobile-detail');
    const photo=container.querySelector('img');photo?.addEventListener('error',()=>{photo.replaceWith(Object.assign(document.createElement('div'),{className:'photo-placeholder',textContent:'사진을 불러올 수 없습니다'}));});
  }
  function selectPlace(id,focusMap=true){if(!byId.has(id))return;state.selected=id;renderList();renderBase();renderDetail();$('announcer').textContent=`${byId.get(id).name} 선택됨`;if(focusMap){const p=placePoint(byId.get(id)),margin=camera.w*.14;if(p.x<camera.x+margin||p.x>camera.x+camera.w-margin||p.y<camera.y+margin||p.y>camera.y+camera.h-margin){camera.x=p.x-camera.w/2;camera.y=p.y-camera.h/2;updateCamera();}}}
  function setTab(tab){state.tab=tab;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-pressed',b.dataset.tab===tab);});$('route-panel').hidden=tab!=='route';$('explore-panel').hidden=tab==='route';if(tab!=='route')resetRoute();renderList();renderPins();renderDetail();}
  function renderRouteLine(){if(!$('route-lines'))return;if(!state.route){$('route-lines').innerHTML='';return;}
    const r=state.route,points=[r.fromAnchor,...r.points,r.toAnchor],a=P(r.fromAnchor),b=P(r.toAnchor),unit=camera.w/$('map-wrap').clientWidth;
    $('route-lines').innerHTML='<path class="route-halo" d="'+pathOf(points)+'"/><path class="route-stroke" d="'+pathOf(points)+'"/><circle cx="'+a.x+'" cy="'+a.y+'" r="'+5*unit+'" fill="#347951" stroke="white" stroke-width="'+2*unit+'"/><circle cx="'+b.x+'" cy="'+b.y+'" r="'+5*unit+'" fill="#d36e41" stroke="white" stroke-width="'+2*unit+'"/>';
  }
  function resetRoute(){state.route=null;renderRouteLine();$('route-result').innerHTML='<div class="route-intro">'+icon('route')+'<h2>경로를 확인해 보세요</h2><p>선택한 두 장소의 최단 경로를 계산합니다.</p></div>';}
  function calculateRoute(){const from=byId.get($('route-from').value),to=byId.get($('route-to').value);const result=core.route(graph,from,to,model.links);state.route=result.error?null:result;state.selected=to.id;renderBase();if(result.error){$('route-result').innerHTML=`<div class="route-error" role="alert">${escape(result.error)}</div>`;return;}
    const minutes=Math.max(1,Math.ceil(result.length/(walkingSpeedKmh*1000/60)));
    $('route-result').innerHTML='<div class="route-summary"><div class="eyebrow">CAMPUS WALK</div><div class="route-metrics"><div class="route-duration" aria-label="예상 도보 시간 약 '+minutes+'분"><span>도보 약</span> '+minutes+'<span>분</span></div><div class="route-distance">약 '+Math.round(result.length/10)*10+'<span>m</span></div></div><p class="route-time-basis">시속 '+walkingSpeedKmh+'km 기준 · 연결로 포함</p><ol class="route-stops"><li>'+escape(from.name)+'<small>출발 · 건물 앞 연결로</small></li><li>캠퍼스 길을 따라<small>지도에 표시된 주황색 길</small></li><li>'+escape(to.name)+'<small>도착 · 건물 앞 연결로</small></li></ol><p>지도에 표시된 길을 따라 출발지와 목적지를 연결합니다.</p></div>';
    fit([...result.points,result.fromAnchor,result.toAnchor],80);renderRouteLine();$('announcer').textContent=from.name+'에서 '+to.name+'까지 도보 약 '+minutes+'분, 연결로 포함 약 '+Math.round(result.length)+'미터';
  }

  const options=sortPlaces.map(p=>`<option value="${p.id}">${p.officialNumber}번 · ${escape(p.name)}</option>`).join('');$('route-from').innerHTML=options;$('route-to').innerHTML=options;$('route-from').value='6';$('route-to').value='28';
  $('route-form').addEventListener('submit',e=>{e.preventDefault();calculateRoute();});
  $('swap-route').addEventListener('click',()=>{const a=$('route-from').value;$('route-from').value=$('route-to').value;$('route-to').value=a;resetRoute();});
  ['route-from','route-to'].forEach(id=>$(id).addEventListener('change',resetRoute));
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{if(state.selected&&document.body.clientWidth<=700)state.selected=null;setTab(b.dataset.tab);}));
  document.querySelectorAll('[data-category]').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.category;document.querySelectorAll('[data-category]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',x===b);});renderList();renderPins();}));
  $('search').addEventListener('input',e=>{state.query=e.target.value;renderList();renderPins();renderDetail();});
  document.addEventListener('click',e=>{
    const indoorFloor=e.target.closest('[data-indoor-floor]');if(indoorFloor&&!indoorFloor.disabled&&!editor?.enabled){window.IndoorExplorer.open(indoorFloor.dataset.indoorBuilding,indoorFloor.dataset.indoorFloor);return;}
    const libraryFloor=e.target.closest('[data-library-floor]');if(libraryFloor&&!libraryFloor.disabled&&!editor?.enabled){window.LibraryExplorer.open(libraryFloor.dataset.libraryFloor);return;}
    const row=e.target.closest('[data-select]');if(row){selectPlace(row.dataset.select);if(document.body.clientWidth<=700)$('mobile-detail').querySelector('button')?.focus({preventScroll:true});return;}
    if(e.target.closest('#clear-search')){state.query='';$('search').value='';state.category='all';document.querySelector('[data-category="all"]').click();setTab('explore');$('search').focus();}
    if(e.target.closest('.detail-close')){state.selected=null;renderBase();renderDetail();renderList();$('search').focus({preventScroll:true});}
    if(e.target.closest('.save-place')&&state.selected){const id=state.selected;if(state.saved.has(id))state.saved.delete(id);else state.saved.add(id);let persisted=true;try{localStorage.setItem('kyungnam-saved',JSON.stringify([...state.saved]));}catch{persisted=false;}renderList();renderDetail();document.querySelector('.save-place')?.focus({preventScroll:true});notify(persisted?(state.saved.has(id)?'저장한 장소에 추가했어요.':'저장한 장소에서 삭제했어요.'):'이 브라우저는 저장을 제한해 현재 화면에서만 유지됩니다.');}
    if(e.target.closest('#destination-button')&&state.selected){const id=state.selected;$('route-to').value=id;if($('route-from').value===id)$('route-from').value=id==='6'?'28':'6';setTab('route');calculateRoute();$('route-to').focus({preventScroll:true});}
  });
  function activateMapPlace(id){if(editor?.enabled||gps?.active)return;if(state.tab==='route'){state.selected=id;$('route-to').value=id;resetRoute();renderBase();notify('도착지를 변경했어요. 최단 경로 보기를 눌러 주세요.');}else selectPlace(id,false);}
  svg.addEventListener('click',e=>{if(suppressClick){suppressClick=false;return;}const parkingPin=e.target.closest('[data-parking]');if(parkingPin){activateParking(parkingPin.dataset.parking);return;}const p=e.target.closest('[data-place]');if(p)activateMapPlace(p.dataset.place);});
  svg.addEventListener('keydown',e=>{const pin=e.target.closest('[data-parking]');if(!pin||editor?.enabled)return;if(['Enter',' '].includes(e.key)){e.preventDefault();activateParking(pin.dataset.parking);$('parking-pins').querySelector('[data-parking="'+pin.dataset.parking+'"]').focus({preventScroll:true});}});
  svg.addEventListener('keydown',e=>{const p=e.target.closest('[data-place]');if(p&&!gps?.active&&['Enter',' '].includes(e.key)){e.preventDefault();activateMapPlace(p.dataset.place);(state.tab==='route'?$('route-to'):document.querySelector('.save-place'))?.focus({preventScroll:true});return;}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const n=camera.w*.06;if(e.key==='ArrowLeft')camera.x-=n;if(e.key==='ArrowRight')camera.x+=n;if(e.key==='ArrowUp')camera.y-=n;if(e.key==='ArrowDown')camera.y+=n;updateCamera();svg.focus({preventScroll:true});}if(e.key==='+'||e.key==='='){e.preventDefault();zoomBy(1.3);svg.focus({preventScroll:true});}if(e.key==='-'){e.preventDefault();zoomBy(1/1.3);svg.focus({preventScroll:true});}});
  function resetOrientation(){editor?.cancel();state.rotation=0;state.inclination=.6;fit();renderBase();}
  function rotateAtCenter(rotation,inclination,pivot=scene.unproject({x:camera.x+camera.w/2,y:camera.y+camera.h/2},state.depth,state.rotation,state.inclination)){
    state.rotation=((rotation%360)+360)%360;state.inclination=Math.max(.3,Math.min(.95,inclination));
    const center=P(pivot);camera.x=center.x-camera.w/2;camera.y=center.y-camera.h/2;
    svg.setAttribute('viewBox',camera.x+' '+camera.y+' '+camera.w+' '+camera.h);
    if(!rotationFrame)rotationFrame=requestAnimationFrame(()=>{rotationFrame=0;renderBase();});
  }
  $('zoom-in').addEventListener('click',()=>zoomBy(1.3));$('zoom-out').addEventListener('click',()=>zoomBy(1/1.3));$('fit-map').addEventListener('click',resetOrientation);
  function setDepth(value){editor?.cancel();state.depth=value;$('mode-flat').classList.toggle('active',!value);$('mode-depth').classList.toggle('active',value);$('mode-flat').setAttribute('aria-pressed',!value);$('mode-depth').setAttribute('aria-pressed',value);fit();renderBase();}
  $('mode-flat').addEventListener('click',()=>setDepth(false));$('mode-depth').addEventListener('click',()=>setDepth(true));
  svg.addEventListener('wheel',e=>{e.preventDefault();zoomBy(e.deltaY<0?1.12:1/1.12,e.clientX,e.clientY);},{passive:false});
  svg.addEventListener('pointerdown',e=>{
    if(![0,1].includes(e.button)||pointer||editor?.drawing)return;
    pointer={id:e.pointerId,button:e.button,x:e.clientX,y:e.clientY,camera:{...camera},rotation:state.rotation,inclination:state.inclination,pivot:scene.unproject({x:camera.x+camera.w/2,y:camera.y+camera.h/2},state.depth,state.rotation,state.inclination)};
    dragMoved=false;suppressClick=false;
    if(e.button===1){e.preventDefault();svg.setPointerCapture(e.pointerId);$('map-wrap').classList.add('rotating');}
  });
  svg.addEventListener('pointermove',e=>{
    if(!pointer||pointer.id!==e.pointerId)return;
    const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
    if(Math.hypot(dx,dy)>4){dragMoved=true;if(!svg.hasPointerCapture(e.pointerId))svg.setPointerCapture(e.pointerId);$('map-wrap').classList.add(pointer.button===1?'rotating':'dragging');}
    if(!dragMoved)return;
    if(pointer.button===1){e.preventDefault();rotateAtCenter(pointer.rotation+dx*.35,state.depth?pointer.inclination+dy*.0025:pointer.inclination,pointer.pivot);}
    else{const ratio=pointer.camera.w/$('map-wrap').clientWidth;camera.x=pointer.camera.x-dx*ratio;camera.y=pointer.camera.y-dy*ratio;updateCamera();}
  });
  function finishPointer(e){
    if(!pointer||(e&&pointer.id!==e.pointerId))return;
    const previous=pointer;suppressClick=previous.button===0&&dragMoved;pointer=null;
    $('map-wrap').classList.remove('dragging','rotating');
    if(rotationFrame){cancelAnimationFrame(rotationFrame);rotationFrame=0;renderBase();}
    if(svg.hasPointerCapture(previous.id))svg.releasePointerCapture(previous.id);
  }
  for(const type of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(type,finishPointer);
  window.addEventListener('pointerup',finishPointer);window.addEventListener('blur',()=>finishPointer());
  for(const type of ['mousedown','auxclick'])svg.addEventListener(type,e=>{if(e.button===1)e.preventDefault();});
  svg.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||editor?.drawing)return;if(['q','e','r'].includes(e.key.toLowerCase())){e.preventDefault();if(e.key.toLowerCase()==='r')resetOrientation();else rotateAtCenter(state.rotation+(e.key.toLowerCase()==='q'?-15:15),state.inclination);svg.focus({preventScroll:true});}});
  document.addEventListener('keydown',e=>{if(editor?.enabled||gps?.active)return;if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)&&!$('about-dialog').open){e.preventDefault();state.selected=null;setTab('explore');$('search').focus();}if(e.key==='Escape'&&!$('about-dialog').open){if(state.parkingSelected){state.parkingSelected=null;renderParkingPins();svg.focus({preventScroll:true});}if(state.selected){state.selected=null;renderBase();renderDetail();renderList();}}});
  editor=window.RoadEditor.create({editable:false,svg,base:baseRoads,migrationFrom:window.RoadNetwork.deserialize(JSON.stringify(finalRoads.original)),revision:finalRoads.revision,anchors:[...originalLinks.values()].map(l=>l.anchor),boundary:model.boundary,project:P,
    worldPoint:(x,y)=>{const point=svg.createSVGPoint();point.x=x;point.y=y;const p=point.matrixTransform(svg.getScreenCTM().inverse());return scene.unproject(p,state.depth,state.rotation,state.inclination);},
    onChange:roads=>{
      graph=window.RoadNetwork.graph(roads,core);model.roadSegments=roads;model.links=new Map();
      for(const [id,link] of originalLinks){const snap=core.nearestSegment(link.anchor,graph);if(snap&&snap.gap<.08)model.links.set(id,{...link,snap});}
      // No nearest-road bridge across an erased approach; stale routes are discarded.
      const gate=model.links.get('6'),component=gate&&graph.components.get(gate.snap.edge.a),reachable=gate?[...model.links.values()].filter(l=>graph.components.get(l.snap.edge.a)===component).length:0;
      resetRoute();if(camera)renderBase();return {connected:model.links.size,reachable,graph};
    },
    onMode:()=>{finishPointer();state.selected=null;renderDetail();renderList();renderBase();},notify
  });
  function renderGPS(){
    $('gps-position')?.remove();if(!gpsFix||!camera)return;
    const p=P(gpsFix.point),unit=camera.w/$('map-wrap').clientWidth,ring=Array.from({length:36},(_,i)=>P({x:gpsFix.point.x+gpsFix.accuracy*Math.cos(i*Math.PI/18),y:gpsFix.point.y+gpsFix.accuracy*Math.sin(i*Math.PI/18)}));
    const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.id='gps-position';group.classList.add('gps-position');group.setAttribute('role','img');group.setAttribute('aria-label','현재 위치');
    const snap=gpsFix.route?.start;
    group.innerHTML='<path class="gps-accuracy" d="'+scene.path(ring,true)+'"/>'+(snap&&snap.gap>1?'<path d="'+scene.path([p,P(snap.point)])+'" fill="none" stroke="#5684a6" stroke-width="2" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"><title>현재 위치와 가까운 길 사이 거리</title></path>':'')+'<g transform="translate('+p.x+' '+p.y+') scale('+unit+')"><circle class="gps-dot" r="8"/><text class="gps-dot-label" text-anchor="middle" y="-17">내 위치</text></g>';
    svg.append(group);
  }
  gps=window.CampusGPS.create({core,places:sortPlaces,getGraph:()=>graph,getLinks:()=>model.links,
    onOpen:()=>{state.selected=$('gps-destination').value;resetRoute();renderDetail();fit();renderBase();},
    onClose:()=>{resetRoute();fit();renderBase();renderDetail();},
    onMap:(result,recenter)=>{
      gpsFix=result;state.route=result?.route?{...result.route,fromAnchor:result.route.start.point}:null;
      if(!result){renderRouteLine();renderGPS();return;}
      if(recenter){state.selected=$('gps-destination').value;fit(result.route?[...result.route.points,result.route.toAnchor,result.point]:[result.point],100);renderBase();}
      else{renderRouteLine();renderGPS();}
    }
  });
  $('gps-open').addEventListener('click',()=>gps.open($('route-to').value));
  let resizeTimer;window.addEventListener('resize',()=>{editor?.cancel();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{fit(gpsFix?.route?[...gpsFix.route.points,gpsFix.point,gpsFix.route.toAnchor]:undefined,65);renderBase();renderDetail();},100);});
  try {
    fit();renderBase();renderList();renderDetail();$('loading').hidden=true;
    if(document.body.dataset.mobileApp==='true'||new URLSearchParams(location.search).get('mobile')==='1'){
      document.querySelector('.brand').href=document.body.dataset.mobileApp==='true'?'./mobile.html':location.pathname+location.search;
      setTab('route');gps.open($('route-to').value);
    }
  } catch(error){console.error(error);$('loading').hidden=true;$('map-error').hidden=false;}
})();


