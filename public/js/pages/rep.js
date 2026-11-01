/* Class rep panel: review shared notes, post to the library, set the class timetable, events and short updates. */
import { html, icon, api, toast, dialog, confirmBox, ago, kindLabel, eventDate } from '../core/ui.js';
import { emptyState } from './shared.js';
import { uploadForm, readUploadForm, submitWith } from './share.js';
import { DAYS, entryFields, readEntry } from './timetable.js';

let P = null;
const courseList = (S, scope) => S.state.academics.courses.filter((c) => (!c.departmentIds || !c.departmentIds.length || c.departmentIds.includes(scope.departmentId)) && (!scope.level || c.level === scope.level));
const when = (x) => (x.kind === 'class' ? DAYS[x.day - 1] : eventDate({ date: x.date }).long);

export const needsLogin = true;
export async function render({ S, user }) {
  const u = user();
  if (!u || !u.rep) return emptyState('shield', 'Class reps only', 'Admins appoint a class rep for each class. If that is you, they will switch this on for your account.');
  P = await api('GET', '/api/rep/panel');
  const courses = courseList(S, P.scope);
  return html`<div class="sec-head"><div><h2>Class rep panel</h2><p>You look after <b>${P.scope.label}</b> · ${P.students} students.</p></div></div>

    <h3 style="margin:6px 0 12px">Waiting for your review ${P.pending.length ? html`<span class="chip bad">${P.pending.length}</span>` : ''}</h3>
    ${P.pending.length ? html`<div class="card flat"><ol class="lb">${P.pending.map((m) => html`<li class="rv"><span class="grow"><b>${m.title}</b><br><span class="tiny muted">${m.course} · ${kindLabel[m.kind] || 'Resource'} · by ${m.by} · ${ago(m.addedAt)}</span>${m.note ? html`<br><span class="tiny">${m.note}${m.hasNote && m.note.length >= 400 ? '…' : ''}</span>` : ''}</span>
      <span class="row gap-s wrap-r">${m.fileId ? html`<a class="btn ghost small" href="/files/${m.fileId}" target="_blank" rel="noopener">${icon('eye', 15)} Open</a>` : ''}${m.link ? html`<a class="btn ghost small" href="${m.link}" target="_blank" rel="noopener noreferrer nofollow">${icon('link', 15)} Link</a>` : ''}
      <button class="btn primary small" data-action="rep-approve" data-id="${m.id}" type="button">${icon('check', 15)} Approve</button><button class="btn ghost small" data-action="rep-reject" data-id="${m.id}" data-title="${m.title}" type="button">Reject</button></span></li>`)}</ol></div>`
      : emptyState('check', 'All caught up', 'New uploads from your classmates will show up here.')}

    <div class="grid-rep">
      <section class="card"><h3>Post to the library</h3><p class="muted small" style="margin-bottom:10px">Goes live straight away for your class.</p>${uploadForm(S, null, { action: 'rep-post', courses, button: 'Publish' })}</section>
      <section class="card"><h3>Message your class</h3><p class="muted small" style="margin-bottom:10px">A short update. It shows on their home page and arrives as a notification.</p>
        <div class="msg alert bad" hidden role="alert"></div><form data-submit="rep-note" novalidate><label class="field"><span class="sr">Message</span><textarea name="text" rows="3" maxlength="300" required placeholder="e.g. Bring your lab coats on Monday"></textarea></label><button class="btn primary" type="submit">${icon('send', 16)} Send</button></form>
        ${P.notes.length ? html`<ol class="lb" style="margin-top:14px">${P.notes.slice(0, 5).map((n) => html`<li><span class="grow small">${n.text}<br><span class="tiny muted">${ago(n.at)}</span></span><button class="icon-btn small-ic" data-action="rep-del" data-kind="notes" data-id="${n.id}" type="button" aria-label="Delete message">${icon('trash', 15)}</button></li>`)}</ol>` : ''}</section>
    </div>

    <section class="sec"><div class="sec-head"><div><h3>Class timetable and exams</h3><p>Everyone in your class sees these. Exams and tests get a countdown and reminders.</p></div><button class="btn primary small" data-action="rep-tt-add" type="button">${icon('plus', 16)} Add</button></div>
      ${P.timetable.length ? html`<div class="card flat"><ol class="lb">${P.timetable.map((x) => html`<li><span class="grow"><b>${x.title}</b> <span class="chip ${x.kind === 'exam' ? 'bad' : 'grey'}">${x.kind === 'other' ? 'study' : x.kind}</span><br><span class="tiny muted">${when(x)}${x.start ? ' · ' + x.start + (x.end ? '–' + x.end : '') : ''}${x.venue ? ' · ' + x.venue : ''}</span></span><button class="icon-btn small-ic" data-action="rep-del" data-kind="timetable" data-id="${x.id}" type="button" aria-label="Delete ${x.title}">${icon('trash', 15)}</button></li>`)}</ol></div>` : emptyState('clock', 'Nothing yet', 'Add the weekly timetable and exam dates.')}</section>

    <section class="sec"><div class="sec-head"><div><h3>Class events</h3><p>Meetings, tutorials and study groups for your class.</p></div><button class="btn primary small" data-action="rep-ev-add" type="button">${icon('plus', 16)} Add</button></div>
      ${P.events.length ? html`<div class="card flat"><ol class="lb">${P.events.map((e) => html`<li><span class="grow"><b>${e.title}</b><br><span class="tiny muted">${eventDate(e).long}${e.time ? ' · ' + e.time : ''}${e.location ? ' · ' + e.location : ''}</span></span><button class="icon-btn small-ic" data-action="rep-del" data-kind="events" data-id="${e.id}" type="button" aria-label="Delete ${e.title}">${icon('trash', 15)}</button></li>`)}</ol></div>` : emptyState('calendar', 'No class events', 'Add one and your class is notified.')}</section>`;
}

