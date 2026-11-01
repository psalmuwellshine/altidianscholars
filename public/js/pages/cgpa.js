// CGPA calculator on the Nigerian 5.0 scale. Everything stays on the phone.
import { html, icon, toast, esc } from '../core/ui.js';

const GRADES = [['A', 5], ['B', 4], ['C', 3], ['D', 2], ['E', 1], ['F', 0]];
const KEY = 'alt-cgpa-v1';
let data = null;

function load() {
  if (data) return data;
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.sems)) { data = d; return data; } } catch (e) { /* none saved yet */ }
  data = { prevCgpa: '', prevUnits: '', sems: [{ name: 'This semester', rows: [{ c: '', u: 3, g: 'A' }] }] };
  return data;
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode */ } };
const pts = (g) => (GRADES.find((x) => x[0] === g) || [0, 0])[1];
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

export function calc(d) {
  const sems = d.sems.map((s) => {
    const rows = s.rows.filter((r) => num(r.u) > 0);
    const units = rows.reduce((a, r) => a + num(r.u), 0);
    const qp = rows.reduce((a, r) => a + num(r.u) * pts(r.g), 0);
    return { units, qp, gpa: units ? qp / units : null };
  });
  let units = sems.reduce((a, s) => a + s.units, 0); let qp = sems.reduce((a, s) => a + s.qp, 0);
  const pu = num(d.prevUnits); const pc = Math.min(5, num(d.prevCgpa));
  if (pu > 0 && pc > 0) { units += pu; qp += pu * pc; }
  return { sems, units, cgpa: units ? qp / units : null };
}
export const classOf = (c) => (c === null ? '' : c >= 4.5 ? 'First Class' : c >= 3.5 ? 'Second Class Upper' : c >= 2.4 ? 'Second Class Lower' : c >= 1.5 ? 'Third Class' : c >= 1 ? 'Pass' : 'Below pass');
const f2 = (n) => (n === null ? '–' : n.toFixed(2));

function view() {
  const d = load(); const r = calc(d);
  return html`<div class="sec-head"><div><h2>CGPA calculator</h2><p>Nigerian 5.0 scale: A is 5, B is 4, C is 3, D is 2, E is 1, F is 0. Saved on this phone only.</p></div></div>
    <div class="card cg-total pop"><span class="muted small">Your CGPA</span><b class="cg-num" id="cg-num">${f2(r.cgpa)}</b><span class="chip brand" id="cg-class">${r.cgpa === null ? 'Add a course to start' : classOf(r.cgpa)}</span>
      <span class="tiny muted" id="cg-units">${r.units} total units</span></div>
    <details class="fold" ${d.prevUnits || d.prevCgpa ? 'open' : ''}><summary><span class="ico">${icon('trophy', 18)}</span><span class="grow"><b>Already have a CGPA from earlier years?</b></span></summary>
      <div class="fold-body"><div class="grid2"><label class="field"><span>Your CGPA so far</span><input inputmode="decimal" data-input="cg-prev" data-k="prevCgpa" value="${d.prevCgpa}" placeholder="e.g. 4.12"></label>
      <label class="field"><span>Units done so far</span><input inputmode="numeric" data-input="cg-prev" data-k="prevUnits" value="${d.prevUnits}" placeholder="e.g. 48"></label></div></div></details>
    ${d.sems.map((s, si) => html`<section class="card cg-sem" style="margin-top:14px">
      <div class="row between"><input class="cg-name" data-input="cg-semname" data-s="${si}" value="${s.name}" maxlength="30" aria-label="Semester name"><span class="chip ${'grey'}" id="cg-gpa-${si}">GPA ${f2(r.sems[si].gpa)}</span></div>
      <div class="cg-head tiny muted"><span>Course</span><span>Units</span><span>Grade</span><span></span></div>
      ${s.rows.map((row, ri) => html`<div class="cg-row"><input data-input="cg-cell" data-s="${si}" data-r="${ri}" data-k="c" value="${row.c}" maxlength="12" placeholder="MBH222" aria-label="Course code">
        <input inputmode="numeric" data-input="cg-cell" data-s="${si}" data-r="${ri}" data-k="u" value="${row.u}" aria-label="Units">
        <select data-change="cg-cell" data-s="${si}" data-r="${ri}" data-k="g" aria-label="Grade">${GRADES.map(([g]) => html`<option ${row.g === g ? 'selected' : ''}>${g}</option>`)}</select>
        <button class="icon-btn" data-action="cg-del" data-s="${si}" data-r="${ri}" type="button" aria-label="Remove course">${icon('x', 16)}</button></div>`)}
      <div class="row gap-s" style="margin-top:10px"><button class="btn ghost small" data-action="cg-add" data-s="${si}" type="button">${icon('plus', 15)} Add course</button>
        ${d.sems.length > 1 ? html`<button class="btn ghost small" data-action="cg-delsem" data-s="${si}" type="button">Remove semester</button>` : ''}</div></section>`)}
    <div class="row gap-s" style="margin-top:14px"><button class="btn primary" data-action="cg-addsem" type="button">${icon('plus', 17)} Add another semester</button><button class="btn ghost" data-action="cg-reset" type="button">Start over</button></div>
    <p class="tiny muted" style="margin-top:14px">Class of degree uses the usual cut-offs: 4.50 and above First Class, 3.50 to 4.49 Second Class Upper, 2.40 to 3.49 Second Class Lower, 1.50 to 2.39 Third Class. Your school's rules come first if they differ.</p>`;
}

export const page = {
  needsLogin: false,
  render() { data = null; load(); return view(); },
};
export const render = page.render;

const update = () => { // refresh the numbers without rebuilding the inputs (keeps keyboard focus)
  const r = calc(load());
  const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  set('cg-num', f2(r.cgpa)); set('cg-class', r.cgpa === null ? 'Add a course to start' : classOf(r.cgpa)); set('cg-units', r.units + ' total units');
  r.sems.forEach((s, i) => set('cg-gpa-' + i, 'GPA ' + f2(s.gpa)));
  save();
};
const redraw = (renderView) => { save(); renderView(); };

export const actions = {
  'cg-prev'(el) { load()[el.dataset.k] = el.value.replace(/[^0-9.]/g, ''); update(); },
  'cg-semname'(el) { load().sems[+el.dataset.s].name = el.value; save(); },
  'cg-cell'(el) { const row = load().sems[+el.dataset.s].rows[+el.dataset.r]; row[el.dataset.k] = el.dataset.k === 'u' ? el.value.replace(/[^0-9]/g, '') : el.value; update(); },
  'cg-add'(el, ev, { renderView }) { load().sems[+el.dataset.s].rows.push({ c: '', u: 3, g: 'A' }); redraw(renderView); },
  'cg-del'(el, ev, { renderView }) { const s = load().sems[+el.dataset.s]; s.rows.splice(+el.dataset.r, 1); if (!s.rows.length) s.rows.push({ c: '', u: 3, g: 'A' }); redraw(renderView); },
  'cg-addsem'(el, ev, { renderView }) { const d = load(); d.sems.push({ name: 'Semester ' + (d.sems.length + 1), rows: [{ c: '', u: 3, g: 'A' }] }); redraw(renderView); },
  'cg-delsem'(el, ev, { renderView }) { load().sems.splice(+el.dataset.s, 1); redraw(renderView); },
  'cg-reset'(el, ev, { renderView }) { if (!confirm('Clear everything in the calculator?')) return; data = null; try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } renderView(); toast('Cleared.'); },
};
