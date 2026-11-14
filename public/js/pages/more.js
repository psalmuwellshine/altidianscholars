// Student extras: bookmarks, question of the day, weak topics, study groups, receipts and department transfers.
import { html, raw, icon, api, toast, dialog, confirmBox, ago, fmtDate, pct, plural, siteOrigin } from '../core/ui.js';
import { resourceCard, emptyState, scopeOptions, currentScope } from './shared.js';
import { canSave, isSaved } from '../core/offline.js';
import { reportButton } from './report.js';
import { embedOf } from '../core/video.js';
import { passButton } from './pay.js';

const nairaOf = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');

/* ---------- bookmarks and notes ---------- */
let M = null; // the student's bookmarks, loaded once
const key = (t, id, i) => t + ':' + id + ':' + (i === undefined || i === '' || i === null ? '' : i);
export async function prime(force) { if (M && !force) return M; try { M = (await api('GET', '/api/marks')).items; } catch (e) { M = M || []; } return M; }
export const resetMarks = () => { M = null; };
export const isMarked = (t, id, i) => !!M && M.some((m) => key(m.t, m.id, m.i) === key(t, id, i));
export const markBtn = (t, id, i) => html`<button class="btn ghost small rep-btn mark-btn ${isMarked(t, id, i) ? 'on' : ''}" data-action="mark-toggle" data-t="${t}" data-id="${id}" data-i="${i === undefined ? '' : i}" type="button" aria-pressed="${isMarked(t, id, i)}" title="Bookmark">${icon('star', 14)} <span>${isMarked(t, id, i) ? 'Saved' : 'Bookmark'}</span></button>`;

export const bookmarks = {
  needsLogin: true,
  async render({ S }) {
    const items = await prime(true); const st = S.state;
    const rows = items.map((m) => {
      if (m.t === 'm') { const mat = st.materials.find((x) => x.id === m.id); return mat ? { m, mat } : null; }
      const qz = st.quizzes.find((x) => x.id === m.id); const q = qz && qz.questions[m.i]; return q ? { m, qz, q } : null;
    }).filter(Boolean);
    const qs = rows.filter((r) => r.q); const ms = rows.filter((r) => r.mat);
    return html`<div class="sec-head"><div><h2>Bookmarks</h2><p>Questions and resources you starred, with your own notes. Only you can see these.</p></div></div>
      ${!rows.length ? emptyState('star', 'Nothing bookmarked yet', 'Tap Bookmark on a quiz question or a resource to keep it here.') : ''}
      ${qs.length ? html`<h3 style="margin:6px 0 12px">Questions</h3>${qs.map(({ m, qz, q }) => html`<article class="card flat" style="margin-bottom:12px"><div class="row gap-s wrap-r"><span class="chip">${qz.course}</span><span class="tiny muted">${qz.title} · question ${m.i + 1}</span></div>
        <p style="font-weight:700;margin:8px 0">${q.q}</p><p class="small"><b>Answer:</b> ${q.o[q.a]}</p>${q.e ? html`<p class="small muted">${q.e}</p>` : ''}
        <label class="field" style="margin-top:8px"><span class="tiny muted">My note</span><textarea rows="2" maxlength="300" data-change="mark-note" data-t="q" data-id="${m.id}" data-i="${m.i}" placeholder="Add a reminder for yourself">${m.note}</textarea></label>
        <div class="row gap-s wrap-r"><a class="btn ghost small" href="#/quiz/${qz.id}">Open quiz</a><button class="btn ghost small" data-action="mark-remove" data-t="q" data-id="${m.id}" data-i="${m.i}" type="button">Remove</button></div></article>`)}` : ''}
      ${ms.length ? html`<h3 style="margin:22px 0 12px">Resources</h3><div class="cards">${ms.map(({ mat }) => resourceCard(mat))}</div>` : ''}`;
  },
};

