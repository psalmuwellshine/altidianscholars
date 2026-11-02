// Add a whole timetable at once: take a photo (or paste the text), check what was read, save.
import { html, raw, icon, api, toast, dialog } from '../core/ui.js';
import { parseTimetable, missing } from '../core/ttparse.js';
import { DAYS } from './timetable.js';

const ENGINE = '/vendor/tesseract/';
let engineP = null;
// The photo reader (tesseract.js) is optional. If its files are not in /vendor/tesseract/, the dialog still works from pasted text.
function loadEngine() {
  if (window.Tesseract) return Promise.resolve(true);
  if (!engineP) engineP = new Promise((ok) => { const s = document.createElement('script'); s.src = ENGINE + 'tesseract.min.js'; s.onload = () => ok(!!window.Tesseract); s.onerror = () => ok(false); document.head.appendChild(s); });
  return engineP;
}
export const engineReady = () => loadEngine();

export async function readPhoto(file, onProgress) {
  const ok = await loadEngine(); if (!ok) return null;
  const worker = await window.Tesseract.createWorker('eng', 1, { workerPath: ENGINE + 'worker.min.js', corePath: ENGINE, langPath: ENGINE + 'lang', workerBlobURL: false, logger: (m) => { if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100)); } });
  try { const { data } = await worker.recognize(file); return data.text || ''; } finally { await worker.terminate(); }
}
// Phone photos are huge; a smaller copy reads just as well and is much faster.
export async function shrink(file, max = 1800, min = 0) {
  try {
    const bmp = await createImageBitmap(file); const big = Math.max(bmp.width, bmp.height); const k = Math.min(max / big, Math.max(1, min / big));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); g.filter = 'none';
    return await new Promise((r) => c.toBlob((b) => r(b || file), 'image/png'));
  } catch (e) { return file; }
}

const KINDS = [['class', 'Weekly class'], ['exam', 'Exam'], ['test', 'Test'], ['other', 'Study']];
const rowHtml = (r, i) => html`<div class="scan-row ${missing(r) ? 'bad' : ''}" data-i="${i}">
  <select name="kind" aria-label="Type">${KINDS.map(([k, l]) => html`<option value="${k}" ${r.kind === k ? raw('selected') : ''}>${l}</option>`)}</select>
  ${r.kind === 'class' ? html`<select name="day" aria-label="Day"><option value="">Day?</option>${DAYS.map((d, n) => html`<option value="${n + 1}" ${r.day === n + 1 ? raw('selected') : ''}>${d.slice(0, 3)}</option>`)}</select>` : html`<input name="date" type="date" value="${r.date}" aria-label="Date">`}
  <input name="start" type="time" value="${r.start}" aria-label="Starts"><input name="end" type="time" value="${r.end}" aria-label="Ends">
  <input name="title" value="${r.title}" maxlength="80" placeholder="Title" aria-label="Title"><input name="venue" value="${r.venue}" maxlength="80" placeholder="Venue" aria-label="Venue">
  <button class="icon-btn small-ic" data-action="scan-drop" type="button" aria-label="Remove">${icon('x', 15)}</button></div>`;

