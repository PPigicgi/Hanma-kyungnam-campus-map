import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const pages = new Set(['index.html', 'mobile.html']);
const scripts = ['data', 'parking-data', 'core', 'scene', 'amenity-models', 'floor-scene',
  'seonghun-plans', 'library', 'road-network', 'final-roads', 'road-editor',
  'building-directory-data', 'building-directory', 'gps-navigation', 'app'];
const styles = ['styles', 'library', 'road-editor', 'building-directory', 'gps-navigation',
  'mobile', 'assistant-link'];
const publicFiles = new Set([...pages, ...scripts.map(x => `${x}.js`), ...styles.map(x => `${x}.css`)]);
const chatFiles = new Set(['/mobile', '/mobile/', '/api/info', '/static/app.js',
  '/static/style.css', '/static/mobile.css', '/static/kyungnam-symbol.png']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const chatPollingScript = `async function campusPublicChat(url, options) {
  let response = await fetch(url, {...options, headers: {...options.headers, Prefer: 'respond-async'}});
  if (response.status !== 202) return response;
  const {ticket} = await response.json();
  if (!/^[a-f0-9]{48}$/.test(ticket)) throw new Error('질문 연결을 확인할 수 없습니다.');
  for (;;) {
    response = await fetch('/api/chat/jobs/' + ticket, {signal: options.signal, cache: 'no-store'});
    if (response.status !== 202) return response;
    await new Promise((resolve, reject) => {
      const signal = options.signal;
      const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, 1500);
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, {once: true});
    });
  }
}\n`;

// The public listener exposes only visitor assets and the two chatbot API routes.
// It never forwards arbitrary paths, browser cookies or authorization headers.
export function createShareServer({ upstreamPort = 8765, upstreamTimeout = 630000,
  minuteLimit = 5, hourLimit = 60, now = Date.now } = {}) {
  let active = false;
  let hourly = [];
  const visitors = new Map();
  const jobs = new Map();
  const server = http.createServer(async (req, res) => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'geolocation=(self)', 'Cache-Control': 'no-store' };
    const send = (status, body, contentType = 'application/json; charset=utf-8', extra = {}) => {
      if (res.destroyed || res.writableEnded) return;
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      res.writeHead(status, { ...headers, 'Content-Type': contentType, 'Content-Length': bytes.length, ...extra });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    const fail = (status, answer, extra) => send(status, { answer }, undefined, extra);
    let pathname;
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) throw new Error('path');
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) throw new Error('path');
    } catch { fail(400, '올바르지 않은 주소입니다.'); return; }

    const host = String(req.headers.host || '');
    if (req.headers['x-forwarded-proto'] === 'http' && /^[a-z0-9-]+\.trycloudflare\.com$/i.test(host)) {
      send(308, '', 'text/plain', { Location: `https://${host}${req.url}` }); return;
    }
    for (const [ticket, job] of jobs) if (job.expires <= now()) jobs.delete(ticket);
    const jobMatch = /^\/api\/chat\/jobs\/([a-f0-9]{48})$/.exec(pathname);
    if (jobMatch) {
      if (req.method !== 'GET') { fail(405, 'GET 요청이 필요합니다.', { Allow: 'GET' }); return; }
      const job = jobs.get(jobMatch[1]);
      if (!job) { fail(404, '답변 보관 시간이 지났습니다. 다시 질문해 주세요.'); return; }
      if (!job.result) send(202, { pending: true });
      else send(job.result.status, job.result.body, job.result.contentType);
      return;
    }
    if (pathname === '/api/chat') {
      if (req.method !== 'POST') { fail(405, 'POST 요청이 필요합니다.', { Allow: 'POST' }); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        fail(415, 'JSON 형식으로 질문을 보내 주세요.'); return;
      }
      if (req.headers.origin) {
        try {
          if (new URL(req.headers.origin).host !== host) throw new Error('origin');
        } catch { fail(403, '한마 화면에서 질문을 보내 주세요.'); return; }
      }
      if (Number(req.headers['content-length'] || 0) > 40960) { fail(413, '질문이 너무 깁니다.'); return; }
      let body;
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 40960) { fail(413, '질문이 너무 깁니다.'); req.resume(); return; }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
        const data = JSON.parse(body.toString('utf8'));
        const validText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
        if (!data || Array.isArray(data) || !validText(data.question) ||
          Object.keys(data).some(key => !['question', 'history', 'as_of'].includes(key)) ||
          (data.history !== undefined && (!Array.isArray(data.history) || data.history.length > 4 || !data.history.every(validText))) ||
          (data.as_of !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(data.as_of))) throw new Error('validation');
      } catch { fail(400, '질문은 1~2,000자, 이전 질문은 최대 4개까지 보낼 수 있습니다.'); return; }
      const time = now();
      // Cloudflare overwrites CF-Connecting-IP at the edge; no caller-controlled first hop.
      const forwarded = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',').at(-1).trim();
      const visitor = isIP(forwarded) ? forwarded : req.socket.remoteAddress;
      for (const [key, times] of visitors) if (times.at(-1) <= time - 60000) visitors.delete(key);
      const recent = (visitors.get(visitor) || []).filter(t => t > time - 60000);
      hourly = hourly.filter(t => t > time - 3600000);
      if (recent.length >= minuteLimit || hourly.length >= hourLimit) {
        const wait = recent.length >= minuteLimit ? 60 : Math.ceil((hourly[0] + 3600000 - time) / 1000);
        fail(429, '공유 AI의 질문 한도에 도달했습니다. 잠시 후 다시 이용해 주세요.', { 'Retry-After': String(wait) }); return;
      }
      if (active) { fail(429, '한마가 다른 질문에 답변 중입니다. 잠시 후 다시 보내 주세요.', { 'Retry-After': '10' }); return; }
      visitors.set(visitor, [...recent, time]);
      hourly.push(time);
      active = true;
      let job;
      if (req.headers.prefer === 'respond-async') {
        const ticket = randomBytes(24).toString('hex');
        job = { expires: Infinity, result: null };
        jobs.set(ticket, job);
        send(202, { ticket });
      }
      // Keep the slot occupied even when the browser closes: its model call can continue.
      await proxy(body, true, job);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { fail(405, '지원하지 않는 요청입니다.', { Allow: 'GET, HEAD' }); return; }
    if (chatFiles.has(pathname)) { await proxy(undefined, false); return; }
    const relative = pathname === '/' ? 'mobile.html' : pathname.slice(1);
    const imageAllowed = /^assets\/(?:\d+\.jpg|kyungnam-symbol\.png|library\/floor(?:B1|[1-578])\.png|seonghun\/floor[1-5]\.svg)$/.test(relative);
    if (!publicFiles.has(relative) && !imageAllowed) { fail(404, '페이지를 찾을 수 없습니다.'); return; }
    try {
      let content = await fs.readFile(path.join(root, relative));
      if (pages.has(relative)) content = Buffer.from(content.toString('utf8').replaceAll('http://127.0.0.1:8765/mobile', '/mobile'));
      const extras = {};
      if (/\.(?:js|css|svg|html)$/.test(relative) && content.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        content = gzipSync(content);
        extras['Content-Encoding'] = 'gzip';
        extras.Vary = 'Accept-Encoding';
      }
      send(200, content, types[path.extname(relative)], extras);
    } catch { fail(404, '파일을 찾을 수 없습니다.'); }

    function proxy(body, isChat, job) {
      return new Promise(resolve => {
        let done = false;
        const deliver = (status, body, contentType = 'application/json; charset=utf-8', extra = {}) => {
          if (job) job.result = { status, body, contentType };
          else send(status, body, contentType, extra);
        };
        const finish = () => { if (!done) { done = true; clearTimeout(timer); if (isChat) active = false; if (job) job.expires = now() + 300000; resolve(); } };
        const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort,
          path: pathname, method: req.method, headers: body ? {
            'Content-Type': 'application/json', 'Content-Length': body.length,
          } : {} }, response => {
          const chunks = [];
          let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > 2097152) upstream.destroy(new Error('response too large'));
            else chunks.push(chunk);
          });
          response.on('end', () => {
            const extra = {};
            if (response.headers['content-security-policy']) extra['Content-Security-Policy'] = response.headers['content-security-policy'];
            let content = Buffer.concat(chunks);
            if (pathname === '/static/app.js' && req.method !== 'HEAD' && response.statusCode === 200) {
              const original = content.toString('utf8');
              if (!original.includes("fetch('/api/chat',")) {
                deliver(503, { answer: '한마 화면의 연결 방식이 변경되었습니다. 공유 연결을 갱신해 주세요.' }); finish(); return;
              }
              content = Buffer.from(chatPollingScript + original.replace("fetch('/api/chat',", "campusPublicChat('/api/chat',"));
            }
            deliver(response.statusCode, content, response.headers['content-type'], extra);
            finish();
          });
          response.on('error', () => { deliver(502, { answer: '한마 연결이 끊어졌습니다. 잠시 후 다시 시도해 주세요.' }); finish(); });
        });
        const timer = setTimeout(() => upstream.destroy(new Error('timeout')), isChat ? upstreamTimeout : 15000);
        upstream.on('error', () => { deliver(503, { answer: '한마 서버에 연결할 수 없습니다. 잠시 후 다시 이용해 주세요.' }); finish(); });
        upstream.end(body);
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createShareServer();
  server.listen(4318, '127.0.0.1', () => console.log('Public campus gateway ready: http://127.0.0.1:4318'));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
