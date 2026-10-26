import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { Arena } from './arena.js';
import {
  CONNECT_MAX_IN_WINDOW,
  CONNECT_WINDOW_MS,
  DT,
  MAX_PAYLOAD,
  MAX_PER_IP,
  MAX_PLAYERS,
  MAX_SOCKETS,
  PROTOCOL,
  SNAP_EVERY,
} from '../shared/constants.js';
import { sanitizeHello } from '../shared/sanitize.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0 && xff.length < 300) {
      const parts = xff.split(',').map((s) => s.trim()).filter((s) => /^[0-9a-fA-F:.]+$/.test(s));
      if (parts.length) return parts[parts.length - 1];
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
}

export function createGameServer(opts = {}) {
  const port = opts.port ?? (Number(process.env.PORT) || 8787);
  const host = opts.host ?? process.env.HOST ?? '0.0.0.0';
  const dev = process.env.DEV === '1';
  const dist = opts.staticRoot || path.resolve('dist');
  const serveStatic = !dev && fs.existsSync(path.join(dist, 'index.html'));
  const fileCache = new Map();
  const arena = opts.arena || new Arena();
  const ipCounts = new Map();
  const connTimes = [];
  const conns = new Map();
  let running = true;
  let timer = null;
  let acc = 0;
  let last = process.hrtime.bigint();

  function sendJson(ws, obj) {
    if (!ws || ws.readyState !== 1) return;
    if (ws.bufferedAmount > 262144) {
      try { ws.close(1008, 'slow'); } catch { /* ignore */ }
      return;
    }
    try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }

  function rejectAndClose(ws, reason) {
    const payload = JSON.stringify({ t: 'reject', reason });
    if (!ws || ws.readyState !== 1) {
      try { ws?.close(1008, String(reason).slice(0, 40)); } catch { /* ignore */ }
      return;
    }
    try {
      ws.send(payload, () => {
        try { ws.close(1008, String(reason).slice(0, 40)); } catch { /* ignore */ }
      });
    } catch {
      try { ws.close(1008, String(reason).slice(0, 40)); } catch { /* ignore */ }
    }
  }

  function readStatic(rel) {
    const hit = fileCache.get(rel);
    if (hit) return hit;
    const file = path.resolve(dist, rel);
    const root = path.resolve(dist);
    const diff = path.relative(root, file);
    if (diff.startsWith('..') || path.isAbsolute(diff)) return null;
    let stat;
    try { stat = fs.statSync(file); } catch { return null; }
    if (!stat.isFile() || stat.size > 6_000_000) return null;
    const buf = fs.readFileSync(file);
    const ext = path.extname(file).toLowerCase();
    const entry = {
      buf,
      type: MIME[ext] || 'application/octet-stream',
      immutable: /[-.][A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(path.basename(file)) && ext !== '.html',
    };
    fileCache.set(rel, entry);
    return entry;
  }

  function handleHttp(req, res) {
    securityHeaders(res);
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let url;
    try { url = new URL(req.url || '/', 'http://127.0.0.1'); } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(method === 'HEAD' ? undefined : 'ok');
      return;
    }
    if (!serveStatic) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(method === 'HEAD' ? undefined : 'not found');
      return;
    }
    let pathname = url.pathname;
    try { pathname = decodeURIComponent(pathname); } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (pathname.includes('\0') || pathname.includes('\\')) {
      res.writeHead(400);
      res.end();
      return;
    }
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (!rel || rel.includes('..')) {
      res.writeHead(403);
      res.end();
      return;
    }
    const entry = readStatic(rel);
    if (!entry) {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end(method === 'HEAD' ? undefined : 'not found');
      return;
    }
    const headers = {
      'Content-Type': entry.type,
      'Cache-Control': entry.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      Vary: 'Accept-Encoding',
    };
    const accept = String(req.headers['accept-encoding'] || '');
    let body = entry.buf;
    if (body.length > 512 && /\bgzip\b/.test(accept)) {
      if (!entry.gz) entry.gz = zlib.gzipSync(body, { level: 6 });
      body = entry.gz;
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(method === 'HEAD' ? undefined : body);
  }

  const httpServer = http.createServer(handleHttp);
  httpServer.requestTimeout = 8000;
  httpServer.headersTimeout = 4000;
  httpServer.keepAliveTimeout = 5000;
  httpServer.on('error', (err) => {
    console.error('http', err.message);
  });

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: MAX_PAYLOAD,
    perMessageDeflate: false,
  });

  function strike(conn) {
    conn.strikes += 1;
    if (conn.strikes >= 8) {
      try { conn.ws.close(1008, 'bad'); } catch { /* ignore */ }
    }
  }

  function releaseIp(ip) {
    const n = ipCounts.get(ip) || 0;
    if (n <= 1) ipCounts.delete(ip);
    else ipCounts.set(ip, n - 1);
  }

  wss.on('connection', (ws, req) => {
    const now = Date.now();
    while (connTimes.length && now - connTimes[0] > CONNECT_WINDOW_MS) connTimes.shift();
    if (connTimes.length >= CONNECT_MAX_IN_WINDOW || conns.size >= MAX_SOCKETS) {
      rejectAndClose(ws, conns.size >= MAX_SOCKETS ? 'full' : 'rate');
      return;
    }
    const ip = clientIp(req);
    const count = ipCounts.get(ip) || 0;
    if (count >= MAX_PER_IP) {
      rejectAndClose(ws, 'ip');
      return;
    }
    connTimes.push(now);
    ipCounts.set(ip, count + 1);
    const conn = {
      ws,
      ip,
      opened: now,
      lastMsg: now,
      playerId: 0,
      strikes: 0,
      bucket: 40,
      bucketAt: now,
      pingN: 0,
      pingAt: 0,
    };
    conns.set(ws, conn);
    ws.on('error', () => {});
    ws.on('close', () => {
      conns.delete(ws);
      releaseIp(ip);
      if (conn.playerId) arena.removePlayer(conn.playerId);
    });
    ws.on('message', (data, isBinary) => {
      if (!conns.has(ws)) return;
      conn.lastMsg = Date.now();
      if (isBinary) { strike(conn); return; }
      const text = typeof data === 'string' ? data : data.toString('utf8');
      if (text.length > MAX_PAYLOAD) { strike(conn); try { ws.close(1009, 'size'); } catch { /* ignore */ } return; }
      const t = Date.now();
      const elapsed = (t - conn.bucketAt) / 1000;
      conn.bucket = Math.min(90, conn.bucket + elapsed * 90);
      conn.bucketAt = t;
      if (conn.bucket < 1) { strike(conn); return; }
      conn.bucket -= 1;
      let msg;
      try { msg = JSON.parse(text); } catch { strike(conn); return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { strike(conn); return; }
      if (!conn.playerId) {
        if (msg.t !== 'hello') { strike(conn); return; }
        if (arena.players.size >= MAX_PLAYERS) { rejectAndClose(ws, 'full'); return; }
        const hello = sanitizeHello(msg);
        if (hello.error) { rejectAndClose(ws, hello.error); return; }
        const player = arena.addPlayer(hello);
        if (player.error) { rejectAndClose(ws, player.error); return; }
        conn.playerId = player.id;
        player.rtt = 0.08;
        sendJson(ws, {
          t: 'welcome',
          v: PROTOCOL,
          id: player.id,
          tick: arena.tickN,
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.yaw,
          hp: player.hp,
          mag: player.mag,
          reserve: player.reserve,
          weapon: player.weapon,
          skin: player.skin,
          roster: arena.roster(),
        });
        return;
      }
      if (msg.t === 'in') {
        const result = arena.pushInput(conn.playerId, msg);
        if (result === 'bad') strike(conn);
        return;
      }
      if (msg.t === 'pong') {
        if (msg.n === conn.pingN && conn.pingAt) {
          const rtt = (Date.now() - conn.pingAt) / 1000;
          const player = arena.players.get(conn.playerId);
          if (player && Number.isFinite(rtt)) player.rtt = Math.min(0.6, Math.max(0, rtt));
        }
        return;
      }
      if (msg.t === 'hb' || msg.t === 'hello') return;
      strike(conn);
    });
  });

  function broadcast() {
    const events = arena.events.length > 80 ? arena.events.slice(-80) : arena.events.slice();
    for (const conn of conns.values()) {
      if (!conn.playerId) continue;
      const snap = arena.buildSnap(conn.playerId);
      if (!snap) continue;
      snap.e = events;
      sendJson(conn.ws, snap);
    }
    arena.events.length = 0;
    arena.fxCount = 0;
  }

  function flushKicks() {
    const kicks = arena.pullKicks();
    for (let i = 0; i < kicks.length; i++) {
      const kick = kicks[i];
      for (const conn of conns.values()) {
        if (conn.playerId === kick.id) {
          sendJson(conn.ws, { t: 'kick', reason: kick.reason });
          try { conn.ws.close(4000, kick.reason); } catch { /* ignore */ }
        }
      }
    }
  }

  function sweep() {
    const now = Date.now();
    for (const conn of conns.values()) {
      if (!conn.playerId && now - conn.opened > 5000) {
        try { conn.ws.close(1008, 'hello'); } catch { /* ignore */ }
        continue;
      }
      if (now - conn.lastMsg > 45000) {
        try { conn.ws.close(1008, 'idle'); } catch { /* ignore */ }
      }
    }
  }

  function pingAll() {
    const n = (arena.tickN & 0xffff) + 1;
    for (const conn of conns.values()) {
      if (!conn.playerId) continue;
      conn.pingN = n;
      conn.pingAt = Date.now();
      sendJson(conn.ws, { t: 'ping', n });
    }
  }

  function loop() {
    if (!running) return;
    const now = process.hrtime.bigint();
    let delta = Number(now - last) / 1e9;
    last = now;
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    if (delta > 0.25) delta = 0.25;
    acc += delta;
    let steps = 0;
    while (acc >= DT && steps < 6) {
      try { arena.step(); } catch (err) { console.error('tick', err); }
      acc -= DT;
      steps += 1;
      if (arena.tickN % SNAP_EVERY === 0) broadcast();
      flushKicks();
      if (arena.tickN % 60 === 0) sweep();
      if (arena.tickN % 120 === 0) pingAll();
    }
    timer = setTimeout(loop, 4);
  }

  function close() {
    if (!running && !timer) return Promise.resolve();
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    for (const ws of wss.clients) {
      try { ws.close(1001, 'shutdown'); } catch { /* ignore */ }
    }
    return new Promise((resolve) => {
      wss.close(() => {
        httpServer.close(() => resolve());
      });
    });
  }

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      loop();
      const address = httpServer.address();
      resolve({
        httpServer,
        wss,
        arena,
        host,
        port: address.port,
        close,
      });
    });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const server = await createGameServer({});
  console.log(`un prompt en http://${server.host}:${server.port}`);
  const stop = () => {
    server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
