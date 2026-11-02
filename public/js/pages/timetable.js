/* Study timetable, exam countdown and personal entries. */
import { openScan } from './scan.js';
import { html, raw, icon, api, toast, dialog, confirmBox, todayKey, eventDate } from '../core/ui.js';
import { emptyState } from './shared.js';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const KIND = { class: 'Class', exam: 'Exam', test: 'Test', other: 'Other' };
const kindLabel = (x) => (x.kind === 'other' ? 'Study' : KIND[x.kind] || 'Class');

export const daysTo = (date) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(todayKey() + 'T00:00:00Z')) / 86400000);
export const countdown = (d) => (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : 'in ' + d + ' days');
export const todayDay = () => { const d = new Date(todayKey() + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
const time = (x) => (x.start ? x.start + (x.end ? ' – ' + x.end : '') : 'Time not set');
export const dated = (st) => (st.timetable || []).filter((x) => x.date && x.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
export const upcomingExams = (st) => dated(st).filter((x) => x.kind === 'exam' || x.kind === 'test');
export const classesToday = (st) => (st.timetable || []).filter((x) => x.kind === 'class' && x.day === todayDay()).sort((a, b) => a.start.localeCompare(b.start));

export function examCard(x) {
  const n = daysTo(x.date); const d = eventDate({ date: x.date });
  return html`<article class="card exam ${n <= 1 ? 'soon' : ''}"><div class="count"><b>${n === 0 ? '0' : n}</b><span>${n === 1 ? 'day' : 'days'}</span></div>
    <div class="grow"><div class="row gap-s wrap-r"><span class="chip ${x.kind === 'exam' ? 'bad' : ''}">${kindLabel(x)}</span>${x.course ? html`<span class="chip grey">${x.course}</span>` : ''}${x.mine ? html`<span class="chip brand">Mine</span>` : ''}</div>
      <h3>${x.title}</h3><p class="muted small">${d.long} · ${time(x)}${x.venue ? ' · ' + x.venue : ''}</p><p class="small"><b>${countdown(n)}</b></p></div>
    ${x.mine ? html`<button class="icon-btn small-ic" data-action="tt-del" data-id="${x.id}" type="button" aria-label="Delete ${x.title}">${icon('trash', 16)}</button>` : ''}</article>`;
}

export const tabs = (on) => html`<div class="seg" role="tablist" aria-label="Plan"><a role="tab" aria-selected="${on === 'events'}" class="${on === 'events' ? 'on' : ''}" href="#/events">${icon('calendar', 16)} Events</a><a role="tab" aria-selected="${on === 'timetable'}" class="${on === 'timetable' ? 'on' : ''}" href="#/timetable">${icon('clock', 16)} Timetable and exams</a></div>`;

/* Fields shared with the class rep page. */
export function entryFields(courses, v = {}) {
  const kind = v.kind || 'class';
  return html`<div class="grid2"><label class="field"><span>What is it?</span><select name="kind" data-change="tt-kind">${[['class', 'Weekly class'], ['exam', 'Exam'], ['test', 'Test or quiz'], ['other', 'Study session']].map(([k, l]) => html`<option value="${k}" ${kind === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
    <label class="field"><span>Course (optional)</span><input name="course" list="tt-courses" maxlength="10" placeholder="e.g. MBH222" style="text-transform:uppercase"><datalist id="tt-courses">${courses.map((c) => html`<option value="${c}"></option>`)}</datalist></label></div>
    <label class="field"><span>Title</span><input name="title" maxlength="80" required placeholder="e.g. MBH222 lecture"></label>
    <div class="grid2"><label class="field tt-day" ${kind === 'class' ? '' : raw('hidden')}><span>Day</span><select name="day">${DAYS.map((d, i) => html`<option value="${i + 1}">${d}</option>`)}</select></label>
      <label class="field tt-date" ${kind === 'class' ? raw('hidden') : ''}><span>Date</span><input name="date" type="date" min="${todayKey()}"></label>
      <label class="field"><span>Venue (optional)</span><input name="venue" maxlength="80" placeholder="e.g. LT1"></label></div>
    <div class="grid2"><label class="field"><span>Starts</span><input name="start" type="time"></label><label class="field"><span>Ends (optional)</span><input name="end" type="time"></label></div>`;
}
export const readEntry = (f) => { const d = new FormData(f); const o = {}; ['kind', 'title', 'course', 'day', 'date', 'start', 'end', 'venue'].forEach((k) => { o[k] = String(d.get(k) || '').trim(); }); if (o.kind === 'class') o.date = ''; else o.day = ''; return o; };

export const needsLogin = true;
export async function render({ S }) {
  const st = S.state; const exams = upcomingExams(st); const other = dated(st).filter((x) => x.kind === 'other');
  const week = DAYS.map((name, i) => ({ name, n: i + 1, items: (st.timetable || []).filter((x) => x.kind === 'class' && x.day === i + 1).sort((a, b) => a.start.localeCompare(b.start)) }));
  const t = todayDay(); const any = week.some((d) => d.items.length);
  return html`${tabs('timetable')}
    <div class="sec-head"><div><h2>Timetable and exams</h2><p>Your class timetable and exam dates, posted by your class rep and admins. You can add your own too.</p></div><button class="btn ghost small" data-action="tt-scan" type="button">${icon('upload', 16)} From photo</button> <button class="btn primary small" data-action="tt-add" type="button">${icon('plus', 16)} Add mine</button></div>
    <h3 style="margin:6px 0 12px">Exam and test countdown</h3>
    ${exams.length ? html`<div class="cards">${exams.map(examCard)}</div>` : emptyState('clock', 'No exams or tests yet', 'When your class rep or an admin posts one, a countdown shows up here and on your home page.')}
    ${other.length ? html`<h3 style="margin:22px 0 12px">My study sessions</h3><div class="cards">${other.map(examCard)}</div>` : ''}
    <h3 style="margin:26px 0 12px">Weekly classes</h3>
    ${any ? html`<div class="week">${week.map((d) => html`<section class="day ${d.n === t ? 'today' : ''}"><h4>${d.name}${d.n === t ? html` <span class="chip gold">Today</span>` : ''}</h4>
      ${d.items.length ? d.items.map((x) => html`<div class="slot"><b>${time(x)}</b><span>${x.title}${x.venue ? html`<br><span class="tiny muted">${x.venue}</span>` : ''}</span>${x.mine ? html`<button class="icon-btn small-ic" data-action="tt-del" data-id="${x.id}" type="button" aria-label="Delete ${x.title}">${icon('trash', 15)}</button>` : ''}</div>`) : html`<p class="tiny muted">Nothing</p>`}</section>`)}</div>`
      : emptyState('calendar', 'No classes posted yet', 'Your class rep can add the weekly timetable. Or tap "Add mine" to build your own.')}`;
}
export function after() { /* nothing to attach */ }

export const actions = {
  'tt-scan'(el, ev, { S, load, renderView }) { openScan({ target: 'mine', done: async () => { await load(); renderView(); } }); },
  'tt-kind'(el) { const f = el.closest('form'); const c = el.value === 'class'; f.querySelector('.tt-day').hidden = !c; f.querySelector('.tt-date').hidden = c; },
  'tt-add'(el, ev, { S }) {
    const courses = S.state.academics.courses.map((c) => c.code);
    const { box } = dialog(html`<h3>Add to my timetable</h3><p class="muted small" style="margin-bottom:10px">Only you can see this.</p><div class="msg alert bad" hidden role="alert"></div>
      <form data-submit="tt-save" novalidate>${entryFields(courses)}<div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
    box.querySelector('form').box = box;
  },
  async 'tt-save'(form, ev, { load, renderView }) {
    const msg = form.parentElement.querySelector('.msg'); msg.hidden = true;
    try { await api('POST', '/api/timetable/mine', readEntry(form)); form.closest('.modal-back').remove(); document.body.classList.remove('noscroll'); await load(); toast('Added to your timetable.'); renderView(); }
    catch (e) { msg.textContent = e.message; msg.hidden = false; }
  },
  async 'tt-del'(el, ev, { load, renderView }) {
    if (!(await confirmBox({ title: 'Delete this entry?', text: 'It is removed from your timetable.', yes: 'Delete', danger: true }))) return;
    try { await api('DELETE', '/api/timetable/mine/' + el.dataset.id); await load(); renderView(); } catch (e) { toast(e.message, 'bad'); }
  },
};
