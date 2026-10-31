const assert = require('node:assert/strict');
const c = require('../map/core.js');
const data = require('../map/campus-data.json');
const p = id => data.places.find(p=>p.id===id);
const graph = c.createGraph(data.ways);
const results=[];
function check(name,run){run();results.push(name);}
check('Official places have unique ids, finite coordinates, and an official source URL',()=>{assert.equal(new Set(data.places.map(p=>p.id)).size,43);data.places.forEach(p=>{assert(Number.isFinite(p.lat)&&Number.isFinite(p.lon));assert(p.source.startsWith('https://www.kyungnam.ac.kr/'));});});
check('Gate to library follows graph and preserves unverified connector gap separately',()=>{const r=c.route(graph,p('6'),p('28'));assert(!r.error);assert(r.length>400&&r.length<650);assert(r.end.gap>20&&r.end.gap<50);assert(Math.abs(r.length-r.points.slice(1).reduce((n,v,i)=>n+c.distance(r.points[i],v),0))<.001);});
check('Round trip distances are symmetric for a pedestrian graph',()=>{const a=c.route(graph,p('28'),p('16')),b=c.route(graph,p('16'),p('28'));assert(!a.error&&!b.error);assert(Math.abs(a.length-b.length)<.001);});
check('Identical and colocated destinations are rejected',()=>{assert(c.route(graph,p('6'),p('6')).error);assert(c.route(graph,p('6'),p('7')).error);});
check('Missing nearby road data is an error, not an invented path',()=>{assert(c.route(graph,{id:'far',lat:36,lon:129},p('28')).error);});
const geometry=[{lat:35.181,lon:128.554},{lat:35.181,lon:128.555}];
const way=(tags,nodes=['a','b'],geo=geometry)=>({id:nodes.join(''),tags,nodes,geometry:geo});
check('Private and forbidden roads do not enter the walking graph',()=>{for(const tags of [{highway:'service',access:'private'},{highway:'footway',foot:'no'},{highway:'motorway'},{highway:'service',foot:'private',access:'yes'}])assert.equal(c.createGraph([way(tags)]).edges.length,0);assert.equal(c.createGraph([way({highway:'service',access:'private',foot:'yes'})]).edges.length,1);});
check('Same-segment route does not detour through an endpoint',()=>{const g=c.createGraph([way({highway:'footway'})]);const r=c.route(g,{id:'s',lat:35.181,lon:128.5542},{id:'t',lat:35.181,lon:128.5548});assert(!r.error);assert(r.length>50&&r.length<60);});
check('Disconnected graph reports an explicit failure',()=>{const g=c.createGraph([way({highway:'footway'}),way({highway:'footway'},['c','d'],geometry.map(p=>({...p,lat:p.lat+.002})))]);assert(c.route(g,{id:'s',...geometry[0]},{id:'t',...geometry[1],lat:geometry[1].lat+.002}).error);});
check('Local photo references exist and remain inside the asset directory',()=>{const fs=require('fs'),path=require('path');for(const p of data.places.filter(p=>p.photo)){assert(/^assets\/\d+\.jpg$/.test(p.photo));assert(fs.statSync(path.join(__dirname,'../map',p.photo)).size>0);}});
console.log(JSON.stringify({passed:results.length,results},null,2));
