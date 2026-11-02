// Admin: add courses from a photo of a course registration form, and departments from a photo of a list.
// Both work the same way: photo or pasted text -> check screen -> save.
import { html, raw, icon, api, toast, dialog } from '../core/ui.js';
import { parseCourseForm, parseDeptList, matchDepartment, matchFaculty, flagText } from '../core/formparse.js';
import { readPhoto, shrink, engineReady } from './scan.js';

const $ = (box, s) => box.querySelector(s);
const boxOf = (el) => el.closest('.modal');
const setErr = (box, t) => { const m = $(box, '.msg'); m.textContent = t; m.hidden = !t; };
async function textFrom(box, label) {
  const file = $(box, '[name=photo]').files[0]; let text = $(box, '[name=text]').value; const status = $(box, '#imp-status');
  if (file) {
    status.textContent = 'Reading the photo… 0%';
    try {
      const small = await shrink(file, 3000, 2400); const t = await readPhoto(small, (p) => { status.textContent = 'Reading the photo… ' + p + '%'; });
      if (t === null) { if (!text.trim()) throw new Error('Photo reading is not switched on yet. Paste or type the ' + label + ' instead.'); }
      else { text = text.trim() ? text + '\n' + t : t; $(box, '[name=text]').value = text; }
    } finally { status.textContent = ''; }
  }
  if (!text.trim()) throw new Error('Add a photo or some text first.');
  return text;
}
const engineNote = (box) => engineReady().then((ok) => { const s = $(box, '#imp-status'); if (s) s.textContent = ok ? 'Photos are read on this device. Nothing is uploaded.' : 'Photo reading is not switched on yet. Paste or type the text below instead.'; });

/* ---------- courses from a registration form ---------- */
const courseRow = (c) => html`<div class="imp-row ${c.flags.includes('prefix-unknown') || c.flags.includes('no-title') ? 'bad' : c.flags.length ? 'warn' : ''}" title="${c.flags.map(flagText).join(' ')}">
  <input name="code" value="${c.code}" maxlength="10" aria-label="Course code"><input name="name" value="${c.name}" maxlength="90" placeholder="Course title" aria-label="Course title">
  <input name="units" type="number" min="0" max="9" value="${c.units || ''}" placeholder="Unit" aria-label="Units"><select name="semester" aria-label="Semester"><option value="1" ${c.semester === 1 ? raw('selected') : ''}>1st</option><option value="2" ${c.semester === 2 ? raw('selected') : ''}>2nd</option></select>
  <button class="icon-btn small-ic" data-action="imp-drop" type="button" aria-label="Remove">${icon('x', 15)}</button></div>`;

export function openCourseImport({ acad, done }) {
  const deps = acad.departments;
  const { box, close } = dialog(html`<h3>Add courses from a registration form</h3>
    <p class="muted small">Take a clear, flat photo of the course registration form, or paste its text. Courses are added to the department you choose.</p>
    <div class="msg alert bad" hidden role="alert"></div>
    <div id="imp-1">
      <label class="field"><span>Photo of the form</span><input type="file" name="photo" accept="image/*" capture="environment"><small id="imp-status" class="muted"></small></label>
      <label class="field"><span>Or paste the text</span><textarea name="text" rows="6" class="code" placeholder="First semester&#10;CHM 101 General Chemistry I 2 C&#10;MTH 101 Elementary Mathematics I 2 C"></textarea></label>
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" data-action="imp-c-read" type="button">${icon('search', 16)} Read it</button></div>
    </div>
    <div id="imp-2" hidden>
      <div id="imp-notes"></div>
      <div class="grid2"><label class="field"><span>Department</span><select name="dept"><option value="">Choose…</option>${deps.map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select></label>
        <label class="field"><span>Level</span><select name="level"><option value="">From each course code</option>${[100, 200, 300, 400, 500, 600].map((l) => html`<option value="${l}">${l} level</option>`)}</select></label></div>
      <div id="imp-rows"></div>
      <button class="btn ghost small" data-action="imp-add" type="button" style="margin-top:8px">${icon('plus', 15)} Add a row</button>
      <p class="tiny muted" style="margin-top:8px">Red rows need a look. Amber rows were corrected or are missing something small. Courses that already exist are not duplicated: they are just added to this department.</p>
      <div class="row end gap" style="margin-top:12px"><button class="btn ghost" data-action="imp-back" type="button">Back</button><button class="btn primary" data-action="imp-c-save" type="button">${icon('check', 16)} Save courses <span id="imp-n"></span></button></div>
    </div>`);
  box._imp = { kind: 'course', done, close, acad, form: null };
  engineNote(box);
  return box;
}
const countRows = (box) => { const n = box.querySelectorAll('.imp-row').length; const e = $(box, '#imp-n'); if (e) e.textContent = n ? '(' + n + ')' : ''; };

