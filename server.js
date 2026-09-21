'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

function createServer(rootDir) {
  rootDir = rootDir || __dirname;
  return http.createServer((req, res) => {
    try {
      handleRequest(req, res, rootDir);
    } catch (e) {
      // qualquer excecao num handler nao pode derrubar a app
      try {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('erro interno: ' + (e && e.message));
      } catch (e2) {}
    }
  });
}

function handleRequest(req, res, rootDir) {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/sources') {
      handleSources(req, res);
      return;
    }
    if (u.pathname === '/proto') {
      // O frontend reporta o veredicto de protocolo descoberto por host;
      // fica memorizado no mesmo mapa usado pelo proxy.
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1024) req.destroy(); });
      req.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j && j.host) hostProto[String(j.host)] = (j.proto === 'https-ok') ? 'https-ok' : 'http-only';
        } catch (e) {}
        res.writeHead(204);
        res.end();
      });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, If-Range, Content-Type'
      });
      res.end();
      return;
    }
    if (u.pathname === '/proxy') {
      // Pedido ao proprio servidor (deteccao do modo proxy): responder
      // direto do disco, sem fila nem maquinaria de proxy.
      const t = u.searchParams.get('url');
      let selfHit = false;
      if (t) {
        try {
          const tu = new URL(t);
          const reqHost = (req.headers.host || '').split(':')[0];
          selfHit = tu.hostname === reqHost || tu.hostname === '127.0.0.1' || tu.hostname === 'localhost';
        } catch (e) {}
      }
      if (selfHit) {
        serveStatic(rootDir, new URL(t).pathname, req, res);
        return;
      }
      handleProxy(req, res, u);
      return;
    }
    serveStatic(rootDir, u.pathname, req, res);
}

function serveStatic(rootDir, pathname, req, res) {
  let p = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(rootDir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(rootDir)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nao encontrado');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

/* ---------- persistencia de fontes (independente da porta/origem) ---------- */
function sourcesFile() { return path.join(__dirname, 'sources.json'); }
function handleSources(req, res) {
  const file = sourcesFile();
  if (req.method === 'POST' || req.method === 'PUT') {
    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) { res.writeHead(413); res.end('too large'); return; }
      try {
        const arr = JSON.parse(body);
        if (!Array.isArray(arr)) throw new Error('array esperado');
        fs.writeFile(file, JSON.stringify(arr, null, 2), () => {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON invalido' }));
      }
    });
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('null');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function handleProxy(req, res, u) {
  const target = u.searchParams.get('url');
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'falta ?url=' }));
    return;
  }
  const headers = {
    'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
    'Accept-Encoding': 'identity',
    'Connection': 'close'
  };
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
  // Fila SO para a API pequena do painel (player_api.php sem action grande):
  // backends de painel arrastam-se com pedidos concorrentes de API. Listas
  // m3u (get.php), streams, segmentos e logos vao DIRETOS — o m3u de 38 MB
  // chegou a ocupar o unico slot durante minutos e prendia tudo o resto.
  const IS_PANEL_EP = /player_api\.php|get\.php/i.test(target);
  const BIG_RE = /action=(get_vod_streams|get_series|get_live_streams|get_vod_info|get_short_data)/i;
  const isSmallApi = /player_api\.php/i.test(target) && !BIG_RE.test(target) && !/get\.php/i.test(target);
  if (IS_PANEL_EP && isSmallApi) {
    withHostSlot(u.hostname, (release) => fetchWithRedirects(target, headers, 0, res, undefined, release, 45000), false);
  } else {
    // streams/logos: 1 tentativa com timeout curto (10s) — backends mortos
    // falham rapido; o player e que tem o ciclo proprio de retries
    fetchWithRedirects(target, headers, 0, res, 1, undefined, 10000);
  }
}

