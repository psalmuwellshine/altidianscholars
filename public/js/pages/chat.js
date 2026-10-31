/* Chat rooms: a list of rooms the student may enter, and a live conversation. */
import { html, raw, esc, icon, api, toast, avatar, ago, confirmBox, debounce } from '../core/ui.js';
import { emptyState, hasPlace } from './shared.js';

let es = null; let poll = null; let listTimer = null; let cur = null; // cur = the open conversation
let rooms = []; let me = '';

/* ---------- helpers ---------- */
function closeAll() {
  if (es) { es.close(); es = null; }
  clearInterval(poll); clearInterval(listTimer); poll = listTimer = null; cur = null;
  window.removeEventListener('resize', fit);
}
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/chat')) closeAll(); });

const seenMap = () => { try { return JSON.parse(localStorage.getItem('alt-chat-seen') || '{}'); } catch (e) { return {}; } };
const markSeen = (room, at) => { try { const m = seenMap(); m[room] = Math.max(m[room] || 0, at || Date.now()); localStorage.setItem('alt-chat-seen', JSON.stringify(m)); } catch (e) { /* ignore */ } };
const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (t) => {
  const d = new Date(t); const n = new Date();
  const k = (x) => x.getFullYear() * 400 + x.getMonth() * 31 + x.getDate();
  if (k(d) === k(n)) return 'Today';
  if (k(d) === k(new Date(n.getTime() - 86400000))) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};
const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };

