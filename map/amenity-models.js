/* Procedural XYZ meshes for the library's original stair/elevator footprints.
   Details and heights are illustrative. No live elevator state is represented. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LibraryAmenityModels=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const EPS=1e-6,cache=new WeakMap(),layerCache=new WeakMap();
  const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),scale=(a,t)=>a.map(v=>v*t),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>scale(a,1/Math.hypot(...a));
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function face(vertices,color,part,model){return {vertices,color,part,model,normal:unit(cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])))};}
  const cubeFaces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
  function prism(out,vertices,color,part,id){for(const indices of cubeFaces)out.push(face(indices.map(i=>vertices[i]),color,part,id));}
  function box(out,x0,y0,z0,x1,y1,z1,color,part,id){prism(out,[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],color,part,id);}
  function beam(out,a,b,width,color,part,id){
    const direction=unit(sub(b,a)),u=scale(unit(cross(direction,Math.abs(direction[2])>.9?[0,1,0]:[0,0,1])),width/2),v=scale(unit(cross(direction,u)),width/2);
    const corners=p=>[sub(sub(p,u),v),sub(add(p,u),v),add(add(p,u),v),add(sub(p,u),v)];
    prism(out,[...corners(a),...corners(b)],color,part,id);
  }
  function front(out,x0,x1,y,z0,z1,color,part,id){out.push(face([[x1,y,z0],[x0,y,z0],[x0,y,z1],[x1,y,z1]],color,part,id));}
  function stairMesh(bounds,base,id){
    const {x,y,w,h}=bounds,out=[],pad=1.8,x0=x+pad,x1=x+w-pad,y0=y+pad,y1=y+h-pad;
    const width=x1-x0,gap=Math.max(1.3,width*.10),flight=(width-gap)/2,landing=Math.min((y1-y0)*.18,5),count=7,run=(y1-y0-landing)/count,rise=Math.min(22,Math.max(16,width*.9))/(count*2),half=rise*count,right=x1-flight;
    const tread='#dce3e5',rail='#7f98a7';
    for(let i=0;i<count;i++){
      const a=y1-(i+1)*run,b=y1-i*run,z=base+(i+1)*rise;
      box(out,x0,a,base,x0+flight,b,z,tread,'lower-step',id);
      out.push(face([[x0+.3,b-.65,z+.025],[x0+flight-.3,b-.65,z+.025],[x0+flight-.3,b-.15,z+.025],[x0+.3,b-.15,z+.025]],'#b99e6f','step-nosing',id));
      const c=y0+landing+i*run,d=c+run,upper=base+half+(i+1)*rise;
      box(out,right,c,base,right+flight,d,upper,tread,'upper-step',id);
      out.push(face([[right+.3,c+.15,upper+.025],[right+flight-.3,c+.15,upper+.025],[right+flight-.3,c+.65,upper+.025],[right+.3,c+.65,upper+.025]],'#b99e6f','step-nosing',id));
    }
    box(out,x0,y0,base,x1,y0+landing,base+half,tread,'landing',id);
    function railing(xPosition,upper){const posts=[];for(const i of [0,3,6]){
      const yy=upper?y0+landing+(i+.5)*run:y1-(i+.5)*run,zz=base+(upper?half:0)+(i+1)*rise;
      const top=[xPosition,yy,zz+5.4];beam(out,[xPosition,yy,zz],top,.55,rail,'rail-post',id);posts.push(top);
    }beam(out,posts[0],posts.at(-1),.8,rail,'handrail',id);}
    railing(x0+.55,false);railing(x1-.55,true);railing(right+.45,true);
    const a=[x0+.55,y0+.65,base+half+5.4],b=[x1-.55,y0+.65,base+half+5.4];
    beam(out,[a[0],a[1],base+half],a,.55,rail,'rail-post',id);beam(out,[b[0],b[1],base+half],b,.55,rail,'rail-post',id);beam(out,a,b,.8,rail,'landing-rail',id);
    return out;
  }
  function elevatorMesh(bounds,base,id){
    const {x,y,w,h}=bounds,out=[],x0=x+1.4,x1=x+w-1.4,y0=y+1.4,y1=y+h-1.4,height=Math.min(31,Math.max(25,w*.88)),top=base+height;
    box(out,x0,y0,base,x1,y1,top,'#b5c4cc','elevator-body',id);
    box(out,x0-.3,y0-.3,top-.8,x1+.3,y1+.3,top+.5,'#dbe4e8','elevator-canopy',id);
    const left=x0+(x1-x0)*.10,right=x0+(x1-x0)*.79,doorTop=base+height*.79,middle=(left+right)/2;
    front(out,left,right,y1+.03,base+.6,doorTop,'#374d5c','door-recess',id);
    front(out,left+.65,middle-.16,y1+.08,base+.95,doorTop-.65,'#c9d7de','left-door',id);
    front(out,middle+.16,right-.65,y1+.08,base+.95,doorTop-.65,'#a9beca','right-door',id);
    front(out,left+1.1,left+1.65,y1+.10,base+1.4,doorTop-1.1,'#e5edf0','door-highlight',id);
    front(out,middle+.75,middle+1.12,y1+.10,base+1.4,doorTop-1.1,'#d9e4e9','door-highlight',id);
    box(out,left-.7,y1-.5,base,right+.7,y1+.4,base+.65,'#788e9b','threshold',id);
    box(out,left-.7,y1-.5,base,left+.1,y1+.3,doorTop+.8,'#e0e7e9','door-frame',id);
    box(out,right-.1,y1-.5,base,right+.7,y1+.3,doorTop+.8,'#e0e7e9','door-frame',id);
    box(out,left-.7,y1-.5,doorTop,right+.7,y1+.3,doorTop+.9,'#e0e7e9','door-frame',id);
    front(out,middle-3.6,middle+3.6,y1+.06,top-4.5,top-1.6,'#243e49','indicator-panel',id);
    out.push(face([[middle+1.3,y1+.09,top-3.7],[middle-1.3,y1+.09,top-3.7],[middle,y1+.09,top-2.1]],'#8fc2ab','indicator-arrow',id));
    const call=x0+(x1-x0)*.90,callZ=base+height*.44;
    front(out,call-.9,call+.9,y1+.05,callZ-1.8,callZ+2.2,'#5f7787','call-panel',id);
    out.push(face(Array.from({length:10},(_,i)=>{const angle=i/10*Math.PI*2;return [call+Math.cos(angle)*.52,y1+.09,callZ-Math.sin(angle)*.52];}),'#cbdde3','call-button',id));
    return out;
  }
  function classify(face,plane){let front=false,back=false;for(const p of face.vertices){const d=dot(plane.normal,p)-plane.w;if(d>EPS)front=true;if(d<-EPS)back=true;}return front?(back?3:1):back?2:0;}
  function planeOf(face){return {normal:face.normal,w:dot(face.normal,face.vertices[0])};}
  function choosePlane(faces){let best,score=Infinity;const candidates=Math.min(9,faces.length);
    for(let i=0;i<candidates;i++){const plane=planeOf(faces[Math.floor(i*(faces.length-1)/Math.max(1,candidates-1))]);let f=0,b=0,s=0;
      for(const face of faces){const type=classify(face,plane);if(type===1)f++;else if(type===2)b++;else if(type===3)s++;}
      const cost=s*5+Math.abs(f-b);if(cost<score){score=cost;best=plane;}
    }return best;
  }
  function compact(vertices){return vertices.filter((p,i)=>Math.hypot(...sub(p,vertices[(i+vertices.length-1)%vertices.length]))>EPS);}
  function buildTree(faces){
    if(!faces.length)return null;const plane=choosePlane(faces),same=[],front=[],back=[];
    for(const f of faces){const type=classify(f,plane);if(type===0)same.push(f);else if(type===1)front.push(f);else if(type===2)back.push(f);else{
      const a=[],b=[];for(let i=0;i<f.vertices.length;i++){
        const p=f.vertices[i],q=f.vertices[(i+1)%f.vertices.length],dp=dot(plane.normal,p)-plane.w,dq=dot(plane.normal,q)-plane.w;
        if(dp>=-EPS)a.push(p);if(dp<=EPS)b.push(p);
        if((dp>EPS&&dq<-EPS)||(dp<-EPS&&dq>EPS)){const at=add(p,scale(sub(q,p),dp/(dp-dq)));a.push(at);b.push(at);}
      }
      const av=compact(a),bv=compact(b);if(av.length>=3)front.push({...f,vertices:av});if(bv.length>=3)back.push({...f,vertices:bv});
    }}
    return {plane,faces:same,front:buildTree(front),back:buildTree(back)};
  }
  function orderedFaces(tree,view,out=[]){if(!tree)return out;const front=dot(tree.plane.normal,view)>=0;
    orderedFaces(front?tree.back:tree.front,view,out);
    for(const face of tree.faces)if(dot(face.normal,view)>EPS)out.push(face);
    orderedFaces(front?tree.front:tree.back,view,out);return out;
  }
  function splitAtHeight(f,height){
    const zs=f.vertices.map(p=>p[2]);
    if(Math.min(...zs)>=height-EPS)return {upper:[f],lower:[]};
    if(Math.max(...zs)<=height+EPS)return {upper:[],lower:[f]};
    const lower=[],upper=[];
    for(let i=0;i<f.vertices.length;i++){const a=f.vertices[i],b=f.vertices[(i+1)%f.vertices.length],da=a[2]-height,db=b[2]-height;
      if(da<=EPS)lower.push(a);if(da>=-EPS)upper.push(a);
      if(da*db<-EPS*EPS){const at=add(a,scale(sub(b,a),da/(da-db)));lower.push(at);upper.push(at);}
    }
    return {lower:[{...f,vertices:compact(lower)}],upper:[{...f,vertices:compact(upper)}]};
  }
  function layers(floor,walls,height){
    const previous=layerCache.get(floor);if(previous?.walls===walls&&previous.height===height)return previous;
    const scene=get(floor),parts=scene.faces.map(f=>splitAtHeight(f,height));
    const result={walls,height,lower:buildTree([...walls,...parts.flatMap(p=>p.lower)]),upper:buildTree(parts.flatMap(p=>p.upper))};
    layerCache.set(floor,result);return result;
  }
  function get(floor,baseHeight=0){
    const previous=cache.get(floor);if(previous?.baseHeight===baseHeight)return previous;
    const models=[];floor.amenities.forEach((a,i)=>{if(!['stairs','lift'].includes(a.kind))return;
      const xs=a.polygon.map(p=>p[0]),ys=a.polygon.map(p=>p[1]),bounds={x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)},id='amenity-'+i;
      models.push({id,kind:a.kind,name:a.name,bounds,faces:(a.kind==='stairs'?stairMesh:elevatorMesh)(bounds,baseHeight,id)});
    });
    const faces=models.flatMap(m=>m.faces),value={baseHeight,models,faces,tree:buildTree(faces)};cache.set(floor,value);return value;
  }
  function viewVector(project){const origin=project([0,0]),x=project([1,0]),y=project([0,1]),a=x.x-origin.x,b=y.x-origin.x,c=x.y-origin.y,d=y.y-origin.y;return unit([-b,a,a*d-b*c]);}
  function projectVertex(p,project){const q=project(p);return {x:q.x,y:q.y-p[2]};}
  function points(floor,project,height=0){return get(floor,height).faces.flatMap(f=>f.vertices.map(p=>projectVertex(p,project)));}
  function shade(color,normal){const light=.72+.28*Math.max(0,dot(normal,unit([-.35,.4,1])));return '#'+[1,3,5].map(i=>Math.round(parseInt(color.slice(i,i+2),16)*light).toString(16).padStart(2,'0')).join('');}
  function renderFace(f,project){
    const projected=f.vertices.map(p=>projectVertex(p,project)),d=projected.map((p,i)=>(i?'L':'M')+p.x.toFixed(3)+' '+p.y.toFixed(3)).join(' ')+'Z',fill=shade(f.color,f.normal);
    return '<path class="amenity-model-face" data-model="'+f.model+'" data-part="'+f.part+'" d="'+d+'" fill="'+fill+'" stroke="'+fill+'"/>';
  }
  function descriptions(floor,height=0){return get(floor,height).models.map(model=>'<g class="amenity-model-description" data-model-kind="'+model.kind+'" data-base-elevation="'+height+'" aria-hidden="true"><title>'+escape(model.name)+' · 안내용 입체 모형</title></g>').join('');}
  function render(floor,project,height=0){
    const scene=get(floor,height),faces=orderedFaces(scene.tree,viewVector(project));
    let html='<g class="floor-amenity-models" role="img" aria-label="계단과 엘리베이터 입체 모형"><title>발판·난간이 있는 계단과 문·호출 버튼이 있는 엘리베이터</title>';
    for(const f of faces)html+=renderFace(f,project);
    html+=descriptions(floor,height);
    return html+'</g>';
  }
  return {get,render,points,viewVector,projectVertex,buildTree,orderedFaces,splitAtHeight,layers,renderFace,descriptions};
});
