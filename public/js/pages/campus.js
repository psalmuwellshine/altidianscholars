import { fileBtn } from './viewer.js';
import { html, icon, dialog, kindLabel, kindIcon, debounce } from '../core/ui.js';
import { emptyState, deptName, facultyName } from './shared.js';

const F = { q: '', scope: '' };
const SCOPE = { department: 'My department', faculty: 'My faculty', university: 'Whole university' };

function card(S, m) {
  const where = m.scope === 'department' ? deptName(S, m.departmentId) : m.scope === 'faculty' ? facultyName(S, m.facultyId) : 'All students';
  return html`<article class="card res ${m.pinned ? 'pinned' : ''}">
    <div class="row gap-s"><div class="ico-box">${icon(kindIcon[m.kind] || 'file', 22)}</div>
      <div class="top grow"><span class="chip">${where || SCOPE[m.scope]}</span><span class="chip grey">${kindLabel[m.kind] || 'Document'}</span>${m.pinned ? html`<span class="chip brand">${icon('pin', 13)} Pinned</span>` : ''}</div></div>
    <h3>${m.title}</h3>
    ${m.note ? html`<p class="note">${m.note}</p>` : ''}
    <div class="go row wrap-r gap-s">
      ${m.fileId ? fileBtn(m) : ''}
      ${m.link ? html`<a class="btn ${m.fileId ? 'ghost' : 'primary'} small" href="${m.link}" data-track="${m.id}" target="_blank" rel="noopener noreferrer">${icon('link', 16)} Open link</a>` : ''}
      ${!m.fileId && !m.link && m.note ? html`<button class="btn primary small" data-action="campus-read" data-id="${m.id}" type="button">Read</button>` : ''}
    </div></article>`;
}
function list(S) {
  const q = F.q.toLowerCase();
  return (S.state.campus || []).filter((m) => (!F.scope || m.scope === F.scope) && (!q || (m.title + ' ' + (m.note || '')).toLowerCase().includes(q)));
}
const grid = (S) => { const l = list(S); return l.length ? html`<div class="cards">${l.map((m) => card(S, m))}</div>` : emptyState('search', 'Nothing here yet', 'Documents for your department, faculty or the whole university will appear here.'); };

export async function render({ S }) {
  const all = S.state.campus || [];
  const scopes = [...new Set(all.map((m) => m.scope))];
  return html`<div class="sec-head"><div><h2>Campus documents</h2><p>${all.length} official documents: curriculum, course allocations, handbooks and more.</p></div>
      <div class="row gap-s wrap-r"><a class="btn ghost small" href="#/library">${icon('book', 16)} Library</a></div></div>
    <div class="row gap wrap-r" style="margin-bottom:14px"><label class="searchbox">${icon('search', 18)}<span class="sr">Search</span><input type="search" placeholder="Search documents" value="${F.q}" data-input="campus-search"></label></div>
    ${scopes.length > 1 ? html`<div class="filters">${['', 'department', 'faculty', 'university'].filter((k) => !k || scopes.includes(k)).map((k) => html`<button class="pill ${F.scope === k ? 'on' : ''}" data-action="campus-scope" data-v="${k}" type="button">${k ? SCOPE[k] : 'Everything'}</button>`)}</div>` : ''}
    <div id="campus-grid">${grid(S)}</div>`;
}

export const actions = {
  'campus-search': debounce((el, ev, { S }) => { F.q = el.value; document.getElementById('campus-grid').innerHTML = grid(S).s; }, 120),
  'campus-scope'(el, ev, { renderView }) { F.scope = el.dataset.v; renderView(); },
  'campus-read'(el, ev, { S }) {
    const m = (S.state.campus || []).find((x) => x.id === el.dataset.id); if (!m) return;
    dialog(html`<h3>${m.title}</h3><div style="white-space:pre-line;margin:12px 0 20px;line-height:1.65">${m.note || ''}</div><div class="row end"><button class="btn ghost small" data-close type="button" autofocus>Close</button></div>`, { wide: true });
  },
};
