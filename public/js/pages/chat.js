/* Chat rooms: a list of rooms the student may enter, and a live conversation. */
import { html, raw, esc, icon, api, toast, avatar, ago, confirmBox, debounce } from '../core/ui.js';
import { emptyState, hasPlace } from './shared.js';

let es = null; let poll = null; let listTimer = null; let cur = null; // cur = the open conversation
let rooms = []; let me = ''; let dms = []; let dmEnabled = true; let dmOff = false;
const byId = new Map(); // messages on screen, by id
const EMOJIS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];
const isDm = () => !!(cur && cur.data.room.kind === 'dm');

/* ---------- helpers ---------- */
function closeAll() {
  if (es) { es.close(); es = null; }
  clearInterval(poll); clearInterval(listTimer); poll = listTimer = null; cur = null; byId.clear(); closeMenu();
  window.removeEventListener('resize', fit);
}
window.addEventListener('hashchange', () => { closeMenu(); if (!location.hash.startsWith('#/chat')) closeAll(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

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

const rxHtml = (m) => {
  const e = Object.entries(m.reactions || {});
  return e.length ? html`<div class="rx">${e.map(([k, u]) => html`<button type="button" class="rx-c ${u.includes(me) ? 'on' : ''}" data-action="chat-react" data-id="${m.id}" data-e="${k}" aria-label="${k} ${u.length}">${k}<span>${u.length}</span></button>`)}</div>` : html``;
};
function msgHtml(m, prev) {
  const mine = m.uid === me;
  const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
  const grouped = prev && !newDay && prev.uid === m.uid && m.at - prev.at < 5 * 60000;
  const av = m.admin ? html`<span class="avatar sm adm-av">${icon('shield', 16)}</span>` : avatar(m.name, m.avatar, 'sm');
  const avLink = dmEnabled && !isDm() && !m.admin ? html`<a class="av-link" href="#/chat/dm/${m.uid}" aria-label="Message ${m.name}">${av}</a>` : av;
  return html`${newDay ? html`<div class="day-sep"><span>${dayLabel(m.at)}</span></div>` : ''}
    <div class="m ${mine ? 'mine' : ''} ${m.admin ? 'adm' : ''} ${grouped ? 'grp' : ''}" data-id="${m.id}" data-uid="${m.uid}" data-at="${m.at}">
      ${mine ? '' : (grouped ? html`<span class="av-gap"></span>` : avLink)}
      <div class="mb">
        ${grouped ? '' : html`<div class="mh"><b>${mine ? 'You' : m.name}</b>${m.admin ? html`<span class="chip gold-tag">Admin</span>` : ''}<time>${hhmm(m.at)}</time></div>`}
        <div class="bubble" data-action="chat-menu" data-id="${m.id}">${m.reply ? html`<button type="button" class="quote" data-action="chat-jump" data-id="${m.reply.id}"><b>${m.reply.uid === me ? 'You' : m.reply.name}</b><span>${m.reply.text}</span></button>` : ''}${linkify(m.text)}</div>
        <div class="rx-wrap">${rxHtml(m)}</div>
        <div class="macts">${grouped ? html`<time>${hhmm(m.at)}</time>` : ''}<button type="button" data-action="chat-reply" data-id="${m.id}">Reply</button>${mine ? html`<button type="button" data-action="chat-del" data-id="${m.id}">Delete</button>` : (m.admin ? '' : html`<button type="button" data-action="chat-report" data-id="${m.id}">Report</button>`)}</div>
      </div></div>`;
}
function closeMenu() { document.getElementById('cmenu')?.remove(); }
function showReply() {
  const bar = document.getElementById('replybar'); if (!bar) return;
  if (!cur || !cur.reply) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.innerHTML = html`<div class="rb-t"><b>Replying to ${cur.reply.uid === me ? 'yourself' : cur.reply.name}</b><span>${cur.reply.text}</span></div><button type="button" class="icon-btn" data-action="chat-reply-x" aria-label="Cancel reply">${icon('x', 16)}</button>`.s;
  bar.hidden = false; document.getElementById('chat-in')?.focus();
}
function setReactions(id, reactions) {
  const m = byId.get(id); if (!m) return;
  if (reactions && Object.keys(reactions).length) m.reactions = reactions; else delete m.reactions;
  const w = box()?.querySelector(`.m[data-id="${id}"] .rx-wrap`); if (w) w.innerHTML = rxHtml(m).s;
}
function setOnline(n) {
  const o = document.getElementById('online'); if (!o) return;
  o.textContent = isDm() ? (n >= 2 ? 'Online now' : 'Offline') : n;
}

const box = () => document.getElementById('msgs');
const nearBottom = () => { const b = box(); return b.scrollHeight - b.scrollTop - b.clientHeight < 120; };
function lastMsgEl() { const all = box().querySelectorAll('.m'); return all[all.length - 1] || null; }
function append(m) {
  const b = box(); if (!b || !cur || m.room && m.room !== cur.id) return;
  if (b.querySelector(`.m[data-id="${m.id}"]`)) return;
  byId.set(m.id, m);
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
function dmSection(activeId, seen) {
  if (!dmEnabled) return '';
  return html`<div class="list-h">Personal messages</div>
    <label class="searchbox dm-find">${icon('search', 18)}<span class="sr">Find a student</span><input id="dm-q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="30" placeholder="Find a student by username" data-input="dm-find"></label>
    <div id="dm-res"></div>
    <div class="room-list" role="list">${dms.map((d) => {
      const unread = !d.last.mine && d.last.at > (seen[d.id] || 0) && d.id !== activeId;
      return html`<a class="room-row ${d.id === activeId ? 'on' : ''}" role="listitem" href="#/chat/${d.id}">${avatar(d.other.name, d.other.avatar)}
        <span class="grow"><b>${d.other.name}</b><br><span class="tiny muted rp">${d.last.mine ? 'You: ' : ''}${d.last.text}</span></span>
        <span class="room-meta"><span class="tiny muted">${ago(d.last.at).replace(' ago', '')}</span>${unread ? html`<i class="dot" aria-label="Unread messages"></i>` : ''}${d.online ? html`<span class="tiny on-n">online</span>` : ''}</span></a>`;
    })}</div>
    ${dms.length ? '' : html`<p class="tiny muted" style="padding:6px 16px">No personal chats yet. Search above, or tap a student's picture in a room or on the leaderboard.</p>`}
    <label class="dm-allow tiny"><input type="checkbox" data-change="dm-allow" ${dmOff ? '' : raw('checked')}> Let other students message me</label>`;
}
function listHtml(activeId) {
  const seen = seenMap();
  return html`<div class="chat-head"><h2>Chat</h2></div>
    <div class="list-h">Rooms</div>
    <div class="room-list" role="list">${rooms.map((r) => {
      const unread = r.last && r.last.uid !== me && r.last.at > (seen[r.id] || 0) && r.id !== activeId;
      return html`<a class="room-row ${r.id === activeId ? 'on' : ''}" role="listitem" href="#/chat/${r.id}">
        <span class="room-ic ${r.kind}">${icon(r.kind === 'general' ? 'users' : r.kind === 'custom' ? 'bell' : 'book', 20)}</span>
        <span class="grow"><b>${r.name}</b>${r.readOnly ? html` <span class="chip grey">Read only</span>` : ''}<br><span class="tiny muted rp">${r.last ? r.last.name + ': ' + r.last.text : r.desc}</span></span>
        <span class="room-meta">${r.last ? html`<span class="tiny muted">${ago(r.last.at).replace(' ago', '')}</span>` : ''}${unread ? html`<i class="dot" aria-label="Unread messages"></i>` : ''}${r.online ? html`<span class="tiny on-n">${r.online} online</span>` : ''}</span></a>`;
    })}</div>
    ${!hasPlace(window.__altUser) ? html`<p class="tiny muted" style="padding:12px 16px">Add your department and level in <a href="#/profile">your profile</a> to join your department and class rooms.</p>` : ''}
    ${dmSection(activeId, seen)}`;
}
async function refreshList() {
  const q = document.getElementById('dm-q'); if (q && (q.value || document.activeElement === q)) return; // do not wipe a search in progress
  try { const r = await api('GET', '/api/chat/rooms'); rooms = r.rooms; dms = r.dms || []; const el = document.querySelector('.chat-list'); if (el) el.innerHTML = listHtml(cur && cur.id).s; } catch (e) { /* try again later */ }
}

/* ---------- conversation ---------- */
function mainHtml(d) {
  const r = d.room; const dm = r.kind === 'dm';
  const composer = d.canPost
    ? html`<div class="replybar" id="replybar" hidden></div><form class="composer" data-submit="chat-send" novalidate><label class="sr" for="chat-in">Message</label><textarea id="chat-in" rows="1" maxlength="600" placeholder="Message ${r.name}" enterkeyhint="send" autocomplete="off"></textarea><button class="btn primary icon-send" type="submit" aria-label="Send">${icon('send', 20)}</button></form>`
    : html`<div class="composer off">${d.muted ? 'An admin has muted you, so you can read but not post.' : (d.blockedMsg || 'Only admins can post in this room.')}</div>`;
  const head = dm
    ? html`<div class="chat-head room"><a class="icon-btn back" href="#/chat" aria-label="Back to chats">${icon('back', 20)}</a>${avatar(r.other.name, r.other.avatar, 'sm')}
      <div class="grow"><h3>${r.name}</h3><p class="tiny muted"><span id="online">${d.online >= 2 ? 'Online now' : 'Offline'}</span> · Personal chat</p></div>
      <button type="button" class="btn ghost small" data-action="dm-block" data-uid="${r.other.id}" data-state="${d.iBlocked ? 1 : 0}">${d.iBlocked ? 'Unblock' : 'Block'}</button></div>`
    : html`<div class="chat-head room"><a class="icon-btn back" href="#/chat" aria-label="Back to rooms">${icon('back', 20)}</a>
      <div class="grow"><h3>${r.name}</h3><p class="tiny muted"><span id="online">${d.online}</span> online${r.desc ? ' · ' + r.desc : ''}</p></div></div>`;
  return html`${head}
    <div class="msgs" id="msgs" aria-live="polite">${d.messages.length ? '' : html`<div class="empty-chat">${icon('chat', 34)}<p>${dm ? html`No messages yet.<br>Say hello to ${r.name}.` : html`No messages yet.<br>Be the first to say hello.`}</p></div>`}</div>
    <div class="conn" id="conn" hidden>Reconnecting…</div>
    ${composer}`;
}
function fill(messages) {
  const b = box(); let prev = null; let h = '';
  messages.forEach((m) => { byId.set(m.id, m); h += msgHtml(m, prev).s; prev = m; });
  b.insertAdjacentHTML('afterbegin', h);
  b.scrollTop = b.scrollHeight;
}
async function catchUp() {
  if (!cur) return;
  try {
    const d = await api('GET', `/api/chat/messages?room=${encodeURIComponent(cur.id)}&after=${cur.lastAt}`);
    d.messages.forEach(append); setOnline(d.online);
  } catch (e) { /* offline for now */ }
}
function openStream(id) {
  es = new EventSource('/api/chat/stream?room=' + encodeURIComponent(id));
  es.addEventListener('message', (e) => { try { append(JSON.parse(e.data)); } catch (x) { /* ignore */ } });
  es.addEventListener('delete', (e) => { const { id: mid } = JSON.parse(e.data); byId.delete(mid); box()?.querySelector(`.m[data-id="${mid}"]`)?.remove(); });
  es.addEventListener('reaction', (e) => { try { const d = JSON.parse(e.data); setReactions(d.id, d.reactions); } catch (x) { /* ignore */ } });
  es.addEventListener('clear', () => { if (box()) box().innerHTML = ''; });
  es.addEventListener('presence', (e) => setOnline(JSON.parse(e.data).online));
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
  const r = await api('GET', '/api/chat/rooms'); rooms = r.rooms; me = r.me; dms = r.dms || []; dmEnabled = r.dmEnabled !== false; dmOff = !!r.dmOff;
  let id = params.room || '';
  if (id.startsWith('dm/')) { // arrived by tapping someone's picture
    try { id = (await api('GET', '/api/chat/user?id=' + encodeURIComponent(id.slice(3)))).room; } catch (e) { return emptyState('chat', 'Student not found', e.message); }
  }
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
      const r = await api('POST', '/api/chat/send', { room: cur.id, text, replyTo: cur.reply ? cur.reply.id : undefined });
      ta.value = ''; ta.style.height = '46px'; cur.reply = null; showReply(); append(r.message);
    } catch (e) { toast(e.message, 'bad'); }
    btn.disabled = false; ta.focus();
  },
  async 'chat-del'(el) {
    closeMenu();
    if (!(await confirmBox({ title: 'Delete this message?', text: 'It will disappear for everyone in the chat.', yes: 'Delete', danger: true }))) return;
    try { await api('POST', '/api/chat/delete', { room: cur.id, id: el.dataset.id }); byId.delete(el.dataset.id); box()?.querySelector(`.m[data-id="${el.dataset.id}"]`)?.remove(); } catch (e) { toast(e.message, 'bad'); }
  },
  async 'chat-report'(el) {
    closeMenu();
    if (!(await confirmBox({ title: 'Report this message?', text: 'Admins will review it. Use this for abuse, spam or anything unsafe.', yes: 'Report', danger: true }))) return;
    try { await api('POST', '/api/chat/report', { room: cur.id, id: el.dataset.id }); toast('Thanks. An admin will take a look.'); } catch (e) { toast(e.message, 'bad'); }
  },
  // Tap a message: reactions, reply, copy, and delete or report.
  'chat-menu'(el, ev) {
    if (ev.target.closest('a, .quote') || !cur) return;
    const m = byId.get(el.dataset.id); if (!m) return;
    closeMenu();
    const mine = m.uid === me; const canPost = cur.data.canPost;
    const mineRx = Object.keys(m.reactions || {}).find((k) => m.reactions[k].includes(me));
    const wrap = document.createElement('div'); wrap.id = 'cmenu'; wrap.className = 'cmenu-back'; wrap.dataset.action = 'chat-menu-close';
    wrap.innerHTML = html`<div class="cmenu" role="dialog" aria-label="Message options">
      ${canPost ? html`<div class="cm-rx">${EMOJIS.map((e) => html`<button type="button" class="${mineRx === e ? 'on' : ''}" data-action="chat-react" data-id="${m.id}" data-e="${e}" aria-label="React ${e}">${e}</button>`)}</div>` : ''}
      ${canPost ? html`<button type="button" class="cm-i" data-action="chat-reply" data-id="${m.id}">Reply</button>` : ''}
      <button type="button" class="cm-i" data-action="chat-copy" data-id="${m.id}">Copy text</button>
      ${mine ? html`<button type="button" class="cm-i bad" data-action="chat-del" data-id="${m.id}">Delete</button>` : (m.admin ? '' : html`<button type="button" class="cm-i bad" data-action="chat-report" data-id="${m.id}">Report</button>`)}
      <button type="button" class="cm-i" data-action="chat-menu-close">Close</button></div>`.s;
    document.body.appendChild(wrap);
    wrap.querySelector('button')?.focus();
  },
  'chat-menu-close'(el, ev) { if (el.id === 'cmenu' && ev.target !== el) return; closeMenu(); },
  async 'chat-react'(el) {
    closeMenu();
    if (!cur) return;
    try { const r = await api('POST', '/api/chat/react', { room: cur.id, id: el.dataset.id, emoji: el.dataset.e }); setReactions(el.dataset.id, r.reactions); } catch (e) { toast(e.message, 'bad'); }
  },
  'chat-reply'(el) {
    closeMenu(); const m = byId.get(el.dataset.id); if (!m || !cur || !cur.data.canPost) return;
    cur.reply = { id: m.id, uid: m.uid, name: m.name, text: String(m.text).slice(0, 120) }; showReply();
  },
  'chat-reply-x'() { if (cur) cur.reply = null; showReply(); },
  async 'chat-copy'(el) {
    closeMenu(); const m = byId.get(el.dataset.id); if (!m) return;
    try { await navigator.clipboard.writeText(m.text); toast('Copied.'); } catch (e) { toast('Could not copy. Press and hold the text instead.', 'bad'); }
  },
  'chat-jump'(el) {
    const t = box()?.querySelector(`.m[data-id="${el.dataset.id}"]`);
    if (!t) return toast('That message is further back or was deleted.');
    t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1600);
  },
  'dm-find': debounce(async (el) => {
    const out = document.getElementById('dm-res'); if (!out) return;
    const q = el.value.trim(); if (q.length < 2) { out.innerHTML = ''; return; }
    try {
      const r = await api('GET', '/api/chat/find?q=' + encodeURIComponent(q));
      out.innerHTML = (r.users.length ? html`<div class="room-list">${r.users.map((u) => html`<a class="room-row" href="#/chat/dm/${u.id}">${avatar(u.name, u.avatar)}<span class="grow"><b>${u.name}</b><br><span class="tiny muted">Send a message</span></span></a>`)}</div>` : html`<p class="tiny muted" style="padding:6px 16px">No student with that username.</p>`).s;
    } catch (e) { out.innerHTML = html`<p class="tiny muted" style="padding:6px 16px">${e.message}</p>`.s; }
  }, 300),
  async 'dm-allow'(el) {
    try { const r = await api('POST', '/api/chat/dm-settings', { allow: el.checked }); dmOff = r.dmOff; toast(dmOff ? 'Other students can no longer start a chat with you.' : 'Other students can message you.'); } catch (e) { el.checked = !el.checked; toast(e.message, 'bad'); }
  },
  async 'dm-block'(el, ev, { renderView }) {
    const on = el.dataset.state === '1';
    if (!on && !(await confirmBox({ title: 'Block this student?', text: 'Neither of you can send messages in this chat until you unblock them.', yes: 'Block', danger: true }))) return;
    try { await api('POST', '/api/chat/block', { uid: el.dataset.uid, blocked: !on }); toast(on ? 'Unblocked.' : 'Blocked.'); renderView(); } catch (e) { toast(e.message, 'bad'); }
  },
};
