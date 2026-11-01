import { html, icon, dialog, kindLabel, debounce, mount } from '../core/ui.js';
import { resourceCard, emptyState, scopeBar, inScope, currentScope, scopeState, courseIndex } from './shared.js';

const F = { q: '', course: '', kind: '' };

function filtered(st, S, user) {
  const q = F.q.toLowerCase(); const sc = currentScope(user);
  return st.materials.filter((m) => inScope(S, user, sc, m.course) && (!F.course || m.course === F.course) && (!F.kind || m.kind === F.kind) &&
    (!q || (m.title + ' ' + m.course + ' ' + (m.note || '')).toLowerCase().includes(q)));
}
const grid = (st, S, user) => { const l = filtered(st, S, user); return l.length ? html`<div class="cards">${l.map(resourceCard)}</div>` : emptyState('search', 'No matches', 'Try another course or a different word.'); };

export async function render({ S, user }) {
  const st = S.state; const u = user(); const sc = currentScope(u);
  const pool = st.materials.filter((m) => inScope(S, u, sc, m.course));
  if (F.course && !pool.some((m) => m.course === F.course)) F.course = '';
  const courses = [...new Set(pool.map((m) => m.course))].sort();
  const kinds = [...new Set(pool.map((m) => m.kind))];
  return html`
    <div class="sec-head"><div><h2>Library</h2><p>${pool.length} resources: notes, past questions, slides and videos.</p></div>
      <div class="row gap-s wrap-r">${u && S.state.config.contribEnabled ? html`<a class="btn gold small" href="#/share">${icon('upload', 16)} Share a note</a>` : ''}<a class="btn ghost small" href="#/saved">${icon('download', 16)} Saved offline</a></div></div>
    ${scopeBar(S, u, 'lib-scope')}
    <div class="row gap wrap-r" style="margin-bottom:14px"><label class="searchbox">${icon('search', 18)}<span class="sr">Search</span><input type="search" placeholder="Search by title or course" value="${F.q}" data-input="lib-search"></label></div>
    <div class="filters" id="lib-courses"><button class="pill ${F.course ? '' : 'on'}" data-action="lib-course" data-v="" type="button">All courses</button>${courses.map((c) => html`<button class="pill ${F.course === c ? 'on' : ''}" data-action="lib-course" data-v="${c}" type="button">${c}</button>`)}</div>
    ${kinds.length > 1 ? html`<div class="filters" id="lib-kinds">${['', ...kinds].map((k) => html`<button class="pill ${F.kind === k ? 'on' : ''}" data-action="lib-kind" data-v="${k}" type="button">${k ? kindLabel[k] || k : 'Everything'}</button>`)}</div>` : ''}
    <div id="lib-grid">${grid(st, S, u)}</div>`;
}

function refresh(S, user) {
  document.getElementById('lib-grid').innerHTML = grid(S.state, S, user()).s;
  document.querySelectorAll('#lib-courses .pill').forEach((b) => b.classList.toggle('on', b.dataset.v === F.course));
  document.querySelectorAll('#lib-kinds .pill').forEach((b) => b.classList.toggle('on', b.dataset.v === F.kind));
}
export const actions = {
  'lib-search': debounce((el, ev, { S, user }) => { F.q = el.value; refresh(S, user); }, 120),
  'lib-course': (el, ev, { S, user }) => { F.course = el.dataset.v; refresh(S, user); },
  'lib-scope': (el, ev, { renderView }) => { scopeState.v = el.dataset.v; F.course = ''; renderView(); },
  'lib-kind': (el, ev, { S, user }) => { F.kind = el.dataset.v; refresh(S, user); },
  read(el, ev, { S }) {
    const m = S.state.materials.find((x) => x.id === el.dataset.id); if (!m) return;
    dialog(html`<div class="row gap-s wrap-r" style="margin-bottom:10px"><span class="chip">${m.course}</span><span class="chip grey">${kindLabel[m.kind] || 'Resource'}</span></div>
      <h3>${m.title}</h3><div class="${m.paid ? 'no-copy' : ''}" style="white-space:pre-line;margin:12px 0 20px;line-height:1.65">${m.note || ''}</div>
      <div class="row end gap-s wrap-r">${m.fileId ? (m.paid ? html`<button class="btn primary small" data-action="view-file" data-id="${m.id}" type="button">${icon('eye', 16)} View</button>` : html`<a class="btn primary small" href="/files/${m.fileId}" target="_blank" rel="noopener">${icon('download', 16)} Open file</a>`) : ''}
      ${m.link ? html`<a class="btn ghost small" href="${m.link}" target="_blank" rel="noopener noreferrer">${icon('link', 16)} Open link</a>` : ''}
      <button class="btn ghost small" data-close type="button" autofocus>Close</button></div>`, { wide: true });
  },
};
