(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.CampusGPS=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // A GPS start joins only a nearby existing segment. Destination anchors stay fixed.
  function plan(core,graph,links,fix,to,now=Date.now()){
    if(!fix||![fix.lat,fix.lon,fix.accuracy,fix.timestamp].every(Number.isFinite)||Math.abs(fix.lat)>90||Math.abs(fix.lon)>180||fix.accuracy<0)return {error:'현재 위치를 확인할 수 없습니다. 다시 시도해 주세요.'};
    if(now-fix.timestamp>15000||fix.timestamp>now+5000)return {error:'위치 업데이트가 멈췄습니다. GPS 수신을 기다려 주세요.'};
    if(fix.accuracy>35)return {error:'위치 오차가 큽니다. 탁 트인 곳에서 다시 확인해 주세요.'};
    const point=core.project(fix),snap=core.nearestSegment(point,graph),end=links.get(to.id);
    if(!snap||snap.gap>25)return {error:'교내 길에서 현재 위치를 찾지 못했습니다. 캠퍼스 안에서 다시 확인해 주세요.'};
    if(!end)return {error:'목적지 연결로가 끊겨 있습니다. 다른 목적지를 선택해 주세요.'};
    const from={...fix,id:'gps-current',name:'현재 위치'},access=new Map(links);
    access.set(from.id,{anchor:point,snap});
    // core.route rejects coincident place coordinates; arrival uses the actual road anchor.
    const atAnchor=core.distance(point,end.anchor)<=12&&fix.accuracy<=20;
    if(atAnchor&&snap.index===end.snap.index)return {arrived:true,point,accuracy:fix.accuracy,length:0,minutes:0};
    const route=core.route(graph,from,to,access);
    if(route.error)return route;
    const length=route.length+snap.gap+core.distance(route.end.point,end.anchor);
    if(atAnchor&&length<=15)return {arrived:true,point,accuracy:fix.accuracy,length:0,minutes:0};
    return {route,point,accuracy:fix.accuracy,length,minutes:Math.max(1,Math.ceil(length/75)),arrived:false};
  }
  function unproject(p){const a=-25*Math.PI/180,x=p.x*Math.cos(a)+p.y*Math.sin(a),y=-p.x*Math.sin(a)+p.y*Math.cos(a);return {lat:35.1816-y/111320,lon:128.554+x/(111320*Math.cos(35.1816*Math.PI/180))};}
  function sample(points,fraction,core){
    const lengths=points.slice(1).map((p,i)=>core.distance(points[i],p)),total=lengths.reduce((a,b)=>a+b,0);let left=total*Math.max(0,Math.min(1,fraction));
    for(let i=0;i<lengths.length;i++){if(left<=lengths[i]&&lengths[i]>0){const t=left/lengths[i];return {x:points[i].x+(points[i+1].x-points[i].x)*t,y:points[i].y+(points[i+1].y-points[i].y)*t};}left-=lengths[i];}return points.at(-1);
  }
  function create({core,places,getGraph,getLinks,onMap,onOpen,onClose}){
    const $=id=>document.getElementById(id),demo=document.body.dataset?.mobileApp!=='true'&&new URLSearchParams(location.search).get('gps-demo')==='1';
    let active=false,watch=null,staleTimer=null,demoTimer=null,lastFix=null,lastResult=null,generation=0,first=true;
    const panel=document.createElement('section');panel.id='gps-ui';panel.hidden=true;panel.setAttribute('aria-label','현재 위치 길찾기');
    panel.innerHTML='<div class="gps-top"><div class="gps-title"><button id="gps-close" aria-label="GPS 길찾기 종료"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg></button><span>도보 길찾기</span><span id="gps-kind">GPS</span></div><label for="gps-destination">도착지</label><select id="gps-destination" aria-label="GPS 목적지"></select></div><div class="gps-bottom"><div id="gps-status" role="status" aria-live="polite"></div><div id="gps-metrics"></div><p id="gps-note"></p><button id="gps-start" class="primary-button">현재 위치로 시작</button><button id="gps-demo-start" class="primary-button" hidden>모의 이동 시작</button><button id="gps-recenter">내 위치 중심으로</button></div>';
    document.querySelector('.map-panel').append(panel);
    for(const p of places){const o=document.createElement('option');o.value=p.id;o.textContent=p.officialNumber+'번 '+p.name;$('gps-destination').append(o);}
    $('gps-destination').value='28';$('gps-demo-start').hidden=!demo;$('gps-start').hidden=demo;
    $('gps-kind').textContent=demo?'모의 GPS · 빠른 시연':'GPS';
    function clear(){generation++;if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;}clearInterval(staleTimer);clearInterval(demoTimer);staleTimer=demoTimer=null;}
    function status(text){if($('gps-status').textContent!==text)$('gps-status').textContent=text;}
    function invalidate(text){lastResult=null;status(text);$('gps-metrics').textContent='';$('gps-note').textContent='';onMap(null,false);}
    function accept(fix){
      if(!active)return;lastFix=fix;
      const to=places.find(p=>p.id===$('gps-destination').value),result=plan(core,getGraph(),getLinks(),fix,to);
      if(result.error){invalidate(result.error);return;}
      lastResult=result;
      status(result.arrived?'목적지에 도착했어요':'현재 위치에서 '+to.name+'까지');
      $('gps-metrics').innerHTML=result.arrived?'<strong class="gps-arrived">도착</strong><span>'+to.name+' 앞 연결로</span>':'<strong>'+result.minutes+'<small>분</small></strong><span>약 '+Math.max(10,Math.round(result.length/10)*10)+'m 남음</span>';
      $('gps-note').textContent=result.arrived?'안내를 종료하려면 위의 뒤로 버튼을 누르세요.':'도보 4.5km/h 기준 · 위치 정확도 ±'+Math.round(fix.accuracy)+'m';
      onMap(result,first);first=false;
      if(result.arrived)clear();
    }
    function open(destination){
      clear();active=true;first=true;lastFix=lastResult=null;
      if(places.some(p=>p.id===destination))$('gps-destination').value=destination;
      panel.hidden=false;document.body.classList.add('gps-open');onOpen();
      status(demo?'모의 위치로 정문에서 출발합니다':'현재 위치에서 교내 길을 안내합니다');
      $('gps-metrics').textContent='';$('gps-note').textContent=demo?'실제 GPS 수신이 아닌 이동 시연입니다.':'위치 허용 후 시작합니다. 위치는 저장하거나 전송하지 않습니다.';
      $('gps-start').textContent='현재 위치로 시작';$('gps-start').disabled=false;$('gps-demo-start').textContent='모의 이동 시작';
      $('gps-destination').focus({preventScroll:true});
    }
    function close(){clear();active=false;lastFix=lastResult=null;panel.hidden=true;document.body.classList.remove('gps-open');onMap(null,false);onClose();$('gps-open').focus({preventScroll:true});}
    function start(){
      clear();first=true;lastFix=null;invalidate('현재 위치를 찾고 있어요…');
      if(!window.isSecureContext){invalidate('GPS는 HTTPS 연결에서 사용할 수 있습니다.');return;}
      if(!navigator.geolocation){invalidate('이 브라우저는 위치 기능을 지원하지 않습니다.');return;}
      const token=generation;$('gps-start').textContent='위치 다시 확인';
      try{watch=navigator.geolocation.watchPosition(p=>{if(active&&token===generation)accept({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp});},e=>{
        if(!active||token!==generation)return;
        clear();lastFix=null;
        invalidate(e.code===1?'위치 권한이 꺼져 있습니다. 브라우저에서 위치를 허용한 뒤 다시 시도해 주세요.':e.code===3?'위치 확인 시간이 초과됐습니다. 다시 시도해 주세요.':'GPS 신호를 받지 못했습니다. 위치 서비스를 확인하고 다시 시도해 주세요.');
      },{enableHighAccuracy:true,maximumAge:0,timeout:12000});
      staleTimer=setInterval(()=>{if(lastFix&&Date.now()-lastFix.timestamp>15000)invalidate('위치 업데이트가 멈췄습니다. GPS 수신을 기다려 주세요.');},1000);
      }catch{clear();invalidate('위치 기능을 시작할 수 없습니다. 브라우저의 위치 권한을 확인해 주세요.');}
    }
    function startDemo(){
      if(!demo)return;clear();first=true;
      const gate=places.find(p=>p.id==='6'),to=places.find(p=>p.id===$('gps-destination').value),r=core.route(getGraph(),gate,to,getLinks());
      if(r.error){invalidate(r.error);return;}
      const points=[r.fromAnchor,...r.points,r.toAnchor],started=Date.now();
      const tick=()=>{const f=Math.min(1,(Date.now()-started)/26000),p=sample(points,f,core);accept({...unproject(p),accuracy:6,timestamp:Date.now()});if(f===1)clear();};
      $('gps-demo-start').textContent='처음부터 다시 시연';tick();demoTimer=setInterval(tick,180);
    }
    $('gps-close').addEventListener('click',close);$('gps-start').addEventListener('click',start);$('gps-demo-start').addEventListener('click',startDemo);
    $('gps-recenter').addEventListener('click',()=>{if(lastResult)onMap(lastResult,true);});
    $('gps-destination').addEventListener('change',()=>{first=true;if(demo){clear();lastFix=null;invalidate('목적지를 선택했습니다. 모의 이동을 시작해 주세요.');}else if(watch!==null&&lastFix)accept(lastFix);else{lastFix=null;invalidate('목적지를 선택했습니다. 현재 위치로 시작해 주세요.');$('gps-start').textContent='현재 위치로 시작';}});
    document.addEventListener('keydown',e=>{if(active&&e.key==='Escape'&&!document.querySelector('dialog[open]')){e.preventDefault();close();}});
    window.addEventListener('pagehide',()=>{clear();lastFix=null;if(active){invalidate('위치 안내가 중지됐습니다. 현재 위치로 다시 시작해 주세요.');$('gps-start').textContent='현재 위치로 시작';}});
    return {open,close,get active(){return active;}};
  }
  return {plan,unproject,sample,create};
});
