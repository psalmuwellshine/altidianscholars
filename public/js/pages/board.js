import { html, icon, avatar } from '../core/ui.js';
import { leaderRows, emptyState, hasPlace, deptName } from './shared.js';

const B = { scope: 'all' };

export async function render({ S, user }) {
  const st = S.state; const u = user();
  if (!st.config.leaderboardEnabled) return emptyState('trophy', 'Leaderboard is off', 'The admins have switched the leaderboard off for now.');
  const scope = hasPlace(u) ? B.scope : 'all';
  let rows = st.board;
  if (scope === 'dept') rows = rows.filter((r) => r.dept === u.departmentId);
  else if (scope === 'level') rows = rows.filter((r) => r.dept === u.departmentId && r.level === u.level);
  rows = rows.slice(0, 100).map((r, i) => Object.assign({}, r, { rank: i + 1 }));
  const top = rows.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
  const me = rows.find((r) => r.me);
  const tabs = [['all', 'Everyone'], ['dept', 'My department'], ['level', 'My level']];
  return html`<div class="sec-head"><div><h2>Leaderboard</h2><p>10 points for every correct answer, counted from your best attempt at each quiz.</p></div></div>
    ${hasPlace(u) ? html`<div class="filters board-tabs" role="group" aria-label="Who to rank">${tabs.map(([k, l]) => html`<button class="pill ${scope === k ? 'on' : ''}" data-action="board-scope" data-v="${k}" type="button">${l}${k === 'dept' ? ' · ' + deptName(S, u.departmentId) : k === 'level' ? ' · ' + u.level : ''}</button>`)}</div>` : ''}
    ${!u && st.config.requireLogin ? html`<div class="alert info">Log in to appear on the leaderboard. <a href="#/login?next=%2Fboard">Log in</a></div>` : ''}
    ${me ? html`<div class="alert ok">You are #${me.rank} with ${me.points} points. Keep climbing!</div>` : ''}
    ${rows.length ? html`
      <div class="podium">${order.map((r) => html`<div class="pod p${r.rank}">${r.uid ? html`<a class="av-link" href="#/chat/dm/${r.uid}" aria-label="Message ${r.name}">${avatar(r.name, r.avatar)}</a>` : avatar(r.name, r.avatar)}<b>${r.name}</b><span>${r.points} pts</span><div class="medal">${icon('medal', 18)} #${r.rank}</div></div>`)}</div>
      <div class="card flat">${leaderRows(rows)}</div>` : emptyState('trophy', 'No scores yet', 'Be the first on the board: take a quiz.')}`;
}
export const actions = {
  'board-scope': (el, ev, { renderView }) => { B.scope = el.dataset.v; renderView(); },
};
