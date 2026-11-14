'use strict';
/* Admin control panel API. Every route here needs the admin cookie. */
const H = require('../lib/helpers');
const D = require('../lib/domain');
const Ac = require('../lib/academics');
const { FILE_TYPES, MAX_FILE_BYTES, looksLike } = require('../lib/files');

const { HttpError, clean, okCourse, isHttp, newId, isDate, isTime, bool } = H;
const KINDS = ['notes', 'pq', 'slides', 'video', 'other'];
const LEVELS = ['info', 'success', 'warning'];
const day = 86400000;

// Spreadsheet programs run text that starts with = + - @ as a formula. Prefix it so they do not.
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

module.exports = function registerAdmin({ route, store, send, push }) {
  const A = { admin: true };

  // A WhatsApp number (0815 117 9933, +234 815 117 9933) or a WhatsApp link, saved as a wa.me link.
  function waContact(raw, who) {
    const v = clean(raw, 200); if (!v) return '';
    if (isHttp(v)) {
      if (!/^https?:\/\/(wa\.me|api\.whatsapp\.com|wa\.link|chat\.whatsapp\.com)\//i.test(v)) throw new HttpError(400, who + ': use a WhatsApp link or just the phone number.');
      return v;
    }
    let d = v.replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('0')) d = '234' + d.slice(1); // 0815... -> 234815...
    else if (d.length === 10) d = '234' + d;                           // 815... -> 234815...
    if (d.length < 11 || d.length > 15) throw new HttpError(400, who + ': that phone number does not look right. Example: 0815 117 9933.');
    return 'https://wa.me/' + d;
  }
  const VIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  // Prices are whole naira. Used by materials, quizzes and the semester pass.
  function wholeNaira(v, what, allowBlank) {
    if (allowBlank && (v === '' || v === null || v === undefined)) return 0;
    const n = Number(v);
    if (!Number.isInteger(n) || n < (allowBlank ? 0 : 1) || n > 1000000) throw new HttpError(400, 'Enter the ' + what + ' in naira as a whole number, like 500.');
    return n;
  }
  // Marks a material or quiz as paid (with its own price) or free.
  function readPaid(b, doc) {
    if (bool(b.paid)) { doc.paid = true; doc.price = wholeNaira(b.price, 'price'); }
    return doc;
  }

  /* ---------- sign in ---------- */
  route('POST', '/api/admin/login', { limit: ['login', 8, 15 * 60 * 1000] }, async (req, res, ctx) => {
    if (!H.ADMIN_PASSWORD) throw new HttpError(503, 'Admin is not set up. Set the ADMIN_PASSWORD variable on the server.');
    if (H.tooManyFails('adminlogin', 'all', 8)) throw new HttpError(429, 'Too many wrong attempts. Please wait 15 minutes and try again.'); // counted for the admin account itself, from anywhere
    const pw = ctx.body.password;
    if (typeof pw !== 'string' || !H.safeEqual(H.sha(pw), H.sha(H.ADMIN_PASSWORD))) { H.noteFail('adminlogin', 'all', 15 * 60 * 1000); throw new HttpError(401, 'Wrong password.'); }
    H.clearFails('adminlogin', 'all');
    send(res, 200, { ok: true }, { 'Set-Cookie': H.makeCookie(req, 'ew_admin', 'admin', 'admin', 0, H.ADMIN_SESSION_HOURS * 3600) });
  });
  route('POST', '/api/admin/logout', {}, async (req, res) => send(res, 200, { ok: true }, { 'Set-Cookie': H.clearCookie('ew_admin') }));
  route('GET', '/api/admin/me', {}, async (req, res) => send(res, 200, { admin: H.isAdmin(req), configured: !!H.ADMIN_PASSWORD, storage: store.kind }));

  /* ---------- overview ---------- */
  route('GET', '/api/admin/overview', A, async (req, res) => {
    const [users, scores, quizzes, materials, events] = await Promise.all([
      store.list('users'), store.list('scores'), store.list('quizzes'), store.list('materials'), store.list('events'),
    ]);
    const now = Date.now();
    const stats = D.quizStats(scores, quizzes);
    const attempts = Object.values(stats).reduce((a, s) => a + s.attempts, 0);
    const today = new Date(now + 3600000).toISOString().slice(0, 10);
    const top = quizzes.map((q) => ({ id: q.id, title: q.title, course: q.course, ...stats[q.id] })).sort((a, b) => b.attempts - a.attempts).slice(0, 5);
    const newest = users.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 6).map((u) => ({ id: u.id, username: u.username, createdAt: u.createdAt || null }));
    send(res, 200, {
      totals: {
        students: users.length, disabled: users.filter((u) => u.disabled).length,
        guests: scores.filter((s) => !users.some((u) => u.id === s.id)).length,
        materials: materials.length, hiddenMaterials: materials.filter((m) => m.hidden).length,
        quizzes: quizzes.length, hiddenQuizzes: quizzes.filter((q) => q.hidden).length,
        attempts, events: events.length, upcoming: events.filter((e) => e.date >= today).length,
        activeWeek: users.filter((u) => (u.lastLoginAt || 0) > now - 7 * day).length,
      },
      series: D.activitySeries(scores, users, 14, now),
      top, newest, storage: store.kind,
    });
  });

  /* ---------- students ---------- */
  const userRow = (u, rec, quizIds) => {
    const p = D.pointsFor(rec, quizIds);
    return {
      id: u.id, username: u.username, facultyId: u.facultyId || '', departmentId: u.departmentId || '', level: u.level || 0, avatarId: u.avatarId || '', createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null,
      paidUntil: u.paidUntil || '', unlocked: Array.isArray(u.unlocked) ? u.unlocked : [], unlockedCount: Array.isArray(u.unlocked) ? u.unlocked.length : 0,
      disabled: !!u.disabled, chatMuted: !!u.chatMuted, rep: u.rep || null, hasRecovery: !!u.recovery, points: p.points, done: p.done, rank: D.rankInfo(p.points).title,
      attempts: D.historyOf(rec).length || p.done,
    };
  };
  route('GET', '/api/admin/users', A, async (req, res) => {
    const [users, scores, quizzes] = await Promise.all([store.list('users'), store.list('scores'), store.list('quizzes')]);
    const ids = new Set(quizzes.map((q) => q.id));
    const byId = new Map(scores.map((s) => [s.id, s]));
    send(res, 200, users.map((u) => userRow(u, byId.get(u.id), ids)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  });
  route('GET', '/api/admin/users/:id', A, async (req, res, ctx) => {
    const user = await store.get('users', ctx.params[0]);
    if (!user) throw new HttpError(404, 'Student not found.');
    const [quizzes, scores, users, courses] = await Promise.all([store.list('quizzes'), store.list('scores'), store.list('users'), store.list('courses')]);
    const board = D.buildBoard(new Map(users.map((u) => [u.id, u])), scores, new Set(quizzes.map((q) => q.id)));
    const profile = D.buildProfile({ user, rec: scores.find((s) => s.id === user.id) || null, quizzes, courses, board, now: Date.now() });
    profile.user.disabled = !!user.disabled;
    profile.user.hasRecovery = !!user.recovery;
    send(res, 200, profile);
  });
  route('POST', '/api/admin/users/:id/password', A, async (req, res, ctx) => {
    const user = await store.get('users', ctx.params[0]);
    if (!user) throw new HttpError(404, 'Student not found.');
    const pw = H.str(ctx.body.newPassword, 200);
    if (pw.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
    user.password = await H.hashPassword(pw);
    user.sv = (user.sv || 0) + 1; // signs them out everywhere
    await store.put('users', user);
    send(res, 200, { ok: true });
  });
  route('POST', '/api/admin/users/:id/disable', A, async (req, res, ctx) => {
    const user = await store.get('users', ctx.params[0]);
    if (!user) throw new HttpError(404, 'Student not found.');
    user.disabled = bool(ctx.body.disabled);
    user.sv = (user.sv || 0) + 1;
    await store.put('users', user);
    send(res, 200, { ok: true, disabled: user.disabled });
  });
  route('POST', '/api/admin/users/:id/clear-scores', A, async (req, res, ctx) => {
    await store.del('scores', ctx.params[0]);
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/users/:id', A, async (req, res, ctx) => {
    const u = await store.get('users', ctx.params[0]);
    if (u && u.avatarId) await store.delFile(u.avatarId);
    await store.del('users', ctx.params[0]);
    await store.del('scores', ctx.params[0]);
    send(res, 200, { ok: true });
  });

  route('PUT', '/api/admin/users/:id', A, async (req, res, ctx) => {
    const user = await store.get('users', ctx.params[0]);
    if (!user) throw new HttpError(404, 'Student not found.');
    const b = ctx.body;
    const place = Ac.pickAcademic(b, await Ac.loadAcademics(store));
    Object.assign(user, place);
    await store.put('users', user);
    send(res, 200, { ok: true });
  });
  // Who has paid: a semester pass date and/or single paid items unlocked for this student.
  route('POST', '/api/admin/users/:id/access', A, async (req, res, ctx) => {
    const user = await store.get('users', ctx.params[0]);
    if (!user) throw new HttpError(404, 'Student not found.');
    const b = ctx.body;
    const until = String(b.paidUntil || '').trim();
    if (until && !isDate(until)) throw new HttpError(400, 'Pick a valid date for the semester pass.');
    const [mats, qzs] = await Promise.all([store.list('materials'), store.list('quizzes')]);
    const paidIds = new Set(mats.concat(qzs).filter((x) => x.paid).map((x) => x.id));
    const want = Array.isArray(b.unlocked) ? b.unlocked.map(String) : [];
    const hadItems = new Set(Array.isArray(user.unlocked) ? user.unlocked : []); const prevUntil = user.paidUntil || '';
    user.paidUntil = until;
    user.unlocked = Array.from(new Set(want.filter((id) => paidIds.has(id))));
    // A receipt for everything newly unlocked, so the student can see what they have paid for.
    const cfg = await D.loadConfig(store); const byId = new Map(mats.concat(qzs).map((x) => [x.id, x]));
    const now = Date.now(); user.receipts = Array.isArray(user.receipts) ? user.receipts : [];
    const no = () => 'ALT-' + H.sha(newId() + now).slice(0, 8).toUpperCase(); const gained = [];
    user.unlocked.filter((id) => !hadItems.has(id)).forEach((id) => { const x = byId.get(id); user.receipts.push({ id: newId(), no: no(), kind: 'item', ref: id, title: x.title, amount: x.price || 0, at: now }); gained.push(x.title); });
    if (until && until !== prevUntil && until >= D.lagosDate(now)) { user.receipts.push({ id: newId(), no: no(), kind: 'pass', title: 'Semester pass', amount: cfg.passPrice || 0, until, at: now }); gained.push('Semester pass'); }
    user.receipts = user.receipts.slice(-100);
    await store.put('users', user);
    if (gained.length) push.later({ audience: { uid: user.id }, type: 'direct', title: 'Access unlocked', body: gained.slice(0, 3).join(', ') + (gained.length > 3 ? ' and more' : ''), url: '/#/receipts' });
    send(res, 200, { ok: true, paidUntil: user.paidUntil, unlocked: user.unlocked.length });
  });
  route('DELETE', '/api/admin/users/:id/avatar', A, async (req, res, ctx) => {
    const user = await store.get('users', ctx.params[0]);
    if (!user) throw new HttpError(404, 'Student not found.');
    if (user.avatarId) { await store.delFile(user.avatarId); user.avatarId = ''; user.avatarType = ''; await store.put('users', user); }
    send(res, 200, { ok: true });
  });

  /* ---------- faculties, departments, courses ---------- */
  route('GET', '/api/admin/academics', A, async (req, res) => {
    const [acad, users] = await Promise.all([Ac.loadAcademics(store), store.list('users')]);
    const count = (k, id) => users.filter((u) => u[k] === id).length;
    send(res, 200, {
      faculties: acad.faculties.map((f) => Object.assign({}, f, { students: count('facultyId', f.id), departments: acad.departments.filter((d) => d.facultyId === f.id).length })),
      departments: acad.departments.map((d) => Object.assign({}, d, { students: count('departmentId', d.id), courses: acad.courses.filter((c) => (c.departmentIds || []).includes(d.id)).length })),
      courses: acad.courses,
    });
  });
  route('POST', '/api/admin/faculties', A, async (req, res, ctx) => {
    const name = clean(ctx.body.name, 90);
    if (!name) throw new HttpError(400, 'Add a faculty name.');
    if ((await store.list('faculties')).some((f) => f.name.toLowerCase() === name.toLowerCase())) throw new HttpError(400, 'That faculty already exists.');
    const doc = { id: newId(), name }; await store.put('faculties', doc);
    send(res, 200, { ok: true, id: doc.id });
  });
  route('PUT', '/api/admin/faculties/:id', A, async (req, res, ctx) => {
    const f = await store.get('faculties', ctx.params[0]);
    if (!f) throw new HttpError(404, 'Faculty not found.');
    const name = clean(ctx.body.name, 90);
    if (!name) throw new HttpError(400, 'Add a faculty name.');
    f.name = name; await store.put('faculties', f);
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/faculties/:id', A, async (req, res, ctx) => {
    const id = ctx.params[0];
    if ((await store.list('departments')).some((d) => d.facultyId === id)) throw new HttpError(400, 'Remove or move this faculty\'s departments first.');
    if ((await store.list('users')).some((u) => u.facultyId === id)) throw new HttpError(400, 'Students are still registered under this faculty.');
    await store.del('faculties', id);
    send(res, 200, { ok: true });
  });
  async function readDept(b, existing) {
    const name = clean(b.name, 90);
    if (!name) throw new HttpError(400, 'Add a department or programme name.');
    const facultyId = String(b.facultyId || '');
    if (!(await store.get('faculties', facultyId))) throw new HttpError(400, 'Choose a faculty.');
    const maxLevel = Number(b.maxLevel);
    if (!Ac.LEVELS.includes(maxLevel)) throw new HttpError(400, 'Choose the highest level (100 to 600).');
    const dup = (await store.list('departments')).some((d) => d.facultyId === facultyId && d.name.toLowerCase() === name.toLowerCase() && (!existing || d.id !== existing.id));
    if (dup) throw new HttpError(400, 'That department already exists in this faculty.');
    return { id: existing ? existing.id : newId(), name, facultyId, maxLevel };
  }
  route('POST', '/api/admin/departments', A, async (req, res, ctx) => {
    const d = await readDept(ctx.body, null); await store.put('departments', d);
    send(res, 200, { ok: true, id: d.id });
  });
  route('PUT', '/api/admin/departments/:id', A, async (req, res, ctx) => {
    const cur = await store.get('departments', ctx.params[0]);
    if (!cur) throw new HttpError(404, 'Department not found.');
    const d = await readDept(ctx.body, cur);
    if (d.facultyId !== cur.facultyId && (await store.list('users')).some((u) => u.departmentId === cur.id)) throw new HttpError(400, 'Students are registered here, so it cannot move to another faculty.');
    await store.put('departments', d);
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/departments/:id', A, async (req, res, ctx) => {
    const id = ctx.params[0];
    if ((await store.list('users')).some((u) => u.departmentId === id)) throw new HttpError(400, 'Students are registered in this department.');
    for (const c of await store.list('courses')) {
      if ((c.departmentIds || []).includes(id)) { c.departmentIds = c.departmentIds.filter((x) => x !== id); await store.put('courses', c); }
    }
    await store.del('departments', id);
    send(res, 200, { ok: true });
  });
  // Faculties and departments from a list: faculties that already exist are reused, the rest are created.
  route('POST', '/api/admin/academics/import', A, async (req, res, ctx) => {
    const groups = Array.isArray(ctx.body && ctx.body.groups) ? ctx.body.groups.slice(0, 40) : [];
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\b(faculty|of|and|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const facs = await store.list('faculties'); const deps = await store.list('departments');
    let newFac = 0, newDep = 0, skipped = 0;
    for (const g of groups) {
      let fac = null;
      if (g.facultyId) fac = facs.find((f) => f.id === String(g.facultyId));
      if (!fac) {
        const name = clean(g.faculty, 90); if (!name) { skipped += (g.departments || []).length; continue; }
        fac = facs.find((f) => norm(f.name) === norm(name));
        if (!fac) { fac = { id: newId(), name }; await store.put('faculties', fac); facs.push(fac); newFac++; }
      }
      const maxLevel = Ac.LEVELS.includes(Number(g.maxLevel)) ? Number(g.maxLevel) : 400;
      for (const n0 of (Array.isArray(g.departments) ? g.departments : []).slice(0, 80)) {
        const name = clean(n0, 90); if (!name) continue;
        if (deps.some((d) => d.facultyId === fac.id && d.name.toLowerCase() === name.toLowerCase())) { skipped++; continue; }
        const d = { id: newId(), name, facultyId: fac.id, maxLevel }; await store.put('departments', d); deps.push(d); newDep++;
      }
    }
    send(res, 200, { ok: true, newFac, newDep, skipped });
  });
  async function readCourse(b, existing) {
    const code = clean(b.code, 10).toUpperCase();
    if (!okCourse(code)) throw new HttpError(400, 'Course code must be 2 to 10 letters or digits, like MBH222.');
    const level = Number(b.level);
    if (!Ac.LEVELS.includes(level)) throw new HttpError(400, 'Choose a level from 100 to 600.');
    if ((await store.list('courses')).some((c) => c.code === code && (!existing || c.id !== existing.id))) throw new HttpError(400, 'Course ' + code + ' already exists.');
    const deps = await store.list('departments');
    const ids = Array.isArray(b.departmentIds) ? [...new Set(b.departmentIds.map(String))] : [];
    if (ids.some((id) => !deps.some((d) => d.id === id))) throw new HttpError(400, 'One of the departments is not valid.');
    return { id: existing ? existing.id : newId(), code, name: clean(b.name, 90), level, departmentIds: ids };
  }
  route('POST', '/api/admin/courses', A, async (req, res, ctx) => {
    const c = await readCourse(ctx.body, null); await store.put('courses', c);
    send(res, 200, { ok: true, id: c.id });
  });
  // Many courses at once (from a registration form): new codes are created, existing codes are linked to this department.
  route('POST', '/api/admin/courses/bulk', A, async (req, res, ctx) => {
    const b = ctx.body || {}; const dep = await store.get('departments', String(b.departmentId || ''));
    if (!dep) throw new HttpError(400, 'Choose the department these courses belong to.');
    const list = Array.isArray(b.courses) ? b.courses.slice(0, 120) : [];
    if (!list.length) throw new HttpError(400, 'There are no courses to add.');
    const all = await store.list('courses'); const byCode = new Map(all.map((c) => [c.code, c]));
    let added = 0, linked = 0, same = 0; const bad = [];
    for (const r of list) {
      const code = clean(r.code, 10).toUpperCase();
      if (!okCourse(code)) { bad.push(code || '(blank)'); continue; }
      const cur = byCode.get(code);
      if (cur) {
        if ((cur.departmentIds || []).length && !cur.departmentIds.includes(dep.id)) { cur.departmentIds = cur.departmentIds.concat(dep.id); await store.put('courses', cur); linked++; } else same++;
        continue;
      }
      const level = Ac.LEVELS.includes(Number(r.level)) ? Number(r.level) : (Ac.LEVELS.includes(Number(b.level)) ? Number(b.level) : 0);
      if (!level) { bad.push(code); continue; }
      const c = { id: newId(), code, name: clean(r.name, 90), level, departmentIds: [dep.id] };
      const u = Number(r.units); if (u >= 1 && u <= 9) c.units = u;
      const sm = Number(r.semester); if (sm === 1 || sm === 2) c.semester = sm;
      await store.put('courses', c); byCode.set(code, c); added++;
    }
    send(res, 200, { ok: true, added, linked, same, bad });
  });
  route('PUT', '/api/admin/courses/:id', A, async (req, res, ctx) => {
    const cur = await store.get('courses', ctx.params[0]);
    if (!cur) throw new HttpError(404, 'Course not found.');
    const c = await readCourse(ctx.body, cur);
    if (c.code !== cur.code) { // keep materials and quizzes attached when the code changes
      for (const m of await store.list('materials')) if (m.course === cur.code) { m.course = c.code; await store.put('materials', m); }
      for (const q of await store.list('quizzes')) if (q.course === cur.code) { q.course = c.code; await store.put('quizzes', q); }
    }
    await store.put('courses', c);
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/courses/:id', A, async (req, res, ctx) => {
    const c = await store.get('courses', ctx.params[0]);
    if (!c) return send(res, 200, { ok: true });
    const used = (await store.list('materials')).some((m) => m.course === c.code) || (await store.list('quizzes')).some((q) => q.course === c.code);
    if (used) throw new HttpError(400, 'Resources or quizzes still use ' + c.code + '. Delete or move them first.');
    await store.del('courses', c.id);
    send(res, 200, { ok: true });
  });
  const requireCourse = async (code) => {
    if (!(await store.list('courses')).some((c) => c.code === code)) throw new HttpError(400, 'Pick a course from the list. New courses are added under Academics.');
  };

  // Tell the students a course is meant for (department and level) that something new is up.
  async function notifyCourse(code, type, title, body) {
    try {
      const c = (await store.list('courses')).find((x) => x.code === code);
      push.later({ audience: c ? { departmentIds: c.departmentIds || [], level: c.level } : {}, type, title, body, url: type === 'materials' ? '/#/library' : '/#/quizzes' });
    } catch (e) { /* notifications are best effort */ }
  }

  /* ---------- materials ---------- */
  async function readMaterial(b, existing) {
    const title = clean(b.title, 120);
    const course = clean(b.course, 10).toUpperCase();
    const kind = KINDS.includes(b.kind) ? b.kind : 'other';
    const note = clean(b.note, 8000);
    const link = clean(b.link, 500);
    if (!title) throw new HttpError(400, 'Add a title.');
    if (!okCourse(course)) throw new HttpError(400, 'Course code must be 2 to 10 letters or digits, like MBH222.');
    if (link && !isHttp(link)) throw new HttpError(400, 'The link must start with http:// or https://.');
    const doc = { id: existing ? existing.id : newId(), title, course, kind, addedAt: existing ? existing.addedAt : Date.now(), pinned: bool(b.pinned), hidden: bool(b.hidden) };
    if (existing) ['by', 'byName', 'status', 'approvedAt', 'reason'].forEach((k) => { if (existing[k] !== undefined) doc[k] = existing[k]; });
    readPaid(b, doc);
    if (note) doc.note = note;
    if (link) doc.link = link;
    let fileBuf = null; let dropFile = null;
    if (existing && existing.fileId && !bool(b.removeFile)) {
      doc.fileId = existing.fileId; doc.fileType = existing.fileType; doc.fileName = existing.fileName;
    } else if (existing && existing.fileId) dropFile = existing.fileId;
    if (b.file && b.file.data) {
      const type = String(b.file.type || '');
      if (!FILE_TYPES[type]) throw new HttpError(400, 'That file type is not allowed. Use PDF, Word, PowerPoint, Excel, image, CSV or text.');
      fileBuf = Buffer.from(String(b.file.data), 'base64');
      if (!fileBuf.length) throw new HttpError(400, 'The file is empty.');
      if (fileBuf.length > MAX_FILE_BYTES) throw new HttpError(400, 'That file is over 12 MB.');
      if (!looksLike(fileBuf, type)) throw new HttpError(400, 'The file contents do not match its type.');
      if (doc.fileId) dropFile = doc.fileId;
      doc.fileId = newId(); doc.fileType = type; doc.fileName = clean(b.file.name, 100) || 'file';
    }
    if (doc.paid && doc.fileId && !VIEWABLE.has(doc.fileType)) throw new HttpError(400, 'Paid items must use a PDF or an image, so students can view them without downloading. Convert Word or PowerPoint files to PDF first.');
    if (!doc.note && !doc.link && !doc.fileId) throw new HttpError(400, 'Add a note, a file or a link.');
    return { doc, fileBuf, dropFile };
  }
  async function saveMaterial({ doc, fileBuf, dropFile }) {
    if (fileBuf) await store.putFile(doc.fileId, fileBuf);
    await store.put('materials', doc);
    if (dropFile) await store.delFile(dropFile);
  }
  route('GET', '/api/admin/materials', A, async (req, res) => {
    const list = await store.list('materials');
    send(res, 200, list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)));
  });
  route('POST', '/api/admin/materials', A, async (req, res, ctx) => {
    const r = await readMaterial(ctx.body, null);
    await requireCourse(r.doc.course);
    await saveMaterial(r);
    if (!r.doc.hidden && ctx.body.notify !== false) notifyCourse(r.doc.course, 'materials', 'New ' + r.doc.course+ ' resource', r.doc.title);
    send(res, 200, { ok: true, id: r.doc.id });
  });
  route('PUT', '/api/admin/materials/:id', A, async (req, res, ctx) => {
    const m = await store.get('materials', ctx.params[0]);
    if (!m) throw new HttpError(404, 'Resource not found.');
    const r = await readMaterial(ctx.body, m);
    if (r.doc.course !== m.course) await requireCourse(r.doc.course);
    await saveMaterial(r);
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/materials/:id', A, async (req, res, ctx) => {
    const m = await store.get('materials', ctx.params[0]);
    if (m) { if (m.fileId) await store.delFile(m.fileId); await store.del('materials', m.id); }
    send(res, 200, { ok: true });
  });

  /* ---------- quizzes ---------- */
  function readQuiz(b, existing) {
    const title = clean(b.title, 120);
    const course = clean(b.course, 10).toUpperCase();
    if (!title) throw new HttpError(400, 'Add a quiz title.');
    if (!okCourse(course)) throw new HttpError(400, 'Course code must be 2 to 10 letters or digits, like MBH222.');
    if (!Array.isArray(b.questions) || b.questions.length < 1 || b.questions.length > 150) throw new HttpError(400, 'A quiz needs 1 to 150 questions.');
    const questions = b.questions.map((q0, i) => {
      const q = q0 || {};
      const text = clean(q.q, 500);
      const opts = Array.isArray(q.o) ? q.o.map((o) => clean(o, 250)) : [];
      if (!text || opts.length !== 4 || opts.some((o) => !o) || !Number.isInteger(q.a) || q.a < 0 || q.a > 3) {
        throw new HttpError(400, 'Question ' + (i + 1) + ' is not complete: it needs text, four options and an answer.');
      }
      const item = { q: text, o: opts, a: q.a };
      const e = clean(q.e, 800); if (e) item.e = e;
      return item;
    });
    return readPaid(b, { id: existing ? existing.id : newId(), title, course, questions, addedAt: existing ? existing.addedAt : Date.now(), hidden: bool(b.hidden) });
  }
  route('GET', '/api/admin/quizzes', A, async (req, res) => {
    const [quizzes, scores] = await Promise.all([store.list('quizzes'), store.list('scores')]);
    const stats = D.quizStats(scores, quizzes);
    send(res, 200, quizzes.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).map((q) => Object.assign({}, q, { stats: stats[q.id] })));
  });
  route('POST', '/api/admin/quizzes', A, async (req, res, ctx) => {
    const doc = readQuiz(ctx.body, null);
    await requireCourse(doc.course);
    await store.put('quizzes', doc);
    if (!doc.hidden && ctx.body.notify !== false) notifyCourse(doc.course, 'materials', 'New ' + doc.course + ' quiz', doc.title);
    send(res, 200, { ok: true, id: doc.id, count: doc.questions.length });
  });
  route('PUT', '/api/admin/quizzes/:id', A, async (req, res, ctx) => {
    const q = await store.get('quizzes', ctx.params[0]);
    if (!q) throw new HttpError(404, 'Quiz not found.');
    const doc = readQuiz(ctx.body, q);
    if (doc.course !== q.course) await requireCourse(doc.course);
    await store.put('quizzes', doc);
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/quizzes/:id', A, async (req, res, ctx) => {
    await store.del('quizzes', ctx.params[0]);
    send(res, 200, { ok: true });
  });

  /* ---------- events ---------- */
  function readEvent(b, existing) {
    const title = clean(b.title, 120);
    const date = clean(b.date, 10);
    const time = clean(b.time, 5);
    const link = clean(b.link, 500);
    if (!title) throw new HttpError(400, 'Add an event title.');
    if (!isDate(date)) throw new HttpError(400, 'Pick a valid date.');
    if (time && !isTime(time)) throw new HttpError(400, 'Time must look like 14:30.');
    if (link && !isHttp(link)) throw new HttpError(400, 'The link must start with http:// or https://.');
    const doc = { id: existing ? existing.id : newId(), title, date, createdAt: existing ? existing.createdAt : Date.now() };
    if (time) doc.time = time;
    const location = clean(b.location, 120); if (location) doc.location = location;
    const description = clean(b.description, 1000); if (description) doc.description = description;
    if (link) doc.link = link;
    if (H.okId(b.departmentId)) doc.departmentId = b.departmentId;
    if (Number(b.level) && Ac.LEVELS.includes(Number(b.level))) doc.level = Number(b.level);
    if (existing && existing.by) { doc.by = existing.by; doc.byName = existing.byName; }
    return doc;
  }
  route('GET', '/api/admin/events', A, async (req, res) => {
    const list = await store.list('events');
    send(res, 200, list.sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''))));
  });
  route('POST', '/api/admin/events', A, async (req, res, ctx) => {
    const doc = readEvent(ctx.body, null);
    await store.put('events', doc);
    if (ctx.body.notify !== false) push.later({ audience: { departmentIds: doc.departmentId ? [doc.departmentId] : [], level: doc.level || 0 }, type: 'events', title: doc.title, body: doc.date + (doc.time ? ' · ' + doc.time : '') + (doc.location ? ' · ' + doc.location : ''), url: '/#/events' });
    send(res, 200, { ok: true, id: doc.id });
  });
  route('PUT', '/api/admin/events/:id', A, async (req, res, ctx) => {
    const e = await store.get('events', ctx.params[0]);
    if (!e) throw new HttpError(404, 'Event not found.');
    await store.put('events', readEvent(ctx.body, e));
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/events/:id', A, async (req, res, ctx) => {
    await store.del('events', ctx.params[0]);
    send(res, 200, { ok: true });
  });

  /* ---------- announcement banner ---------- */
  route('GET', '/api/admin/notice', A, async (req, res) => {
    const n = await store.get('settings', 'notice');
    send(res, 200, { text: (n && n.text) || '', level: (n && n.level) || 'info' });
  });
  route('PUT', '/api/admin/notice', A, async (req, res, ctx) => {
    const text = clean(ctx.body.text, 240);
    const level = LEVELS.includes(ctx.body.level) ? ctx.body.level : 'info';
    if (!text) { await store.del('settings', 'notice'); return send(res, 200, { ok: true, text: '', level }); }
    await store.put('settings', { id: 'notice', text, level, at: Date.now() });
    if (bool(ctx.body.push)) push.later({ audience: {}, type: 'notices', title: 'Announcement', body: text, url: '/' });
    send(res, 200, { ok: true, text, level });
  });

  /* ---------- site settings ---------- */
  route('GET', '/api/admin/config', A, async (req, res) => send(res, 200, await D.loadConfig(store)));
  route('PUT', '/api/admin/config', A, async (req, res, ctx) => {
    const b = ctx.body;
    const cur = await D.loadConfig(store);
    const next = {
      id: 'config',
      siteName: clean(b.siteName, 60) || cur.siteName,
      tagline: clean(b.tagline, 120),
      motto: clean(b.motto, 60),
      heroTitle: clean(b.heroTitle, 90) || cur.heroTitle,
      heroText: clean(b.heroText, 300),
      footerText: clean(b.footerText, 120),
      registrationOpen: bool(b.registrationOpen),
      requireLogin: bool(b.requireLogin),
      leaderboardEnabled: bool(b.leaderboardEnabled),
      chatEnabled: bool(b.chatEnabled),
      dmEnabled: b.dmEnabled === undefined ? true : bool(b.dmEnabled),
      contribEnabled: bool(b.contribEnabled),
      contribPoints: (() => { if (b.contribPoints === undefined || b.contribPoints === '') return cur.contribPoints; const n = Number(b.contribPoints); if (!Number.isInteger(n) || n < 0 || n > 500) throw new HttpError(400, 'Points for an approved upload must be a whole number from 0 to 500.'); return n; })(),
      payBank: clean(b.payBank, 60), payAccountName: clean(b.payAccountName, 80), payNote: clean(b.payNote, 300),
      payAccountNumber: (() => { const n = String(b.payAccountNumber || '').replace(/\s+/g, ''); if (n && !/^\d{10}$/.test(n)) throw new HttpError(400, 'The account number must be 10 digits.'); return n; })(),
      paystackOn: bool(b.paystackOn),
      passPrice: wholeNaira(b.passPrice, 'semester pass price', true),
      passEnds: (() => { const d = String(b.passEnds || '').trim(); if (d && !isDate(d)) throw new HttpError(400, 'Pick a valid last day for the semester pass.'); return d; })(),
      levelOpen: cur.levelOpen, levelEnds: cur.levelEnds,
      moveOn: bool(b.moveOn), moveCount: bool(b.moveCount),
      moveEnds: (() => { const d = String(b.moveEnds || '').trim(); if (d && !isDate(d)) throw new HttpError(400, 'Pick a valid day for the move-over countdown.'); return d; })(),
      moveTitle: clean(b.moveTitle, 80), moveText: clean(b.moveText, 240),
      support1Name: clean(b.support1Name, 40), support1Wa: waContact(b.support1Wa, 'Admin 1'),
      support2Name: clean(b.support2Name, 40), support2Wa: waContact(b.support2Wa, 'Admin 2'),
      links: {},
    };
    const L = b.links || {};
    Object.keys(D.DEFAULT_CONFIG.links).forEach((k) => {
      const v = clean(L[k], 200);
      if (!v) { next.links[k] = ''; return; }
      if (k === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, 'That email address does not look right.');
      } else if (!isHttp(v)) throw new HttpError(400, 'The ' + k + ' link must start with http:// or https://.');
      next.links[k] = v;
    });
    await store.put('settings', next);
    send(res, 200, D.mergeConfig(next));
  });

  /* ---------- leaderboard ---------- */
  route('GET', '/api/admin/board', A, async (req, res) => {
    const [users, scores, quizzes] = await Promise.all([store.list('users'), store.list('scores'), store.list('quizzes')]);
    const board = D.buildBoard(new Map(users.map((u) => [u.id, u])), scores, new Set(quizzes.map((q) => q.id)));
    send(res, 200, board.map((b, i) => ({ rank: i + 1, id: b.id, name: b.name, isUser: b.isUser, points: b.points, done: b.done })));
  });
  route('DELETE', '/api/admin/board/:id', A, async (req, res, ctx) => {
    await store.del('scores', ctx.params[0]);
    send(res, 200, { ok: true });
  });
  route('POST', '/api/admin/board/reset', A, async (req, res, ctx) => {
    if (ctx.body.confirm !== 'RESET') throw new HttpError(400, 'Type RESET to confirm.');
    const scores = await store.list('scores');
    for (const s of scores) await store.del('scores', s.id);
    send(res, 200, { ok: true, cleared: scores.length });
  });

  /* ---------- CSV downloads ---------- */
  route('GET', '/api/admin/export/:what', A, async (req, res, ctx) => {
    const what = ctx.params[0];
    const [users, scores, quizzes] = await Promise.all([store.list('users'), store.list('scores'), store.list('quizzes')]);
    const ids = new Set(quizzes.map((q) => q.id));
    const byId = new Map(scores.map((s) => [s.id, s]));
    let rows;
    if (what === 'students') {
      const acad = await Ac.loadAcademics(store);
      const fn = (id) => (acad.faculties.find((f) => f.id === id) || {}).name || ''; const dn = (id) => (acad.departments.find((d) => d.id === id) || {}).name || '';
      rows = [['Username', 'Faculty', 'Department', 'Level', 'Joined', 'Last login', 'Status', 'Points', 'Quizzes done', 'Rank']].concat(users.map((u) => {
        const r = userRow(u, byId.get(u.id), ids);
        return [r.username, fn(r.facultyId), dn(r.departmentId), r.level || '', r.createdAt ? new Date(r.createdAt).toISOString() : '', r.lastLoginAt ? new Date(r.lastLoginAt).toISOString() : '', r.disabled ? 'disabled' : 'active', r.points, r.done, r.rank];
      }));
    } else if (what === 'scores') {
      const name = new Map(users.map((u) => [u.id, u.username]));
      rows = [['Student', 'Quiz', 'Course', 'Best correct', 'Out of', 'Percent']];
      scores.forEach((s) => {
        Object.keys(s.best || {}).forEach((qid) => {
          const q = quizzes.find((x) => x.id === qid); if (!q) return;
          const b = s.best[qid];
          rows.push([name.get(s.id) || s.nick || 'Guest', q.title, q.course, b.correct, b.total, b.total ? Math.round((b.correct / b.total) * 100) : 0]);
        });
      });
    } else throw new HttpError(404, 'Unknown export.');
    send(res, 200, '﻿' + csv(rows), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="altidian-${what}.csv"`,
      'Cache-Control': 'no-store',
    });
  });
};
