/* Pieces used by more than one student page. */
import { isSaved, canSave } from '../core/offline.js';
import { html, raw, icon, esc, kindLabel, kindIcon, eventDate, todayKey, pct, initial, avatar } from '../core/ui.js';

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
export function resourceCard(m) {
  const long = (m.note || '').length > 140;
  return html`<article class="card res ${m.pinned ? 'pinned' : ''} ${m.paid ? 'no-copy' : ''}">
    <div class="row gap-s"><div class="ico-box ${m.kind === 'video' ? 'brand' : ''}">${icon(kindIcon[m.kind] || 'file', 22)}</div>
      <div class="top grow"><span class="chip">${m.course}</span><span class="chip grey">${kindLabel[m.kind] || 'Resource'}</span>${m.pinned ? html`<span class="chip brand">${icon('pin', 13)} Pinned</span>` : ''}${m.paid ? html`<span class="chip ${m.locked ? 'bad' : 'good'}">${icon(m.locked ? 'lock' : 'check', 13)} ${m.locked ? naira(m.price) : 'Unlocked'}</span>` : ''}</div></div>
    <h3>${m.title}</h3>
    ${m.by ? html`<p class="tiny muted shared-by">${icon('users', 13)} Shared by ${m.by}</p>` : ''}
    ${m.note ? html`<p class="note">${m.note}</p>` : ''}
    ${m.locked ? html`<div class="go"><button class="btn gold small" data-action="unlock" data-id="${m.id}" type="button">${icon('lock', 16)} Unlock</button></div>` : html`<div class="go row wrap-r gap-s">
      ${m.fileId ? (m.paid ? html`<button class="btn primary small" data-action="view-file" data-id="${m.id}" type="button">${icon('eye', 16)} View</button>` : html`<a class="btn primary small" href="/files/${m.fileId}" target="_blank" rel="noopener">${icon('download', 16)} Open file</a>`) : ''}
      ${m.link ? html`<a class="btn ${m.fileId ? 'ghost' : 'primary'} small" href="${m.link}" target="_blank" rel="noopener noreferrer">${icon(m.kind === 'video' ? 'video' : 'link', 16)} ${m.kind === 'video' ? 'Watch' : 'Open link'}</a>` : ''}
      ${long || (m.note && !m.fileId && !m.link) ? html`<button class="btn ghost small" data-action="read" data-id="${m.id}" type="button">Read notes</button>` : ''}
      ${canSave(m) ? html`<button class="btn ghost small save-off ${isSaved(m.id) ? 'on' : ''}" data-action="save-offline" data-id="${m.id}" type="button">${isSaved(m.id) ? 'Saved ✓' : 'Save offline'}</button>` : ''}
    </div>`}
  </article>`;
}

export function eventTile(e) {
  const d = eventDate(e); const past = e.date < todayKey();
  return html`<article class="card ev ${past ? 'past' : ''}">
    <div class="date-tile"><i>${d.mon}</i><b>${d.day}</b></div>
    <div class="grow"><h3>${e.title}</h3>
      <p class="muted small">${d.long}${e.time ? ' · ' + e.time : ''}</p>
      ${e.location ? html`<p class="small row gap-s" style="margin-top:4px">${icon('pin2', 16)} ${e.location}</p>` : ''}
      ${e.description ? html`<p class="small muted" style="margin-top:8px;white-space:pre-line">${e.description}</p>` : ''}
      ${e.link ? html`<p style="margin-top:10px"><a class="btn ghost small" href="${e.link}" target="_blank" rel="noopener noreferrer">${icon('link', 15)} More info</a></p>` : ''}
    </div>
  </article>`;
}

export function quizCard(q, best, ctx) {
  const done = best ? pct(best.correct, best.total) : null;
  return html`<article class="card quiz-card">
    <div class="row gap-s wrap-r"><span class="chip">${q.course}</span><span class="chip grey">${q.count || q.questions.length} questions</span>${q.paid ? html`<span class="chip ${q.locked ? 'bad' : 'good'}">${icon(q.locked ? 'lock' : 'check', 13)} ${q.locked ? naira(q.price) : 'Unlocked'}</span>` : ''}${best ? html`<span class="chip good">${icon('check', 13)} Done</span>` : ''}</div>
    <h3>${q.title}</h3>
    ${best ? html`<div><div class="row between small"><span class="muted">Best score</span><b>${best.correct}/${best.total}</b></div><div class="bar" style="margin-top:6px"><i style="width:${done}%"></i></div></div>` : html`<p class="muted small">Not tried yet. Every correct answer earns 10 points.</p>`}
    ${q.locked ? html`<button class="btn gold block" style="margin-top:auto" data-action="unlock" data-id="${q.id}" type="button">${icon('lock', 17)} Unlock</button>` : html`<a class="btn ${best ? 'ghost' : 'primary'} block" style="margin-top:auto" href="#/quiz/${q.id}">${best ? 'Try again' : 'Start quiz'} ${icon('arrow', 17)}</a>`}
  </article>`;
}