// Turns web addresses in a message into safe links. Everything else stays plain text.
function linkify(text) {
  const out = []; let last = 0; const re = /https?:\/\/[^\s<]+/gi; let m;
  while ((m = re.exec(text))) {
    let url = m[0]; const trail = (url.match(/[.,;:!?)\]]+$/) || [''])[0]; url = url.slice(0, url.length - trail.length);
    out.push(esc(text.slice(last, m.index)));
    out.push(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(url)}</a>`);
    out.push(esc(trail)); last = m.index + m[0].length;
  }
  out.push(esc(text.slice(last)));
  return raw(out.join(''));
}

function msgHtml(m, prev) {
  const mine = m.uid === me;
  const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
  const grouped = prev && !newDay && prev.uid === m.uid && m.at - prev.at < 5 * 60000;
  return html`${newDay ? html`<div class="day-sep"><span>${dayLabel(m.at)}</span></div>` : ''}
    <div class="m ${mine ? 'mine' : ''} ${m.admin ? 'adm' : ''} ${grouped ? 'grp' : ''}" data-id="${m.id}" data-uid="${m.uid}" data-at="${m.at}">
      ${mine ? '' : (grouped ? html`<span class="av-gap"></span>` : (m.admin ? html`<span class="avatar sm adm-av">${icon('shield', 16)}</span>` : avatar(m.name, m.avatar, 'sm')))}
      <div class="mb">
        ${grouped ? '' : html`<div class="mh"><b>${mine ? 'You' : m.name}</b>${m.admin ? html`<span class="chip gold-tag">Admin</span>` : ''}<time>${hhmm(m.at)}</time></div>`}
        <div class="bubble">${linkify(m.text)}</div>
        <div class="macts">${grouped ? html`<time>${hhmm(m.at)}</time>` : ''}${mine ? html`<button type="button" data-action="chat-del" data-id="${m.id}">Delete</button>` : (m.admin ? '' : html`<button type="button" data-action="chat-report" data-id="${m.id}">Report</button>`)}</div>
      </div></div>`;
}

const box = () => document.getElementById('msgs');
const nearBottom = () => { const b = box(); return b.scrollHeight - b.scrollTop - b.clientHeight < 120; };
function lastMsgEl() { const all = box().querySelectorAll('.m'); return all[all.length - 1] || null; }
function append(m) {
  const b = box(); if (!b || !cur || m.room && m.room !== cur.id) return;
  if (b.querySelector(`.m[data-id="${m.id}"]`)) return;
  b.querySelector('.empty-chat')?.remove();
  const stick = nearBottom() || m.uid === me;
  const le = lastMsgEl(); const prev = le ? { uid: le.dataset.uid, at: Number(le.dataset.at) } : null;
  b.insertAdjacentHTML('beforeend', msgHtml(m, prev).s);
  cur.lastAt = Math.max(cur.lastAt, m.at);
  if (stick) b.scrollTop = b.scrollHeight;
  markSeen(cur.id, m.at);
}
function fit() {
  const c = document.querySelector('.chat'); if (!c) return;
  const tabs = document.querySelector('.tabbar'); const tabH = tabs && tabs.offsetParent !== null && getComputedStyle(tabs).display !== 'none' ? tabs.offsetHeight : 0;
  const top = c.getBoundingClientRect().top + window.scrollY;
  const pad = parseFloat(getComputedStyle(document.getElementById('view')).paddingBottom) || 0;
  c.style.height = Math.max(360, window.innerHeight - top - pad) + 'px';
}

/* ---------- list ---------- */
function listHtml(activeId) {
  const seen = seenMap();
  return html`<div class="chat-head"><h2>Chat</h2></div>
    <div class="room-list" role="list">${rooms.map((r) => {
      const unread = r.last && r.last.uid !== me && r.last.at > (seen[r.id] || 0) && r.id !== activeId;
      return html`<a class="room-row ${r.id === activeId ? 'on' : ''}" role="listitem" href="#/chat/${r.id}">
        <span class="room-ic ${r.kind}">${icon(r.kind === 'general' ? 'users' : r.kind === 'custom' ? 'bell' : 'book', 20)}</span>
        <span class="grow"><b>${r.name}</b>${r.readOnly ? html` <span class="chip grey">Read only</span>` : ''}<br><span class="tiny muted rp">${r.last ? r.last.name + ': ' + r.last.text : r.desc}</span></span>
        <span class="room-meta">${r.last ? html`<span class="tiny muted">${ago(r.last.at).replace(' ago', '')}</span>` : ''}${unread ? html`<i class="dot" aria-label="Unread messages"></i>` : ''}${r.online ? html`<span class="tiny on-n">${r.online} online</span>` : ''}</span></a>`;
    })}</div>
    ${!hasPlace(window.__altUser) ? html`<p class="tiny muted" style="padding:12px 16px">Add your department and level in <a href="#/profile">your profile</a> to join your department and class rooms.</p>` : ''}`;
}
async function refreshList() {
  try { const r = await api('GET', '/api/chat/rooms'); rooms = r.rooms; const el = document.querySelector('.chat-list'); if (el) el.innerHTML = listHtml(cur && cur.id).s; } catch (e) { /* try again later */ }
}

/* ---------- conversation ---------- */
function mainHtml(d) {
  const r = d.room;
  const composer = d.canPost
    ? html`<form class="composer" data-submit="chat-send" novalidate><label class="sr" for="chat-in">Message</label><textarea id="chat-in" rows="1" maxlength="600" placeholder="Message ${r.name}" enterkeyhint="send" autocomplete="off"></textarea><button class="btn primary icon-send" type="submit" aria-label="Send">${icon('send', 20)}</button></form>`
    : html`<div class="composer off">${d.muted ? 'An admin has muted you, so you can read but not post.' : 'Only admins can post in this room.'}</div>`;
  return html`<div class="chat-head room"><a class="icon-btn back" href="#/chat" aria-label="Back to rooms">${icon('back', 20)}</a>
      <div class="grow"><h3>${r.name}</h3><p class="tiny muted"><span id="online">${d.online}</span> online${r.desc ? ' · ' + r.desc : ''}</p></div></div>
    <div class="msgs" id="msgs" aria-live="polite">${d.messages.length ? '' : html`<div class="empty-chat">${icon('chat', 34)}<p>No messages yet.<br>Be the first to say hello.</p></div>`}</div>
    <div class="conn" id="conn" hidden>Reconnecting…</div>
    ${composer}`;
}
function fill(messages) {
  const b = box(); let prev = null; let h = '';
  messages.forEach((m) => { h += msgHtml(m, prev).s; prev = m; });
  b.insertAdjacentHTML('afterbegin', h);
  b.scrollTop = b.scrollHeight;
}
async function catchUp() {
  if (!cur) return;
  try {
    const d = await api('GET', `/api/chat/messages?room=${encodeURIComponent(cur.id)}&after=${cur.lastAt}`);
    d.messages.forEach(append); const o = document.getElementById('online'); if (o) o.textContent = d.online;
  } catch (e) { /* offline for now */ }
}
function openStream(id) {
  es = new EventSource('/api/chat/stream?room=' + encodeURIComponent(id));
  es.addEventListener('message', (e) => { try { append(JSON.parse(e.data)); } catch (x) { /* ignore */ } });
  es.addEventListener('delete', (e) => { const { id: mid } = JSON.parse(e.data); box()?.querySelector(`.m[data-id="${mid}"]`)?.remove(); });
  es.addEventListener('clear', () => { if (box()) box().innerHTML = ''; });
  es.addEventListener('presence', (e) => { const o = document.getElementById('online'); if (o) o.textContent = JSON.parse(e.data).online; });
  es.onopen = () => { const c = document.getElementById('conn'); if (c) c.hidden = true; catchUp(); };
  es.onerror = () => { const c = document.getElementById('conn'); if (c) c.hidden = false; };
  poll = setInterval(() => { if (!es || es.readyState !== 1) catchUp(); }, 20000); // backup when live updates are blocked
}

/* ---------- page ---------- */
export const needsLogin = true;
export async function render({ S, user, config }, params) {
  closeAll();
  if (!config().chatEnabled) return emptyState('chat', 'Chat is switched off', 'The admins have turned chat off for now.');
  window.__altUser = user();
  const r = await api('GET', '/api/chat/rooms'); rooms = r.rooms; me = r.me;
  const id = params.room || '';
  let d = null;
  if (id) {
    d = await api('GET', `/api/chat/messages?room=${encodeURIComponent(id)}`);
    cur = { id, lastAt: d.messages.length ? d.messages[d.messages.length - 1].at : 0, data: d };
  }
  return html`<div class="chat ${id ? 'in-room' : ''}"><aside class="chat-list">${listHtml(id)}</aside>
    <section class="chat-main">${d ? mainHtml(d) : html`<div class="chat-empty">${icon('chat', 44)}<h3>Choose a room</h3><p class="muted">Pick a room on the left to start chatting.</p></div>`}</section></div>`;
}
export function after(ctx, view, params) {
  fit(); requestAnimationFrame(fit); window.addEventListener('resize', fit);
  listTimer = setInterval(refreshList, 30000);
  if (!cur) return;
  fill(cur.data.messages); markSeen(cur.id, cur.lastAt); openStream(cur.id);
  const ta = document.getElementById('chat-in');
  if (ta) {
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ta.form.requestSubmit(); } });
    ta.addEventListener('input', () => { ta.style.height = '46px'; ta.style.height = Math.min(Math.max(ta.scrollHeight, 46), 110) + 'px'; });
    if (window.innerWidth >= 900) ta.focus();
  }
}
export const chatRoom = { needsLogin: true, render, after };

export const actions = {
  async 'chat-send'(form) {
    const ta = form.querySelector('textarea'); const text = ta.value.trim(); if (!text || !cur) return;
    const btn = form.querySelector('button'); btn.disabled = true;
    try {
      const r = await api('POST', '/api/chat/send', { room: cur.id, text });
      ta.value = ''; ta.style.height = '46px'; append(r.message);
    } catch (e) { toast(e.message, 'bad'); }
    btn.disabled = false; ta.focus();
  },
  async 'chat-del'(el) {
    if (!(await confirmBox({ title: 'Delete this message?', text: 'It will disappear for everyone in the room.', yes: 'Delete', danger: true }))) return;
    try { await api('POST', '/api/chat/delete', { room: cur.id, id: el.dataset.id }); box()?.querySelector(`.m[data-id="${el.dataset.id}"]`)?.remove(); } catch (e) { toast(e.message, 'bad'); }
  },
  async 'chat-report'(el) {
    if (!(await confirmBox({ title: 'Report this message?', text: 'Admins will review it. Use this for abuse, spam or anything unsafe.', yes: 'Report', danger: true }))) return;
    try { await api('POST', '/api/chat/report', { room: cur.id, id: el.dataset.id }); toast('Thanks. An admin will take a look.'); } catch (e) { toast(e.message, 'bad'); }
  },
};
