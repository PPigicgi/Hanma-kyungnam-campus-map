/* Source-plan polygons extruded into equal-height, selectable room volumes.
   Heights are illustrative pixel units, never surveyed architectural heights. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./amenity-models'));else root.LibraryFloorScene=factory(root.LibraryAmenityModels);})(typeof globalThis!=='undefined'?globalThis:this,function(amenityModels){
  'use strict';
  const ROOM_HEIGHT=12,PLATE_DEPTH=5,prepared=new WeakMap();
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const path=points=>points.map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ')+'Z';
  const area=points=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
  const palette={study:'#f8fcfa',collection:'#fffdf3',service:'#f3f8fb',common:'#fff9f3',staff:'#f9f8fc',unknown:'#f1f2ed',wc:'#e1edf0',stairs:'#eddbbc',lift:'#e6d8bf'};
  function extrude(polygon,project,height=ROOM_HEIGHT,hole=false){
    const bottom=polygon.map(project),top=bottom.map(p=>({x:p.x,y:p.y-height})),winding=Math.sign(area(bottom))*(hole?-1:1),faces=[];
    if(height>0)for(let i=0;i<bottom.length;i++){
      const j=(i+1)%bottom.length,a=bottom[i],b=bottom[j];
      if((b.x-a.x)*winding>=-.00001)continue;
      faces.push({points:[a,b,top[j],top[i]],depth:(a.y+b.y)/2,shade:b.y>a.y?'#647169':'#88938a'});
    }
    return {bottom,top,faces};
  }
  function blocks(floor){
    return [...floor.rooms.map(r=>({...r,kind:'room'})),...(floor.unlabeled||[]).map((polygon,i)=>({id:'unknown-'+i,kind:'unknown',polygons:[polygon],type:'unknown'})),...floor.amenities.filter(a=>a.kind==='wc').map((a,i)=>({...a,id:'amenity-'+i,kind:'amenity',type:a.kind,polygons:[a.polygon]}))];
  }
  const inside=(p,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
  // Source plans are orthogonal. A small exact grid makes both interior holes
  // and edge notches, without changing the original source polygons.
  function cutouts(polygon,cuts){
    const xs=[...new Set([...polygon,...cuts.flat()].map(p=>p[0]))].sort((a,b)=>a-b),ys=[...new Set([...polygon,...cuts.flat()].map(p=>p[1]))].sort((a,b)=>a-b),filled=new Set(),cells=[];
    for(let y=0;y<ys.length-1;y++)for(let x=0;x<xs.length-1;x++){
      const center=[(xs[x]+xs[x+1])/2,(ys[y]+ys[y+1])/2];
      if(inside(center,polygon)&&!cuts.some(c=>inside(center,c))){filled.add(x+','+y);cells.push([[xs[x],ys[y]],[xs[x+1],ys[y]],[xs[x+1],ys[y+1]],[xs[x],ys[y+1]]]);}
    }
    const edges=[],starts=new Map(),key=p=>p.join(',');
    function edge(a,b,dir){const e={a,b,dir,used:false};edges.push(e);const k=key(a);if(!starts.has(k))starts.set(k,[]);starts.get(k).push(e);}
    for(const cell of filled){const [x,y]=cell.split(',').map(Number),a=[xs[x],ys[y]],b=[xs[x+1],ys[y]],c=[xs[x+1],ys[y+1]],d=[xs[x],ys[y+1]];
      if(!filled.has(x+','+(y-1)))edge(a,b,0);if(!filled.has((x+1)+','+y))edge(b,c,1);if(!filled.has(x+','+(y+1)))edge(c,d,2);if(!filled.has((x-1)+','+y))edge(d,a,3);
    }
    const contours=[];
    for(const first of edges){if(first.used)continue;const loop=[];let e=first;
      do{e.used=true;loop.push(e.a);const choices=(starts.get(key(e.b))||[]).filter(n=>!n.used);if(key(e.b)===key(first.a))break;const rank=[1,0,3,2];choices.sort((a,b)=>rank.indexOf((a.dir-e.dir+4)%4)-rank.indexOf((b.dir-e.dir+4)%4));e=choices[0];}while(e);
      contours.push(loop.filter((p,i)=>{const a=loop[(i+loop.length-1)%loop.length],b=loop[(i+1)%loop.length];return (p[0]-a[0])*(b[1]-p[1])!==(p[1]-a[1])*(b[0]-p[0]);}));
    }
    return {contours,cells};
  }
  function prepare(floor){
    if(prepared.has(floor))return prepared.get(floor);
    const cuts=[...floor.amenities.filter(a=>a.kind==='stairs'||a.kind==='lift'),...(floor.corridors||[])].map(a=>a.polygon),items=blocks(floor).map(b=>({...b,regions:b.polygons.map(poly=>cutouts(poly,cuts))})),occluders=[];
    for(const b of items)for(const region of b.regions){
      for(const poly of region.contours)for(let i=0;i<poly.length;i++){const a=poly[i],next=poly[(i+1)%poly.length],dx=next[0]-a[0],dy=next[1]-a[1],len=Math.hypot(dx,dy);occluders.push({vertices:[[...a,0],[...next,0],[...next,ROOM_HEIGHT],[...a,ROOM_HEIGHT]],normal:[dy/len,-dx/len,0],block:b});}
    }
    // Closed door panels sit just outside their wall; they never cut room floors.
    for(const door of floor.doors||[]){
      const block=items.find(b=>b.kind==='room'&&b.id===door.roomId);if(!block)continue;
      const [a,b]=door.wall,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),normal=[dy/length,-dx/length,0];
      function panel(start,end,bottom,top,offset,color,part){
        const point=(t,z)=>[a[0]+dx*t+normal[0]*offset,a[1]+dy*t+normal[1]*offset,z];
        occluders.push({vertices:[point(start,bottom),point(end,bottom),point(end,top),point(start,top)],normal,block,doorPart:part,doorColor:color});
      }
      panel(0,1,0,ROOM_HEIGHT*.86,.06,'#40525a','frame');
      panel(.06,.94,.5,ROOM_HEIGHT*.78,.09,'#b8cbd0','leaf');
      panel(.73,.86,ROOM_HEIGHT*.38,ROOM_HEIGHT*.43,.12,'#f5eedf','handle');
    }
    const value={items,occluders};prepared.set(floor,value);return value;
  }
  function visibleWallStrips(faces){
    // A wall's average depth is insufficient when a long wall overlaps a short
    // one. Partition at edge endpoints/crossings; depth order is constant in
    // each resulting x strip, including intersecting source-plan polygons.
    const edges=faces.map((face,index)=>{const [a,b,c]=face.points,m=(b.y-a.y)/(b.x-a.x);return {...face,index,m,q:a.y-m*a.x,min:Math.min(a.x,b.x),max:Math.max(a.x,b.x),height:b.y-c.y};});
    const cuts=edges.flatMap(e=>[e.min,e.max]);
    for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
      const a=edges[i],b=edges[j];if(Math.abs(a.m-b.m)<1e-8)continue;
      const x=(b.q-a.q)/(a.m-b.m);if(x>Math.max(a.min,b.min)+1e-7&&x<Math.min(a.max,b.max)-1e-7)cuts.push(x);
    }
    cuts.sort((a,b)=>a-b);const unique=cuts.filter((x,i)=>!i||x-cuts[i-1]>1e-7),strips=[];
    for(let i=1;i<unique.length;i++){
      const left=unique[i-1],right=unique[i],middle=(left+right)/2;
      const active=edges.filter(e=>e.min<=left+1e-7&&e.max>=right-1e-7).sort((a,b)=>(a.m*middle+a.q)-(b.m*middle+b.q)||a.index-b.index);
      for(const edge of active){const a={x:left,y:edge.m*left+edge.q},b={x:right,y:edge.m*right+edge.q};strips.push({...edge,points:[a,b,{x:b.x,y:b.y-edge.height},{x:a.x,y:a.y-edge.height}]});}
    }
    return strips;
  }
  function extent(floor,project,tilt){
    const height=tilt?ROOM_HEIGHT:0,points=floor.outline.map(project);
    for(const b of blocks(floor))for(const poly of b.polygons){const g=extrude(poly,project,height);points.push(...g.bottom,...g.top);}
    for(const p of floor.outline.map(project))points.push({x:p.x+5,y:p.y+(tilt?PLATE_DEPTH+9:0)});
    if(tilt)points.push(...amenityModels.points(floor,project));
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);
    return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
  }
  function symbol(item,project,height){
    const p=project(item.at);let detail='';
    if(item.type==='wc')detail=(item.signs||[]).map((sign,i,all)=>{
      const female=sign.gender==='female',x=(i-(all.length-1)/2)*13-6.6;
      const body=female?'<path d="M9 11h6l5.8 16H16v10a1.5 1.5 0 0 1-3 0V27h-2v10a1.5 1.5 0 0 1-3 0V27H3.2Z"/><path d="M8.2 12.8 3.6 23M15.8 12.8 20.4 23" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>':'<path d="M8 11h8a4 4 0 0 1 4 4v9a1.5 1.5 0 0 1-3 0v-9h-1v22a1.5 1.5 0 0 1-3 0V25h-2v12a1.5 1.5 0 0 1-3 0V15H7v9a1.5 1.5 0 0 1-3 0v-9a4 4 0 0 1 4-4Z"/>';
      return '<svg class="wc-sign '+sign.gender+'" role="img" aria-label="'+escape(sign.name)+'" x="'+x+'" y="-11" width="13.2" height="22" viewBox="0 0 24 40" fill="currentColor" style="color:'+(female?'#d83049':'#176bc0')+'"><title>'+escape(sign.name)+'</title><circle cx="12" cy="5" r="3.1"/>'+body+'</svg>';
    }).join('');
    else if(item.type==='stairs')detail='<path d="M-6 7h4V3h4v-4h4v-4h3" fill="none" stroke="currentColor" stroke-width="1.8"/>';
    else detail='<rect x="-6" y="-7" width="12" height="15" rx="1" fill="none" stroke="currentColor"/><path d="m-3-2 3-3 3 3M-3 3l3 3 3-3" fill="none" stroke="currentColor"/>';
    if(item.type==='wc'&&!detail)detail='<text class="floor-wc-label" text-anchor="middle" y="3">WC</text>';
    return '<g class="floor-amenity-symbol '+item.type+'" role="img" aria-label="'+escape(item.name)+'" transform="translate('+p.x+' '+(p.y-height)+')">'+detail+'<title>'+escape(item.name)+'</title></g>';
  }
  function nameLines(text){
    if(text.length<=7)return [text];
    if(text.includes(' '))return text.split(' ');
    const middle=Math.ceil(text.length/2);return [text.slice(0,middle),text.slice(middle)];
  }
  function labelSpace(room,project){
    const center=project(room.at),span=(poly,axis)=>{const other=axis==='x'?'y':'x',cuts=[];
      for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if((a[other]>center[other])!==(b[other]>center[other]))cuts.push(a[axis]+(center[other]-a[other])*(b[axis]-a[axis])/(b[other]-a[other]));}
      cuts.sort((a,b)=>a-b);for(let i=1;i<cuts.length;i+=2)if(center[axis]>=cuts[i-1]&&center[axis]<=cuts[i])return 2*Math.min(center[axis]-cuts[i-1],cuts[i]-center[axis]);return 0;
    };
    for(const polygon of room.polygons){const poly=polygon.map(project),w=span(poly,'x'),h=span(poly,'y');if(w&&h)return {w,h};}
    return {w:30,h:20};
  }
  function render(floor,project,{tilt=true,selected=null,query='',small=false}={}){
    const height=tilt?ROOM_HEIGHT:0,scene=prepare(floor),items=scene.items.map(b=>({...b,geometry:b.regions.map((r,i)=>{
      const contours=(tilt||floor.corridors?.length?r.contours:[b.polygons[i]]).map(poly=>extrude(poly,project,height,area(poly.map(p=>({x:p[0],y:p[1]})))<0));
      return {contours,faces:contours.flatMap(g=>g.faces)};
    })}));
    const ground=floor.outline.map(project),outline=path(ground);
    let html='<g class="floor-ground" aria-hidden="true">';
    if(tilt){
      html+='<path class="floor-ground-shadow" d="'+path(ground.map(p=>({x:p.x+4,y:p.y+11})))+'"/>';
      const plate=extrude(floor.outline,p=>{const q=project(p);return {x:q.x,y:q.y+PLATE_DEPTH};},PLATE_DEPTH);
      for(const face of plate.faces)html+='<path class="floor-plate-side" d="'+path(face.points)+'"/>';
    }
    html+='<path class="floor-ground-top" d="'+outline+'"/>';
    for(const c of floor.corridors||[])html+='<path class="floor-corridor" data-elevation="0" d="'+path(c.polygon.map(project))+'"><title>'+escape(c.name)+'</title></path>';
    if(floor.void){const v=floor.void.map(project);html+='<path class="floor-void" d="'+path(v)+'"/><path class="floor-void-cross" d="M'+v[0].x+' '+v[0].y+'L'+v[2].x+' '+v[2].y+'M'+v[1].x+' '+v[1].y+'L'+v[3].x+' '+v[3].y+'"/>';}
    for(const a of floor.amenities.filter(a=>a.kind==='stairs'||a.kind==='lift'))html+='<path class="floor-facility-footprint" data-facility="'+a.kind+'" data-elevation="0" d="'+path(a.polygon.map(project))+'"/>';
    html+='</g>';
    if(tilt){html+='<g class="floor-room-shadows" aria-hidden="true">';for(const b of items)for(const g of b.geometry)html+='<path fill-rule="evenodd" d="'+g.contours.map(c=>path(c.bottom.map(p=>({x:p.x+3,y:p.y+5})))).join(' ')+'"/>';html+='</g>';}
    // Keep room tops coplanar: interleave walls and facility faces below 12,
    // paint tops with facility cutouts, then facility faces above 12.
    const layers=tilt?amenityModels.layers(floor,scene.occluders,ROOM_HEIGHT):null,view=amenityModels.viewVector(project);
    const faces=tilt?amenityModels.orderedFaces(layers.lower,view):[];
    html+='<g class="floor-walls">';
    for(const face of faces){if(!face.block){html+=amenityModels.renderFace(face,project);continue;}const b=face.block,active=b.kind==='room'&&b.id===selected,dim=b.kind==='room'&&query&&!b.name.toLowerCase().includes(query.toLowerCase());
      const shade=face.doorColor||(active?'#96714b':face.normal[0]>0?'#647169':'#88938a');
      html+='<path class="floor-wall'+(face.doorPart?' floor-door-panel':'')+(active?' selected':'')+(dim?' muted':'')+'" '+(face.doorPart?'data-door-part="'+face.doorPart+'" ':'')+(b.kind==='room'?'data-room="'+escape(b.id)+'" ':'')+'d="'+path(face.vertices.map(p=>amenityModels.projectVertex(p,project)))+'" fill="'+shade+'" stroke="'+shade+'"/>';
    }
    html+='</g><g class="floor-tops">';
    for(const b of items){const active=b.kind==='room'&&b.id===selected,dim=b.kind==='room'&&query&&!b.name.toLowerCase().includes(query.toLowerCase());
      html+='<g class="'+(b.kind==='room'?'floor-room':b.kind==='amenity'?'floor-amenity':'floor-unnamed')+(active?' selected':'')+(dim?' muted':'')+'" '+(b.kind==='room'?'data-room="'+escape(b.id)+'" role="button" tabindex="0" aria-label="'+escape(b.name)+'" aria-pressed="'+active+'"':'')+'>';
      for(const g of b.geometry)html+='<path class="floor-room-top" fill-rule="evenodd" d="'+g.contours.map(c=>path(c.top)).join(' ')+'" fill="'+palette[b.type]+'" data-elevation="'+height+'"/>';
      if(b.kind==='unknown')html+='<title>공간</title>';
      if(b.kind==='amenity')html+='<title>'+escape(b.name)+'</title>';
      html+='</g>';
    }
    html+='</g>';
    for(const detail of floor.details||[])html+='<path class="floor-partition-detail'+(detail.type==='corridor'?' floor-interior-corridor':'')+'" d="'+path(detail.polygon.map(p=>{const q=project(p);return{x:q.x,y:q.y-height};}))+'"><title>'+escape(detail.name)+'</title></path>';
    for(const door of floor.doors||[])html+='<g class="floor-door" role="img" aria-label="'+escape(door.name)+'" data-room="'+escape(door.roomId)+'"><title>'+escape(door.name)+'</title><path class="floor-door-top" d="'+path(door.polygon.map(p=>{const q=project(p);return{x:q.x,y:q.y-height};}))+'"/></g>';
    if(tilt)html+='<g class="floor-amenity-models" role="img" aria-label="바닥에서 올라오는 계단과 엘리베이터 입체 모형">'+amenityModels.orderedFaces(layers.upper,view).map(f=>amenityModels.renderFace(f,project)).join('')+amenityModels.descriptions(floor)+'</g>';
    html+='<g class="floor-labels">';
    for(const c of floor.corridors||[])if(!c.hideLabel){const p=project(c.at);html+='<text class="floor-corridor-label" text-anchor="middle" x="'+p.x+'" y="'+(p.y+3)+'">'+escape(c.name)+'</text>';}
    for(const b of items)if(b.kind==='amenity'&&(!tilt||b.type==='wc'))html+=symbol(b,project,height);
    if(!tilt)for(const a of floor.amenities.filter(a=>a.kind==='stairs'||a.kind==='lift'))html+=symbol({...a,type:a.kind},project,0);
    for(const r of floor.rooms){const p=project(r.at),space=labelSpace(r,project),nameOnly=!!r.labelLines,compact=space.h<36&&!nameOnly,width=space.w-(compact?22:6);
      let lines=r.labelLines||nameLines(r.short);if(lines.length===1&&r.short.includes(' ')&&width/r.short.length<8)lines=r.short.split(' ');
      const font=Math.min(small?10:9,width/Math.max(...lines.map(s=>s.length))),showName=font>=6.8&&space.h>(compact||nameOnly?lines.length*(font+2):lines.length===1?34:43),cx=compact&&showName?-space.w/2+7:0,cy=compact||nameOnly?0:-11,tx=compact?cx+11:0,dim=query&&!r.name.toLowerCase().includes(query.toLowerCase());
      html+='<g class="floor-room-label'+(r.id===selected?' selected':'')+(dim?' muted':'')+'" data-room="'+escape(r.id)+'" aria-hidden="true" transform="translate('+p.x+' '+(p.y-height)+')"><title>'+escape(r.name)+'</title>';
      if(!nameOnly||!showName)html+='<circle cx="'+cx+'" cy="'+cy+'" r="'+(compact?5.5:6.5)+'"/><text class="room-number" text-anchor="middle" x="'+cx+'" y="'+(cy+3)+'">'+(r.id==='copy'?'P':escape(r.id))+'</text>';
      if(showName)html+='<text class="room-name" text-anchor="'+(compact?'start':'middle')+'" style="font-size:'+font+'px">'+lines.map((line,i)=>'<tspan x="'+tx+'" y="'+(compact||nameOnly?(i-(lines.length-1)/2)*(font+2)+font*.35:6+i*(font+2))+'">'+escape(line)+'</tspan>').join('')+'</text>';
      html+='</g>';
    }
    if(floor.entry){const p=project(floor.entry);html+='<g aria-label="출입구" class="floor-entry" transform="translate('+p.x+' '+(p.y+10)+')"><path d="M-5 4 0-2 5 4"/><text y="16">출입구</text></g>';}
    return html+'</g>';
  }
  return {extrude,visibleWallStrips,extent,render,cutouts,prepare,height:ROOM_HEIGHT};
});