/* ---------- departments from a list ---------- */
const deptRow = (name) => html`<div class="imp-dept"><input name="dname" value="${name}" maxlength="90" aria-label="Department"><button class="icon-btn small-ic" data-action="imp-drop-d" type="button" aria-label="Remove">${icon('x', 15)}</button></div>`;
const groupHtml = (g, facs) => {
  const m = matchFaculty(g.faculty, facs);
  return html`<div class="imp-group" data-fid="${m ? m.id : ''}"><div class="row gap wrap-r" style="align-items:center"><input name="faculty" value="${m ? m.name : g.faculty}" maxlength="90" placeholder="Faculty name" aria-label="Faculty" style="flex:1;min-width:180px">
      <span class="chip ${m ? 'good' : 'grey'}">${m ? 'Existing faculty' : 'New faculty'}</span></div>
    <div class="imp-depts">${g.departments.map(deptRow)}</div>
    <button class="btn ghost small" data-action="imp-add-d" type="button">${icon('plus', 15)} Add a department</button></div>`;
};
export function openDeptImport({ acad, done }) {
  const { box, close } = dialog(html`<h3>Add departments from a list</h3>
    <p class="muted small">Take a photo of the list, or paste it. Faculty names start each group, and the departments follow in order. Faculties that already exist are reused.</p>
    <div class="msg alert bad" hidden role="alert"></div>
    <div id="imp-1">
      <label class="field"><span>Photo of the list</span><input type="file" name="photo" accept="image/*" capture="environment"><small id="imp-status" class="muted"></small></label>
      <label class="field"><span>Or paste the list</span><textarea name="text" rows="8" class="code" placeholder="Faculty of Basic Medical Sciences&#10;1. Anatomy&#10;2. Physiology&#10;Faculty of Science&#10;1. Microbiology"></textarea></label>
      <div class="grid2"><label class="field"><span>Departments with no faculty heading go under</span><select name="deffac"><option value="">Choose…</option>${acad.faculties.map((f) => html`<option value="${f.id}">${f.name}</option>`)}</select></label>
        <label class="field"><span>Highest level for new departments</span><select name="maxlevel">${[400, 500, 600, 300, 200, 100].map((l) => html`<option value="${l}">${l} level</option>`)}</select></label></div>
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" data-action="imp-d-read" type="button">${icon('search', 16)} Read it</button></div>
    </div>
    <div id="imp-2" hidden><div id="imp-groups"></div>
      <p class="tiny muted" style="margin-top:8px">Check the names. Remove anything that is not a department.</p>
      <div class="row end gap" style="margin-top:12px"><button class="btn ghost" data-action="imp-back" type="button">Back</button><button class="btn primary" data-action="imp-d-save" type="button">${icon('check', 16)} Save <span id="imp-n"></span></button></div></div>`);
  box._imp = { kind: 'dept', done, close, acad };
  engineNote(box);
  return box;
}

