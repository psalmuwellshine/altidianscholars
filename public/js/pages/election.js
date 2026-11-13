import { html, icon, api, dialog, toast, initial, siteOrigin } from '../core/ui.js';
import { emptyState } from './shared.js';

let DATA = { posts: [] };
const NOTE = 'Voting is organised by the electoral committee. This page only shares information about the candidates.';
const daysLeft = (d) => { if (!d) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(d + 'T00:00:00') - t) / 86400000); };
export function votingLine(d) {
  const n = daysLeft(d); if (n === null) return '';
  return n > 1 ? `Voting in ${n} days` : n === 1 ? 'Voting is tomorrow' : n === 0 ? 'Voting is today' : '';
}
const photo = (c, cls = '') => (c.photo ? html`<img class="cand-photo ${cls}" src="/avatars/${c.photo}" alt="${c.name}" loading="lazy">` : html`<span class="cand-photo ${cls} ph">${initial(c.name)}</span>`);
const meta = (c) => [c.position, c.level ? c.level + ' level' : ''].filter(Boolean).join(' · ');

function card(c) {
  return html`<article class="card cand">
    ${photo(c)}
    <div class="cand-body"><h4>${c.name}</h4><p class="tiny muted">${c.level ? c.level + ' level' : ''}</p>${c.slogan ? html`<p class="cand-slogan">“${c.slogan}”</p>` : ''}</div>
    ${c.manifesto || (c.promises || []).length || c.link ? html`<button class="btn ghost small" data-action="el-open" data-id="${c.id}" type="button">Read manifesto ${icon('arrow', 16)}</button>` : ''}
  </article>`;
}

export async function render() {
  let d;
  try { d = await api('GET', '/api/election'); } catch (e) { d = { on: false }; }
  if (!d.on) return html`<div class="sec-head"><div><h2>Student elections</h2></div></div>${emptyState('users', 'Nothing to show right now', 'Campaign pages appear here during elections.')}`;
  DATA = d;
  const line = votingLine(d.votingDate);
  return html`<div class="sec-head"><div><h2>${d.title}</h2><p>${d.note || NOTE}</p></div>${line ? html`<span class="chip gold">${line}</span>` : ''}</div>
    ${d.posts.length ? d.posts.map((p) => html`<section class="sec"><h3 class="post-h">${p.position}</h3><div class="cards cand-cards">${p.candidates.map(card)}</div></section>`) : emptyState('users', 'No candidates yet', 'Candidates will be listed here as they are confirmed.')}`;
}

export const actions = {
  'el-open'(el) {
    const c = DATA.posts.flatMap((p) => p.candidates).find((x) => x.id === el.dataset.id); if (!c) return;
    dialog(html`<div class="cand-modal">${photo(c, 'big')}<h3>${c.name}</h3><p class="muted small">${meta(c)}</p>
      ${c.slogan ? html`<p class="cand-slogan">“${c.slogan}”</p>` : ''}
      ${c.manifesto ? html`<h4>Manifesto</h4><p class="manifesto">${c.manifesto}</p>` : ''}
      ${(c.promises || []).length ? html`<h4>Key promises</h4><ul class="promises">${c.promises.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
      <div class="row end gap wrap-r" style="margin-top:16px">${c.link ? html`<a class="btn ghost small" href="${c.link}" target="_blank" rel="noopener noreferrer">${icon('link', 16)} More</a>` : ''}
        <button class="btn ghost small" data-action="el-share" data-id="${c.id}" type="button">${icon('share', 16)} Share</button><button class="btn primary small" data-close type="button" autofocus>Close</button></div></div>`);
  },
  async 'el-share'(el) {
    const c = DATA.posts.flatMap((p) => p.candidates).find((x) => x.id === el.dataset.id); if (!c) return;
    const text = `${c.name}, candidate for ${c.position}${c.slogan ? ': “' + c.slogan + '”' : ''}. Read the manifesto on Altidian:`; const url = siteOrigin() + '/#/election';
    try { if (navigator.share) { await navigator.share({ title: c.name, text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text + ' ' + url); toast('Link copied.'); } catch (e) { toast(url); }
  },
};