/* opts: { target: 'mine' | 'rep' | 'admin', courses, scope: () => ({departmentId, level}), scopeHtml, done } */
export function openScan(opts) {
  const state = { rows: [] };
  const { box, close } = dialog(html`<h3>Add a timetable from a photo or text</h3>
    <p class="muted small">Take a photo of the timetable, or paste its text. We read it and fill the entries in for you. Check them, fix anything wrong, then save.</p>
    <div class="msg alert bad" hidden role="alert"></div>
    <div id="scan-1">
      ${opts.scopeHtml || ''}
      <label class="field"><span>Photo or scan</span><input type="file" name="photo" accept="image/*" capture="environment"><small id="scan-status" class="muted"></small></label>
      <label class="field"><span>Text of the timetable</span><textarea name="text" rows="7" class="code" placeholder="Monday&#10;8:00-10:00 MBH222 Metabolism LT1&#10;Tuesday&#10;2pm-4pm ANA204 Gross anatomy Lab 2"></textarea></label>
      <label class="field"><span>These are mostly</span><select name="defkind">${KINDS.map(([k, l]) => html`<option value="${k}">${l === 'Weekly class' ? 'Weekly classes' : l + 's'}</option>`)}</select></label>
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" data-action="scan-read" type="button">${icon('search', 16)} Read it</button></div>
    </div>
    <div id="scan-2" hidden><div id="scan-rows"></div><p class="tiny muted" style="margin-top:8px">Rows in red are missing something. Fix them or remove them.</p>
      <div class="row end gap" style="margin-top:12px"><button class="btn ghost" data-action="scan-back" type="button">Back</button><button class="btn primary" data-action="scan-save" type="button">${icon('check', 16)} Save <span id="scan-n"></span></button></div></div>`, { wide: true });
  box._scan = { opts, state, close };
  const $ = (s) => box.querySelector(s); const err = (t) => { const m = $('.msg'); m.textContent = t; m.hidden = !t; };
  const draw = () => { $('#scan-rows').innerHTML = state.rows.map(rowHtml).map((x) => x.s).join(''); $('#scan-n').textContent = state.rows.length ? '(' + state.rows.length + ')' : ''; $('#scan-1').hidden = true; $('#scan-2').hidden = false; };
  box._scan.draw = draw; box._scan.err = err;
  loadEngine().then((ok) => { const s = $('#scan-status'); if (s) s.textContent = ok ? 'Photos are read on your phone. Nothing is uploaded.' : 'Photo reading is not switched on yet. Paste or type the text below instead.'; });
  return box;
}
const boxOf = (el) => el.closest('.modal');
function collect(box) {
  return [...box.querySelectorAll('.scan-row')].map((row) => { const v = (n) => { const e = row.querySelector('[name=' + n + ']'); return e ? String(e.value || '').trim() : ''; }; const kind = v('kind'); return { kind, day: kind === 'class' ? Number(v('day')) || 0 : 0, date: kind === 'class' ? '' : v('date'), start: v('start'), end: v('end'), title: v('title'), venue: v('venue'), course: (v('title').match(/\b[A-Z]{3}\d{3}\b/) || [''])[0] }; });
}
export const actions = {
  async 'scan-read'(el) {
    const box = boxOf(el); const S = box._scan; const f = (n) => box.querySelector('[name=' + n + ']');
    S.err(''); let text = f('text').value; const file = f('photo').files[0]; const status = box.querySelector('#scan-status');
    el.disabled = true;
    try {
      if (file) {
        status.textContent = 'Reading the photo… 0%';
        const small = await shrink(file); const t = await readPhoto(small, (p) => { status.textContent = 'Reading the photo… ' + p + '%'; });
        if (t === null) { if (!text.trim()) throw new Error('Photo reading is not switched on yet. Paste or type the timetable text instead.'); } else { text = text.trim() ? text + '\n' + t : t; f('text').value = text; }
      }
      if (!text.trim()) throw new Error('Add a photo or some text first.');
      S.state.rows = parseTimetable(text, { kind: f('defkind').value });
      if (!S.state.rows.length) throw new Error('No classes or exams found. Check the text has days or dates, times like 8:00-10:00, and course codes like MBH222.');
      S.draw();
    } catch (e) { S.err(e.message); } finally { el.disabled = false; if (status && file) status.textContent = ''; }
  },
  'scan-back'(el) { const box = boxOf(el); box.querySelector('#scan-2').hidden = true; box.querySelector('#scan-1').hidden = false; },
  'scan-drop'(el) { const box = boxOf(el); el.closest('.scan-row').remove(); const n = box.querySelectorAll('.scan-row').length; box.querySelector('#scan-n').textContent = n ? '(' + n + ')' : ''; },
  async 'scan-save'(el) {
    const box = boxOf(el); const S = box._scan; const rows = collect(box); S.err('');
    if (!rows.length) return S.err('Nothing to save.');
    const bad = rows.find((r) => missing(r)); if (bad) return S.err('One row still needs its ' + missing(bad) + '.');
    const path = { mine: '/api/timetable/mine', rep: '/api/rep/timetable', admin: '/api/admin/timetable' }[S.opts.target];
    const extra = S.opts.scope ? S.opts.scope(box) : {};
    el.disabled = true; let saved = 0;
    for (const r of rows) {
      try { await api('POST', path, Object.assign({}, r, extra)); saved++; el.querySelector('#scan-n').textContent = '(' + saved + '/' + rows.length + ')'; }
      catch (e) { el.disabled = false; S.err('Saved ' + saved + ' of ' + rows.length + '. Stopped at "' + r.title + '": ' + e.message); box.querySelectorAll('.scan-row').forEach((x, i) => { if (i < saved) x.remove(); }); return; }
    }
    S.close(); toast('Added ' + saved + ' timetable ' + (saved === 1 ? 'entry' : 'entries') + '.'); if (S.opts.done) S.opts.done();
  },
};
