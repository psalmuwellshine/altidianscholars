/* Students share their own notes and past questions. Approved uploads earn points. */
import { html, raw, icon, api, toast, readFile, kindLabel, ago } from '../core/ui.js';
import { emptyState, inScope } from './shared.js';

const MAX = 8 * 1024 * 1024;
const KINDS = [['notes', 'Notes'], ['pq', 'Past questions'], ['slides', 'Slides'], ['other', 'Other']];
const STATUS = { pending: ['Waiting for review', ''], approved: ['Published', 'good'], rejected: ['Not accepted', 'bad'] };

/* The form is also used by class reps (they publish straight away). */
export function uploadForm(S, user, { action, courses, button }) {
  const mine = courses.filter((c) => !user || inScope(S, user, 'mine', c.code)); const rest = courses.filter((c) => !mine.includes(c));
  const opt = (c) => html`<option value="${c.code}">${c.code}${c.name ? ' · ' + c.name : ''} (${c.level} level)</option>`;
  return html`<div class="msg alert bad" hidden role="alert"></div><form data-submit="${action}" novalidate>
    <label class="field"><span>Title</span><input name="title" required maxlength="120" placeholder="e.g. MBH222 glycolysis summary"></label>
    <div class="grid2"><label class="field"><span>Course</span><select name="course" required><option value="">Choose a course</option>${mine.length ? html`<optgroup label="Your courses">${mine.map(opt)}</optgroup>` : ''}${rest.length ? html`<optgroup label="${mine.length ? 'Other courses' : 'Courses'}">${rest.map(opt)}</optgroup>` : ''}</select></label>
      <label class="field"><span>What is it?</span><select name="kind">${KINDS.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label></div>
    <label class="field"><span>File (PDF, Word, PowerPoint or picture, up to 8 MB)</span><input name="file" type="file" accept=".pdf,.docx,.pptx,image/png,image/jpeg,image/webp"></label>
    <label class="field"><span>Notes or text (optional)</span><textarea name="note" rows="4" maxlength="8000" placeholder="Type or paste notes here, if you have no file"></textarea></label>
    <label class="field"><span>Link (optional)</span><input name="link" type="url" maxlength="500" placeholder="https://"></label>
    <button class="btn primary" type="submit">${icon('upload', 17)} ${button}</button></form>`;
}
export async function readUploadForm(form) {
  const d = new FormData(form); const body = {};
  ['title', 'course', 'kind', 'note', 'link'].forEach((k) => { body[k] = String(d.get(k) || '').trim(); });
  const f = d.get('file');
  if (f && f.size) { if (f.size > MAX) throw new Error('That file is over 8 MB. Compress it or split it.'); body.file = await readFile(f); }
  return body;
}
export async function submitWith(form, work) {
  const msg = form.parentElement.querySelector('.msg'); const btn = form.querySelector('button[type=submit]'); const label = btn.innerHTML;
  msg.hidden = true; btn.disabled = true; btn.textContent = 'Please wait…';
  try { await work(); } catch (e) { msg.textContent = e.message; msg.hidden = false; } finally { btn.disabled = false; btn.innerHTML = label; }
}

export const needsLogin = true;
export async function render({ S, user, config }) {
  const c = config(); const u = user();
  if (!c.contribEnabled) return emptyState('upload', 'Sharing is switched off', 'The admins have paused student uploads for now.');
  const r = await api('GET', '/api/contribute/mine');
  return html`<div class="sec-head"><div><h2>Share a note</h2><p>Help your classmates. Once a class rep or admin approves your upload, it goes into the library with your name on it${r.points ? ' and you earn <b>' + r.points + ' points</b>' : ''}.</p></div></div>
    <div class="card" style="max-width:720px">${uploadForm(S, u, { action: 'share-send', courses: S.state.academics.courses, button: 'Send for review' })}</div>
    <h3 style="margin:28px 0 12px">My uploads</h3>
    ${r.items.length ? html`<div class="card flat"><ol class="lb">${r.items.map((m) => html`<li><span class="grow"><b>${m.title}</b><br><span class="tiny muted">${m.course} · ${kindLabel[m.kind] || 'Resource'} · ${ago(m.addedAt)}</span>${m.status === 'rejected' && m.reason ? html`<br><span class="tiny" style="color:var(--bad)">${m.reason}</span>` : ''}</span>
      <span class="chip ${STATUS[m.status][1]}">${STATUS[m.status][0]}</span>${m.status !== 'approved' ? html`<button class="icon-btn small-ic" data-action="share-del" data-id="${m.id}" type="button" aria-label="Delete ${m.title}">${icon('trash', 15)}</button>` : ''}</li>`)}</ol></div>`
      : emptyState('upload', 'Nothing shared yet', 'Your uploads and their review status will show up here.')}`;
}
export const actions = {
  async 'share-send'(form, ev, { renderView }) {
    await submitWith(form, async () => { await api('POST', '/api/contribute', await readUploadForm(form)); toast('Sent! You will get a notification when it is reviewed.'); renderView(); });
  },
  async 'share-del'(el, ev, { renderView }) {
    try { await api('DELETE', '/api/contribute/' + el.dataset.id); toast('Removed.'); renderView(); } catch (e) { toast(e.message, 'bad'); }
  },
};