/* ---------- question of the day ---------- */
export const qotdSlot = () => html`<div id="qotd" style="margin-top:16px"></div>`;
const L = ['A', 'B', 'C', 'D'];
function qotdHtml(q) {
  if (q.none) return html``;
  const streak = q.streak ? html`<span class="chip gold">${icon('star', 13)} ${q.streak}-day streak</span>` : '';
  const head = html`<div class="row between wrap-r"><span class="tag-lite">${icon('quiz', 16)} Question of the day</span>${streak}</div><p class="tiny muted" style="margin-top:4px">${q.course} · ${q.title}</p>`;
  if (q.answered) return html`<div class="card qotd">${head}<h3 class="q-text" style="margin:10px 0">${q.q}</h3>
    <div class="opts">${q.o.map((o, i) => html`<div class="opt ${i === q.a ? 'right' : i === q.picked ? 'wrong' : ''}"><span class="l">${i === q.a ? icon('check', 18) : i === q.picked ? icon('x', 18) : L[i]}</span><span>${o}</span></div>`)}</div>
    ${q.e ? html`<div class="expl"><b>Why: </b>${q.e}</div>` : ''}<p class="small muted" style="margin-top:10px">${q.correct ? 'Correct! +' + q.points + ' points.' : 'Not this time.'} Come back tomorrow to keep your streak${q.best > 1 ? ' (best: ' + q.best + ' days)' : ''}.</p></div>`;
  return html`<div class="card qotd">${head}<h3 class="q-text" style="margin:10px 0">${q.q}</h3>
    <div class="opts">${q.o.map((o, i) => html`<button class="opt" data-action="qotd-pick" data-i="${i}" type="button"><span class="l">${L[i]}</span><span>${o}</span></button>`)}</div>
    <p class="tiny muted" style="margin-top:8px">One try a day. A right answer earns ${q.points} points.</p></div>`;
}
export async function hydrateQotd() {
  const el = document.getElementById('qotd'); if (!el) return;
  try { const q = await api('GET', '/api/qotd'); el.innerHTML = qotdHtml(q).s; } catch (e) { el.innerHTML = ''; }
}

/* ---------- weak topics ---------- */
export function weakCard(S) {
  const st = S.state; const best = (st.me && st.me.best) || {}; const missed = (st.me && st.me.missed) || {};
  const by = new Map();
  st.quizzes.forEach((q) => { const b = best[q.id]; if (!b) return; const x = by.get(q.course) || { course: q.course, c: 0, t: 0, miss: 0, quiz: null }; x.c += b.correct; x.t += b.total; x.miss += (missed[q.id] || []).length; if (!x.quiz || (missed[q.id] || []).length > (missed[x.quiz.id] || []).length) x.quiz = q; by.set(q.course, x); });
  const rows = [...by.values()].filter((x) => x.t > 0).map((x) => Object.assign(x, { avg: pct(x.c, x.t) })).sort((a, b) => a.avg - b.avg).slice(0, 3).filter((x) => x.avg < 85);
  if (!rows.length) return '';
  return html`<section class="card weak" style="margin-bottom:16px"><h3 style="margin-bottom:4px">Where to focus</h3><p class="muted small" style="margin-bottom:10px">Your lowest courses so far, from your best quiz scores.</p>
    ${rows.map((x) => html`<div class="row between gap-s wrap-r" style="padding:8px 0;border-top:1px solid var(--line)"><span><b>${x.course}</b> <span class="muted small">${x.avg}% average</span></span>
      ${x.miss ? html`<a class="btn gold small" href="#/quiz/${x.quiz.id}?mode=practice">${icon('refresh', 14)} Practise ${plural(x.miss, 'mistake')}</a>` : html`<a class="btn ghost small" href="#/quiz/${x.quiz.id}">Retake</a>`}</div>`)}</section>`;
}

