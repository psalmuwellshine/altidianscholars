'use strict';
/*
  Altidian server. Uses only Node's built-in modules (plus `mongodb`, loaded
  only when MONGODB_URI is set), so there is nothing heavy to install.
    lib/      shared helpers and the scoring rules
    routes/   public.js for students, admin.js for the control panel
    public/   the website itself
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createStore } = require('./store');
const H = require('./lib/helpers');
const { FILE_TYPES } = require('./lib/files');
const { seedAcademics } = require('./lib/academics');

const { HttpError, send } = H;
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.gz': 'application/gzip',
};
const PAGES = { '/': '/index.html', '/admin': '/admin.html' };
const REDIRECTS = { '/login': '/#/login', '/login.html': '/#/login', '/profile': '/#/profile', '/profile.html': '/#/profile' };

const etags = new Map();
function serveStatic(req, res, pathname) {
  if (REDIRECTS[pathname]) return send(res, 302, '', { Location: REDIRECTS[pathname] });
  const rel = PAGES[pathname] || pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      // Unknown file-looking paths are real 404s; anything else is a page route of the app.
      if (path.extname(file)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, b2) =>
        e2 ? send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }) : send(res, 404, b2, { 'Content-Type': STATIC_TYPES['.html'], 'Cache-Control': 'no-cache' }));
    }
    const ext = path.extname(file).toLowerCase();
    const tag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) + '"';
    etags.set(file, tag);
    const headers = {
      'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache', // always check with the server (304 when unchanged), so a replaced logo shows up straight away
      ETag: tag,
    };
    if (req.headers['if-none-match'] === tag) return send(res, 304, undefined, headers);
    send(res, 200, buf, headers);
  });
}

async function main() {
  const store = await createStore();
  await seedAcademics(store);

  const routes = [];
  function route(method, pattern, opts, handler) {
    const re = new RegExp('^' + pattern.replace(/:[a-z]+/gi, '([^/]+)') + '$');
    routes.push({ method, re, opts: opts || {}, handler });
  }

  // The signed-in student for this request, or null. A bumped session version or a disabled account ends the session.
  async function userOf(req) {
    const s = H.readSession(req, 'ew_user', 'user');
    if (!s || !H.okId(s.id)) return null;
    const u = await store.get('users', s.id);
    if (!u || u.disabled || (u.sv || 0) !== s.version) return null;
    return u;
  }

  const stats = require('./lib/stats')(store);
  require('./routes/public')({ route, store, send, userOf, fileTypes: FILE_TYPES, stats });
  const push = require('./lib/push')(store);
  require('./routes/admin')({ route, store, send, push });
  require('./routes/chat')({ route, store, send, userOf });
  require('./routes/community')({ route, store, send, userOf, push });
  require('./routes/extras')({ route, store, send, userOf, push, stats });
  require('./routes/transfers')({ route, store, send, userOf, push });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch (e) { throw new HttpError(400, 'Bad request.'); }

      let matched = null; let pathMatch = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (m) {
          pathMatch = true;
          if (r.method === req.method || (r.method === 'GET' && req.method === 'HEAD')) { matched = { r, params: m.slice(1) }; break; }
        }
      }
      if (matched) {
        const { r, params } = matched;
        if (r.opts.admin && !H.isAdmin(req)) throw new HttpError(401, 'Admin login required.');
        if (r.opts.limit && H.limited(req, ...r.opts.limit)) throw new HttpError(429, 'Too many requests. Please wait a bit and try again.');
        const body = ['POST', 'PUT'].includes(req.method) ? await H.readJson(req) : {};
        return await r.handler(req, res, { params: params.map(decodeURIComponent), query: url.searchParams, body });
      }
      if (pathname.startsWith('/api/') || pathname.startsWith('/files/') || pathname.startsWith('/avatars/') || pathMatch) throw new HttpError(pathMatch ? 405 : 404, pathMatch ? 'Method not allowed.' : 'Not found.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      serveStatic(req, res, pathname);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Something went wrong.' });
    }
  });
  server.requestTimeout = 120000;
  server.listen(PORT, () => {
    console.log('Altidian running on port ' + PORT + ' (storage: ' + store.kind + ')');
    if (!H.ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is not set, so the admin page is disabled.');
    if (!process.env.SESSION_SECRET) console.warn('WARNING: SESSION_SECRET is not set. Add a long random SESSION_SECRET on the server so login cookies are signed with their own key.');
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
