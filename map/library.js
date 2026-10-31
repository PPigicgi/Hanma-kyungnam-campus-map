/* Official floor plans, redrawn as a schematic. Original images are retained. */
(() => {
  'use strict';
  const source='https://library.kyungnam.ac.kr/webcontent/info/48';
  const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
  const room=(id,name,short,polygon,at,type='study')=>({id:String(id),name,short,polygons:[polygon],at,type});
  const amenity=(name,kind,box)=>({name,kind,polygon:rect(...box),at:[box[0]+box[2]/2,box[1]+box[3]/2]});
  // User clarified that the entire central source symbol represents one elevator.
  const coreAmenities=(male,female,lift)=>[amenity('남자 화장실','wc',male),amenity('여자 화장실','wc',female),amenity('엘리베이터','lift',lift)];
  const floors={
    '1':{title:'대출·휴식·학습',size:[425,355],outline:[[94,1],[329,1],[329,92],[303,92],[303,134],[423,134],[423,286],[283,286],[283,354],[139,354],[139,286],[2,286],[2,137],[117,137],[117,92],[94,92]],rooms:[
      room(1,'제1서고','제1서고',rect(96,4,231,85),[211,46],'collection'),room(2,'대출반납실','대출반납실',rect(119,92,59,52),[149,116],'service'),room(3,'그룹스터디룸 5·6','스터디룸 5·6',[[274,163],[327,163],[327,189],[299,189],[299,205],[274,205]],[298,178]),room(4,'휴 플레이스','휴 플레이스',[[328,177],[411,177],[411,281],[305,281],[305,233],[274,233],[274,206],[299,206],[299,190],[328,190]],[354,226],'common'),room(5,'AI·SW취창업카페','AI·SW 카페',[[12,153],[54,153],[54,159],[96,159],[96,190],[113,190],[113,235],[12,235]],[61,197],'common'),room(6,'컴퓨터실습실','컴퓨터실습실',rect(12,237,102,44),[63,260]),room('copy','복사실','복사실',rect(329,144,82,31),[369,159],'service')],amenities:[amenity('화장실','wc',[234,94,39,52]),amenity('엘리베이터','lift',[195,95,33,51]),amenity('계단','stairs',[119,235,23,47]),amenity('계단','stairs',[281,235,23,47])],entry:[213,289]},
    '2':{title:'열람실·자료 보관',size:[427,349],outline:[[84,1],[344,1],[344,98],[307,98],[307,155],[425,155],[425,314],[331,314],[331,347],[114,347],[114,314],[2,314],[2,155],[117,155],[117,98],[84,98]],rooms:[
      room(1,'제2·3서고','제2·3서고',rect(87,4,253,91),[214,49],'collection'),room(2,'딸림자료보관실','딸림자료',rect(164,99,29,57),[178,128],'collection'),room(3,'제1열람실','제1열람실',[[4,158],[94,158],[94,237],[115,237],[115,311],[4,311]],[51,242]),room(4,'제2열람실','제2열람실',[[95,181],[194,181],[194,206],[239,206],[239,344],[117,344],[117,238],[95,238]],[184,265]),room(5,'제3열람실','제3열람실',[[241,181],[330,181],[330,285],[309,285],[309,344],[241,344]],[282,224]),room(6,'제4열람실','제4열람실',rect(333,158,91,153),[378,217])],amenities:[...coreAmenities([119,99,43,57],[266,99,40,57],[200,101,32,50]),amenity('계단','stairs',[120,240,25,46]),amenity('계단','stairs',[281,240,26,46])]},
    '3':{title:'연속간행물·학위논문',size:[460,362],outline:[[102,1],[358,1],[358,105],[327,105],[327,153],[458,153],[458,304],[312,304],[312,360],[138,360],[138,304],[2,304],[2,154],[134,154],[134,106],[102,106]],rooms:[
      room(1,'휴게실','휴게실',rect(105,4,250,99),[228,56],'common'),room(2,'연속간행물 보관실','간행물 보관',rect(174,106,34,49),[190,130],'collection'),room(3,'도시락코너','도시락코너',rect(250,106,38,49),[269,130],'common'),room(4,'수험자료실','수험자료실',[[4,157],[112,157],[112,180],[136,180],[136,300],[4,300]],[63,230]),room(5,'명사의 서재','명사의 서재',rect(114,182,46,62),[137,214],'collection'),room(6,'연속간행물실','연속간행물실',[[162,182],[201,182],[201,201],[254,201],[254,181],[347,181],[347,157],[456,157],[456,251],[297,251],[297,300],[309,300],[309,357],[141,357],[141,302],[162,302]],[234,280],'collection'),room(7,'학위논문실','학위논문실',rect(329,254,127,47),[393,277],'collection')],amenities:[...coreAmenities([136,107,36,47],[290,107,35,47],[217,108,29,47]),amenity('계단','stairs',[135,248,26,52]),amenity('계단','stairs',[300,250,26,49])]},
    '4':{title:'신간·참고·고전자료',size:[485,276],outline:[[143,3],[343,3],[343,56],[483,56],[483,224],[381,224],[381,273],[146,273],[146,227],[2,227],[2,58],[143,58]],rooms:[
      room(1,'1인 크리에이터실','1인 제작실',rect(185,6,37,51),[204,32]),room(2,'북한특수자료실','북한자료',rect(272,6,33,51),[287,32],'collection'),room(3,'신간대출실','신간대출실',[[4,60],[122,60],[122,82],[222,82],[222,107],[201,107],[201,126],[315,126],[315,152],[305,152],[305,204],[336,204],[336,270],[149,270],[149,153],[107,153],[107,225],[4,225]],[210,174],'collection'),room(4,'한적실','한적실',rect(368,60,114,48),[424,83],'collection'),room(5,'참고자료실','참고자료실',[[316,83],[366,83],[366,110],[417,110],[417,222],[382,222],[382,191],[358,191],[358,153],[316,153]],[373,145],'collection'),room(6,'고전자료실','고전자료실',rect(419,111,63,111),[449,169],'collection')],amenities:coreAmenities([145,6,38,51],[307,6,34,51],[230,7,33,48]).concat([amenity('계단','stairs',[151,156,24,47]),amenity('계단','stairs',[309,156,25,47])])},
    '5':{title:'도서관 운영·행정',size:[251,246],outline:[[37,1],[215,1],[215,176],[248,176],[248,244],[2,244],[2,176],[37,176]],rooms:[
      room(1,'관장실','관장실',rect(40,91,55,46),[67,114],'staff'),room(2,'학술문헌팀','학술문헌팀',[[97,100],[212,100],[212,176],[246,176],[246,241],[5,241],[5,178],[39,178],[39,139],[97,139]],[127,184],'staff')],amenities:[...coreAmenities([40,5,62,36],[149,5,62,36],[106,7,37,58]),amenity('계단','stairs',[9,180,25,59]),amenity('계단','stairs',[216,180,25,59])]},
    '7':{title:'다목적 공간',size:[208,247],outline:rect(2,2,204,243),rooms:[room(1,'다목적실2','다목적실2',rect(138,91,65,151),[170,175])],unlabeled:[rect(6,91,67,151),rect(75,124,61,57),rect(75,184,61,58)],amenities:coreAmenities([6,6,67,43],[138,6,65,43],[87,11,36,60])},
    '8':{title:'창의융합·스터디룸',size:[208,245],outline:rect(2,2,204,241),rooms:[room(1,'교수연구실','교수연구실',rect(159,50,44,36),[181,68],'staff'),room(2,'창의융합스터디룸1','창의융합 1',rect(151,90,52,90),[177,134]),room(3,'창의융합스터디룸2','창의융합 2',[[139,193],[150,193],[150,183],[203,183],[203,241],[139,241]],[173,218]),room(4,'창의융합스터디룸3','창의융합 3',rect(76,195,61,46),[105,217]),room(5,'다목적스터디룸1','다목적 1',rect(6,50,46,36),[29,69]),room(6,'다목적스터디룸2','다목적 2',rect(6,90,67,151),[38,164])],amenities:coreAmenities([6,6,67,41],[138,6,65,41],[87,10,36,59]),void:rect(76,123,59,58)},
    'B1':{title:'보존서고·지원 공간',size:[445,345],outline:[[245,2],[384,2],[384,95],[442,95],[442,285],[321,285],[321,343],[121,343],[121,285],[2,285],[2,96],[96,96],[96,47],[245,47]],rooms:[room(1,'변전실','변전실',rect(98,49,101,97),[149,99],'staff'),room(2,'보일러실','보일러실',rect(248,5,94,89),[297,49],'staff'),{...room(3,'보존서고','보존서고',[[5,99],[95,99],[95,149],[343,149],[343,242],[5,242]],[182,187],'collection'),polygons:[[[5,99],[95,99],[95,149],[343,149],[343,242],[5,242]],rect(246,97,97,49)]},room(4,'휴게실','휴게실',rect(346,98,94,144),[393,182],'common')],amenities:[amenity('계단','stairs',[205,49,26,42]),amenity('계단','stairs',[347,5,26,47]),amenity('계단','stairs',[120,198,25,44]),amenity('계단','stairs',[279,198,24,44])],entry:[220,284]}
  };
  // Keep the source plan's gender assignments; the renderer supplies crisp SVG signs.
  const wcSigns=[{gender:'male',name:'남자 화장실'},{gender:'female',name:'여자 화장실'}];
  for(const plan of Object.values(floors)){
    const toilets=plan.amenities.filter(a=>a.kind==='wc');if(!toilets.length)continue;
    wcSigns.forEach((sign,i)=>{const toilet=toilets.length===1?toilets[0]:toilets[i];(toilet.signs??=[]).push(sign);});
    if(toilets.length===1)toilets[0].name='남자 · 여자 화장실';
  }
  const order=['B1','1','2','3','4','5','7','8'],label=id=>id==='B1'?'지하 1층':id+'층';
  const buildings={'28':{id:'28',name:'중앙도서관',eyebrow:'INSIDE THE LIBRARY',source,sourceLabel:'경남대학교 도서관 공식 층별안내',originalLabel:'공식 원본',originalCaption:'경남대학교 중앙도서관 공식 도면',order,floors},'20':window.SEONGHUN_PLAN};
  let building=buildings['28'],activeFloors=floors,activeOrder=order;
  const typeNames={study:'학습 공간',collection:'자료 공간',service:'이용 서비스',common:'휴식·편의',staff:'운영·지원'};
  const $=id=>document.getElementById(id),escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let floor='1',selected=null,tilt=true,rotation=0,inclination=1,view=null,base=null,drag=null,moved=false,returnFocus=null,query='',rotationFrame=0;
  const sidebar=document.createElement('section');sidebar.id='library-sidebar';sidebar.setAttribute('aria-label','도서관 층별 공간');
  sidebar.innerHTML='<button id="library-back" class="indoor-back">← 캠퍼스 안내도</button><div class="indoor-heading"><span class="eyebrow">INSIDE THE LIBRARY</span><h1>중앙도서관</h1><p id="library-floor-description"></p></div><div id="floor-buttons" class="floor-buttons" aria-label="층 선택"></div><label class="indoor-search"><span class="sr-only">현재 층 공간 검색</span><input id="room-search" type="search" placeholder="이 층에서 공간 찾기" autocomplete="off"></label><div class="indoor-list-heading"><strong>이 층의 공간</strong><span id="room-count"></span></div><div id="room-list" class="room-list"></div><div id="room-detail" aria-live="polite"></div>';
  document.querySelector('.sidebar').append(sidebar);
  const panel=document.createElement('section');panel.id='library-panel';panel.setAttribute('aria-label','도서관 층별 구조도');
  panel.innerHTML='<div class="indoor-toolbar"><div class="indoor-breadcrumb"><span id="indoor-building-name">중앙도서관</span><span aria-hidden="true">/</span><strong id="indoor-floor-label">1층</strong></div><label class="floor-select-wrap"><span class="sr-only">구조도 층 선택</span><select id="floor-select" aria-label="구조도 층 선택"></select></label></div><div id="floor-canvas"><svg id="floor-svg" xmlns="http://www.w3.org/2000/svg" role="group" tabindex="0" aria-label="도서관 구조도. 공간을 선택하거나 방향키로 이동할 수 있습니다. 휠 버튼 드래그 또는 Q와 E로 회전하며 R로 초기화합니다."></svg></div><div class="indoor-tools"><button id="floor-tilt" aria-label="평면 구조도로 전환" aria-pressed="true">입체</button><button id="floor-plus" aria-label="구조도 확대">＋</button><button id="floor-minus" aria-label="구조도 축소">−</button><button id="floor-fit" title="전체 보기 · 방향 초기화" aria-label="구조도 전체 보기">⛶</button></div><div class="indoor-legend"><span><i style="background:#e5f0ed"></i>학습</span><span><i style="background:#f8f5e6"></i>자료</span><span><i style="background:#f6ede4"></i>휴식·편의</span><span><i style="background:#d8e8f2"></i>화장실</span></div><p class="floor-caption"><span class="rotation-hint">휠 드래그 · 회전　|　Q / E · 회전　R · 초기화</span><span id="indoor-source-caption">경남대학교 중앙도서관 · 층별 구조도</span></p>';
  document.querySelector('.map-panel').append(panel);
  function project(p){const f=activeFloors[floor],x=p[0]-f.size[0]/2,y=p[1]-f.size[1]/2,a=rotation*Math.PI/180,u=x*Math.cos(a)-y*Math.sin(a),v=x*Math.sin(a)+y*Math.cos(a);return tilt?{x:u*.96-v*.28,y:(u*.14+v*.76)*inclination}:{x:u,y:v};}
  function unproject(p){const f=activeFloors[floor],a=rotation*Math.PI/180,y=p.y/(tilt?inclination:1),det=.96*.76+.28*.14,u=tilt?(.76*p.x+.28*y)/det:p.x,v=tilt?(-.14*p.x+.96*y)/det:y;return[u*Math.cos(a)+v*Math.sin(a)+f.size[0]/2,-u*Math.sin(a)+v*Math.cos(a)+f.size[1]/2];}
  function render(controls=true){const f=activeFloors[floor],svg=$('floor-svg');
    svg.innerHTML='<title>'+escape(building.name)+' '+label(floor)+' 구조도</title>'+window.LibraryFloorScene.render(f,project,{tilt,selected,query,small:document.body.clientWidth<=700});
    if(!controls)return;
    renderList();$('library-floor-description').textContent=label(floor)+' · '+f.title;$('indoor-floor-label').textContent=label(floor);$('floor-select').value=floor;
    $('floor-buttons').innerHTML=activeOrder.map(id=>'<button data-floor="'+id+'" '+''+' aria-pressed="'+(id===floor)+'" class="'+(id===floor?'active':'')+'">'+(id==='B1'?'B1':id+'층')+'</button>').join('');
  }
  function renderList(){const results=activeFloors[floor].rooms.filter(r=>r.name.toLowerCase().includes(query.toLowerCase()));$('room-count').textContent=results.length+'곳';$('room-list').innerHTML=results.length?results.map(r=>'<button class="room-row'+(r.id===selected?' active':'')+'" data-room="'+r.id+'" aria-pressed="'+(r.id===selected)+'"><span class="room-index">'+(r.id==='copy'?'P':r.id)+'</span><span><strong>'+escape(r.name)+'</strong><small>'+typeNames[r.type]+'</small></span><span aria-hidden="true">›</span></button>').join(''):'<div class="empty-state"><strong>이 층에서 찾을 수 없어요.</strong><span>검색어를 바꾸거나 다른 층을 선택해 주세요.</span></div>';const r=activeFloors[floor].rooms.find(r=>r.id===selected);$('room-detail').innerHTML=r?'<span class="eyebrow">SELECTED SPACE</span><strong>'+escape(r.name)+'</strong><p>'+escape(building.name)+' '+label(floor)+' · '+typeNames[r.type]+'</p>':'';}
  function selectRoom(id){if(!activeFloors[floor].rooms.some(r=>r.id===id))return;selected=id;render();$('announcer').textContent=label(floor)+' '+activeFloors[floor].rooms.find(r=>r.id===id).name+' 선택됨';}
  function updateView(){if(view)$('floor-svg').setAttribute('viewBox',view.x+' '+view.y+' '+view.w+' '+view.h);$('floor-plus').disabled=base&&view.w<=base.w/3;$('floor-minus').disabled=base&&view.w>=base.w*1.25;}
  function fit(){
    if(!document.body.classList.contains('library-open'))return;
    const box=window.LibraryFloorScene.extent(activeFloors[floor],project,tilt),rect=$('floor-canvas').getBoundingClientRect(),ratio=rect.width/rect.height;
    if(!Number.isFinite(ratio)||ratio<=0)return;
    const w=Math.max(box.w+75,(box.h+75)*ratio),h=w/ratio;
    view={x:box.x+(box.w-w)/2,y:box.y+(box.h-h)/2,w,h};base={...view};updateView();
  }
  function zoom(factor){const w=Math.max(base.w/3,Math.min(base.w*1.25,view.w/factor)),h=w*view.h/view.w;view={x:view.x+(view.w-w)/2,y:view.y+(view.h-h)/2,w,h};updateView();}
  function changeFloor(id){if(!activeFloors[id])return;floor=id;selected=null;query='';$('room-search').value='';render();fit();$('announcer').textContent=building.name+' '+label(id)+' 구조도';}
  function open(buildingId='28',id='1'){
    const next=buildings[String(buildingId)];if(!next?.floors[id])return;
    endDrag();returnFocus=document.activeElement;
    if(building!==next){rotation=0;inclination=1;tilt=true;}
    building=next;activeFloors=next.floors;activeOrder=next.order;
    sidebar.setAttribute('aria-label',building.name+' 층별 공간');panel.setAttribute('aria-label',building.name+' 층별 구조도');
    sidebar.querySelector('h1').textContent=building.name;sidebar.querySelector('.eyebrow').textContent=building.eyebrow;
    $('indoor-building-name').textContent=building.name;$('indoor-source-caption').textContent=building.name+' · 층별 구조도';
    $('floor-svg').setAttribute('aria-label',building.name+' 구조도. 공간을 선택하거나 방향키로 이동할 수 있습니다. 휠 버튼 드래그 또는 Q와 E로 회전하며 R로 초기화합니다.');
    $('floor-select').innerHTML=activeOrder.map(f=>'<option value="'+f+'">'+label(f)+'</option>').join('');
    $('floor-tilt').textContent=tilt?'입체':'평면';$('floor-tilt').setAttribute('aria-pressed',tilt);$('floor-tilt').setAttribute('aria-label',tilt?'평면 구조도로 전환':'입체 구조도로 전환');
    document.body.classList.add('library-open');changeFloor(id);requestAnimationFrame(fit);$('floor-select').focus({preventScroll:true});
  }
  function close(){endDrag();document.body.classList.remove('library-open');const target=returnFocus?.isConnected?returnFocus:document.querySelector('.library-entry [data-indoor-building="'+building.id+'"][data-indoor-floor="'+floor+'"]');target?.focus({preventScroll:true});}
  $('floor-select').innerHTML=activeOrder.map(id=>'<option value="'+id+'" '+(!activeFloors[id]?'disabled':'')+'>'+label(id)+''+'</option>').join('');
  $('floor-select').addEventListener('change',e=>changeFloor(e.target.value));$('library-back').addEventListener('click',close);
  sidebar.addEventListener('click',e=>{const f=e.target.closest('[data-floor]'),r=e.target.closest('[data-room]');if(f&&!f.disabled){changeFloor(f.dataset.floor);sidebar.querySelector('[data-floor="'+f.dataset.floor+'"]')?.focus({preventScroll:true});}if(r){selectRoom(r.dataset.room);sidebar.querySelector('[data-room="'+r.dataset.room+'"]')?.focus({preventScroll:true});}});
  $('room-search').addEventListener('input',e=>{query=e.target.value.trim();render();});
  $('floor-tilt').addEventListener('click',()=>{tilt=!tilt;$('floor-tilt').textContent=tilt?'입체':'평면';$('floor-tilt').setAttribute('aria-pressed',tilt);$('floor-tilt').setAttribute('aria-label',tilt?'평면 구조도로 전환':'입체 구조도로 전환');render();fit();});
  function resetOrientation(){rotation=0;inclination=1;render(false);fit();}
  function rotateAtCenter(angle,slope,pivot=unproject({x:view.x+view.w/2,y:view.y+view.h/2})){
    rotation=((angle%360)+360)%360;inclination=Math.max(.55,Math.min(1.25,slope));
    const center=project(pivot);view.x=center.x-view.w/2;view.y=center.y-view.h/2;updateView();
    if(!rotationFrame)rotationFrame=requestAnimationFrame(()=>{rotationFrame=0;render(false);});
  }
  $('floor-plus').addEventListener('click',()=>zoom(1.25));$('floor-minus').addEventListener('click',()=>zoom(.8));$('floor-fit').addEventListener('click',resetOrientation);
  $('floor-svg').addEventListener('click',e=>{if(moved){moved=false;return;}const r=e.target.closest('[data-room]');if(r)selectRoom(r.dataset.room);});
  $('floor-svg').addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.dataset.room){e.preventDefault();const id=e.target.dataset.room;selectRoom(id);$('floor-svg').querySelector('g[data-room="'+id+'"]')?.focus();return;}if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}if(e.key==='-'){e.preventDefault();zoom(.8);}if(e.key.startsWith('Arrow')){e.preventDefault();const d=view.w*.07;if(e.key==='ArrowLeft')view.x-=d;if(e.key==='ArrowRight')view.x+=d;if(e.key==='ArrowUp')view.y-=d;if(e.key==='ArrowDown')view.y+=d;updateView();}});
  $('floor-svg').addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.12:.89);},{passive:false});
  $('floor-svg').addEventListener('pointerdown',e=>{
    if(![0,1].includes(e.button)||drag)return;
    drag={id:e.pointerId,button:e.button,x:e.clientX,y:e.clientY,start:{...view},rotation,inclination,pivot:unproject({x:view.x+view.w/2,y:view.y+view.h/2})};moved=false;
    if(e.button===1){e.preventDefault();$('floor-svg').setPointerCapture(e.pointerId);$('floor-svg').classList.add('rotating');}
  });
  $('floor-svg').addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const x=e.clientX-drag.x,y=e.clientY-drag.y;
    if(Math.hypot(x,y)>4){moved=true;if(!$('floor-svg').hasPointerCapture(e.pointerId))$('floor-svg').setPointerCapture(e.pointerId);}
    if(!moved)return;
    if(drag.button===1){e.preventDefault();rotateAtCenter(drag.rotation+x*.35,tilt?drag.inclination+y*.003:drag.inclination,drag.pivot);}
    else{const unit=drag.start.w/$('floor-canvas').clientWidth;view.x=drag.start.x-x*unit;view.y=drag.start.y-y*unit;updateView();}
  });
  function endDrag(e){
    if(!drag||(e&&drag.id!==e.pointerId))return;
    const previous=drag;drag=null;if(previous.button===1)moved=false;
    $('floor-svg').classList.remove('rotating');
    if(rotationFrame){cancelAnimationFrame(rotationFrame);rotationFrame=0;render(false);}
    if($('floor-svg').hasPointerCapture(previous.id))$('floor-svg').releasePointerCapture(previous.id);
  }
  for(const type of ['pointerup','pointercancel','lostpointercapture'])$('floor-svg').addEventListener(type,endDrag);
  window.addEventListener('pointerup',endDrag);window.addEventListener('blur',()=>endDrag());
  for(const type of ['mousedown','auxclick'])$('floor-svg').addEventListener(type,e=>{if(e.button===1)e.preventDefault();});
  $('floor-svg').addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;if(['q','e','r'].includes(e.key.toLowerCase())){e.preventDefault();if(e.key.toLowerCase()==='r')resetOrientation();else rotateAtCenter(rotation+(e.key.toLowerCase()==='q'?-15:15),inclination);$('floor-svg').focus({preventScroll:true});}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('library-open')&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopImmediatePropagation();close();}},true);
  document.addEventListener('keydown',e=>{if(e.key==='/'&&document.body.classList.contains('library-open')&&!document.querySelector('dialog[open]')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();e.stopImmediatePropagation();$('room-search').focus();}},true);
  window.addEventListener('resize',()=>{if(document.body.classList.contains('library-open')){render();fit();}});
  window.IndoorExplorer={open,close,buildings};
  window.LibraryExplorer={open:(id='1')=>open('28',id),close,floors};
})();