/* ---------- study groups ---------- */
const meetLine = (m) => [m.date ? fmtDate(Date.parse(m.date + 'T00:00:00Z'), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '', m.time, m.place].filter(Boolean).join(' · ');
export const groups = {
  needsLogin: true,
  async render() {
    const d = await api('GET', '/api/groups');
    return html`<div class="sec-head"><div><h2>Study groups</h2><p>Small private groups for a course or topic, with a shared to-do list and meeting time. Join with a code from a friend.</p></div></div>
      <div class="row gap-s wrap-r" style="margin-bottom:16px"><button class="btn primary" data-action="grp-new" type="button">${icon('plus', 17)} Start a group</button><button class="btn ghost" data-action="grp-join" type="button">${icon('users', 17)} Join with a code</button></div>
      ${d.groups.length ? html`<div class="cards">${d.groups.map((g) => html`<a class="card flat" href="#/group/${g.id}" style="text-decoration:none;color:inherit"><div class="row gap-s wrap-r">${g.course ? html`<span class="chip">${g.course}</span>` : ''}<span class="chip grey">${plural(g.members.length, 'member')}</span>${g.owner ? html`<span class="chip brand">Owner</span>` : ''}</div>
        <h3 style="margin:8px 0 4px">${g.name}</h3><p class="small muted">${meetLine(g.meet) || 'No meeting set yet'}</p><p class="small" style="margin-top:6px">${g.todos.filter((t) => !t.done).length} open tasks</p></a>`)}</div>` : emptyState('users', 'No groups yet', 'Start one, or ask a friend for their group code.')}`;
  },
};
const meetFields = (g = {}) => { const m = g.meet || {}; return html`<div class="grid2"><label class="field"><span>Meeting day (optional)</span><input name="date" type="date" value="${m.date || ''}"></label><label class="field"><span>Time</span><input name="time" type="time" value="${m.time || ''}"></label></div>
  <label class="field"><span>Place (optional)</span><input name="place" maxlength="60" placeholder="e.g. Library, second floor" value="${m.place || ''}"></label>
  <label class="field"><span>WhatsApp or Telegram group link (optional)</span><input name="link" maxlength="200" placeholder="https://chat.whatsapp.com/…" value="${g.link || ''}"></label>`; };
export const group = {
  needsLogin: true,
  async render({ S }, { id }) {
    const g = await api('GET', '/api/groups/' + id);
    return html`<p><a href="#/groups" class="small">← All groups</a></p>
      <div class="sec-head"><div><h2>${g.name}</h2><p>${g.course ? g.course + ' · ' : ''}${plural(g.members.length, 'member')}</p></div></div>
      <div class="card flat" style="margin-bottom:16px"><div class="row between wrap-r gap-s"><div><b>Invite code</b><br><span class="mono" style="font-size:1.6rem;letter-spacing:.14em">${g.code}</span></div>
        <button class="btn ghost small" data-action="grp-copy" data-code="${g.code}" data-name="${g.name}" type="button">${icon('share', 15)} Share</button></div>
        <p class="tiny muted" style="margin-top:6px">Anyone with this code can join. Share it only with people you want in.</p></div>
      <div class="card flat" style="margin-bottom:16px"><h3 style="margin-bottom:6px">Next meeting</h3><p>${meetLine(g.meet) || 'Not set yet.'}</p>
        ${g.link ? html`<p style="margin-top:8px"><a class="btn primary small" href="${g.link}" target="_blank" rel="noopener noreferrer nofollow">${icon('chat', 15)} Open group chat</a></p>` : ''}
        ${g.owner ? html`<p style="margin-top:8px"><button class="btn ghost small" data-action="grp-edit" data-id="${g.id}" type="button">Edit details</button></p>` : ''}</div>
      <section class="card" style="margin-bottom:16px"><h3 style="margin-bottom:10px">To-do list</h3>
        <form class="row gap-s" data-submit="grp-todo" data-id="${g.id}" novalidate><label class="sr" for="todo-in">New task</label><input id="todo-in" name="text" maxlength="120" placeholder="e.g. Read chapter 4 of Harper" style="flex:1;min-width:0"><button class="btn primary small" type="submit">${icon('plus', 15)} Add</button></form>
        ${g.todos.length ? html`<ul class="todo">${g.todos.map((t) => html`<li class="${t.done ? 'done' : ''}"><button class="todo-chk" data-action="grp-toggle" data-id="${g.id}" data-tid="${t.id}" type="button" aria-label="Mark done">${t.done ? icon('check', 16) : ''}</button><span class="grow">${t.text}<br><span class="tiny muted">${t.by}</span></span><button class="icon-btn small-ic" data-action="grp-todo-del" data-id="${g.id}" data-tid="${t.id}" type="button" aria-label="Remove">${icon('x', 14)}</button></li>`)}</ul>` : html`<p class="muted small" style="margin-top:10px">No tasks yet.</p>`}</section>
      <section class="card flat"><h3 style="margin-bottom:8px">Members</h3><p>${g.members.map((m) => m.name + (m.owner ? ' (owner)' : '')).join(', ')}</p>
        <p style="margin-top:12px" class="row gap-s wrap-r"><button class="btn ghost small" data-action="grp-leave" data-id="${g.id}" type="button">Leave group</button>${g.owner ? html`<button class="btn ghost small" data-action="grp-delete" data-id="${g.id}" type="button">Delete group</button>` : ''}</p></section>`;
  },
};
const withMsg = async (form, fn) => { const m = form.querySelector('.msg'); if (m) m.hidden = true; const b = form.querySelector('[type=submit]'); if (b) b.disabled = true; try { await fn(); } catch (e) { if (m) { m.textContent = e.message; m.hidden = false; } else toast(e.message, 'bad'); if (b) b.disabled = false; } };

/* ---------- receipts ---------- */
let RC = [], WHO = '';
const CH = { card: 'Card', bank: 'Bank', bank_transfer: 'Bank transfer', ussd: 'USSD', qr: 'QR code', mobile_money: 'Mobile money', apple_pay: 'Apple Pay' };
export const receipts = {
  needsLogin: true,
  async render({ user, config }) {
    const d = await api('GET', '/api/receipts'); RC = d.receipts; WHO = d.username;
    return html`<div class="sec-head"><div><h2>My purchases</h2><p>What you have unlocked, and your receipts.</p></div></div>
      ${passButton(config(), Object.assign({}, user(), { paidUntil: d.paidUntil }))}
      <div class="card flat" style="margin-bottom:16px"><div class="row gap-s wrap-r"><span class="chip ${d.passActive ? 'good' : 'grey'}">${icon(d.passActive ? 'check' : 'lock', 13)} Semester pass</span>
        <span>${d.passActive ? 'Active until ' + fmtDate(Date.parse(d.paidUntil + 'T00:00:00Z'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : d.paidUntil ? 'Ended ' + fmtDate(Date.parse(d.paidUntil + 'T00:00:00Z'), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'You do not have a pass.'}</span></div></div>
      ${d.items.length ? html`<h3 style="margin:6px 0 10px">Unlocked items</h3><div class="card flat" style="margin-bottom:16px"><ol class="lb">${d.items.map((x) => html`<li><span class="ico-box">${icon(x.what === 'quiz' ? 'quiz' : 'book', 18)}</span><span class="grow"><b>${x.title}</b><br><span class="tiny muted">${x.course} · ${x.what}</span></span></li>`)}</ol></div>` : ''}
      <h3 style="margin:6px 0 10px">Receipts</h3>
      ${d.receipts.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Receipt</th><th>For</th><th class="num">Amount</th><th>Date</th><th></th></tr></thead><tbody>${d.receipts.map((r) => html`<tr><td class="mono">${r.no}</td><td>${r.title}${r.until ? html`<br><span class="tiny muted">until ${r.until}</span>` : ''}</td><td class="num">${r.amount ? nairaOf(r.amount) : '—'}</td><td>${fmtDate(r.at)}</td><td><button class="btn ghost small" data-action="rcpt-view" data-id="${r.id}" type="button">View</button></td></tr>`)}</tbody></table></div>` : emptyState('check', 'No receipts yet', 'When you pay online, or an admin unlocks something for you, the receipt shows here.')}`;
  },
};

/* ---------- transfers (shown on the profile) ---------- */
export const transferSection = () => html`<section class="sec folds"><details class="fold" id="transfer"><summary><span class="ico-box">${icon('refresh', 20)}</span><span class="grow"><b>Department transfer</b><br><span class="tiny muted">Applied for a transfer, or want to change department</span></span></summary><div class="fold-body"><div class="card" style="max-width:640px" id="transfer-box"><p class="muted small">Loading…</p></div></div></details></section>`;
export async function hydrateTransfer(S) {
  const box = document.getElementById('transfer-box'); if (!box) return;
  const A = S.state.academics; const dn = (id) => (A.departments.find((d) => d.id === id) || {}).name || '';
  try {
    const t = await api('GET', '/api/transfer/me');
    const depOpts = A.faculties.map((f) => html`<optgroup label="${f.name}">${A.departments.filter((d) => d.facultyId === f.id).map((d) => html`<option value="${d.id}">${d.name}</option>`)}</optgroup>`);
    const declare = html`<form data-submit="tr-declare" novalidate><div class="msg alert bad" hidden role="alert"></div>
      <p class="small">Applied for an inter or intra faculty transfer? Enter your matric number. When the transfer list is published, you are moved to your new department automatically if your number is on it.</p>
      <label class="field"><span>Matric number</span><input name="matric" required autocomplete="off" maxlength="25" placeholder="e.g. NDU/MLS/2023/001" style="text-transform:uppercase"><small>Used only to match the transfer list.</small></label>
      <button class="btn primary" type="submit">I applied for a transfer</button></form>`;
    let out = '';
    if (t.declared) {
      const s = t.declared.status;
      out += s === 'moved' ? html`<div class="alert info">${icon('check', 16)} You were moved by the transfer list. Your department is now <b>${dn(S.state.user.departmentId)}</b>.</div>`.s
        : s === 'not-listed' ? html`<div class="alert warning">Your matric number <b>${t.declared.matric}</b> was not on the transfer list. You can ask for a department change below.</div>`.s
        : html`<div class="alert info">Waiting for the transfer list. Your matric number <b>${t.declared.matric}</b> is saved. You will be moved automatically if it appears.</div><p><button class="btn ghost small" data-action="tr-withdraw" type="button">Remove my application</button></p>`.s;
    } else out += declare.s;
    if (t.request) out += html`<div class="alert ${t.request.status === 'approved' ? 'info' : t.request.status === 'rejected' ? 'warning' : 'info'}" style="margin-top:12px">Your request for <b>${dn(t.request.toDepartmentId)}</b> is <b>${t.request.status}</b>.${t.request.note ? ' ' + t.request.note : ''}</div>`.s;
    if (t.listOut && !(t.request && t.request.status === 'pending') && !(t.declared && t.declared.status === 'moved')) {
      out += html`<hr style="margin:16px 0;border:0;border-top:1px solid var(--line)"><h4 style="margin-bottom:6px">Not on the list? Ask for a department change</h4><form data-submit="tr-request" novalidate><div class="msg alert bad" hidden role="alert"></div>
        <label class="field"><span>Department you want to move to</span><select name="departmentId" required><option value="">Choose…</option>${depOpts}</select></label>
        <label class="field"><span>Reason</span><textarea name="reason" rows="3" maxlength="300" required placeholder="Briefly tell the admin why"></textarea></label>
        <button class="btn primary" type="submit">Send request</button><p class="tiny muted" style="margin-top:6px">An admin approves or declines it.</p></form>`.s;
    }
    box.innerHTML = out;
  } catch (e) { box.innerHTML = '<p class="muted small">Could not load this right now.</p>'; }
}

export const actions = {
  'scope-menu'(el, ev, { user }) {
    const u = user(); const cur = currentScope(u);
    dialog(html`<div class="sheet"><h3>Show me</h3><div class="more-list">${scopeOptions(u, cur, el.dataset.act).map((o) => html`<button class="btn ghost" data-close data-action="${o.act}" data-v="${o.k}" type="button">${o.label}</button>`)}</div><button class="btn ghost block" data-close type="button">Close</button></div>`);
  },
  'more-res'(el, ev, { S }) {
    const m = S.state.materials.find((x) => x.id === el.dataset.id); if (!m) return;
    const long = (m.note || '').length > 140;
    const { box } = dialog(html`<div class="sheet"><h3>${m.title}</h3><p class="tiny muted">${m.course}</p><div class="more-list">
      ${m.locked ? html`<button class="btn gold" data-action="unlock" data-id="${m.id}" data-close type="button">${icon('lock', 16)} Unlock</button>` : html`
      ${(long || (m.note && (m.fileId || m.link))) ? html`<button class="btn ghost" data-action="read" data-id="${m.id}" data-close type="button">${icon('file', 16)} Read notes</button>` : ''}
      ${canSave(m) ? html`<button class="btn ghost save-off ${isSaved(m.id) ? 'on' : ''}" data-action="save-offline" data-id="${m.id}" type="button">${isSaved(m.id) ? 'Saved ✓ (tap to remove)' : 'Save offline'}</button>` : ''}
      ${markBtn('m', m.id)}`}
      ${raw(reportButton('material', m.id).s.replace('data-action', 'data-close data-action'))}
    </div><button class="btn ghost block" data-close type="button">Close</button></div>`);
    box.querySelectorAll('.rep-btn,.mark-btn').forEach((b) => b.classList.remove('small'));
  },
  'more-quiz'(el) {
    const d = el.dataset; const n = Number(d.missed || 0);
    dialog(html`<div class="sheet"><h3>${d.title}</h3><p class="tiny muted">${d.course} · ${d.n} questions</p><div class="more-list">
      <a class="btn ghost" data-close href="#/quiz/${d.id}?mode=exam">${icon('clock', 16)} Timed exam</a>
      <a class="btn ghost" data-close href="#/quiz/${d.id}?mode=cards">${icon('refresh', 16)} Flashcards</a>
      ${n ? html`<a class="btn gold" data-close href="#/quiz/${d.id}?mode=practice">${icon('refresh', 16)} Practise ${n} mistake${n > 1 ? 's' : ''}</a>` : ''}
      <button class="btn ghost" data-action="quiz-share" data-id="${d.id}" data-title="${d.title}" data-course="${d.course}" data-n="${d.n}" type="button">${icon('share', 16)} Share this quiz</button>
    </div><button class="btn ghost block" data-close type="button">Close</button></div>`);
  },
  async 'mark-toggle'(el) {
    const { t, id, i } = el.dataset; await prime(); const on = isMarked(t, id, i);
    try {
      if (on) await api('POST', '/api/marks/remove', { t, id, i: i === '' ? undefined : Number(i) });
      else await api('POST', '/api/marks', { t, id, i: i === '' ? undefined : Number(i) });
      await prime(true);
      document.querySelectorAll('.mark-btn').forEach((b) => { if (b.dataset.t === t && b.dataset.id === id && b.dataset.i === i) { const now = isMarked(t, id, i); b.classList.toggle('on', now); b.setAttribute('aria-pressed', String(now)); b.querySelector('span').textContent = now ? 'Saved' : 'Bookmark'; } });
      toast(on ? 'Bookmark removed.' : 'Bookmarked.');
    } catch (e) { toast(e.message, 'bad'); }
  },
  async 'mark-remove'(el, ev, { renderView }) { const { t, id, i } = el.dataset; try { await api('POST', '/api/marks/remove', { t, id, i: i === '' ? undefined : Number(i) }); renderView(); } catch (e) { toast(e.message, 'bad'); } },
  async 'mark-note'(el) { const { t, id, i } = el.dataset; try { await api('POST', '/api/marks', { t, id, i: i === '' ? undefined : Number(i), note: el.value }); toast('Note saved.'); await prime(true); } catch (e) { toast(e.message, 'bad'); } },
  async 'qotd-pick'(el) {
    const btns = document.querySelectorAll('#qotd .opt'); btns.forEach((b) => { b.disabled = true; });
    try { await api('POST', '/api/qotd', { pick: Number(el.dataset.i) }); await hydrateQotd(); } catch (e) { btns.forEach((b) => { b.disabled = false; }); toast(e.message, 'bad'); }
  },
  'grp-new'() {
    const { box, close } = dialog(html`<h3>Start a study group</h3><form data-submit="grp-create" novalidate><div class="msg alert bad" hidden role="alert"></div>
      <label class="field"><span>Group name</span><input name="name" required maxlength="60" placeholder="e.g. MBH222 night readers" autofocus></label>
      <label class="field"><span>Course (optional)</span><input name="course" maxlength="10" placeholder="MBH222" style="text-transform:uppercase"></label>${meetFields()}
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">Create group</button></div></form>`);
    box.querySelector('form').close = close;
  },
  'grp-join'() {
    const { box, close } = dialog(html`<h3>Join a group</h3><form data-submit="grp-joinsend" novalidate><div class="msg alert bad" hidden role="alert"></div>
      <label class="field"><span>Group code</span><input name="code" required maxlength="8" autocomplete="off" placeholder="6 letters and numbers" style="text-transform:uppercase;letter-spacing:.2em" autofocus></label>
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">Join</button></div></form>`);
    box.querySelector('form').close = close;
  },
  async 'grp-edit'(el) {
    const g = await api('GET', '/api/groups/' + el.dataset.id);
    const { box, close } = dialog(html`<h3>Edit group</h3><form data-submit="grp-update" data-id="${g.id}" novalidate><div class="msg alert bad" hidden role="alert"></div>
      <label class="field"><span>Group name</span><input name="name" required maxlength="60" value="${g.name}"></label>${meetFields(g)}
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
    box.querySelector('form').close = close;
  },
  async 'grp-create'(form, ev, { go }) { await withMsg(form, async () => { const f = new FormData(form); const r = await api('POST', '/api/groups', Object.fromEntries(f.entries())); form.close(); toast('Group created. Share the code ' + r.code + '.'); go('/group/' + r.id); }); },
  async 'grp-joinsend'(form, ev, { go }) { await withMsg(form, async () => { const r = await api('POST', '/api/groups/join', { code: new FormData(form).get('code') }); form.close(); toast('Joined.'); go('/group/' + r.id); }); },
  async 'grp-update'(form, ev, { renderView }) { await withMsg(form, async () => { await api('POST', '/api/groups/' + form.dataset.id + '/update', Object.fromEntries(new FormData(form).entries())); form.close(); toast('Saved.'); renderView(); }); },
  async 'grp-todo'(form, ev, { renderView }) { await withMsg(form, async () => { const text = new FormData(form).get('text'); if (!String(text).trim()) throw new Error('Write the task first.'); await api('POST', '/api/groups/' + form.dataset.id + '/todos', { text }); renderView(); }); },
  async 'grp-toggle'(el, ev, { renderView }) { try { await api('POST', `/api/groups/${el.dataset.id}/todos/${el.dataset.tid}/toggle`); renderView(); } catch (e) { toast(e.message, 'bad'); } },
  async 'grp-todo-del'(el, ev, { renderView }) { try { await api('DELETE', `/api/groups/${el.dataset.id}/todos/${el.dataset.tid}`); renderView(); } catch (e) { toast(e.message, 'bad'); } },
  async 'grp-leave'(el, ev, { go }) { if (!(await confirmBox({ title: 'Leave this group?', text: 'You can rejoin later with the code.', yes: 'Leave' }))) return; try { await api('POST', `/api/groups/${el.dataset.id}/leave`); go('/groups'); } catch (e) { toast(e.message, 'bad'); } },
  async 'grp-delete'(el, ev, { go }) { if (!(await confirmBox({ title: 'Delete this group?', text: 'It is removed for every member.', yes: 'Delete', danger: true }))) return; try { await api('DELETE', '/api/groups/' + el.dataset.id); go('/groups'); } catch (e) { toast(e.message, 'bad'); } },
  async 'rcpt-view'(el) {
    const r = RC.find((x) => x.id === el.dataset.id); if (!r) return;
    const via = r.via === 'online' ? 'Paid online with Paystack' + (r.channel ? ' (' + (CH[r.channel] || r.channel) + ')' : '') : 'Unlocked by an Altidian admin';
    const U = { username: WHO };
    dialog(html`<div class="rcpt-sheet"><div style="text-align:center;margin-bottom:12px"><h2 style="margin:0">Altidian</h2><p class="tiny muted" style="margin:2px 0 0">Payment receipt</p></div>
      <table class="rcpt-tbl"><tbody>
        <tr><th>Receipt no.</th><td class="mono">${r.no}</td></tr>
        <tr><th>For</th><td>${r.title}${r.until ? html` (until ${r.until})` : ''}</td></tr>
        <tr><th>Amount</th><td><b>${r.amount ? nairaOf(r.amount) : '—'}</b></td></tr>
        <tr><th>Date</th><td>${fmtDate(r.at, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td></tr>
        <tr><th>Method</th><td>${via}</td></tr>
        ${r.pref ? html`<tr><th>Reference</th><td class="mono">${r.pref}</td></tr>` : ''}
        ${U.username ? html`<tr><th>Student</th><td>${U.username}</td></tr>` : ''}
      </tbody></table>
      <p class="tiny muted" style="margin-top:12px;text-align:center">Thank you for learning with Altidian. Rise to your highest point.</p></div>
      <div class="row gap-s" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" data-close type="button">Close</button><button class="btn primary" data-action="rcpt-print" type="button">Print / save as PDF</button></div>`);
  },
  async 'rcpt-print'(el) {
    const sheet = el.closest('.modal').querySelector('.rcpt-sheet'); if (!sheet) return;
    const w = document.createElement('div'); w.className = 'rcpt-print'; w.appendChild(sheet.cloneNode(true)); document.body.appendChild(w);
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); w.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50);
  },
  async 'grp-copy'(el) {
    const text = 'Join my study group "' + el.dataset.name + '" on Altidian. Code: ' + el.dataset.code + ' — ' + siteOrigin() + '/#/groups';
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(text); toast('Invite copied. Paste it in your chat.'); } catch (e) { toast(el.dataset.code); }
  },
  async 'tr-declare'(form, ev, { S }) { await withMsg(form, async () => { const r = await api('POST', '/api/transfer/declare', { matric: new FormData(form).get('matric') }); if (r.moved) { toast('You have been moved to ' + r.moved + '.'); location.reload(); return; } toast('Saved. You will be moved when the list is out.'); await hydrateTransfer(S); }); },
  async 'tr-withdraw'(el, ev, { S }) { try { await api('POST', '/api/transfer/withdraw'); await hydrateTransfer(S); } catch (e) { toast(e.message, 'bad'); } },
  async 'tr-request'(form, ev, { S }) { await withMsg(form, async () => { await api('POST', '/api/transfer/request', Object.fromEntries(new FormData(form).entries())); toast('Request sent to the admin.'); await hydrateTransfer(S); }); },
};