function withHostSlot(hostname, fn, front) {
  const q = hostQueues[hostname] || (hostQueues[hostname] = { active: 0, wait: [] });
  const run = (f) => {
    if (!f) return;
    if (q.active >= MAX_PER_HOST) {
      if (front) q.wait.unshift(f); else q.wait.push(f);
      return;
    }
    q.active++;
    let released = false;
    f(() => {
      if (released) return;
      released = true;
      q.active--;
      const next = q.wait.shift();
      if (next) setTimeout(() => run(next), 250); // pequena pausa entre pedidos
    });
  };
  run(fn);
}
const hostQueues = {};
// Paineis Xtream tipicos so respondem a UM pedido de cada vez por conta:
// pedidos concorrentes ficam sem resposta (hang silencioso). Serializar.
const MAX_PER_HOST = 1;

/* ---------- reescrita de playlists HLS ---------- */
// Os segmentos de uma playlist m3u8 vao com URLs relativas ao backend;
// pelo proxy, o browser resolveria contra 127.0.0.1:8096 e falharia.
// Reescreve cada URI para /proxy?url=<absoluta>.
function proxify(u, base) {
  try { return '/proxy?url=' + encodeURIComponent(new URL(u, base).toString()); }
  catch (e) { return u; }
}
function rewriteM3u8(body, baseUrl) {
  return body.split(/\r?\n/).map(line => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + proxify(u, baseUrl) + '"');
    return proxify(t, baseUrl);
  }).join('\n');
}

// Veredicto por host sobre o protocolo: paineis com HTTPS morto (handshake
// que falha sempre) vao logo por HTTP, sem queimar tempo em tentativas https.
const hostProto = {};

