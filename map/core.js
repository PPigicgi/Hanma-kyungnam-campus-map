(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CampusCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const angle = -25 * Math.PI / 180;
  function project(p) {
    const x = (p.lon - 128.554) * 111320 * Math.cos(35.1816 * Math.PI / 180);
    const y = (35.1816 - p.lat) * 111320;
    return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) };
  }
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function inside(point, polygon) {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
    }
    return result;
  }
  function createGraph(ways, projectPoint = project) {
    const nodes = new Map(), edges = [], adjacency = new Map();
    const allowed = new Set(['footway', 'path', 'pedestrian', 'steps', 'service', 'residential', 'living_street', 'unclassified', 'track']);
    for (const way of ways) {
      const t = way.tags;
      if (!allowed.has(t.highway) || t.area === 'yes' || ['no', 'private'].includes(t.foot) || (['private', 'no'].includes(t.access) && !['yes', 'designated', 'permissive'].includes(t.foot))) continue;
      way.nodes.forEach((id, i) => { if (!nodes.has(id)) { nodes.set(id, projectPoint(way.geometry[i])); adjacency.set(id, []); } });
      for (let i = 1; i < way.nodes.length; i++) {
        const a = way.nodes[i - 1], b = way.nodes[i], length = distance(nodes.get(a), nodes.get(b));
        if (length < 0.01) continue;
        const edge = { a, b, length, way: way.id, type: t.highway, name: t.name || (t.highway === 'steps' ? '계단' : '교내 연결로') };
        edges.push(edge); adjacency.get(a).push({ id: b, cost: length }); adjacency.get(b).push({ id: a, cost: length });
      }
    }
    const components=new Map();let componentCount=0;
    for(const id of nodes.keys()){
      if(components.has(id))continue;
      const queue=[id];components.set(id,componentCount);
      for(let i=0;i<queue.length;i++)for(const next of adjacency.get(queue[i]))if(!components.has(next.id)){components.set(next.id,componentCount);queue.push(next.id);}
      componentCount++;
    }
    return { nodes, edges, adjacency, components, componentCount };
  }
  function nearestSegment(point, graph) {
    let best = null;
    graph.edges.forEach((edge, index) => {
      const a = graph.nodes.get(edge.a), b = graph.nodes.get(edge.b);
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / edge.length ** 2));
      const snapped = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      const gap = distance(point, snapped);
      if (!best || gap < best.gap) best = { index, edge, point: snapped, gap, t };
    });
    return best;
  }
  function route(graph, from, to, entrances) {
    if (from.id === to.id) return { error: '출발지와 도착지를 다르게 선택해 주세요.' };
    if (distance(project(from), project(to)) < 1) return { error: '두 장소가 같은 위치에 등록되어 있습니다. 다른 출발지나 도착지를 선택해 주세요.' };
    const fromAccess = entrances?.get(from.id), toAccess = entrances?.get(to.id);
    if (entrances && (!fromAccess || !toAccess)) return { error: '이 장소의 연결로가 끊겨 있습니다. 다른 출발지나 도착지를 선택해 주세요.' };
    const start = fromAccess?.snap || nearestSegment(project(from), graph), end = toAccess?.snap || nearestSegment(project(to), graph);
    if (!start || !end || start.gap > 85 || end.gap > 85) return { error: '가까운 연결로를 찾을 수 없습니다. 다른 출발지나 도착지를 선택해 주세요.' };
    if(graph.components&&graph.components.get(start.edge.a)!==graph.components.get(end.edge.a))return {error:'현재 도로망에서 두 장소를 연결할 수 없습니다. 다른 출발지나 도착지를 선택해 주세요.'};
    const adjacency = new Map([...graph.adjacency].map(([id, neighbors]) => [id, [...neighbors]]));
    const points = new Map(graph.nodes);
    const startKey=Symbol('route-start'),endKey=Symbol('route-end');
    const connect = (a, b, cost) => { adjacency.get(a).push({ id: b, cost }); adjacency.get(b).push({ id: a, cost }); };
    for (const [id, snap] of [[startKey, start], [endKey, end]]) {
      points.set(id, snap.point); adjacency.set(id, []);
      connect(id, snap.edge.a, snap.t * snap.edge.length);
      connect(id, snap.edge.b, (1 - snap.t) * snap.edge.length);
    }
    if (start.index === end.index) connect(startKey, endKey, distance(start.point, end.point));
    // A* with an admissible straight-line heuristic; the objective stays metres.
    // Binary heap avoids scanning the whole frontier. Stale entries are discarded.
    const costs = new Map([[startKey, 0]]), previous = new Map(), heap=[], visited = new Set();let sequence=0,expanded=0;
    const less=(a,b)=>a.priority<b.priority||(a.priority===b.priority&&a.sequence<b.sequence);
    function push(id,cost){const item={id,cost,priority:cost+distance(points.get(id),end.point),sequence:sequence++};let i=heap.length;heap.push(item);while(i>0){const parent=(i-1)>>1;if(!less(item,heap[parent]))break;heap[i]=heap[parent];i=parent;}heap[i]=item;}
    function pop(){const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&less(heap[child+1],heap[child]))child++;if(!less(heap[child],last))break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;}
    push(startKey,0);
    while (heap.length) {
      const entry=pop(),current=entry.id;
      if(entry.cost!==costs.get(current)||visited.has(current))continue;
      expanded++;if(current===endKey)break;visited.add(current);
      for (const next of adjacency.get(current)) {
        if (visited.has(next.id)) continue;
        const cost = costs.get(current) + next.cost;
        if (cost < (costs.get(next.id) ?? Infinity)) { costs.set(next.id, cost); previous.set(next.id, current); push(next.id,cost); }
      }
    }
    if (!costs.has(endKey)) return { error: '현재 도로망에서 두 장소를 연결할 수 없습니다. 다른 출발지나 도착지를 선택해 주세요.' };
    const ids = [endKey]; while (ids.at(-1) !== startKey) ids.push(previous.get(ids.at(-1)));ids.reverse();
    return { points: ids.map(id => points.get(id)), length: costs.get(endKey), start, end, from, to, fromAnchor: fromAccess?.anchor || project(from), toAnchor: toAccess?.anchor || project(to), fromAccess: !!fromAccess, toAccess: !!toAccess, algorithm:'astar',expanded };
  }
  function bounds(points, padding = 0) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x = Math.min(...xs) - padding, y = Math.min(...ys) - padding;
    return { x, y, w: Math.max(...xs) - x + padding, h: Math.max(...ys) - y + padding };
  }
  return { project, distance, inside, createGraph, route, bounds, nearestSegment };
});
