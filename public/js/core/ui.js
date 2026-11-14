/* Shared helpers for the student site and the admin panel: safe HTML, icons, toasts, dialogs, API calls. */

export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
// The address students should share: the official Altidian address, even if the app was opened from the old onrender.com link.
export const siteOrigin = () => (/\.onrender\.com$/.test(location.hostname) ? 'https://altidian.com.ng' : location.origin);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);
const part = (v) => {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
};
// html`...` escapes every value unless it came from another html`...` call.
export const html = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? part(vals[i]) : ''), ''));
export const mount = (el, tpl) => { el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl); };

/* ---------- icons (stroke icons, 24px grid) ---------- */
const P = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5M9 7h6',
  quiz: 'M9 9a3 3 0 115 2c-1 .8-2 1.2-2 2.5M12 17h.01M12 22a10 10 0 100-20 10 10 0 000 20z',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3',
  calendar: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20a7 7 0 0114 0M16 4.3a3.5 3.5 0 010 6.4M18 14a7 7 0 013 6',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 13A9 9 0 1111 3a7 7 0 0010 10z',
  flame: 'M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.5-4.5',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h6',
  video: 'M4 6h11a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zM16 10l5-3v10l-5-3',
  pin: 'M12 17v5M8 3h8l-1 6 3 4H6l3-4z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeoff: 'M3 3l18 18M10.6 5.1A9.7 9.7 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.6 6.6A16 16 0 002 12s4 7 10 7a9.6 9.6 0 004-.9',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  bell: 'M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 004 0',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  logout: 'M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9',
  lock: 'M6 11h12a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1zM8 11V7a4 4 0 118 0v4',
  more: 'M5 12m-1.6 0a1.6 1.6 0 103.2 0a1.6 1.6 0 10-3.2 0M12 12m-1.6 0a1.6 1.6 0 103.2 0a1.6 1.6 0 10-3.2 0M19 12m-1.6 0a1.6 1.6 0 103.2 0a1.6 1.6 0 10-3.2 0',
  share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  back: 'M19 12H5M11 6l-6 6 6 6',
  pin2: 'M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
  volume: 'M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12',
  play: 'M8 5v14l11-7z',
  pause: 'M8 5v14M16 5v14',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  medal: 'M12 15a6 6 0 100-12 6 6 0 000 12zM8.5 14L7 22l5-3 5 3-1.5-8',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  chat: 'M21 12a8 8 0 01-11.6 7.1L4 20l1.1-4.5A8 8 0 1121 12zM8.5 11h.01M12 11h.01M15.5 11h.01',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  warning: 'M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
};
export const icon = (name, size = 20) =>
  new Raw(`<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.star}"/></svg>`);

/* ---------- API ---------- */
import * as idle from './idle.js';
export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch (e) { throw new ApiError(0, 'Could not reach the server. Check your connection and try again.'); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Please try again.');
  if (/^\/api\/(login|register|user\/reset-password|admin\/login)$/.test(url)) idle.touch(true);
  if (/^\/api\/(login|register|logout)$/.test(url)) { try { sessionStorage.removeItem('alt-push-asked'); } catch (e) { /* ignore */ } }
  return data;
}
export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }

/* ---------- formatting ---------- */
export const fmtDate = (ts, opts) => (ts ? new Date(ts).toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24); if (d < 30) return d + ' day' + (d > 1 ? 's' : '') + ' ago';
  return fmtDate(ts);
}
export const eventDate = (e) => {
  const d = new Date(e.date + 'T00:00:00');
  return { day: d.getDate(), mon: d.toLocaleDateString('en-GB', { month: 'short' }), long: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
};
export const todayKey = () => { const d = new Date(Date.now() + 3600000); return d.toISOString().slice(0, 10); }; // Lagos date

/* ---------- toasts ---------- */
let toastBox;
export function toast(message, kind = 'ok') {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); document.body.appendChild(toastBox); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = message;
  toastBox.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'bad' ? 5000 : 3000);
}

/* ---------- dialogs ---------- */
export function dialog(tpl, { wide = false, onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" tabindex="-1">${tpl.s}</div>`;
  const prev = document.activeElement;
  document.body.appendChild(back);
  document.body.classList.add('noscroll');
  const box = back.firstElementChild;
  const close = (v) => { back.remove(); if (!document.querySelector('.modal-back')) document.body.classList.remove('noscroll'); if (prev && prev.focus) prev.focus(); if (onClose) onClose(v); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // keep focus inside
      const f = [...box.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  box.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  const af = box.querySelector('[autofocus]') || box; af.focus();
  return { box, close };
}
export function confirmBox({ title, text, yes = 'Confirm', danger = false, typed }) {
  return new Promise((resolve) => {
    let done = false;
    const { box, close } = dialog(html`
      <h3>${title}</h3><p class="muted">${text}</p>
      ${typed ? html`<label class="field"><span>Type <b>${typed}</b> to confirm</span><input data-typed autocomplete="off" autofocus></label>` : ''}
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-yes type="button" ${typed ? 'disabled' : ''}>${yes}</button></div>`,
      { onClose: (v) => { if (!done) resolve(false); } });
    const t = box.querySelector('[data-typed]'); const y = box.querySelector('[data-yes]');
    if (t) t.addEventListener('input', () => { y.disabled = t.value.trim() !== typed; });
    y.addEventListener('click', () => { done = true; close(); resolve(true); });
    if (!typed) y.focus();
  });
}

/* ---------- theme ---------- */
export function initTheme() {
  let t = null;
  try { t = localStorage.getItem('ew-theme'); } catch (e) { /* ignore */ }
  if (t) document.documentElement.dataset.theme = t;
}
export function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('ew-theme', next); } catch (e) { /* ignore */ }
}

/* ---------- misc ---------- */
export const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);
export const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b || a + 's');
export const initial = (s) => (String(s).trim()[0] || '?').toUpperCase();
// A round profile picture, or the first letter of the name when there is no picture.
export const avatar = (name, id, cls = '') => (id
  ? html`<span class="avatar ${cls}"><img src="/avatars/${id}" alt="" loading="lazy"></span>`
  : html`<span class="avatar ${cls}" aria-hidden="true">${initial(name)}</span>`);
// Shrinks a chosen photo to a 256px square JPEG in the browser before it is uploaded.
export function squarePhoto(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Use a JPG, PNG or WebP picture.'));
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that picture.'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not open that picture.'));
      img.onload = () => {
        const n = Math.min(img.width, img.height); const c = document.createElement('canvas'); c.width = c.height = 256;
        c.getContext('2d').drawImage(img, (img.width - n) / 2, (img.height - n) / 2, n, n, 0, 0, 256, 256);
        resolve({ type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.86).split(',')[1] });
      };
      img.src = String(r.result);
    };
    r.readAsDataURL(file);
  });
}
export const kindLabel = { notes: 'Notes', pq: 'Past questions', slides: 'Slides', video: 'Video', other: 'Resource' };
export const kindIcon = { notes: 'file', pq: 'quiz', slides: 'file', video: 'video', other: 'link' };
export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, type: file.type, data: String(r.result).split(',')[1] || '' });
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}
