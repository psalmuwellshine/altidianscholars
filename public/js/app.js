/* Altidian student site: shell, state, router. Pages live in /js/pages. */
import { html, raw, mount, icon, api, toast, initTheme, toggleTheme, initial, avatar, ApiError } from './core/ui.js';
import * as home from './pages/home.js';
import * as library from './pages/library.js';
import * as quizzes from './pages/quizzes.js';
import * as board from './pages/board.js';
import * as events from './pages/events.js';
import * as account from './pages/account.js';
import * as viewer from './pages/viewer.js';
import * as pay from './pages/pay.js';
import * as chat from './pages/chat.js';
import * as timetable from './pages/timetable.js';
import * as share from './pages/share.js';
import * as saved from './pages/saved.js';
import * as rep from './pages/rep.js';
import * as notify from './pages/notify.js';
import * as cgpa from './pages/cgpa.js';
import * as report from './pages/report.js';
import { saveSnapshot, loadSnapshot } from './core/offline.js';
import * as push from './core/push.js';

initTheme();

/* ---------- shared state ---------- */
export const S = { state: null, device: '', profile: null };
try {
  S.device = localStorage.getItem('ew-device') || '';
  if (!/^[a-z0-9]{16,40}$/.test(S.device)) {
    S.device = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24).replace(/[^a-z0-9]/g, 'a');
    localStorage.setItem('ew-device', S.device);
  }
} catch (e) { S.device = 'guest' + Math.random().toString(36).slice(2, 12) + 'abcdef'; }

export async function load() {
  try {
    S.state = await api('GET', '/api/state?device=' + encodeURIComponent(S.device));
    S.offline = false;
    saveSnapshot(S.state);
  } catch (e) {
    // No connection: open with the last copy of the data, so saved notes and the timetable still work.
    const snap = e.status === 0 ? loadSnapshot() : null;
    if (!snap) throw e;
    S.state = snap; S.offline = true;
  }
  S.profile = null;
  renderChrome();
  if (S.state.user && !S.offline) push.sync();
  return S.state;
}
export const user = () => S.state && S.state.user;
export const config = () => S.state.config;
export function go(path) { location.hash = '#' + path; }

/* ---------- pages ---------- */
const PAGES = [
  { id: 'home', path: '/', label: 'Home', icon: 'home', mod: home },
  { id: 'library', path: '/library', label: 'Library', icon: 'book', mod: library },
  { id: 'quizzes', path: '/quizzes', label: 'Quizzes', icon: 'quiz', mod: quizzes },
  { id: 'board', path: '/board', label: 'Ranks', icon: 'trophy', mod: board },
  { id: 'events', path: '/events', label: 'Events', icon: 'calendar', mod: events },
  { id: 'chat', path: '/chat', label: 'Chat', icon: 'chat', mod: chat },
];
const visiblePages = () => PAGES.filter((p) => p.id !== 'chat' || (S.state && S.state.config.chatEnabled));
const ctxApi = { S, load, user, config, go, renderView: () => route() };
const modules = [home, library, quizzes, board, events, account, viewer, pay, chat, timetable, share, saved, rep, notify, cgpa, report];
const actions = Object.assign({}, ...modules.map((m) => m.actions || {}));

