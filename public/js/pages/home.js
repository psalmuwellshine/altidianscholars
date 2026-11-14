import { html, raw, icon, plural, esc, avatar, kindLabel, kindIcon, debounce } from '../core/ui.js';
import { resourceCard, quizCard, eventTile, leaderRows, emptyState, inScope, hasPlace, placeLine } from './shared.js';
import { todayKey } from '../core/ui.js';
import * as move from './transition.js';
import { passCard } from './pay.js';
import * as more from './more.js';
import * as notifyMod from './notify.js';
import { votingLine } from './election.js';
import { upcomingExams, classesToday, daysTo, countdown } from './timetable.js';

/* ---------- search ---------- */
let Q = ''; // what the student last searched for (kept if the page redraws)
const LIM = { m: 12, q: 12, e: 12 };
const flat = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const squash = (s) => flat(s).replace(/ /g, '');
const PAGES_FOR_SEARCH = [
  { label: 'Library', href: '#/library', ic: 'book', words: 'library notes past questions slides videos materials resources' },
  { label: 'Quizzes', href: '#/quizzes', ic: 'quiz', words: 'quizzes quiz practice test exam cbt' },
  { label: 'Ranks', href: '#/board', ic: 'trophy', words: 'ranks leaderboard points top climbers' },
  { label: 'Events', href: '#/events', ic: 'calendar', words: 'events notices calendar' },
  { label: 'Timetable', href: '#/timetable', ic: 'clock', words: 'timetable classes schedule exams countdown' },
  { label: 'CGPA calculator', href: '#/cgpa', ic: 'chart', words: 'cgpa gpa calculator grade' },
  { label: 'Saved offline', href: '#/saved', ic: 'download', words: 'saved offline downloads' },
  { label: 'My profile', href: '#/profile', ic: 'user', words: 'profile account password avatar photo' },
];
// Every word the student typed must appear somewhere in the item. Titles count most.
function scoreOf(terms, fields) {
  let total = 0;
  for (const t of terms) {
    let best = 0;
    for (const [text, weight] of fields) {
      const f = flat(text); if (!f) continue;
      if (f.includes(t) || squash(text).includes(t.replace(/ /g, ''))) best = Math.max(best, f.startsWith(t) ? weight + 1 : weight);
    }
    if (!best) return 0; // this word is nowhere in the item
    total += best;
  }
  return total;
}
function searchAll(S, u, q) {
  const st = S.state; const terms = flat(q).split(' ').filter(Boolean);
  const courses = new Map(S.state.academics.courses.map((c) => [c.code, c.name || '']));
  const mine = (code) => inScope(S, u, 'mine', code);
  const rank = (list) => list.sort((a, b) => b.score - a.score || (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (b.x.pinned ? 1 : 0) - (a.x.pinned ? 1 : 0) || (b.x.addedAt || 0) - (a.x.addedAt || 0));
  const mats = rank(st.materials.map((m) => ({ x: m, mine: mine(m.course), score: scoreOf(terms, [[m.title, 6], [m.course, 5], [courses.get(m.course), 4], [kindLabel[m.kind] || m.kind, 3], [m.by, 2], [m.note, 1]]) })).filter((r) => r.score));
  const qzs = rank(st.quizzes.map((x) => ({ x, mine: mine(x.course), score: scoreOf(terms, [[x.title, 6], [x.course, 5], [courses.get(x.course), 4], ['quiz practice test', 2]]) })).filter((r) => r.score));
  const evs = rank(st.events.map((x) => ({ x, mine: true, score: scoreOf(terms, [[x.title, 6], [x.location, 3], [x.description, 1]]) })).filter((r) => r.score));
  const pages = PAGES_FOR_SEARCH.filter((p) => (p.href !== '#/profile' || u) && scoreOf(terms, [[p.label, 6], [p.words, 2]]));
  return { mats: mats.map((r) => r.x), qzs: qzs.map((r) => r.x), evs: evs.map((r) => r.x), pages };
}
function resultsHtml(S, u, q) {
  const st = S.state; const r = searchAll(S, u, q); const best = (st.me && st.me.best) || {};
  const total = r.mats.length + r.qzs.length + r.evs.length + r.pages.length;
  const head = html`<div class="hs-head"><p class="muted small">${total ? total + (total === 1 ? ' result' : ' results') + ' for' : 'Nothing found for'} <b>“${q}”</b></p><button class="btn ghost small" data-action="home-search-clear" type="button">${icon('x', 15)} Clear</button></div>`;
  if (!total) return html`${head}${emptyState('search', 'No results', 'Try fewer words, or a course code like ANA 204.')}<p style="text-align:center"><a class="btn primary" href="#/library">${icon('book', 18)} Browse the library</a></p>`;
  const group = (title, ic, items, g, card) => items.length ? html`<div class="hs-group"><h3 class="hs-h">${icon(ic, 18)} ${title} <span class="chip grey">${items.length}</span></h3>
    <div class="cards">${items.slice(0, LIM[g]).map(card)}</div>${items.length > LIM[g] ? html`<p class="fold-more"><button class="btn ghost small" data-action="home-more" data-g="${g}" type="button">Show ${Math.min(12, items.length - LIM[g])} more</button></p>` : ''}</div>` : '';
  return html`${head}
    ${r.pages.length ? html`<div class="hs-group"><h3 class="hs-h">${icon('arrow', 18)} Go to</h3><div class="filters">${r.pages.map((p) => html`<a class="pill" href="${p.href}">${p.label}</a>`)}</div></div>` : ''}
    ${group('Notes and resources', 'book', r.mats, 'm', resourceCard)}
    ${group('Quizzes', 'quiz', r.qzs, 'q', (x) => quizCard(x, best[x.id], null))}
    ${group('Events', 'calendar', r.evs, 'e', eventTile)}`;
}

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
  const counts = new Map(); pool.forEach((m) => counts.set(m.course, (counts.get(m.course) || 0) + 1));
  const chips = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code]) => code);
  const searching = Q.trim().length >= 2;
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
    ${move.banner(c)}
    ${u && c.levelOpen && (!c.levelEnds || c.levelEnds >= todayKey()) ? html`<div class="alert warning level-banner"><b>New session!</b> Update your level so you see the right courses. <a href="#/profile" data-action="goto-settings">Update my level</a></div>` : ''}
    ${passCard(c, u)}
    <section class="hero">
      ${c.tagline ? html`<span class="tag">${c.tagline}</span>` : ''}
      <h1>${c.heroTitle}</h1><p>${c.heroText}</p>
      <div class="hero-actions">
        <a class="btn primary" href="#/quizzes">${icon('quiz', 19)} Take a quiz</a>
        <a class="btn ghost" href="#/library">${icon('book', 19)} Browse the library</a>
        ${!u && c.registrationOpen ? html`<a class="btn ghost" href="#/register">Create account</a>` : ''}
      </div>
      <div class="hero-links"><button class="linkish" data-action="channels-open" type="button">${icon('users', 16)} Our channels</button><button class="linkish" data-action="support-open" type="button">${icon('mail', 16)} Contact support</button></div>
    </section>
    ${u ? more.qotdSlot() : ''}
    ${u && st.election ? html`<section class="sec"><a class="card election-card" href="#/election"><div><span class="chip gold">Student elections</span><h3>${st.election.title}</h3><p class="small">${st.election.count} candidate${st.election.count === 1 ? '' : 's'}${votingLine(st.election.votingDate) ? ' · ' + votingLine(st.election.votingDate) : ''}</p></div><span class="btn gold small">Meet the candidates ${icon('arrow', 16)}</span></a></section>` : ''}
    <section class="sec home-search">
      <form class="hs-form" data-submit="home-search-go" role="search">
        <label class="searchbox big">${icon('search', 20)}<span class="sr">Search Altidian</span><input id="hs-input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search notes, past questions, quizzes…" value="${Q}" data-input="home-search"></label>
        <button class="btn primary" type="submit">${icon('search', 18)} Search</button>
      </form>
      <div id="hs-results" aria-live="polite">${searching ? resultsHtml(S, u, Q.trim()) : ''}</div>
    </section>
    <div id="home-main" ${searching ? raw('hidden') : ''}>
    ${u && st.me ? html`<section class="sec"><div class="card row gap wrap-r between"><div class="row gap">${avatar(u.username, u.avatarId, 'md')}
      <div><p class="muted small">Welcome back</p><h3>${u.username}</h3><p class="small"><span class="chip brand">${st.me.rank.title}</span> ${st.me.points} points${st.me.position ? ' · #' + st.me.position + ' on the board' : ''}</p></div></div>
      <a class="btn gold" href="#/profile">View my profile ${icon('arrow', 17)}</a></div></section>` : ''}

    ${u && (exams.length || today.length || (st.classNotes || []).length) ? html`<section class="sec"><div class="sec-head"><div><h2>Your plan</h2><p>Countdowns, today's classes and updates from your class.</p></div><a class="btn ghost small" href="#/timetable">Timetable ${icon('arrow', 15)}</a></div>
      ${(st.classNotes || []).length ? html`<div class="notes-strip">${st.classNotes.slice(0, 3).map((n) => n.kind === 'summary' ? html`<div class="alert info"><span class="chip">${n.course}</span> <b>Today in class</b> · ${n.by}<br>${n.text}</div>` : html`<div class="alert info"><b>${n.by}:</b> ${n.text}</div>`)}</div>` : ''}
      ${exams.length ? html`<div class="count-row">${exams.slice(0, 3).map((x) => html`<a class="count-pill ${daysTo(x.date) <= 1 ? 'soon' : ''}" href="#/timetable"><b>${daysTo(x.date)}</b><span>${daysTo(x.date) === 1 ? 'day' : 'days'}</span><i>${x.course || x.title} ${x.kind}</i></a>`)}</div>` : ''}
      ${today.length ? html`<div class="card flat" style="margin-top:12px"><p class="muted small" style="margin-bottom:6px">Today's classes</p>${today.map((x) => html`<div class="slot"><b>${x.start}${x.end ? ' – ' + x.end : ''}</b><span>${x.title}${x.venue ? html` <span class="tiny muted">· ${x.venue}</span>` : ''}</span></div>`)}</div>` : ''}</section>` : ''}

    <section class="sec"><div class="sec-head"><div><h2>Fresh for you</h2><p>${hasPlace(u) ? 'For ' + placeLine(S, u) + '. Tap a heading to open it.' : 'Pinned and newest resources. Tap a heading to open it.'}</p></div><a class="btn ghost small" href="#/library">See all</a></div>
      ${groups.length ? html`<div class="folds">${groups}</div>` : emptyState('book', 'Nothing here yet', 'New study resources will show up here as soon as they are added.')}</section>

    <section class="sec"><div class="sec-head"><div><h2>Coming up</h2><p>Notices and events from ${c.siteName}.</p></div><a class="btn ghost small" href="#/events">All events</a></div>
      ${upcoming.length ? html`<div class="cards">${upcoming.map(eventTile)}</div>` : emptyState('calendar', 'No upcoming events', 'Check back soon.')}</section>

    ${c.leaderboardEnabled ? html`<section class="sec"><div class="sec-head"><div><h2>Top climbers</h2><p>10 points for every correct answer.</p></div><a class="btn ghost small" href="#/board">Full leaderboard</a></div>
      <div class="card flat">${st.board.length ? leaderRows(st.board.slice(0, 5)) : emptyState('trophy', 'Be the first', 'Take a quiz to claim the top spot.')}</div></section>` : ''}
    </div>`;
}
export function after(ctx) { notifyMod.nudge(); move.welcome(ctx.user(), ctx.config()); more.hydrateQotd(); }
function runSearch(S, user, q, jump) {
  Q = q; LIM.m = LIM.q = LIM.e = 12;
  const on = Q.trim().length >= 2;
  const main = document.getElementById('home-main'); const box = document.getElementById('hs-results');
  if (!main || !box) return;
  main.hidden = on;
  box.innerHTML = on ? resultsHtml(S, user(), Q.trim()).s : '';
  if (on && jump) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
export const actions = {
  'home-search': debounce((el, ev, { S, user }) => runSearch(S, user, el.value, false), 150),
  'home-search-go'(form, ev, { S, user }) {
    const input = form.querySelector('#hs-input'); runSearch(S, user, input.value, true); input.blur(); // closes the phone keyboard
  },
  'home-chip'(el, ev, { S, user }) {
    const input = document.getElementById('hs-input'); if (input) input.value = el.dataset.v; runSearch(S, user, el.dataset.v, true);
  },
  'home-more'(el, ev, { S, user }) {
    LIM[el.dataset.g] += 12; const y = window.scrollY; runSearch(S, user, Q, false); window.scrollTo(0, y);
  },
  'home-search-clear'(el, ev, { S, user }) {
    const input = document.getElementById('hs-input'); if (input) { input.value = ''; input.focus(); } runSearch(S, user, '', false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  read(el, ev, { S }) {
    // handled in the library module too; the home page shares the same dialog
    import('./library.js').then((m) => m.actions.read(el, ev, { S }));
  },
};
