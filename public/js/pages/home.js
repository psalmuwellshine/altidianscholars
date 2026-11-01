import { html, icon, plural, esc, avatar, kindLabel, kindIcon } from '../core/ui.js';
import { resourceCard, quizCard, eventTile, leaderRows, emptyState, inScope, hasPlace, placeLine } from './shared.js';
import { todayKey } from '../core/ui.js';
import * as notifyMod from './notify.js';
import { upcomingExams, classesToday, daysTo, countdown } from './timetable.js';

export async function render({ S, user, config }) {
  const st = S.state; const c = config(); const u = user();
  const upcoming = st.events.filter((e) => e.date >= todayKey()).slice(0, 3);
  let pool = st.materials.filter((m) => inScope(S, u, 'mine', m.course));
  if (!pool.length) pool = st.materials;
  const sorted = pool.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  let quizPool = st.quizzes.filter((q) => inScope(S, u, 'mine', q.course));
  if (!quizPool.length) quizPool = st.quizzes;
  const best = (st.me && st.me.best) || {};
  const exams = u ? upcomingExams(st) : []; const today = u ? classesToday(st) : [];
  // Everything starts minimised. A student taps a heading to open it.
  const fold = (ic, title, total, cards, seeAllHref) => html`<details class="fold">
    <summary><span class="ico-box">${icon(ic, 20)}</span><span class="grow"><b>${title}</b></span><span class="chip grey">${total}</span></summary>
    <div class="fold-body"><div class="cards">${cards}</div>${total > 6 ? html`<p class="fold-more"><a class="btn ghost small" href="${seeAllHref}">See all ${total} ${icon('arrow', 15)}</a></p>` : ''}</div></details>`;
  const groups = [];
  [['notes', 'Notes'], ['pq', 'Past questions'], ['slides', 'Slides'], ['video', 'Videos'], ['other', 'Other resources']].forEach(([k, label]) => {
    const items = sorted.filter((m) => m.kind === k);
    if (items.length) groups.push(fold(kindIcon[k] || 'file', label, items.length, items.slice(0, 6).map(resourceCard), '#/library'));
  });
  if (quizPool.length) groups.push(fold('quiz', 'Practice quizzes', quizPool.length, quizPool.slice(0, 6).map((q) => quizCard(q, best[q.id], null)), '#/quizzes'));
  return html`
    ${u && !hasPlace(u) ? html`<div class="alert warning" style="margin-top:16px">Tell us your department and level to see the right courses. <a href="#/profile">Update my profile</a></div>` : ''}
    ${u ? html`<div id="push-nudge" style="margin-top:16px"></div>` : ''}
    <section class="hero">
      ${c.tagline ? html`<span class="tag">${c.tagline}</span>` : ''}
      <h1>${c.heroTitle}</h1><p>${c.heroText}</p>
      <div class="hero-actions">
        <a class="btn primary" href="#/quizzes">${icon('quiz', 19)} Take a quiz</a>
        <a class="btn ghost" href="#/library">${icon('book', 19)} Browse the library</a>
        ${!u && c.registrationOpen ? html`<a class="btn ghost" href="#/register">Create account</a>` : ''}
      </div>
    </section>
    <div class="stats">
      <div class="stat"><b>${st.stats.materials}</b><span>Study resources</span></div>
      <div class="stat"><b>${st.stats.quizzes}</b><span>Practice quizzes</span></div>
      <div class="stat"><b>${st.stats.students}</b><span>Climbers</span></div>
    </div>
    ${u && st.me ? html`<section class="sec"><div class="card row gap wrap-r between"><div class="row gap">${avatar(u.username, u.avatarId, 'md')}
      <div><p class="muted small">Welcome back</p><h3>${u.username}</h3><p class="small"><span class="chip brand">${st.me.rank.title}</span> ${st.me.points} points${st.me.position ? ' · #' + st.me.position + ' on the board' : ''}</p></div></div>
      <a class="btn gold" href="#/profile">View my profile ${icon('arrow', 17)}</a></div></section>` : ''}

    ${u && (exams.length || today.length || (st.classNotes || []).length) ? html`<section class="sec"><div class="sec-head"><div><h2>Your plan</h2><p>Countdowns, today's classes and updates from your class.</p></div><a class="btn ghost small" href="#/timetable">Timetable ${icon('arrow', 15)}</a></div>
      ${(st.classNotes || []).length ? html`<div class="notes-strip">${st.classNotes.slice(0, 2).map((n) => html`<div class="alert info"><b>${n.by}:</b> ${n.text}</div>`)}</div>` : ''}
      ${exams.length ? html`<div class="count-row">${exams.slice(0, 3).map((x) => html`<a class="count-pill ${daysTo(x.date) <= 1 ? 'soon' : ''}" href="#/timetable"><b>${daysTo(x.date)}</b><span>${daysTo(x.date) === 1 ? 'day' : 'days'}</span><i>${x.course || x.title} ${x.kind}</i></a>`)}</div>` : ''}
      ${today.length ? html`<div class="card flat" style="margin-top:12px"><p class="muted small" style="margin-bottom:6px">Today's classes</p>${today.map((x) => html`<div class="slot"><b>${x.start}${x.end ? ' – ' + x.end : ''}</b><span>${x.title}${x.venue ? html` <span class="tiny muted">· ${x.venue}</span>` : ''}</span></div>`)}</div>` : ''}</section>` : ''}

    <section class="sec"><div class="sec-head"><div><h2>Fresh for you</h2><p>${hasPlace(u) ? 'For ' + placeLine(S, u) + '. Tap a heading to open it.' : 'Pinned and newest resources. Tap a heading to open it.'}</p></div><a class="btn ghost small" href="#/library">See all</a></div>
      ${groups.length ? html`<div class="folds">${groups}</div>` : emptyState('book', 'Nothing here yet', 'New study materials will show up here as soon as they are added.')}</section>

    <section class="sec"><div class="sec-head"><div><h2>Coming up</h2><p>Notices and events from ${c.siteName}.</p></div><a class="btn ghost small" href="#/events">All events</a></div>
      ${upcoming.length ? html`<div class="cards">${upcoming.map(eventTile)}</div>` : emptyState('calendar', 'No upcoming events', 'Check back soon.')}</section>

    ${c.leaderboardEnabled ? html`<section class="sec"><div class="sec-head"><div><h2>Top climbers</h2><p>10 points for every correct answer.</p></div><a class="btn ghost small" href="#/board">Full leaderboard</a></div>
      <div class="card flat">${st.board.length ? leaderRows(st.board.slice(0, 5)) : emptyState('trophy', 'Be the first', 'Take a quiz to claim the top spot.')}</div></section>` : ''}`;
}
export function after() { notifyMod.nudge(); }
export const actions = {
  read(el, ev, { S }) {
    // handled in the library module too; the home page shares the same dialog
    import('./library.js').then((m) => m.actions.read(el, ev, { S }));
  },
};
