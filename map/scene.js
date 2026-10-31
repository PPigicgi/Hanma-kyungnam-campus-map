/* Schematic campus illustration. Routing stays in ground metres in core.js. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CampusScene=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function screen(p,depth=true,rotation=0,inclination=.6){const angle=((depth?65:0)+rotation)*Math.PI/180;return{x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:(p.x*Math.sin(angle)+p.y*Math.cos(angle))*(depth?inclination:1)};}
  function unproject(p,depth=true,rotation=0,inclination=.6){const angle=((depth?65:0)+rotation)*Math.PI/180,y=p.y/(depth?inclination:1);return{x:p.x*Math.cos(angle)+y*Math.sin(angle),y:-p.x*Math.sin(angle)+y*Math.cos(angle)};}
  function path(points,close=false){return points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')+(close?'Z':'');}
  function cross(a,b,c){return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
  function hull(points){const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y),lo=[],hi=[];for(const p of sorted){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}for(const p of [...sorted].reverse()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),p)<=0)hi.pop();hi.push(p);}return lo.slice(0,-1).concat(hi.slice(0,-1));}
  const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  function centroid(points){return{x:points.reduce((n,p)=>n+p.x,0)/points.length,y:points.reduce((n,p)=>n+p.y,0)/points.length};}
  function pointOnEdge(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return mix(a,b,t);}
  function collision(a,b,polygons,inside){
    for(const poly of polygons){
      if(inside(mix(a,b,.001),poly)||inside(mix(a,b,.5),poly)||inside(mix(a,b,.999),poly))return true;
      const rx=b.x-a.x,ry=b.y-a.y;
      for(let i=0;i<poly.length;i++){
        const c=poly[i],d=poly[(i+1)%poly.length],sx=d.x-c.x,sy=d.y-c.y,den=rx*sy-ry*sx;
        if(Math.abs(den)<1e-8)continue;
        const t=((c.x-a.x)*sy-(c.y-a.y)*sx)/den,u=((c.x-a.x)*ry-(c.y-a.y)*rx)/den;
        if(t>.001&&t<.999&&u>=0&&u<=1)return true;
      }
    }return false;
  }
  function makeModel(data,core,graph){
    const places=data.places,buildings=[],assigned=new Set();
    for(const w of data.ways.filter(w=>w.tags.building)){
      const polygon=w.geometry.map(core.project),center=centroid(polygon);
      const place=places.find(p=>p.name===w.tags.name)||places.find(p=>core.inside(core.project(p),polygon));
      if(!place)continue;assigned.add(place.id);
      buildings.push({id:w.id,place,polygon:polygon.slice(0,-1),center,height:place.id==='28'?23:place.category==='life'?18:15,illustrative:false});
    }
    for(const p of places.filter(p=>['study','life'].includes(p.category)&&!assigned.has(p.id))){
      const q=core.project(p),w=p.id==='48'?24:15,h=p.id==='48'?16:10;
      const polygon=[{x:q.x-w,y:q.y-h},{x:q.x+w,y:q.y-h},{x:q.x+w,y:q.y+h},{x:q.x-w,y:q.y+h}];
      buildings.push({id:'symbol-'+p.id,place:p,polygon,center:q,height:13,illustrative:true});
    }
    const campus=data.ways.find(w=>w.tags.amenity==='university');
    const envelope=hull([...campus.geometry.map(core.project),...buildings.flatMap(b=>b.polygon),...places.map(core.project)]);
    const center=centroid(envelope),boundary=envelope.map(p=>{const l=core.distance(p,center);return{x:p.x+(p.x-center.x)/l*22,y:p.y+(p.y-center.y)/l*22};});
    const polygons=buildings.map(b=>b.polygon),links=new Map();
    for(const place of places){
      const building=buildings.find(b=>b.place.id===place.id),q=core.project(place),candidates=[];
      if(building){for(let i=0;i<building.polygon.length;i++){const a=building.polygon[i],b=building.polygon[(i+1)%building.polygon.length];if(core.distance(a,b)<4)continue;for(const t of [.25,.5,.75])candidates.push(mix(a,b,t));}}
      else candidates.push(q);
      let chosen=null;
      for(const anchor of candidates){
        const snap=core.nearestSegment(anchor,graph);if(!snap||snap.gap>85)continue;
        if(collision(anchor,snap.point,polygons,core.inside))continue;
        if(!chosen||snap.gap<chosen.snap.gap)chosen={anchor,snap,place,building};
      }
      if(chosen)links.set(place.id,chosen);
    }
    const green=data.ways.filter(w=>!w.tags.building&&(w.tags.leisure||w.tags.natural==='water')).map(w=>({...w,polygon:w.geometry.map(core.project)})).filter(w=>core.inside(centroid(w.polygon),boundary));
    const trees=[];
    // Symbolic landscaping: deliberately sparse, and never used as route obstacles.
    for(const area of green.filter(w=>w.tags.leisure==='park')){
      const b=core.bounds(area.polygon);for(let y=b.y+10;y<b.y+b.h;y+=23)for(let x=b.x+10;x<b.x+b.w;x+=23){const p={x,y};if(core.inside(p,area.polygon)&&!polygons.some(poly=>core.inside(p,poly))&&core.nearestSegment(p,graph)?.gap>10)trees.push(p);}
    }
    const roads=data.ways.filter(w=>w.tags.highway&&w.geometry.some(g=>core.inside(core.project(g),boundary)));
    return{places,buildings,links,boundary,green,trees,roads,graph};
  }
  function surface(model,core,depth,rotation=0,inclination=.6){
    const P=p=>screen(p,depth,rotation,inclination),S=points=>points.map(P),ground=path(S(model.boundary),true);
    let s=`<defs><clipPath id="campus-clip"><path d="${ground}"/></clipPath><marker id="route-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse"><path d="M2 2 7 5 2 8" fill="none" stroke="white" stroke-width="2"/></marker></defs><path d="${ground}" transform="translate(0 5)" fill="#d2d5d1"/><path d="${ground}" fill="#e2e3df"/>`;
    s+='<g clip-path="url(#campus-clip)" aria-hidden="true">';
    for(const g of model.green){
      const fill=g.tags.natural==='water'?'#b7d9dd':g.tags.leisure==='pitch'?(g.tags.sport==='tennis'?'#8ab3a1':'#c3be91'):g.tags.leisure==='track'?'#d6c6b5':'#c1cea9';
      s+=`<path d="${path(S(g.polygon),true)}" fill="${fill}" stroke="#f9faf7" stroke-width="3"/>`;
      if(g.tags.leisure==='pitch'&&g.polygon.length>=4){
        const pts=g.polygon.slice(0,-1),a=pts[0],b=pts[1],c=pts[2],d=pts[3];
        const center=centroid(pts),inner=pts.map(p=>mix(p,center,.13));
        s+=`<path d="${path(S(inner),true)}" fill="none" stroke="#fffff6" stroke-width=".8"/><path d="${path(S([mix(a,b,.5),mix(d,c,.5)]))}" stroke="#fffff6" stroke-width=".8"/>`;
        const r=Math.min(core.distance(a,b),core.distance(b,c))*.12;
        s+=`<path d="${path(Array.from({length:33},(_,i)=>P({x:center.x+r*Math.cos(i/32*Math.PI*2),y:center.y+r*Math.sin(i/32*Math.PI*2)})),true)}" fill="none" stroke="#fffff6" stroke-width=".8"/>`;
      }
    }
    // Each road uses one continuous centerline. Intersections and route edges share coordinates.
    if(model.roadSegments){for(const road of model.roadSegments)s+=`<path class="campus-road${road.custom?' custom-road':''}" d="${path(S([road.a,road.b]))}" fill="none" stroke="#fff" stroke-width="${road.width}" stroke-linecap="round" stroke-linejoin="round"/>`;}
    else{
      for(const road of model.roads){const foot=['footway','path','steps'].includes(road.tags.highway),w=foot?5:11;s+=`<path class="campus-road" d="${path(S(road.geometry.map(core.project)))}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;}
      for(const link of model.links.values())if(link.snap.gap>1)s+=`<path class="building-approach" data-access="${link.place.id}" d="${path(S([link.anchor,link.snap.point]))}" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    }
    s+='</g>';
    return s;
  }
  function structures(model,core,{depth,selected,rotation=0,inclination=.6}){
    const P=p=>screen(p,depth,rotation,inclination);let s='';
    const items=[...model.buildings.map(b=>({type:'building',y:P(b.center).y,value:b})),...model.trees.map(p=>({type:'tree',y:P(p).y,value:p}))].sort((a,b)=>a.y-b.y);
    for(const item of items){
      if(item.type==='tree'){const p=P(item.value);s+=`<g class="map-tree" aria-hidden="true" transform="translate(${p.x} ${p.y})"><ellipse rx="5" ry="2.2" fill="#7b8969" opacity=".13"/><path d="M0 0v-7" stroke="#8d8267" stroke-width="1.3"/><ellipse cy="-8" rx="4" ry="5" fill="#769977"/><ellipse cx="-2" cy="-10" rx="3" ry="3.8" fill="#88a783"/></g>`;continue;}
      const b=item.value,pts=b.polygon.map(P),height=depth?b.height:0,roof=pts.map(p=>({x:p.x,y:p.y-height})),active=b.place.id===selected;
      s+=`<g class="map-building${active?' selected':''}" data-place="${b.place.id}"><title>${b.place.name}</title><path d="${path(pts.map(p=>({x:p.x+7,y:p.y+5})),true)}" fill="#79827b" opacity=".12"/>`;
      if(depth){
        const faces=pts.map((a,i)=>({a,b:pts[(i+1)%pts.length],i})).sort((a,b)=>(a.a.y+a.b.y)-(b.a.y+b.b.y));
        for(const f of faces){const {a,b:bb}=f;const face=[a,bb,{x:bb.x,y:bb.y-height},{x:a.x,y:a.y-height}],len=Math.hypot(bb.x-a.x,bb.y-a.y);const isLight=bb.x>a.x;
          s+=`<path d="${path(face,true)}" fill="${isLight?'#c1b9ad':'#9ea6a3'}" stroke="#9ca4a0" stroke-width=".35"/>`;
          if(len>7){const columns=Math.min(18,Math.max(2,Math.floor(len/4.8))),rows=height>20?4:3;for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){const ta=(col+.18)/columns,tb=(col+.76)/columns,pa=mix(a,bb,ta),pb=mix(a,bb,tb),y0=3+row*(height-5)/rows,h=(height-5)/rows*.62;s+=`<path class="building-window" d="${path([{x:pa.x,y:pa.y-y0},{x:pb.x,y:pb.y-y0},{x:pb.x,y:pb.y-y0-h},{x:pa.x,y:pa.y-y0-h}],true)}" fill="${isLight?'#b1d1d8':'#89b4bf'}"/>`;}}
        }
      }
      s+=`<path class="roof" d="${path(roof,true)}" fill="${active?'#dcece0':'#fafbf8'}" stroke="${active?'#42795b':'#b7bdb7'}" stroke-width="${active?1.7:.8}"/>`;
      const c=centroid(roof);if(depth&&core.distance(b.polygon[0],b.polygon[1])>20){s+=`<path d="${path(roof.map(p=>mix(p,c,.13)),true)}" fill="none" stroke="#dee3dc" stroke-width=".65"/>`;}
      const access=model.links.get(b.place.id);if(access){const door=P(access.anchor);s+=`<circle class="building-door" cx="${door.x}" cy="${door.y}" r="2.2" fill="${active?'#337d57':'#8ba59c'}" stroke="#fff" stroke-width=".7"/>`;}
      s+='</g>';
    }
    return s;
  }
  return{screen,unproject,path,makeModel,surface,structures,collision};
});
