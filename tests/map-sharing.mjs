import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createShareServer } from '../map/public-share.mjs';

let calls = 0;
let delay = 0;
let receivedHeaders;
const upstream = http.createServer(async (req, res) => {
  receivedHeaders = req.headers;
  for await (const chunk of req) { /* consume test body */ }
  calls++;
  setTimeout(() => {
    res.setHeader('Content-Type', req.url === '/static/app.js' ? 'text/javascript' : 'application/json');
    res.end(req.url === '/static/app.js' ? "fetch('/api/chat',{});" : JSON.stringify({ answer: 'test answer' }));
  }, delay);
});
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
const gateway = createShareServer({ upstreamPort: upstream.address().port, minuteLimit: 2, hourLimit: 3 });
gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
const base = `http://127.0.0.1:${gateway.address().port}`;
const post = (data = { question: '학교 안내' }, headers = {}) => fetch(base + '/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data),
});
try {
  const home = await fetch(base); const html = await home.text();
  assert.equal(home.status, 200); assert.match(html, /data-mobile-app/);
  assert.match(html, /href="\/mobile"/); assert.ok(!html.includes('127.0.0.1:8765'));
  const assets = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:css|js|png))"/g)].map(x => x[1]);
  for (const asset of assets) assert.equal((await fetch(`${base}/${asset}`)).status, 200, asset);
  console.log('PASS mobile default, same-origin Hanma and all entry assets');
  for (const forbidden of ['/serve.mjs', '/public-share.mjs', '/start-share.ps1', '/public-link.txt',
    '/README.md', '/.env', '/docs', '/openapi.json', '/kyungnam.db', '/assets/seonghun/supplied-plans.html', '/static/../.env']) {
    assert.equal((await fetch(base + forbidden)).status, 404, forbidden);
  }
  assert.equal((await fetch(base + '/%5c..%5c.env')).status, 400);
  console.log('PASS private files, backend docs and traversal unavailable');
  for (const route of ['/mobile', '/mobile/', '/api/info', '/static/app.js', '/static/style.css', '/static/mobile.css', '/static/kyungnam-symbol.png']) {
    assert.equal((await fetch(base + route)).status, 200, route);
  }
  assert.equal((await fetch(base + '/mobile', { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(base + '/api/chat')).status, 405);
  console.log('PASS exact chatbot route/method allowlist');
  assert.equal((await post({ question: '' })).status, 400);
  assert.equal((await post({ question: 'x', unexpected: true })).status, 400);
  assert.equal((await post({ question: 'x', history: ['x','x','x','x','x'] })).status, 400);
  assert.equal((await post({ question: 'x'.repeat(41000) })).status, 413);
  assert.equal((await post(undefined, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(undefined, { Origin: 'https://unrelated.example' })).status, 403);
  console.log('PASS JSON validation, body bound and cross-origin rejection');
  const count = calls;
  const valid = await post(undefined, { Origin: base, Cookie: 'private=test', Authorization: 'Bearer test' });
  assert.equal(valid.status, 200); assert.equal((await valid.json()).answer, 'test answer');
  assert.equal(calls, count + 1); assert.equal(receivedHeaders.cookie, undefined); assert.equal(receivedHeaders.authorization, undefined);
  console.log('PASS chat response and upstream credential stripping');
  delay = 200;
  const pending = post();
  await new Promise(r => setTimeout(r, 35));
  assert.equal((await post(undefined, { 'X-Forwarded-For': '192.0.2.10' })).status, 429);
  assert.equal((await pending).status, 200);
  assert.equal((await post()).status, 429);
  assert.equal((await post(undefined, { 'X-Forwarded-For': '192.0.2.11' })).status, 200);
  assert.equal((await post(undefined, { 'X-Forwarded-For': '192.0.2.12' })).status, 429);
  console.log('PASS active question exclusion, per-visitor and global rate limits');
} finally { gateway.closeAllConnections(); gateway.close(); }

let time = Date.now();
const asyncGateway = createShareServer({ upstreamPort: upstream.address().port, now:()=>time });
asyncGateway.listen(0,'127.0.0.1'); await once(asyncGateway,'listening');
const asyncBase = `http://127.0.0.1:${asyncGateway.address().port}`;
try {
  const script=await (await fetch(asyncBase+'/static/app.js')).text();
  assert.match(script,/function campusPublicChat/); assert.match(script,/respond-async/);
  const response=await fetch(asyncBase+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'respond-async'},body:JSON.stringify({question:'test async'})});
  assert.equal(response.status,202); const {ticket}=await response.json(); assert.match(ticket,/^[a-f0-9]{48}$/);
  const jobUrl=asyncBase+'/api/chat/jobs/'+ticket;
  assert.equal((await fetch(jobUrl)).status,202);
  assert.equal((await fetch(jobUrl,{method:'DELETE'})).status,405);
  assert.equal((await fetch(asyncBase+'/api/chat/jobs/'+'0'.repeat(48))).status,404);
  const previous=calls;
  await new Promise(r=>setTimeout(r,250));
  const completed=await fetch(jobUrl); assert.equal(completed.status,200); assert.equal((await completed.json()).answer,'test answer');
  assert.equal(calls,previous);
  time+=300001; assert.equal((await fetch(jobUrl)).status,404);
  console.log('PASS async acceptance/pending/result, opaque ticket, no repeat inference, five-minute expiry and polling script');
} finally { asyncGateway.closeAllConnections(); asyncGateway.close(); }

const disconnected = createShareServer({ upstreamPort: upstream.address().port });
disconnected.listen(0, '127.0.0.1'); await once(disconnected, 'listening');
const port = disconnected.address().port;
try {
  const abandoned = http.request({ hostname:'127.0.0.1',port,path:'/api/chat',method:'POST',headers:{'Content-Type':'application/json'} });
  abandoned.on('error',()=>{}); abandoned.end(JSON.stringify({question:'test disconnect'}));
  await new Promise(r=>setTimeout(r,45)); abandoned.destroy();
  const busy = await fetch(`http://127.0.0.1:${port}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'second'})});
  assert.equal(busy.status,429);
  await new Promise(r=>setTimeout(r,200));
  upstream.closeAllConnections(); await new Promise(r=>upstream.close(r));
  const unavailable=await fetch(`http://127.0.0.1:${port}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'server down'})});
  assert.equal(unavailable.status,503); assert.ok((await unavailable.json()).answer);
  console.log('PASS disconnected browser keeps model slot; backend outage returns readable error');
} finally { disconnected.closeAllConnections(); disconnected.close(); }