export const actions = {
  'imp-back'(el) { const b = boxOf(el); $(b, '#imp-1').hidden = false; $(b, '#imp-2').hidden = true; },
  'imp-drop'(el) { const b = boxOf(el); el.closest('.imp-row').remove(); countRows(b); },
  'imp-add'(el) { const b = boxOf(el); const d = document.createElement('div'); d.innerHTML = courseRow({ code: '', name: '', units: 0, semester: 1, flags: [] }).s; $(b, '#imp-rows').appendChild(d.firstElementChild); countRows(b); },
  'imp-drop-d'(el) { el.closest('.imp-dept').remove(); },
  'imp-add-d'(el) { const w = el.closest('.imp-group').querySelector('.imp-depts'); const d = document.createElement('div'); d.innerHTML = deptRow('').s; w.appendChild(d.firstElementChild); w.lastElementChild.querySelector('input').focus(); },

  async 'imp-c-read'(el) {
    const b = boxOf(el); setErr(b, ''); el.disabled = true;
    try {
      const S = b._imp; const text = await textFrom(b, 'text of the form');
      const known = [...new Set(S.acad.courses.map((c) => String(c.code).slice(0, 3)))];
      const r = parseCourseForm(text, { prefixes: known });
      if (!r.courses.length) throw new Error('No courses found. Each course needs a code like CHM 101 on its own line.');
      const dep = matchDepartment(r.department, S.acad.departments);
      $(b, '#imp-rows').innerHTML = r.courses.map((c) => courseRow(c).s).join('');
      if (dep) $(b, '[name=dept]').value = dep.id;
      if (r.level) $(b, '[name=level]').value = String(r.level);
      const notes = r.notes.concat(!dep && r.department ? ['The form says the department is "' + r.department + '". Choose it from the list.'] : []);
      $(b, '#imp-notes').innerHTML = (r.department || r.level ? '<p class="small"><b>On the form:</b> ' + [r.department, r.level ? r.level + ' level' : '', r.session].filter(Boolean).map((x) => String(x).replace(/[<>&]/g, '')).join(' · ') + '</p>' : '') + notes.map((n) => '<div class="alert warning" style="margin:6px 0">' + n.replace(/[<>&]/g, '') + '</div>').join('');
      $(b, '#imp-1').hidden = true; $(b, '#imp-2').hidden = false; countRows(b);
    } catch (e) { setErr(b, e.message); } finally { el.disabled = false; }
  },
  async 'imp-c-save'(el) {
    const b = boxOf(el); setErr(b, ''); const S = b._imp;
    const dept = $(b, '[name=dept]').value; if (!dept) return setErr(b, 'Choose the department these courses belong to.');
    const lvl = Number($(b, '[name=level]').value) || 0;
    const courses = [...b.querySelectorAll('.imp-row')].map((row) => { const v = (n) => row.querySelector('[name=' + n + ']').value.trim(); const code = v('code').toUpperCase().replace(/\s+/g, ''); const m = /(\d)\d\d$/.exec(code);
      return { code, name: v('name'), units: Number(v('units')) || 0, semester: Number(v('semester')) || 1, level: lvl || (m ? Number(m[1]) * 100 : 0) }; }).filter((c) => c.code);
    if (!courses.length) return setErr(b, 'There are no courses to save.');
    const empty = courses.find((c) => !c.name); if (empty) return setErr(b, empty.code + ' has no title. Add one or remove the row.');
    el.disabled = true;
    try {
      const r = await api('POST', '/api/admin/courses/bulk', { departmentId: dept, courses });
      S.close(); toast([r.added && r.added + ' added', r.linked && r.linked + ' linked to this department', r.same && r.same + ' already there', r.bad && r.bad.length && r.bad.length + ' skipped (' + r.bad.join(', ') + ')'].filter(Boolean).join(' · ') + '.');
      if (S.done) S.done();
    } catch (e) { setErr(b, e.message); el.disabled = false; }
  },

  async 'imp-d-read'(el) {
    const b = boxOf(el); setErr(b, ''); el.disabled = true;
    try {
      const S = b._imp; const text = await textFrom(b, 'list');
      let groups = parseDeptList(text); if (!groups.length || !groups.some((g) => g.departments.length)) throw new Error('No departments found. Put one department on each line, with a faculty heading above each group.');
      const def = S.acad.faculties.find((f) => f.id === $(b, '[name=deffac]').value);
      groups = groups.map((g) => (g.faculty ? g : { faculty: def ? def.name : '', departments: g.departments }));
      $(b, '#imp-groups').innerHTML = groups.map((g) => groupHtml(g, S.acad.faculties).s).join('');
      $(b, '#imp-1').hidden = true; $(b, '#imp-2').hidden = false; $(b, '#imp-n').textContent = '(' + groups.reduce((a, g) => a + g.departments.length, 0) + ')';
    } catch (e) { setErr(b, e.message); } finally { el.disabled = false; }
  },
  async 'imp-d-save'(el) {
    const b = boxOf(el); setErr(b, ''); const S = b._imp; const maxLevel = Number($(b, '[name=maxlevel]').value) || 400;
    const groups = [...b.querySelectorAll('.imp-group')].map((g) => ({ facultyId: g.dataset.fid || '', faculty: g.querySelector('[name=faculty]').value.trim(), maxLevel, departments: [...g.querySelectorAll('[name=dname]')].map((i) => i.value.trim()).filter(Boolean) })).filter((g) => g.departments.length);
    if (!groups.length) return setErr(b, 'There are no departments to save.');
    const nofac = groups.find((g) => !g.faculty && !g.facultyId); if (nofac) return setErr(b, 'Every group needs a faculty name.');
    el.disabled = true;
    try {
      const r = await api('POST', '/api/admin/academics/import', { groups });
      S.close(); toast([r.newFac && r.newFac + ' new faculties', r.newDep && r.newDep + ' departments added', r.skipped && r.skipped + ' already there'].filter(Boolean).join(' · ') + '.');
      if (S.done) S.done();
    } catch (e) { setErr(b, e.message); el.disabled = false; }
  },
};