export function leaderRows(rows) {
  return html`<ol class="lb">${rows.map((r) => html`<li class="${r.me ? 'me' : ''}"><span class="n">${r.rank}</span>${avatar(r.name, r.avatar, 'sm')}<span class="grow"><b>${r.name}</b>${r.me ? html` <span class="chip brand">You</span>` : ''}<br><span class="tiny muted">${r.done} quiz${r.done === 1 ? '' : 'zes'}</span></span><span class="pts">${r.points} pts</span></li>`)}</ol>`;
}

export const emptyState = (ic, title, text) => html`<div class="empty">${icon(ic, 36)}<h3>${title}</h3><p>${text}</p></div>`;

/* ---------- faculties, departments, levels ---------- */
export const acad = (S) => S.state.academics;
export const deptName = (S, id) => (acad(S).departments.find((d) => d.id === id) || {}).name || '';
export const facultyName = (S, id) => (acad(S).faculties.find((f) => f.id === id) || {}).name || '';
export const hasPlace = (u) => !!(u && u.departmentId && u.level);
export const placeLine = (S, u) => (hasPlace(u) ? deptName(S, u.departmentId) + ' · ' + u.level + ' level' : '');

// Three linked drop-downs: faculty, then its departments, then the levels that department offers.
export function placeFields(S, sel = {}) {
  const A = acad(S);
  const fac = sel.facultyId || '';
  const deps = A.departments.filter((d) => d.facultyId === fac);
  const dep = A.departments.find((d) => d.id === sel.departmentId && d.facultyId === fac);
  const levels = dep ? Array.from({ length: Math.min(6, (dep.maxLevel || 600) / 100) }, (_, i) => (i + 1) * 100) : [];
  return html`<div data-place><label class="field"><span>Faculty</span><select name="facultyId" data-change="place-fac" required><option value="">Choose your faculty</option>${A.faculties.map((f) => html`<option value="${f.id}" ${f.id === fac ? raw('selected') : ''}>${f.name}</option>`)}</select></label>
    <div class="grid2"><label class="field"><span>Department / programme</span><select name="departmentId" data-change="place-dep" required ${fac ? '' : raw('disabled')}><option value="">${fac ? 'Choose your department' : 'Pick a faculty first'}</option>${deps.map((d) => html`<option value="${d.id}" ${dep && d.id === dep.id ? raw('selected') : ''}>${d.name}</option>`)}</select></label>
    <label class="field"><span>Level</span><select name="level" required ${dep ? '' : raw('disabled')}><option value="">${dep ? 'Choose level' : 'Pick a department first'}</option>${levels.map((l) => html`<option value="${l}" ${l === Number(sel.level) ? raw('selected') : ''}>${l} level</option>`)}</select></label></div></div>`;
}
export function placeChange(S, el) {
  const w = el.closest('[data-place]'); const g = (n) => w.querySelector(`[name=${n}]`).value;
  const sel = { facultyId: g('facultyId'), departmentId: el.name === 'facultyId' ? '' : g('departmentId'), level: el.name === 'level' ? g('level') : '' };
  w.outerHTML = placeFields(S, sel).s;
  const nxt = document.querySelector(el.name === 'facultyId' ? '[name=departmentId]' : '[name=level]'); if (nxt) nxt.focus();
}

/* ---------- what a student should see ---------- */
// 'mine' = my level and department, 'dept' = my department at any level, 'all' = everything.
export const scopeState = { v: null };
export function courseIndex(S) { return new Map(acad(S).courses.map((c) => [c.code, c])); }
export function inScope(S, user, scope, code) {
  if (scope === 'all' || !hasPlace(user)) return true;
  const c = courseIndex(S).get(code); if (!c) return false;
  const deptOk = !c.departmentIds || !c.departmentIds.length || c.departmentIds.includes(user.departmentId);
  return scope === 'dept' ? deptOk : deptOk && c.level === user.level;
}
export const currentScope = (user) => (hasPlace(user) ? (scopeState.v || 'mine') : 'all');
export function scopeBar(S, user, action) {
  if (!hasPlace(user)) return html``;
  const cur = currentScope(user);
  const tabs = [['mine', 'My courses · ' + user.level + ' level'], ['dept', 'My department'], ['all', 'Everything']];
  return html`<div class="filters" role="group" aria-label="Which courses to show">${tabs.map(([k, l]) => html`<button class="pill ${cur === k ? 'on' : ''}" data-action="${action}" data-v="${k}" type="button">${l}</button>`)}</div>`;
}
