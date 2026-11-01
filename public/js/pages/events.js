import { html, todayKey } from '../core/ui.js';
import { eventTile, emptyState } from './shared.js';
import { tabs } from './timetable.js';

export async function render({ S }) {
  const t = todayKey();
  const up = S.state.events.filter((e) => e.date >= t);
  const past = S.state.events.filter((e) => e.date < t).reverse().slice(0, 12);
  return html`${tabs('events')}<div class="sec-head"><div><h2>Events and notices</h2><p>Tests, meetings, study sessions and more.</p></div></div>
    ${up.length ? html`<div class="cards">${up.map(eventTile)}</div>` : emptyState('calendar', 'Nothing scheduled', 'New events will appear here.')}
    ${past.length ? html`<div class="sec"><h3 style="margin-bottom:14px">Past events</h3><div class="cards">${past.map(eventTile)}</div></div>` : ''}`;
}
export const actions = {};