/* ---------- chrome (header, notice, tabs, footer) ---------- */
function renderChrome() {
  const c = S.state.config; const u = user(); const L = c.links || {};
  const shell = document.getElementById('shell');
  const cur = currentId();
  const oldView = document.getElementById('view');
  mount(shell, html`
    <header class="topbar"><div class="wrap in">
      <a class="brand" href="#/"><img src="/logo.png" alt=""><span class="name-wrap"><span class="name">${c.siteName}</span>${/^altidian$/i.test(c.siteName) ? html`<span class="was">formerly Exam Warriors</span>` : ''}</span></a>
      ${u ? html`<nav class="nav" aria-label="Main">${visiblePages().map((p) => html`<a href="#${p.path}" class="${cur === p.id ? 'on' : ''}" ${cur === p.id ? raw('aria-current="page"') : ''}>${icon(p.icon, 18)}${p.label}</a>`)}</nav>` : html`<span></span>`}
      <div class="top-end">
        <button class="icon-btn" data-action="theme" type="button" aria-label="Switch light and dark mode">${icon('moon', 19)}</button>
        ${u ? html`<a class="avatar-link" href="#/profile" aria-label="Your profile (${u.username})">${avatar(u.username, u.avatarId)}</a>` : ''}
      </div>
    </div></header>
    ${S.offline && u ? html`<div class="notice info" role="status"><div class="wrap">${icon("refresh", 19)}<span>You are offline. Saved notes and your timetable still work. <a href="#/saved">Open saved notes</a></span></div></div>` : ''}
    ${S.state.notice && u ? html`<div class="notice ${S.state.notice.level}" role="status"><div class="wrap">${icon('bell', 19)}<span>${S.state.notice.text}</span></div></div>` : ''}
    <main id="view" class="wrap" tabindex="-1"></main>
    <footer class="foot"><div class="wrap in">
      <div><b>${c.siteName}</b> ${c.tagline ? html`· ${c.tagline}` : ''}<br>${c.motto ? html`<span class="motto">${c.motto}</span><br>` : ''}<span class="tiny">${c.footerText}</span></div>
      <div class="links">
        ${L.whatsapp ? html`<a href="${L.whatsapp}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${L.telegram ? html`<a href="${L.telegram}" target="_blank" rel="noopener">Telegram</a>` : ''}
        ${L.instagram ? html`<a href="${L.instagram}" target="_blank" rel="noopener">Instagram</a>` : ''}
        ${L.website ? html`<a href="${L.website}" target="_blank" rel="noopener">Website</a>` : ''}
        ${L.email ? html`<a href="mailto:${L.email}">Email us</a>` : ''}
        <a href="#" data-action="share">Share site</a>
      </div>
    </div></footer>
    ${u ? html`<nav class="tabbar" aria-label="Main">${visiblePages().map((p) => html`<a class="tab ${cur === p.id ? 'on' : ''}" href="#${p.path}">${icon(p.icon, 22)}<span>${p.label}</span></a>`)}</nav>` : ''}`);
  if (oldView) document.getElementById('view').replaceWith(oldView); // keep the page the student is on
  document.body.classList.toggle('has-tabs', !!u);
  document.title = c.siteName + (cur === 'home' ? ' · ' + (c.tagline || 'Study smarter') : '');
}

function parse() {
  const raw0 = location.hash.replace(/^#/, '') || '/';
  const [p, q] = raw0.split('?');
  return { path: p.replace(/\/+$/, '') || '/', query: new URLSearchParams(q || ''), full: raw0 };
}
function currentId() {
  const { path } = parse();
  if (path === '/') return 'home';
  const hit = PAGES.find((p) => p.path !== '/' && path.startsWith(p.path));
  if (hit) return hit.id;
  if (path.startsWith('/quiz/')) return 'quizzes';
  if (path === '/timetable') return 'events';
  if (path === '/share' || path === '/saved') return 'library';
  if (path === '/cgpa') return 'home';
  return '';
}

/* ---------- router ---------- */
let token = 0;
async function route() {
  if (!S.state) return;
  const my = ++token;
  const { path, query, full } = parse();
  let page;
  let params = {};
  if (path === '/') page = home;
  else if (path === '/library') page = library;
  else if (path === '/quizzes') page = quizzes;
  else if (path.startsWith('/quiz/')) { page = quizzes.runner; params = { id: path.slice(6) }; }
  else if (path === '/board') page = board;
  else if (path === '/events') page = events;
  else if (path === '/timetable') page = timetable;
  else if (path === '/share') page = share;
  else if (path === '/saved') page = saved;
  else if (path === '/rep') page = rep;
  else if (path === '/cgpa') page = cgpa;
  else if (path === '/chat' || path.startsWith('/chat/')) { page = chat; params = { room: path.slice(6) }; }
  else if (path === '/profile') page = account.profile;
  else if (['/login', '/register', '/forgot'].includes(path)) { page = account.auth; params = { mode: path.slice(1) }; }
  else page = null;

  const isAuthPage = ['/login', '/register', '/forgot'].includes(path);
  if (!user() && !isAuthPage) { // logged-out visitors always land on the login page first
    go(path === '/' ? '/login' : '/login?next=' + encodeURIComponent(full));
    return;
  }

  renderChrome();
  const view = document.getElementById('view');
  if (!page) { mount(view, html`<div class="page"><div class="empty">${icon('search', 34)}<h2>Page not found</h2><p>That page does not exist.</p><p style="margin-top:14px"><a class="btn primary" href="#/">Go home</a></p></div></div>`); return; }
  if ((typeof page.needsLogin === 'function' ? page.needsLogin(ctxApi) : page.needsLogin) && !user()) { go('/login?next=' + encodeURIComponent(full)); return; }
  mount(view, html`<div class="page"><div class="skeleton"></div></div>`);
  try {
    const out = await page.render(ctxApi, params, query);
    if (my !== token) return;
    mount(view, html`<div class="page">${out}</div>`);
    if (page.after) page.after(ctxApi, view, params);
  } catch (e) {
    if (my !== token) return;
    if (e instanceof ApiError && e.status === 401) { await load(); go('/login?next=' + encodeURIComponent(full)); return; }
    mount(view, html`<div class="page"><div class="alert bad">${e.message}</div><button class="btn ghost" data-action="retry" type="button">Try again</button></div>`);
  }
  window.scrollTo(0, 0);
  const inQuiz = path.startsWith('/quiz/');
  document.body.classList.toggle('has-tabs', !inQuiz && !!user());
}

/* ---------- global events ---------- */
actions.theme = () => toggleTheme();
actions.retry = () => route();
actions.share = async (el, ev) => {
  ev.preventDefault();
  const data = { title: config().siteName, text: config().tagline || 'Study with Altidian', url: location.origin };
  try { if (navigator.share) { await navigator.share(data); return; } } catch (e) { return; }
  try { await navigator.clipboard.writeText(location.origin); toast('Link copied. Paste it in your group.'); } catch (e) { toast(location.origin); }
};
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, ev, ctxApi);
});
document.addEventListener('submit', (ev) => {
  const f = ev.target.closest('form[data-submit]');
  if (!f) return;
  ev.preventDefault();
  const fn = actions[f.dataset.submit];
  if (fn) fn(f, ev, ctxApi);
});
document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-input]');
  if (el && actions[el.dataset.input]) actions[el.dataset.input](el, ev, ctxApi);
});
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-change]');
  if (el && actions[el.dataset.change]) actions[el.dataset.change](el, ev, ctxApi);
});
window.addEventListener('hashchange', route);
window.addEventListener('online', () => { if (S.offline) load().then(route).catch(() => {}); });
window.addEventListener('offline', () => { /* the next load falls back to the saved copy */ });

/* ---------- start ---------- */
(async function start() {
  try { await load(); } catch (e) {
    document.getElementById('shell').innerHTML = '<div class="wrap" style="padding-top:80px"><div class="alert bad">Could not load Altidian. Check your connection and refresh.</div></div>';
    return;
  }
  route();
})();

/* ---------- installable app (PWA) ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* app still works as a normal site */ }); });
}
