#!/usr/bin/env node
// Lumen backend: serves the app and stores notes as plain .md files in a vault folder.
// Usage: node server.js [vaultDir]   (env: LUMEN_VAULT, PORT, HOST)
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const VAULT = path.resolve(process.argv[2] || process.env.LUMEN_VAULT || path.join(__dirname, 'vault'));
const PORT = +process.env.PORT || 5188;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const STATE = path.join(VAULT, '.lumen', 'state.json');
const MAX_BODY = 25 * 1024 * 1024;
const MAX_FILE = 200 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
// Attachments are served only with these types. Anything else is forced to download as opaque bytes,
// so an uploaded .html can never run script on the app's origin.
const SAFE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.json': 'text/plain; charset=utf-8', '.canva': 'text/plain; charset=utf-8',
};
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

fs.mkdirSync(VAULT, { recursive: true });

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// Map a note path ("Folder/Note") to a file inside the vault, refusing anything that escapes it.
function noteFile(p) {
  if (typeof p !== 'string' || !p.trim()) throw new HttpError(400, 'missing path');
  const parts = p.split('/').map(s => s.trim());
  if (parts.some(s => !s || s === '.' || s === '..' || s.startsWith('.') || /[\0\\:*?"<>|]/.test(s))) throw new HttpError(400, 'invalid path');
  const file = path.join(VAULT, ...parts) + '.md';
  if (!file.startsWith(VAULT + path.sep)) throw new HttpError(400, 'invalid path');
  return file;
}
// Attachment path ("attachments/photo.png") -> file in the vault. Same containment rules as notes.
function attFile(p) {
  if (typeof p !== 'string' || !p.trim()) throw new HttpError(400, 'missing path');
  const parts = p.split('/').map(s => s.trim());
  if (parts.some(s => !s || s === '.' || s === '..' || s.startsWith('.') || /[\0\\:*?"<>|]/.test(s)) || /\.md$/i.test(p) || p.includes('.tmp-')) throw new HttpError(400, 'invalid path');
  const file = path.join(VAULT, ...parts);
  if (!file.startsWith(VAULT + path.sep)) throw new HttpError(400, 'invalid path');
  return file;
}
function dirFile(p) {
  const f = noteFile(p);
  return f.slice(0, -3);
}

async function walk(dir, rel, out) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { out.folders.push(r); await walk(full, r, out); }
    else if (e.isFile() && e.name.endsWith('.md')) {
      const st = await fsp.stat(full);
      out.notes[r.slice(0, -3)] = { c: await fsp.readFile(full, 'utf8'), t: Math.round(st.mtimeMs) };
    } else if (e.isFile() && !e.name.includes('.tmp-')) {
      const st = await fsp.stat(full);
      out.files[r] = { size: st.size, t: Math.round(st.mtimeMs) };
    }
  }
}
async function listVault() {
  const out = { notes: {}, folders: [], files: {} };
  await walk(VAULT, '', out);
  return out;
}

function body(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new HttpError(413, 'too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'bad json')); } });
    req.on('error', reject);
  });
}
// Stream a request body to a file, aborting past MAX_FILE. Written to a temp file first, then renamed.
function saveStream(req, file) {
  return new Promise((resolve, reject) => {
    const tmp = file + '.tmp-' + process.pid;
    const out = fs.createWriteStream(tmp);
    let n = 0, dead = false;
    const fail = e => { if (dead) return; dead = true; out.destroy(); fsp.unlink(tmp).catch(() => {}); reject(e); };
    req.on('data', c => { n += c.length; if (n > MAX_FILE) { fail(new HttpError(413, 'file too large')); req.destroy(); } });
    req.on('error', fail); out.on('error', fail);
    out.on('finish', () => { if (!dead) fsp.rename(tmp, file).then(() => resolve(n), fail); });
    req.pipe(out);
  });
}
const send = (res, code, data) => {
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(s);
};

// Refuse cross-site requests: only same-origin pages may call the API.
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

async function api(req, res, url) {
  if (!sameOrigin(req)) throw new HttpError(403, 'cross-origin request refused');
  const m = req.method, p = url.searchParams.get('p');
  if (url.pathname === '/api/vault' && m === 'GET') return send(res, 200, { ...(await listVault()), vault: VAULT });
  if (url.pathname === '/api/note') {
    const file = noteFile(p);
    if (m === 'PUT') {
      const { c } = await body(req);
      if (typeof c !== 'string') throw new HttpError(400, 'content must be a string');
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp-' + process.pid;
      await fsp.writeFile(tmp, c);
      await fsp.rename(tmp, file); // atomic: a crash never leaves a half-written note
      return send(res, 200, { ok: true, t: Math.round((await fsp.stat(file)).mtimeMs) });
    }
    if (m === 'DELETE') {
      try { await fsp.unlink(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return send(res, 200, { ok: true });
    }
  }
  if (url.pathname === '/api/file') {
    const file = attFile(p);
    if (m === 'PUT') {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await saveStream(req, file);
      const st = await fsp.stat(file);
      return send(res, 200, { ok: true, size: st.size, t: Math.round(st.mtimeMs) });
    }
    if (m === 'DELETE') {
      try { await fsp.unlink(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return send(res, 200, { ok: true });
    }
    if (m === 'GET') return serveFile(req, res, file);
  }
  if (url.pathname === '/api/folder' && m === 'POST') {
    const { p: fp } = await body(req);
    await fsp.mkdir(dirFile(fp), { recursive: true });
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/state') {
    if (m === 'GET') { try { return send(res, 200, await fsp.readFile(STATE, 'utf8')); } catch { return send(res, 200, {}); } }
    if (m === 'PUT') {
      const s = await body(req);
      await fsp.mkdir(path.dirname(STATE), { recursive: true });
      await fsp.writeFile(STATE, JSON.stringify(s));
      return send(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'not found');
}

async function serveFile(req, res, file) {
  let st;
  try { st = await fsp.stat(file); if (!st.isFile()) throw 0; } catch { throw new HttpError(404, 'not found'); }
  const ext = path.extname(file).toLowerCase(), type = SAFE[ext];
  const h = {
    'content-type': type || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes', 'cache-control': 'no-cache',
    'content-disposition': (type ? 'inline' : 'attachment') + '; filename*=UTF-8\'\'' + encodeURIComponent(path.basename(file)),
  };
  if (ext !== '.pdf') h['content-security-policy'] = 'sandbox'; // neutralise script in e.g. a directly-opened SVG
  let start = 0, end = st.size - 1, code = 200;
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (r && (r[1] || r[2])) {
    if (r[1]) { start = +r[1]; if (r[2]) end = Math.min(+r[2], end); } else { start = Math.max(0, st.size - +r[2]); }
    if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': 'bytes */' + st.size }); return res.end(); }
    code = 206; h['content-range'] = `bytes ${start}-${end}/${st.size}`;
  }
  h['content-length'] = end - start + 1;
  res.writeHead(code, h);
  if (req.method === 'HEAD' || st.size === 0) return res.end();
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) throw new HttpError(403, 'forbidden');
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch { throw new HttpError(404, 'not found'); }
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    // Block DNS-rebinding: when bound to loopback, only answer requests addressed to a loopback name.
    if (LOCAL_HOSTS.has(HOST) || HOST === '::1') {
      const hn = (req.headers.host || '').replace(/:\d+$/, '');
      if (!LOCAL_HOSTS.has(hn)) throw new HttpError(403, 'bad host');
    }
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : 500;
    if (code === 500) console.error(e);
    send(res, code, { error: code === 500 ? 'server error' : e.message });
  }
}).listen(PORT, HOST, () => console.log(`Lumen running at http://${HOST}:${PORT}\nVault: ${VAULT}`));
