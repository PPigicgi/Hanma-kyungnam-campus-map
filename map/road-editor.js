(function(){
  'use strict';
  const STORAGE='kyungnam-roads-v1';
  window.RoadEditor={create({svg,base,anchors,boundary,project,worldPoint,onChange,onMode,notify,migrationFrom,revision,editable=true}){
    const N=window.RoadNetwork,$=id=>document.getElementById(id);
    let roads=base,history=[base],index=0,enabled=false,tool='draw',width=8,radius=12,stroke=null,hover=null,frame=0,stats={},loadError='',savedText;
    try{
      const stored=localStorage.getItem(STORAGE);
      if(stored){
        const parsed=N.deserialize(stored);roads=parsed;savedText=N.serialize(parsed);
        // Migrate only the exact user-approved snapshot. Later edits win unchanged.
        if(migrationFrom&&savedText===N.serialize(migrationFrom)){
          roads=base;
          try{const backup=STORAGE+'-backup-'+revision;if(!localStorage.getItem(backup))localStorage.setItem(backup,stored);localStorage.setItem(STORAGE,N.serialize(base));savedText=N.serialize(base);}
          catch{loadError='다듬은 최종 도로를 열었습니다. 브라우저 저장을 다시 눌러 주세요.';}
        }
      }
    }catch{loadError='저장된 도로를 읽지 못해 기본 도로를 열었습니다. JSON 파일이 있다면 불러와 주세요.';}
    if(!editable){
      onChange(roads);
      if(loadError)notify('저장된 도로를 불러오거나 갱신하지 못해 기본 도로를 표시합니다.');
      return {enabled:false,drawing:false,cancel(){},renderOverlay(){}};
    }
    history=[roads];savedText??=N.serialize(roads);
    const panel=document.createElement('section');panel.id='road-editor-panel';panel.hidden=true;panel.setAttribute('aria-label','도로 편집 도구');
    panel.innerHTML=`<div class="road-editor-heading"><div class="eyebrow">ROAD STUDIO</div><h1>길을 이어 그려요.</h1><p>기존 길에 닿으면 하나의 도로로 연결돼요.</p></div>
      <div class="road-tool-row" role="group" aria-label="편집 도구"><button data-road-tool="draw" aria-pressed="true"><span aria-hidden="true">✎</span>브러시</button><button data-road-tool="erase" aria-pressed="false"><span aria-hidden="true">▱</span>지우개</button><button data-road-tool="pan" aria-pressed="false"><span aria-hidden="true">✥</span>이동</button></div>
      <div id="road-size-field"><label for="road-size"><span id="road-size-label">도로 굵기</span><output id="road-size-value" for="road-size">8 m</output></label><input id="road-size" type="range" min="3" max="22" value="8" step="1"><div class="road-width-sample" aria-hidden="true"><i id="road-width-sample"></i></div></div>
      <p class="road-instructions" id="road-tool-help">왼쪽 버튼을 누른 채 길을 그리세요. 길의 끝은 가까운 도로와 건물 연결점에 자동으로 붙습니다.</p>
      <div class="road-history"><button id="road-undo" disabled>↶ 되돌리기</button><button id="road-redo" disabled>↷ 다시 실행</button></div>
      <div class="road-network-status"><span class="live-dot"></span><span id="road-network-status"></span></div><p id="road-reachability" class="road-instructions"></p><small class="road-anchor-legend"><i></i>건물 연결점 <i class="disconnected"></i>연결 끊김</small>
      <div class="road-save-box"><button id="road-save" class="primary-button">이 브라우저에 저장</button><p id="road-save-status" role="status" aria-live="polite"></p><small>수정은 경로에 바로 반영됩니다. 저장하면 새로고침 후에도 유지돼요.</small></div>
      <div class="road-file-actions"><button id="road-export">JSON 내보내기 ↗</button><button id="road-import">파일 불러오기</button><input type="file" id="road-file" accept=".json,application/json" hidden></div>
      <div id="road-feedback" role="status" aria-live="polite"></div><button id="road-reset" class="text-button">기본 도로로 복원</button>
      <div class="road-shortcuts">휠 버튼 드래그 · 회전<br>Shift + 왼쪽 드래그 · 이동<br>Ctrl + Z / Ctrl + Shift + Z · 실행 취소 / 다시 실행</div><button id="road-done">편집 끝내기</button>`;
    document.querySelector('.sidebar').append(panel);
    const toggle=document.createElement('button');toggle.id='road-edit-toggle';toggle.className='road-edit-toggle';toggle.textContent='✎ 도로 편집';toggle.setAttribute('aria-pressed','false');toggle.setAttribute('aria-controls',panel.id);document.querySelector('.map-top').append(toggle);
    const dirty=()=>N.serialize(roads)!==savedText;
    function update(){
      const changed=dirty();$('road-undo').disabled=index===0;$('road-redo').disabled=index===history.length-1;$('road-save').disabled=!changed;
      $('road-save-status').textContent=changed?'저장하지 않은 수정이 있어요.':'현재 도로가 유지되고 있어요.';
      $('road-network-status').textContent=`건물·장소 연결 ${stats.connected??0} / ${anchors.length}곳`;
      $('road-reachability').textContent=stats.reachable===anchors.length?'모든 장소가 정문과 이어져 있어요.':`정문에서 길이 이어지는 장소 ${stats.reachable??0} / ${anchors.length}곳`;
      toggle.textContent=(enabled?'✓ 편집 중':'✎ 도로 편집')+(changed?' ·':'');toggle.setAttribute('aria-pressed',String(enabled));
      panel.querySelectorAll('[data-road-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.roadTool===tool)));
      $('road-size-field').hidden=tool==='pan';$('road-size-label').textContent=tool==='erase'?'지우개 지름':'도로 굵기';
      const slider=$('road-size');slider.min=tool==='erase'?8:3;slider.max=tool==='erase'?60:22;slider.value=tool==='erase'?radius*2:width;
      $('road-size-value').textContent=slider.value+' m';$('road-width-sample').style.height=Math.min(24,Number(slider.value))+'px';
      $('road-tool-help').textContent=tool==='draw'?'왼쪽 버튼을 누른 채 길을 그리세요. 길의 끝은 가까운 도로와 건물 연결점에 자동으로 붙습니다.':tool==='erase'?'지울 길 위를 문지르세요. 지나간 부분만 잘리고 길찾기 연결도 함께 끊어집니다.':'왼쪽 버튼으로 지도를 이동하세요. 휠을 굴리면 확대·축소할 수 있어요.';
      document.body.classList.toggle('road-brushing',enabled&&tool!=='pan');
    }
    function apply(next){roads=next;stats=onChange(roads);update();renderOverlay();}
    function commit(next){if(N.serialize(next)===N.serialize(roads))return false;history=history.slice(0,index+1);history.push(next);if(history.length>31)history.shift();index=history.length-1;apply(next);return true;}
    function undo(){cancel();if(index>0){index--;apply(history[index]);feedback('한 단계 되돌렸어요.');}}
    function redo(){cancel();if(index<history.length-1){index++;apply(history[index]);feedback('다시 실행했어요.');}}
    function feedback(text){$('road-feedback').textContent=text;}
    function setEnabled(value){cancel();enabled=value;panel.hidden=!value;document.body.classList.toggle('road-editing',value);onMode(value);update();renderOverlay();}
    // Use the map's inverse projection, including yaw, inclination and zoom.
    function point(e){return worldPoint(e.clientX,e.clientY);}
    function inside(p){return window.CampusCore.inside(p,boundary);}
    function trace(points,close=false){return window.CampusScene.path(points.map(project),close);}
    function ring(p,r){return trace(Array.from({length:40},(_,i)=>({x:p.x+Math.cos(i/40*Math.PI*2)*r,y:p.y+Math.sin(i/40*Math.PI*2)*r})),true);}
    function renderOverlay(){
      let layer=$('road-edit-overlay');if(!layer){layer=document.createElementNS('http://www.w3.org/2000/svg','g');layer.id='road-edit-overlay';layer.setAttribute('aria-hidden','true');svg.append(layer);}
      if(!enabled){layer.innerHTML='';return;}
      const graph=stats.graph;
      let markup='<g clip-path="url(#campus-clip)">';
      markup+=roads.map(s=>`<path class="road-centerline" d="${trace([s.a,s.b])}"/>`).join('');
      markup+=anchors.map(a=>{const p=project(a),connected=graph&&window.CampusCore.nearestSegment(a,graph)?.gap<.08;return `<circle class="road-anchor ${connected?'':'disconnected'}" cx="${p.x}" cy="${p.y}" r="3.5"/>`;}).join('');
      if(stroke){let points=stroke.points;if(tool==='draw'&&points.length>1){points=[...points];points[points.length-1]=N.snap(points.at(-1),roads,7,anchors);}
        markup+=`<path class="road-paint-preview ${tool==='erase'?'erasing':''}" d="${trace(points)}" stroke-width="${tool==='erase'?radius*2:width}"/>`;
      }
      if(hover&&tool!=='pan'){markup+=`<path class="road-brush-cursor ${tool==='erase'?'erasing':''}" d="${ring(hover,tool==='erase'?radius:width/2)}"/>`;
        if(tool==='draw'){const snapped=N.snap(hover,roads,7,anchors),p=project(snapped);if(Math.hypot(snapped.x-hover.x,snapped.y-hover.y)>.05)markup+=`<circle class="road-snap-point" cx="${p.x}" cy="${p.y}" r="4"/>`;}}
      layer.innerHTML=markup+'</g>';
    }
    function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;renderOverlay();});}
    function release(){const previous=stroke;stroke=null;if(previous&&svg.hasPointerCapture(previous.id))svg.releasePointerCapture(previous.id);schedule();}
    function cancel(){release();hover=null;}
    function sample(p){if(!stroke||!inside(p))return;if(Math.hypot(p.x-stroke.points.at(-1).x,p.y-stroke.points.at(-1).y)>.8&&stroke.points.length<1500)stroke.points.push(p);}
    svg.addEventListener('pointerdown',e=>{
      if(!enabled||tool==='pan'||e.button!==0||e.shiftKey||stroke)return;
      const p=point(e);if(!inside(p)){e.preventDefault();e.stopImmediatePropagation();return;}
      e.preventDefault();e.stopImmediatePropagation();svg.focus({preventScroll:true});hover=p;stroke={id:e.pointerId,points:[tool==='draw'?N.snap(p,roads,7,anchors):p]};svg.setPointerCapture(e.pointerId);feedback('');schedule();
    },true);
    svg.addEventListener('pointermove',e=>{
      if(!enabled)return;hover=inside(point(e))?point(e):null;
      if(stroke&&stroke.id===e.pointerId){e.preventDefault();e.stopImmediatePropagation();sample(point(e));}schedule();
    },true);
    svg.addEventListener('pointerup',e=>{
      if(!stroke||stroke.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();sample(point(e));const points=stroke.points;release();
      try{const next=tool==='erase'?N.erase(roads,points,radius):N.draw(roads,points,width,anchors);if(commit(next))feedback(tool==='erase'?'지운 구간을 도로망에서 제거했어요.':'그린 길을 도로망에 연결했어요.');else feedback(tool==='erase'?'지우개가 닿은 도로가 없어요.':'드래그해서 길을 그려 주세요.');}catch(error){feedback(error.message);}
      renderOverlay();
    },true);
    for(const type of ['pointercancel','lostpointercapture'])svg.addEventListener(type,e=>{if(stroke?.id===e.pointerId){cancel();feedback('그리기를 취소했어요.');}},true);
    svg.addEventListener('pointerleave',()=>{if(!stroke){hover=null;schedule();}});
    svg.addEventListener('click',e=>{if(enabled){e.preventDefault();e.stopImmediatePropagation();}},true);
    svg.addEventListener('wheel',()=>{cancel();},true);window.addEventListener('blur',cancel);
    svg.addEventListener('keydown',e=>{if(stroke&&(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key)))cancel();},true);
    toggle.addEventListener('click',()=>setEnabled(!enabled));$('road-done').addEventListener('click',()=>{setEnabled(false);toggle.focus();if(dirty())notify('수정은 적용되어 있어요. 새로고침 전에 브라우저에 저장해 주세요.');});
    panel.querySelectorAll('[data-road-tool]').forEach(b=>b.addEventListener('click',()=>{cancel();tool=b.dataset.roadTool;update();renderOverlay();}));
    $('road-size').addEventListener('input',e=>{cancel();if(tool==='erase')radius=Number(e.target.value)/2;else width=Number(e.target.value);update();renderOverlay();});
    $('road-undo').addEventListener('click',undo);$('road-redo').addEventListener('click',redo);
    $('road-save').addEventListener('click',()=>{cancel();try{const text=N.serialize(roads);localStorage.setItem(STORAGE,text);savedText=text;update();feedback('이 브라우저에 저장했어요. 다음에 열어도 같은 도로가 나와요.');}catch{feedback('브라우저 저장에 실패했어요. JSON 내보내기로 파일을 보관해 주세요.');}});
    $('road-export').addEventListener('click',()=>{cancel();const url=URL.createObjectURL(new Blob([N.serialize(roads)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='kyungnam-roads.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback('도로 JSON 파일을 내보냈어요. 다른 브라우저에서도 불러올 수 있어요.');});
    $('road-import').addEventListener('click',()=>{cancel();$('road-file').click();});
    $('road-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>4000000)throw Error('4MB 이하의 도로 JSON 파일을 선택해 주세요.');const next=N.deserialize(await file.text());commit(next);feedback('도로 파일을 불러왔어요. 유지하려면 브라우저에 저장해 주세요.');}catch(error){feedback('불러오지 못했어요. '+(error instanceof SyntaxError?'JSON 형식을 확인해 주세요.':error.message));}finally{e.target.value='';}});
    $('road-reset').addEventListener('click',()=>{cancel();commit(base);feedback('기본 도로로 복원했어요. 되돌리기로 이전 편집을 살릴 수 있어요.');});
    document.addEventListener('keydown',e=>{
      if(!enabled||document.body.classList.contains('library-open')||$('about-dialog').open||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
      if(e.key==='Escape'&&stroke){e.preventDefault();cancel();feedback('그리기를 취소했어요.');}
    });
    window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
    stats=onChange(roads);update();if(loadError)feedback(loadError);
    return {renderOverlay,get enabled(){return enabled;},get drawing(){return !!stroke;},cancel};
  }};
})();
