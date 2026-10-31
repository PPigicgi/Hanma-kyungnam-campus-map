/* Editable ground coordinates. Display and routing consume the same segments. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RoadNetwork=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const EPS=.00001, MAX_SEGMENTS=12000;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const cross=(a,b)=>a.x*b.y-a.y*b.x;
  const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
  function node(p){return {x:p.x,y:p.y,id:p.id||`edit:${p.x.toFixed(5)}:${p.y.toFixed(5)}`};}
  function at(segment,t){return t<EPS?segment.a:t>1-EPS?segment.b:node(mix(segment.a,segment.b,t));}
  function nearest(p,a,b){const d=sub(b,a),den=d.x*d.x+d.y*d.y;const t=Math.max(0,Math.min(1,((p.x-a.x)*d.x+(p.y-a.y)*d.y)/(den||1)));return {t,point:mix(a,b,t)};}
  function snap(p,segments,radius=7,anchors=[]){
    let result=node(p),gap=radius;
    for(const anchor of anchors){const d=distance(p,anchor);if(d<=gap){gap=d;result=node(anchor);}}
    for(const s of segments){const n=nearest(p,s.a,s.b),d=distance(p,n.point);if(d<gap){gap=d;result=at(s,n.t);}}
    return result;
  }
  function simplify(points,tolerance=.65){
    if(points.length<3)return points;
    // Iterative Ramer–Douglas–Peucker; long strokes cannot overflow the stack.
    const keep=new Set([0,points.length-1]),pending=[[0,points.length-1]];
    while(pending.length){const [a,b]=pending.pop();let far=tolerance,index=-1;
      for(let i=a+1;i<b;i++){const d=distance(points[i],nearest(points[i],points[a],points[b]).point);if(d>far){far=d;index=i;}}
      if(index>=0){keep.add(index);pending.push([a,index],[index,b]);}
    }
    return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
  }
  function intersections(a,b,c,d){
    const r=sub(b,a),s=sub(d,c),q=sub(c,a),den=cross(r,s);
    if(Math.abs(den)>EPS){const t=cross(q,s)/den,u=cross(q,r)/den;return t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS?[[Math.max(0,Math.min(1,t)),Math.max(0,Math.min(1,u))]]:[];}
    if(Math.abs(cross(q,r))>EPS)return [];
    const result=[];
    for(const [p,t] of [[a,0],[b,1]]){const n=nearest(p,c,d);if(distance(p,n.point)<EPS)result.push([t,n.t]);}
    for(const [p,u] of [[c,0],[d,1]]){const n=nearest(p,a,b);if(distance(p,n.point)<EPS)result.push([n.t,u]);}
    return result;
  }
  function pieces(segment,cuts){
    const sorted=cuts.sort((a,b)=>a.t-b.t).filter((c,i,all)=>!i||Math.abs(c.t-all[i-1].t)>EPS),out=[];
    for(let i=1;i<sorted.length;i++){const a=sorted[i-1].p,b=sorted[i].p;if(distance(a,b)>.02)out.push({...segment,a,b});}
    return out;
  }
  function insert(segments,stroke){
    // Collect junctions before emitting pieces. An original endpoint discovered
    // later must also join pieces split earlier at the very same crossing.
    const junction=(t,p)=>({t,p,ids:new Set([p.id]),endpoint:false});
    const cuts=[junction(0,stroke.a),junction(1,stroke.b)],pending=[];
    for(const segment of segments){const hits=intersections(stroke.a,stroke.b,segment.a,segment.b),old=[{t:0,p:segment.a},{t:1,p:segment.b}];
      for(const [t,u] of hits){
        let shared=cuts.find(c=>Math.abs(c.t-t)<EPS);
        if(!shared){shared=junction(t,node(mix(stroke.a,stroke.b,t)));cuts.push(shared);}
        const endpoint=u<EPS?segment.a:u>1-EPS?segment.b:null;
        if(endpoint){shared.ids.add(endpoint.id);if(!shared.endpoint){shared.p=endpoint;shared.endpoint=true;}}
        old.push({t:u,shared});
      }
      pending.push({segment,old});
    }
    const aliases=new Map();for(const cut of cuts)for(const id of cut.ids)aliases.set(id,cut.p);
    const canonical=p=>aliases.get(p.id)||p,out=[];
    // Rewire incident edges only at junctions touched by this new stroke.
    // Loading source data alone still preserves independent overpass nodes.
    for(const {segment,old} of pending)out.push(...pieces(segment,old.map(c=>({t:c.t,p:c.shared?c.shared.p:canonical(c.p)}))));
    out.push(...pieces(stroke,cuts.map(c=>({t:c.t,p:c.p}))));
    if(out.length>MAX_SEGMENTS)throw Error('도로 구간이 너무 많습니다. 일부를 지우거나 더 짧게 그려 주세요.');
    return out;
  }
  function draw(segments,points,width=8,anchors=[]){
    if(points.length<2)return segments;
    const path=simplify(points).map(node);
    path[0]=snap(path[0],segments,7,anchors);path[path.length-1]=snap(path.at(-1),segments,7,anchors);
    let result=segments;
    for(let i=1;i<path.length;i++)if(distance(path[i-1],path[i])>.15)result=insert(result,{a:path[i-1],b:path[i],width,tags:{highway:'footway',name:'직접 그린 길'},custom:true});
    return result;
  }
  function fromData(data,core,links){
    let segments=[];
    for(const way of data.ways.filter(w=>w.tags.highway))for(let i=1;i<way.nodes.length;i++){
      const a={...core.project(way.geometry[i-1]),id:'osm:'+way.nodes[i-1]},b={...core.project(way.geometry[i]),id:'osm:'+way.nodes[i]};
      if(distance(a,b)>.02)segments.push({a,b,width:['footway','path','steps'].includes(way.tags.highway)?5:11,tags:{...way.tags},custom:false});
    }
    // Freeze generated building approaches into ordinary editable road edges.
    for(const link of links.values())if(distance(link.anchor,link.snap.point)>.02){
      segments=insert(segments,{a:node(link.anchor),b:node(link.snap.point),width:5,tags:{highway:'footway',name:'건물 앞 연결로'},custom:false});
    }
    return segments;
  }
  function graph(segments,core){return core.createGraph(segments.map((s,i)=>({id:'road-'+i,tags:s.tags,nodes:[s.a.id,s.b.id],geometry:[s.a,s.b]})),p=>({x:p.x,y:p.y}));}
  function circleInterval(a,b,c,r){
    const d=sub(b,a),f=sub(a,c),A=d.x*d.x+d.y*d.y,B=2*(f.x*d.x+f.y*d.y),C=f.x*f.x+f.y*f.y-r*r,disc=B*B-4*A*C;
    if(disc<=0)return [];
    const lo=Math.max(0,(-B-Math.sqrt(disc))/(2*A)),hi=Math.min(1,(-B+Math.sqrt(disc))/(2*A));return hi>lo?[[lo,hi]]:[];
  }
  function stripInterval(a,b,c,d,r){
    const v=sub(d,c),L=Math.hypot(v.x,v.y);if(L<EPS)return [];
    const q=sub(a,c),delta=sub(b,a),u0=(q.x*v.x+q.y*v.y)/L,du=(delta.x*v.x+delta.y*v.y)/L,v0=cross(v,q)/L,dv=cross(v,delta)/L;
    let lo=0,hi=1;
    for(const [start,change,min,max] of [[u0,du,0,L],[v0,dv,-r,r]]){
      if(Math.abs(change)<EPS){if(start<min||start>max)return [];continue;}
      const t1=(min-start)/change,t2=(max-start)/change;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));
    }
    return hi>lo?[[lo,hi]]:[];
  }
  function erase(segments,points,radius){
    if(!points.length)return segments;
    const out=[];
    for(const s of segments){let intervals=[];const r=radius+s.width/2;
      for(let i=0;i<points.length;i++){intervals.push(...circleInterval(s.a,s.b,points[i],r));if(i)intervals.push(...stripInterval(s.a,s.b,points[i-1],points[i],r));}
      if(!intervals.length){out.push(s);continue;}
      intervals.sort((a,b)=>a[0]-b[0]);let end=0;
      for(const [lo,hi] of intervals){if(lo>end&&distance(at(s,end),at(s,lo))>.02)out.push({...s,a:at(s,end),b:at(s,lo)});end=Math.max(end,hi);}
      if(end<1&&distance(at(s,end),s.b)>.02)out.push({...s,a:at(s,end)});
    }
    if(out.length>MAX_SEGMENTS)throw Error('도로 구간이 너무 많습니다. 더 넓은 지우개를 사용해 주세요.');
    return out;
  }
  function serialize(segments){return JSON.stringify({schema:'kyungnam-roads',version:1,campus:'woryeong',segments});}
  function refine(segments,anchors=[]){
    // One explicit cleanup operation, never an implicit load/import mutation.
    // Only identical node-ID edges with identical attributes may be deduplicated.
    const signature=s=>JSON.stringify([s.width,s.custom,Object.entries(s.tags).sort(([a],[b])=>a.localeCompare(b))]);
    const seen=new Set(),unique=[];
    for(const s of segments){const key=JSON.stringify([...[s.a.id,s.b.id].sort(),signature(s)]);if(!seen.has(key)){unique.push(s);seen.add(key);}}
    const incidence=new Map();
    unique.forEach((s,i)=>{for(const p of [s.a,s.b]){if(!incidence.has(p.id))incidence.set(p.id,[]);incidence.get(p.id).push(i);}});
    const cuts=new Map(),curves=[];let rounded=0;
    for(const [id,edges] of incidence){
      if(edges.length!==2)continue;
      const [i,j]=edges,s=unique[i],t=unique[j],p=s.a.id===id?s.a:s.b;
      if(!s.custom||!t.custom||signature(s)!==signature(t)||anchors.some(a=>distance(a,p)<1))continue;
      const a=s.a.id===id?s.b:s.a,b=t.a.id===id?t.b:t.a,la=distance(a,p),lb=distance(b,p);
      const cosine=((a.x-p.x)*(b.x-p.x)+(a.y-p.y)*(b.y-p.y))/(la*lb),turn=Math.PI-Math.acos(Math.max(-1,Math.min(1,cosine)));
      // Preserve almost-straight and hairpin strokes; keep ample edge between bends.
      if(turn<.15||turn>2.15||Math.min(la,lb)<1)continue;
      const cut=Math.min(1.6,s.width*.25,la*.2,lb*.2),start=node(mix(p,a,cut/la)),end=node(mix(p,b,cut/lb));
      cuts.set(i+':'+id,start);cuts.set(j+':'+id,end);
      const arc=[start];
      for(const f of [.25,.5,.75])arc.push(node({x:(1-f)**2*start.x+2*f*(1-f)*p.x+f*f*end.x,y:(1-f)**2*start.y+2*f*(1-f)*p.y+f*f*end.y}));
      arc.push(end);for(let k=1;k<arc.length;k++)curves.push({...s,a:arc[k-1],b:arc[k]});rounded++;
    }
    const result=unique.map((s,i)=>({...s,a:cuts.get(i+':'+s.a.id)||s.a,b:cuts.get(i+':'+s.b.id)||s.b})).concat(curves);
    if(result.length>MAX_SEGMENTS)throw Error('도로 구간이 너무 많아 정리할 수 없습니다.');
    return {segments:result,report:{removedDuplicates:segments.length-unique.length,roundedCorners:rounded,maxDeviation:.8}};
  }
  function deserialize(text){
    if(typeof text!=='string'||text.length>4000000)throw Error('도로 파일은 4MB 이하의 JSON이어야 합니다.');
    const value=JSON.parse(text);
    if(value?.schema!=='kyungnam-roads'||value.version!==1||value.campus!=='woryeong'||!Array.isArray(value.segments)||value.segments.length>MAX_SEGMENTS)throw Error('이 지도에서 내보낸 도로 파일을 선택해 주세요.');
    const ids=new Map();
    function point(p){
      if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>5000||Math.abs(p.y)>5000||typeof p.id!=='string'||!p.id.length||p.id.length>120)throw Error('도로 좌표가 올바르지 않습니다.');
      if(ids.has(p.id)&&distance(ids.get(p.id),p)>.0001)throw Error('도로 연결점 좌표가 서로 다릅니다.');
      const clean={id:p.id,x:p.x,y:p.y};ids.set(p.id,clean);return clean;
    }
    return value.segments.map(s=>{
      if(!s||!Number.isFinite(s.width)||s.width<1||s.width>30||!s.tags||typeof s.tags.highway!=='string')throw Error('도로 굵기 또는 종류가 올바르지 않습니다.');
      const a=point(s.a),b=point(s.b);if(distance(a,b)<=.02)throw Error('길이가 없는 도로 구간이 있습니다.');
      const tags={};for(const key of ['highway','area','foot','access','name','bridge','layer','tunnel'])if(s.tags[key]!==undefined){if(typeof s.tags[key]!=='string'||s.tags[key].length>180)throw Error('도로 속성이 올바르지 않습니다.');tags[key]=s.tags[key];}
      return {a,b,width:s.width,tags,custom:s.custom===true};
    });
  }
  return {fromData,graph,draw,erase,snap,simplify,serialize,deserialize,refine};
});