function fetchWithRedirects(target, headers, depth, res, connectAttempts, done, timeoutMs) {
  const attempts = connectAttempts === undefined ? 3 : connectAttempts;
  const finish = done || (() => {});
  const sockTimeout = timeoutMs || 45000;
  let url;
  try {
    url = new URL(target);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'URL invalida' }));
    return;
  }
  if (url.protocol === 'https:' && hostProto[url.hostname] === 'http-only') {
    target = target.replace(/^https:/i, 'http:');
    url = new URL(target);
  }
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? require('https') : require('http');
  // Muitos paineis Xtream recusam HTTPS no mesmo host/porta do HTTP:
  // enviar Referer http:// ajuda o painel a responder.
  if (isHttps) headers['Referer'] = 'http://' + url.host + '/';
  const opts = {
    method: 'GET',
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    headers: headers
  };
  const firstHttpsProbe = isHttps && depth === 0 && attempts >= 3;
  const req = lib.request(opts, (resp) => {
    settled = true; // resposta a chegar: timeout de socket ja nao mata o body
    if (isHttps && depth === 0) hostProto[url.hostname] = 'https-ok';
    if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
      resp.resume();
      if (depth >= 5) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'demasiados redirects' }));
        return;
      }
      const next = new URL(resp.headers.location, target).toString();
      fetchWithRedirects(next, headers, depth + 1, res, undefined, finish);
      return;
    }
    const out = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range, If-Range',
      'Content-Type': resp.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    };
    if (resp.headers['content-length']) out['Content-Length'] = resp.headers['content-length'];
    if (resp.headers['content-range']) out['Content-Range'] = resp.headers['content-range'];
    if (resp.headers['accept-ranges']) out['Accept-Ranges'] = resp.headers['accept-ranges'];
    if (resp.headers['transfer-encoding']) out['Transfer-Encoding'] = resp.headers['transfer-encoding'];
    // playlist HLS: acumular, reescrever URIs para o proxy e devolver
    const ct = String(resp.headers['content-type'] || '').toLowerCase();
    if (ct.includes('mpegurl') || ct.includes('/m3u') || /\.m3u8?$/i.test(url.pathname)) {
      const chunks = [];
      let size = 0, aborted = false;
      resp.on('data', (c) => {
        size += c.length;
        if (size > 3 * 1024 * 1024) { aborted = true; resp.destroy(); return; }
        chunks.push(c);
      });
      resp.on('end', () => {
        if (aborted) { finish(); if (!res.headersSent) { res.writeHead(502); res.end('playlist demasiado grande'); } return; }
        const body = Buffer.concat(chunks).toString('utf8');
        const rewritten = rewriteM3u8(body, target);
        const buf = Buffer.from(rewritten, 'utf8');
        out['Content-Type'] = 'application/vnd.apple.mpegurl';
        out['Content-Length'] = buf.length;
        delete out['Transfer-Encoding'];
        res.writeHead(resp.statusCode, out);
        res.end(buf);
        finish();
      });
      resp.on('error', () => { finish(); res.destroy(); });
      res.on('close', () => { finish(); if (!res.writableFinished) { try { resp.destroy(); } catch (e) {} } });
      return;
    }
    res.writeHead(resp.statusCode, out);
    resp.pipe(res);
    resp.on('error', () => { finish(); res.destroy(); });
    res.on('close', () => {
      finish(); // liberta o slot em qualquer fim (ok, abort, erro)
      // cliente abortou a meio: parar tambem a descarga a montante,
      // senao fica um pedido orfao a ocupar o painel (que so serve um de cada vez)
      if (!res.writableFinished) { try { req.destroy(); } catch (e) {} }
    });
  });
  let connected = false;
  let settled = false; // este pedido ja seguiu um caminho (retry / fallback / resposta)
  req.on('socket', (s) => {
    // 1.ª sondagem https: 8s chegam para um handshake; se stallar, e https morto.
    s.setTimeout(firstHttpsProbe ? Math.min(sockTimeout, 8000) : sockTimeout);
    s.on('connect', () => { connected = true; });
    s.on('timeout', () => {
      if (settled) return;
      if (connected) {
        // servidor aceitou a ligacao mas nunca respondeu: responder 504 ao
        // cliente em vez de o deixar pendurado para sempre
        settled = true;
        finish();
        if (!res.headersSent) {
          try { res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ error: 'sem resposta do servidor' })); } catch (e) {}
        } else { try { res.destroy(); } catch (e) {} }
        try { req.destroy(new Error('timeout')); } catch (e) {}
      } else if (isHttps && depth === 0 && !res.headersSent) {
        // HTTPS stallou o handshake: nao queimar tentativas no mesmo TLS
        // morto — marcar o host e cair para HTTP imediatamente
        settled = true;
        hostProto[url.hostname] = 'http-only';
        try { req.destroy(); } catch (e) {}
        fetchWithRedirects(target.replace(/^https:/i, 'http:'), headers, depth, res, undefined, finish, timeoutMs);
      } else if (attempts > 1) {
        settled = true;
        try { req.destroy(); } catch (e) {}
        setTimeout(() => fetchWithRedirects(target, headers, depth, res, attempts - 1, finish, timeoutMs), 300);
      } else {
        settled = true;
        finish();
        if (!res.headersSent) {
          try { res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ error: 'connect timeout' })); } catch (e) {}
        } else { try { res.destroy(); } catch (e) {} }
        try { req.destroy(new Error('connect timeout')); } catch (e) {}
      }
    });
  });
  req.on('error', (e) => {
    if (settled) return;
    settled = true;
    // HTTPS recusado logo a seguir ao handshake (ECONNRESET / EPROTO /
    // socket hang up): repetir por HTTP, que e o que o painel aceita.
    if (isHttps && depth === 0 && !res.headersSent &&
        /ECONNRESET|EPROTO|ECONNREFUSED|socket hang up|ERR_SSL|ERR_TLS|certificate/i.test(String(e.code || e.message))) {
      hostProto[url.hostname] = 'http-only';
      fetchWithRedirects(target.replace(/^https:/i, 'http:'), headers, 0, res, undefined, finish, timeoutMs);
      return;
    }
    finish();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message }));
    } else {
      res.destroy();
    }
  });
  req.end();
}

if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 8090;
  const server = createServer(__dirname);
  server.listen(PORT, '127.0.0.1', () => {
    console.log('NEO//IPTV web a correr em http://127.0.0.1:' + PORT);
  });
}

module.exports = { createServer };