const done = async (renderView, load, text) => { await load(); toast(text); renderView(); };
export const actions = {
  async 'rep-approve'(el, ev, { renderView }) {
    try { await api('POST', `/api/rep/uploads/${el.dataset.id}/review`, { action: 'approve' }); toast('Approved and published.'); renderView(); } catch (e) { toast(e.message, 'bad'); }
  },
  'rep-reject'(el, ev, { renderView }) {
    const { box, close } = dialog(html`<h3>Reject "${el.dataset.title}"?</h3><p class="muted small" style="margin-bottom:10px">The student sees your reason.</p>
      <label class="field"><span>Reason</span><input name="reason" maxlength="200" placeholder="e.g. Blurry photo, please resend a clear PDF" autofocus></label>
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn danger" data-yes type="button">Reject</button></div>`);
    box.querySelector('[data-yes]').addEventListener('click', async () => {
      try { await api('POST', `/api/rep/uploads/${el.dataset.id}/review`, { action: 'reject', reason: box.querySelector('[name=reason]').value }); close(); toast('Rejected.'); renderView(); } catch (e) { toast(e.message, 'bad'); }
    });
  },
  async 'rep-post'(form, ev, { load, renderView }) {
    await submitWith(form, async () => { await api('POST', '/api/rep/materials', await readUploadForm(form)); await done(renderView, load, 'Published for your class.'); });
  },
  async 'rep-note'(form, ev, { renderView }) {
    await submitWith(form, async () => { await api('POST', '/api/rep/notes', { text: new FormData(form).get('text') }); toast('Sent to your class.'); renderView(); });
  },
  'rep-tt-add'(el, ev, { S }) {
    const { box, close } = dialog(html`<h3>Add to the class timetable</h3><div class="msg alert bad" hidden role="alert"></div><form data-submit="rep-tt-save" novalidate>${entryFields(courseList(S, P.scope).map((c) => c.code))}<div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
    box.querySelector('form').close = close;
  },
  async 'rep-tt-save'(form, ev, { renderView }) {
    await submitWith(form, async () => { await api('POST', '/api/rep/timetable', readEntry(form)); form.close(); toast('Added. Your class is notified.'); renderView(); });
  },
  'rep-ev-add'() {
    const { box, close } = dialog(html`<h3>Add a class event</h3><div class="msg alert bad" hidden role="alert"></div><form data-submit="rep-ev-save" novalidate>
      <label class="field"><span>Title</span><input name="title" required maxlength="120" autofocus></label><div class="grid2"><label class="field"><span>Date</span><input name="date" type="date" required></label><label class="field"><span>Time (optional)</span><input name="time" type="time"></label></div>
      <label class="field"><span>Where (optional)</span><input name="location" maxlength="120"></label><label class="field"><span>Details (optional)</span><textarea name="description" rows="3" maxlength="1000"></textarea></label>
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
    box.querySelector('form').close = close;
  },
  async 'rep-ev-save'(form, ev, { renderView }) {
    await submitWith(form, async () => { const d = new FormData(form); const b = {}; ['title', 'date', 'time', 'location', 'description'].forEach((k) => { b[k] = String(d.get(k) || '').trim(); }); await api('POST', '/api/rep/events', b); form.close(); toast('Added. Your class is notified.'); renderView(); });
  },
  async 'rep-del'(el, ev, { renderView }) {
    if (!(await confirmBox({ title: 'Delete this?', text: 'It is removed for your whole class.', yes: 'Delete', danger: true }))) return;
    try { await api('DELETE', `/api/rep/${el.dataset.kind}/${el.dataset.id}`); renderView(); } catch (e) { toast(e.message, 'bad'); }
  },
};
