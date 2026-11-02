'use strict';
/*
  Shared building blocks: errors, validation, passwords, signed login cookies,
  rate limiting, JSON reading and response sending.
*/
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

/* ---------- settings from the environment ---------- */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (ADMIN_PASSWORD
    ? crypto.createHash('sha256').update('exam-warriors:' + ADMIN_PASSWORD).digest('hex')
    : crypto.randomBytes(32).toString('hex')); // no password set: sessions last until the server restarts
const ADMIN_SESSION_HOURS = 12;
const USER_SESSION_DAYS = 30;

/* ---------- errors ---------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- validation ---------- */
const newId = () => crypto.randomBytes(8).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (v, max) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '';
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
const isHttp = (u) => /^https?:\/\/[^\s]+$/i.test(u || '');
const okCourse = (c) => /^[A-Z0-9]{2,10}$/.test(c || '');
const okDevice = (d) => typeof d === 'string' && /^[a-z0-9]{16,40}$/.test(d);
const okId = (d) => typeof d === 'string' && /^[a-f0-9]{16}$/.test(d);
const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}._ -]{1,22}[\p{L}\p{N}]$/u;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const bool = (v) => v === true || v === 'true';

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- passwords and recovery phrases ----------
   New passwords use salted scrypt. Older accounts used plain SHA-256; those still
   log in and are upgraded to scrypt the first time they do. */
const normPhrase = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
const NO_SALT = '0'.repeat(32);

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + (await scrypt(pw, salt, 64)).toString('hex');
}
async function checkPassword(stored, pw) {
  if (typeof stored !== 'string') return { ok: false };
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    const got = (await scrypt(pw, salt, 64)).toString('hex');
    return { ok: safeEqual(got, hash) };
  }
  return { ok: safeEqual(sha(pw), stored), legacy: true };
}
const hashPhrase = async (phrase, salt) => (await scrypt(normPhrase(phrase), salt, 32)).toString('hex');

/* ---------- signed cookies ---------- */
const sign = (v) => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return ''; }
    }
  }
  return '';
}
const isSecure = (req) => req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;

// The cookie holds "kind.id.version.expiry.signature". It cannot be edited without the secret.
function makeCookie(req, name, kind, id, version, ttlSeconds) {
  const exp = Date.now() + ttlSeconds * 1000;
  const payload = [kind, id, version, exp].join('.');
  return `${name}=${payload}.${sign(payload)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}${isSecure(req) ? '; Secure' : ''}`;
}
const clearCookie = (name) => `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

function readSession(req, name, kind) {
  const parts = readCookie(req, name).split('.');
  if (parts.length !== 5) return null;
  const [k, id, version, exp, mac] = parts;
  if (k !== kind || !/^\d+$/.test(exp) || Date.now() > Number(exp)) return null;
  if (!safeEqual(mac, sign([k, id, version, exp].join('.')))) return null;
  return { id, version: Number(version) || 0 };
}
const isAdmin = (req) => !!ADMIN_PASSWORD && !!readSession(req, 'ew_admin', 'admin');

/* ---------- rate limiting (per visitor address) ---------- */
const hits = new Map();
function clientIp(req) {
  const f = req.headers['x-forwarded-for'];
  return (f ? String(f).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}
function limited(req, name, max, windowMs) {
  const key = name + ':' + clientIp(req);
  const now = Date.now();
  let h = hits.get(key);
  if (!h || now > h.reset) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
  return ++h.count > max;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (n > v.reset) hits.delete(k); }, 60000).unref();

/* ---------- wrong-password limits (counted per account, not per address) ----------
   A visitor's address can be faked, and many students share one campus or mobile-network address,
   so wrong guesses are counted against the account being tried instead. */
const fails = new Map();
const tooManyFails = (name, key, max) => { const h = fails.get(name + ':' + key); return !!h && Date.now() <= h.reset && h.count >= max; };
function noteFail(name, key, windowMs) {
  const k = name + ':' + key; const now = Date.now(); let h = fails.get(k);
  if (!h || now > h.reset) { if (!h && fails.size > 20000) return; h = { count: 0, reset: now + windowMs }; fails.set(k, h); }
  h.count++;
}
const clearFails = (name, key) => { fails.delete(name + ':' + key); };
setInterval(() => { const n = Date.now(); for (const [k, v] of fails) if (n > v.reset) fails.delete(k); }, 60000).unref();

/* ---------- reading requests ---------- */
const MAX_BODY_BYTES = 18 * 1024 * 1024;
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) { req.resume(); return reject(new HttpError(413, 'That upload is too large.')); }
    const chunks = []; let size = 0; let dead = false;
    req.on('data', (c) => {
      if (dead) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) { dead = true; reject(new HttpError(413, 'That upload is too large.')); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (dead) return;
      if (!size) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch (e) { reject(new HttpError(400, 'Bad request.')); }
    });
    req.on('error', reject);
  });
}

/* ---------- sending responses ---------- */
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://drive.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const COMPRESSIBLE = /^(text\/|application\/json|application\/javascript|image\/svg)/;

function send(res, status, body, headers) {
  const h = Object.assign({}, SEC_HEADERS, headers || {});
  if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') {
    body = JSON.stringify(body);
    h['Content-Type'] = 'application/json; charset=utf-8';
    h['Cache-Control'] = 'no-store';
  }
  const type = String(h['Content-Type'] || '');
  const wantsGzip = /\bgzip\b/.test(String((res.req && res.req.headers['accept-encoding']) || ''));
  if (body && wantsGzip && COMPRESSIBLE.test(type) && Buffer.byteLength(body) > 1024 && !h['Content-Encoding']) {
    body = zlib.gzipSync(body);
    h['Content-Encoding'] = 'gzip';
    h['Vary'] = 'Accept-Encoding';
  }
  res.writeHead(status, h);
  res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
}

module.exports = {
  ADMIN_PASSWORD, SESSION_SECRET, ADMIN_SESSION_HOURS, USER_SESSION_DAYS,
  HttpError, newId, sha, clean, str, isHttp, okCourse, okDevice, okId, USERNAME_RE, isDate, isTime, bool, safeEqual,
  normPhrase, NO_SALT, hashPassword, checkPassword, hashPhrase,
  readCookie, makeCookie, clearCookie, readSession, isAdmin, isSecure,
  clientIp, limited, tooManyFails, noteFail, clearFails, readJson, send,
};
