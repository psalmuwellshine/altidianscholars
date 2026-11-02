'use strict';
/* Push notifications, class reps, student uploads, timetable and class notes. */
const H = require('../lib/helpers');
const D = require('../lib/domain');
const Ac = require('../lib/academics');
const Cl = require('../lib/classes');
const { FILE_TYPES, looksLike } = require('../lib/files');

const { HttpError, clean, okCourse, isHttp, newId, isDate, isTime, bool } = H;
const KINDS = ['notes', 'pq', 'slides', 'other'];
const UPLOAD_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
const MAX_UPLOAD = 8 * 1024 * 1024;
const TT_KINDS = ['class', 'exam', 'test', 'other'];
const DAY = 86400000;

module.exports = function registerCommunity({ route, store, send, userOf, push }) {
  const A = { admin: true };
  const need = async (req) => { const u = await userOf(req); if (!u) throw new HttpError(401, 'Please log in first.'); return u; };
  const needRep = async (req) => { const u = await need(req); const scope = Cl.repScope(u); if (!scope) throw new HttpError(403, 'You are not a class rep.'); return { user: u, scope }; };
  const deptName = (acad, id) => (acad.departments.find((d) => d.id === id) || {}).name || '';
  const scopeLabel = (acad, s) => (s ? (deptName(acad, s.departmentId) || 'Department') + (s.level ? ' · ' + s.level + ' level' : ' · all levels') : '');
  const audienceOfScope = (s) => (s ? { departmentIds: s.departmentId ? [s.departmentId] : [], level: s.level || 0 } : {});

  /* ================= push notifications ================= */
  route('GET', '/api/push/key', {}, async (req, res) => send(res, 200, { key: (await push.vapid()).publicKey }));
  const readSub = (b) => {
    const s = b && b.subscription; const k = s && s.keys;
    const ok = (v, max) => typeof v === 'string' && v.length > 8 && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v);
    if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 700 || !(/^https:\/\//.test(s.endpoint) || (push.dry && /^http:\/\/(localhost|127\.0\.0\.1)/.test(s.endpoint))) || !k || !ok(k.p256dh, 140) || !ok(k.auth, 40)) {
      throw new HttpError(400, 'This device could not be registered for notifications.');
    }
    return { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
  };
  route('POST', '/api/push/subscribe', { limit: ['pushsub', 30, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req);
    const doc = await push.subscribe(u.id, readSub(ctx.body), ctx.body.prefs);
    send(res, 200, { ok: true, prefs: doc.prefs });
  });
  route('POST', '/api/push/check', {}, async (req, res, ctx) => {
    const u = await need(req);
    const e = H.str(ctx.body.endpoint, 700); const s = e ? await push.find(e) : null;
    send(res, 200, { on: !!(s && s.uid === u.id), prefs: s && s.uid === u.id ? s.prefs : null });
  });
  route('POST', '/api/push/prefs', {}, async (req, res, ctx) => {
    const u = await need(req);
    const e = H.str(ctx.body.endpoint, 700); const s = e ? await push.find(e) : null;
    if (!s || s.uid !== u.id) throw new HttpError(404, 'This device is not subscribed.');
    const next = await push.setPrefs(e, ctx.body.prefs);
    send(res, 200, { ok: true, prefs: next.prefs });
  });
  route('POST', '/api/push/unsubscribe', {}, async (req, res, ctx) => {
    const u = await need(req);
    const e = H.str(ctx.body.endpoint, 700); const s = e ? await push.find(e) : null;
    if (s && s.uid === u.id) await push.remove(e);
    send(res, 200, { ok: true });
  });
  route('GET', '/api/admin/push/stats', A, async (req, res) => send(res, 200, Object.assign(await push.stats(), { dry: push.dry })));
  route('POST', '/api/admin/push/send', { admin: true, limit: ['pushsend', 30, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const b = ctx.body; const title = clean(b.title, 80); const body = clean(b.body, 160);
    if (!title) throw new HttpError(400, 'Add a title for the notification.');
    const aud = {};
    if (b.departmentId) { const acad = await Ac.loadAcademics(store); if (!acad.departments.some((d) => d.id === b.departmentId)) throw new HttpError(400, 'Choose a department from the list.'); aud.departmentIds = [b.departmentId]; }
    if (b.level) { const l = Number(b.level); if (!Ac.LEVELS.includes(l)) throw new HttpError(400, 'Choose a level from the list.'); aud.level = l; }
    const r = await push.notify({ audience: aud, type: 'notices', title, body, url: '/' });
    send(res, 200, { ok: true, devices: r.devices, sent: r.sent });
  });
  if (push.dry) route('GET', '/api/admin/push/outbox', A, async (req, res) => send(res, 200, push.outbox));

  /* ================= student uploads ================= */
  async function readUpload(b, acad) {
    const title = clean(b.title, 120); const course = clean(b.course, 10).toUpperCase();
    const kind = KINDS.includes(b.kind) ? b.kind : 'notes'; const note = clean(b.note, 8000); const link = clean(b.link, 500);
    if (!title) throw new HttpError(400, 'Add a title.');
    if (!okCourse(course) || !acad.courses.some((c) => c.code === course)) throw new HttpError(400, 'Pick a course from the list.');
    if (link && !isHttp(link)) throw new HttpError(400, 'The link must start with http:// or https://.');
    const doc = { id: newId(), title, course, kind, addedAt: Date.now(), pinned: false };
    if (note) doc.note = note; if (link) doc.link = link;
    let fileBuf = null;
    if (b.file && b.file.data) {
      const type = String(b.file.type || '');
      if (!UPLOAD_TYPES.includes(type) || !FILE_TYPES[type]) throw new HttpError(400, 'Share a PDF, Word or PowerPoint file, or a picture (PNG, JPG or WebP).');
      fileBuf = Buffer.from(String(b.file.data), 'base64');
      if (!fileBuf.length) throw new HttpError(400, 'The file is empty.');
      if (fileBuf.length > MAX_UPLOAD) throw new HttpError(400, 'That file is over 8 MB. Compress it or split it.');
      if (!looksLike(fileBuf, type)) throw new HttpError(400, 'The file contents do not match its type.');
      doc.fileId = newId(); doc.fileType = type; doc.fileName = clean(b.file.name, 100) || 'file';
    }
    if (!doc.note && !doc.link && !doc.fileId) throw new HttpError(400, 'Add a note, a file or a link.');
    return { doc, fileBuf };
  }
  async function award(uid, points) {
    if (!points) return;
    const rec = (await store.get('scores', uid)) || { id: uid, nick: '', best: {} };
    rec.bonus = (Number(rec.bonus) || 0) + points; rec.updatedAt = Date.now();
    await store.put('scores', rec);
  }
  const uploadRow = (m, acad) => ({ id: m.id, title: m.title, course: m.course, kind: m.kind, status: m.status || 'approved', reason: m.reason || '', addedAt: m.addedAt, by: m.byName || '', fileName: m.fileName || '', fileId: m.fileId || '', hasNote: !!m.note, link: m.link || '', note: (m.note || '').slice(0, 400) });

  route('POST', '/api/contribute', { limit: ['contribute', 60, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req);
    const cfg = await D.loadConfig(store);
    if (!cfg.contribEnabled) throw new HttpError(403, 'Sharing is switched off right now.');
    const all = await store.list('materials');
    if (all.filter((m) => m.by === u.id && m.status === 'pending').length >= 5) throw new HttpError(400, 'You already have 5 uploads waiting for review. Please wait for those first.');
    const acad = await Ac.loadAcademics(store);
    const { doc, fileBuf } = await readUpload(ctx.body, acad);
    Object.assign(doc, { hidden: true, status: 'pending', by: u.id, byName: u.username });
    if (fileBuf) await store.putFile(doc.fileId, fileBuf);
    await store.put('materials', doc);
    send(res, 200, { ok: true, id: doc.id });
  });
  route('GET', '/api/contribute/mine', {}, async (req, res) => {
    const u = await need(req); const acad = await Ac.loadAcademics(store);
    const mine = (await store.list('materials')).filter((m) => m.by === u.id).sort((a, b) => b.addedAt - a.addedAt).slice(0, 60);
    send(res, 200, { items: mine.map((m) => uploadRow(m, acad)), points: (await D.loadConfig(store)).contribPoints });
  });
  route('DELETE', '/api/contribute/:id', {}, async (req, res, ctx) => {
    const u = await need(req); const m = await store.get('materials', ctx.params[0]);
    if (!m || m.by !== u.id) throw new HttpError(404, 'Upload not found.');
    if (m.status === 'approved') throw new HttpError(400, 'This one is already published. Ask an admin to remove it.');
    if (m.fileId) await store.delFile(m.fileId);
    await store.del('materials', m.id);
    send(res, 200, { ok: true });
  });

  // Approve or reject an upload. `by` is { admin:true } or { scope } for a class rep.
  async function review(id, action, reason, by) {
    const m = await store.get('materials', id);
    if (!m || m.status !== 'pending') throw new HttpError(404, 'That upload is not waiting for review.');
    const course = (await store.list('courses')).find((c) => c.code === m.course);
    if (!by.admin && !Cl.courseInScope(course, by.scope)) throw new HttpError(403, 'That upload is not for your class.');
    const cfg = await D.loadConfig(store);
    if (action === 'approve') {
      m.status = 'approved'; m.hidden = false; m.approvedAt = Date.now(); m.addedAt = Date.now(); delete m.reason;
      await store.put('materials', m);
      await award(m.by, cfg.contribPoints);
      push.later({ audience: { uid: m.by }, type: 'direct', title: 'Your upload is live 🎉', body: m.title + (cfg.contribPoints ? ' · +' + cfg.contribPoints + ' points' : ''), url: '/#/share' });
      push.later({ audience: { departmentIds: course ? course.departmentIds || [] : [], level: course ? course.level : 0 }, type: 'materials', title: 'New ' + m.course + ' resource', body: m.title + (m.byName ? ' · shared by ' + m.byName : ''), url: '/#/library' });
    } else {
      m.status = 'rejected'; m.reason = clean(reason, 200) || 'Not suitable for the library.';
      if (m.fileId) { await store.delFile(m.fileId); delete m.fileId; delete m.fileType; delete m.fileName; }
      if (!m.note && !m.link) m.note = '(file removed)';
      await store.put('materials', m);
      push.later({ audience: { uid: m.by }, type: 'direct', title: 'Upload not accepted', body: m.title + ' · ' + m.reason, url: '/#/share' });
    }
    return m;
  }
  const pendingFor = async (scope) => {
    const [mats, courses] = await Promise.all([store.list('materials'), store.list('courses')]);
    const byCode = new Map(courses.map((c) => [c.code, c]));
    return mats.filter((m) => m.status === 'pending' && (!scope || Cl.courseInScope(byCode.get(m.course), scope))).sort((a, b) => a.addedAt - b.addedAt);
  };
  const readReview = (b) => { if (!['approve', 'reject'].includes(b.action)) throw new HttpError(400, 'Choose approve or reject.'); return b.action; };
  route('GET', '/api/admin/uploads', A, async (req, res) => {
    const acad = await Ac.loadAcademics(store);
    const recent = (await store.list('materials')).filter((m) => m.by && m.status && m.status !== 'pending').sort((a, b) => (b.approvedAt || b.addedAt) - (a.approvedAt || a.addedAt)).slice(0, 30);
    send(res, 200, { pending: (await pendingFor(null)).map((m) => uploadRow(m, acad)), recent: recent.map((m) => uploadRow(m, acad)) });
  });
  route('POST', '/api/admin/uploads/:id/review', A, async (req, res, ctx) => { await review(ctx.params[0], readReview(ctx.body), ctx.body.reason, { admin: true }); send(res, 200, { ok: true }); });

  /* ================= class reps ================= */
  route('POST', '/api/admin/users/:id/rep', A, async (req, res, ctx) => {
    const u = await store.get('users', ctx.params[0]);
    if (!u) throw new HttpError(404, 'Student not found.');
    if (bool(ctx.body.remove)) { delete u.rep; await store.put('users', u); return send(res, 200, { ok: true }); }
    const acad = await Ac.loadAcademics(store);
    const dep = acad.departments.find((d) => d.id === ctx.body.departmentId);
    if (!dep) throw new HttpError(400, 'Choose the department this rep looks after.');
    const level = Number(ctx.body.level) || 0;
    if (level && (!Ac.LEVELS.includes(level) || level > (dep.maxLevel || 600))) throw new HttpError(400, 'Choose a level from the list, or all levels.');
    u.rep = { departmentId: dep.id, level }; await store.put('users', u);
    push.later({ audience: { uid: u.id }, type: 'direct', title: 'You are now a class rep', body: 'You can approve notes and post for ' + scopeLabel(acad, u.rep) + '.', url: '/#/rep' });
    send(res, 200, { ok: true });
  });
  route('GET', '/api/rep/panel', {}, async (req, res) => {
    const { user, scope } = await needRep(req); const acad = await Ac.loadAcademics(store);
    const [tt, notes, events] = await Promise.all([store.list('timetable'), store.list('classnotes'), store.list('events')]);
    const mineScope = (x) => !x.uid && x.departmentId === scope.departmentId && (x.level || 0) === scope.level;
    send(res, 200, {
      scope: Object.assign({ label: scopeLabel(acad, scope) }, scope),
      pending: (await pendingFor(scope)).map((m) => uploadRow(m, acad)),
      timetable: tt.filter(mineScope).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.day || 0) - (b.day || 0)),
      notes: notes.filter(mineScope).sort((a, b) => b.at - a.at).slice(0, 20),
      events: events.filter((e) => e.by === user.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30),
      students: (await store.list('users')).filter((s) => !s.disabled && Cl.classMatch(scope, s) && s.departmentId === scope.departmentId).length,
    });
  });
  route('POST', '/api/rep/uploads/:id/review', { limit: ['repreview', 200, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const { scope } = await needRep(req); await review(ctx.params[0], readReview(ctx.body), ctx.body.reason, { scope }); send(res, 200, { ok: true });
  });
  // A rep can publish straight to the library for their class, without waiting for review.
  route('POST', '/api/rep/materials', { limit: ['repmat', 40, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, scope } = await needRep(req); const acad = await Ac.loadAcademics(store);
    const { doc, fileBuf } = await readUpload(ctx.body, acad);
    if (!Cl.courseInScope(acad.courses.find((c) => c.code === doc.course), scope)) throw new HttpError(403, 'Pick a course that belongs to your class.');
    Object.assign(doc, { status: 'approved', by: user.id, byName: user.username, approvedAt: Date.now() });
    if (fileBuf) await store.putFile(doc.fileId, fileBuf);
    await store.put('materials', doc);
    push.later({ audience: audienceOfScope(scope), type: 'materials', title: 'New ' + doc.course + ' resource', body: doc.title, url: '/#/library' });
    send(res, 200, { ok: true, id: doc.id });
  });

  /* ================= events with a class ================= */
  function readEvent(b) {
    const title = clean(b.title, 120); const date = clean(b.date, 10); const time = clean(b.time, 5); const location = clean(b.location, 120); const description = clean(b.description, 1000);
    if (!title) throw new HttpError(400, 'Add an event title.');
    if (!isDate(date)) throw new HttpError(400, 'Pick a valid date.');
    if (time && !isTime(time)) throw new HttpError(400, 'Time must look like 14:30.');
    const doc = { id: newId(), title, date, createdAt: Date.now() };
    if (time) doc.time = time; if (location) doc.location = location; if (description) doc.description = description;
    return doc;
  }
  route('POST', '/api/rep/events', { limit: ['repevent', 40, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, scope } = await needRep(req); const doc = readEvent(ctx.body);
    Object.assign(doc, { departmentId: scope.departmentId, level: scope.level, by: user.id, byName: user.username });
    await store.put('events', doc);
    push.later({ audience: audienceOfScope(scope), type: 'events', title: doc.title, body: doc.date + (doc.time ? ' · ' + doc.time : '') + (doc.location ? ' · ' + doc.location : ''), url: '/#/events' });
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/rep/events/:id', {}, async (req, res, ctx) => {
    const { user } = await needRep(req); const e = await store.get('events', ctx.params[0]);
    if (e && e.by === user.id) await store.del('events', e.id);
    send(res, 200, { ok: true });
  });

  /* ================= timetable and exams ================= */
  function readEntry(b, mine) {
    const kind = TT_KINDS.includes(b.kind) ? b.kind : 'class'; const title = clean(b.title, 80);
    const course = clean(b.course, 10).toUpperCase(); const start = clean(b.start, 5); const end = clean(b.end, 5); const venue = clean(b.venue, 80);
    if (!title) throw new HttpError(400, 'Add a title, for example "MBH222 lecture".');
    if (course && !okCourse(course)) throw new HttpError(400, 'Course code must be 2 to 10 letters or digits.');
    if (start && !isTime(start)) throw new HttpError(400, 'Start time must look like 08:00.');
    if (end && !isTime(end)) throw new HttpError(400, 'End time must look like 10:00.');
    if (start && end && end <= start) throw new HttpError(400, 'The end time must be after the start time.');
    const doc = { id: newId(), kind, title, createdAt: Date.now() };
    if (course) doc.course = course; if (start) doc.start = start; if (end) doc.end = end; if (venue) doc.venue = venue;
    if (kind === 'class') {
      const day = Number(b.day); if (!Number.isInteger(day) || day < 1 || day > 7) throw new HttpError(400, 'Choose the day of the week.');
      doc.day = day; if (!start) throw new HttpError(400, 'Add the start time.');
    } else {
      const date = clean(b.date, 10); if (!isDate(date)) throw new HttpError(400, 'Pick the date.'); doc.date = date;
    }
    return doc;
  }
  const entryNote = (d) => (d.kind === 'class' ? '' : d.date) + (d.start ? ' · ' + d.start : '') + (d.venue ? ' · ' + d.venue : '');
  const announceEntry = (d, aud) => { if (d.kind !== 'class') push.later({ audience: aud, type: 'events', title: (d.kind === 'exam' ? 'Exam: ' : d.kind === 'test' ? 'Test: ' : '') + d.title, body: entryNote(d), url: '/#/timetable' }); };

  route('POST', '/api/rep/timetable', { limit: ['reptt', 80, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, scope } = await needRep(req); const doc = readEntry(ctx.body);
    Object.assign(doc, { departmentId: scope.departmentId, level: scope.level, by: user.id, byName: user.username });
    await store.put('timetable', doc); announceEntry(doc, audienceOfScope(scope)); send(res, 200, { ok: true });
  });
  route('DELETE', '/api/rep/timetable/:id', {}, async (req, res, ctx) => {
    const { scope } = await needRep(req); const t = await store.get('timetable', ctx.params[0]);
    if (t && !t.uid && t.departmentId === scope.departmentId && (t.level || 0) === scope.level) await store.del('timetable', t.id);
    send(res, 200, { ok: true });
  });
  route('GET', '/api/admin/timetable', A, async (req, res) => {
    const list = (await store.list('timetable')).filter((t) => !t.uid).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.day || 0) - (b.day || 0));
    send(res, 200, list);
  });
  route('POST', '/api/admin/timetable', A, async (req, res, ctx) => {
    const doc = readEntry(ctx.body); const acad = await Ac.loadAcademics(store);
    if (ctx.body.departmentId) { if (!acad.departments.some((d) => d.id === ctx.body.departmentId)) throw new HttpError(400, 'Choose a department from the list.'); doc.departmentId = ctx.body.departmentId; }
    if (ctx.body.level) { const l = Number(ctx.body.level); if (!Ac.LEVELS.includes(l)) throw new HttpError(400, 'Choose a level from the list.'); doc.level = l; }
    doc.byName = 'Admin';
    await store.put('timetable', doc); announceEntry(doc, audienceOfScope(doc.departmentId ? { departmentId: doc.departmentId, level: doc.level || 0 } : { level: doc.level || 0 })); send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/timetable/:id', A, async (req, res, ctx) => { await store.del('timetable', ctx.params[0]); send(res, 200, { ok: true }); });
  // Students keep their own private entries too (revision slots, a test the lecturer announced in class).
  route('POST', '/api/timetable/mine', { limit: ['mytt', 60, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req);
    if ((await store.list('timetable')).filter((t) => t.uid === u.id).length >= 40) throw new HttpError(400, 'You can keep up to 40 personal entries. Delete some old ones first.');
    const doc = readEntry(ctx.body); doc.uid = u.id; await store.put('timetable', doc); send(res, 200, { ok: true });
  });
  route('DELETE', '/api/timetable/mine/:id', {}, async (req, res, ctx) => {
    const u = await need(req); const t = await store.get('timetable', ctx.params[0]);
    if (t && t.uid === u.id) await store.del('timetable', t.id);
    send(res, 200, { ok: true });
  });

  /* ================= class notes (short messages from a rep) ================= */
  route('POST', '/api/rep/notes', { limit: ['repnote', 30, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, scope } = await needRep(req);
    const summary = ctx.body.kind === 'summary'; const text = clean(ctx.body.text, summary ? 600 : 300);
    if (!text) throw new HttpError(400, summary ? 'Write what was taught first.' : 'Write the message first.');
    let course = '';
    if (summary) {
      course = String(ctx.body.course || '').trim().toUpperCase();
      const acad = await Ac.loadAcademics(store); const c = acad.courses.find((x) => x.code === course);
      if (!c || !Cl.courseInScope(c, scope)) throw new HttpError(400, 'Choose one of your class courses.');
    }
    await store.put('classnotes', { id: newId(), departmentId: scope.departmentId, level: scope.level, text, kind: summary ? 'summary' : 'update', course, byName: user.username, byUid: user.id, at: Date.now() });
    push.later({ audience: audienceOfScope(scope), type: 'notices', title: summary ? 'Today in ' + course : 'Class update from ' + user.username, body: text, url: '/' });
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/rep/notes/:id', {}, async (req, res, ctx) => {
    const { scope } = await needRep(req); const n = await store.get('classnotes', ctx.params[0]);
    if (n && n.departmentId === scope.departmentId && (n.level || 0) === scope.level) await store.del('classnotes', n.id);
    send(res, 200, { ok: true });
  });


  /* ================= reports: students flag a problem ================= */
  const REASONS = ['wrong-answer', 'typo', 'unclear', 'broken-file', 'other'];
  route('POST', '/api/report', { limit: ['report', 40, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req); const b = ctx.body;
    const type = ['question', 'material', 'site'].includes(b.type) ? b.type : '';
    const reason = REASONS.includes(b.reason) ? b.reason : 'other';
    const message = clean(b.message, 500);
    if (!type) throw new HttpError(400, 'Choose what you are reporting.');
    if (message.length < 5) throw new HttpError(400, 'Tell us a little more, at least a few words.');
    const doc = { id: newId(), uid: u.id, username: u.username, type, reason, message, status: 'open', at: Date.now() };
    if (type === 'question') {
      const quiz = await store.get('quizzes', H.str(b.refId, 40)); const i = Number(b.qIndex);
      if (!quiz || !Number.isInteger(i) || i < 0 || i >= quiz.questions.length) throw new HttpError(404, 'That question was not found.');
      Object.assign(doc, { refId: quiz.id, refTitle: quiz.title, course: quiz.course, qIndex: i, qText: quiz.questions[i].q.slice(0, 200) });
    } else if (type === 'material') {
      const m = await store.get('materials', H.str(b.refId, 40));
      if (!m || m.hidden) throw new HttpError(404, 'That resource was not found.');
      Object.assign(doc, { refId: m.id, refTitle: m.title, course: m.course });
    }
    const all = await store.list('reports');
    if (all.some((r) => r.uid === u.id && r.status === 'open' && r.type === type && r.refId === doc.refId && r.qIndex === doc.qIndex && type !== 'site')) throw new HttpError(400, 'You already reported this. Thank you, we will look at it.');
    if (all.filter((r) => r.uid === u.id && r.status === 'open').length >= 15) throw new HttpError(400, 'You have 15 open reports already. Please wait for those to be handled.');
    await store.put('reports', doc);
    send(res, 200, { ok: true });
  });
  route('GET', '/api/admin/reports', A, async (req, res) => {
    const all = (await store.list('reports')).sort((a, b) => b.at - a.at);
    send(res, 200, { open: all.filter((r) => r.status === 'open').reverse(), done: all.filter((r) => r.status !== 'open').slice(0, 30) });
  });
  route('POST', '/api/admin/reports/:id/resolve', A, async (req, res, ctx) => {
    const r = await store.get('reports', ctx.params[0]);
    if (!r) throw new HttpError(404, 'Report not found.');
    r.status = 'resolved'; r.note = clean(ctx.body.note, 200); r.resolvedAt = Date.now(); await store.put('reports', r);
    push.later({ audience: { uid: r.uid }, type: 'direct', title: 'Thanks for your report', body: (r.refTitle || 'Your report') + (r.note ? ' · ' + r.note : ' · We looked into it.'), url: '/' });
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/reports/:id', A, async (req, res, ctx) => { await store.del('reports', ctx.params[0]); send(res, 200, { ok: true }); });

  /* ================= exam reminders ================= */
  const lagosToday = () => D.lagosDate(Date.now());
  const daysTo = (date) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(lagosToday() + 'T00:00:00Z')) / DAY);
  async function runReminders() {
    const hour = new Date(Date.now() + 3600000).getUTCHours();
    for (const t of await store.list('timetable')) {
      if (!t.date || (t.kind !== 'exam' && t.kind !== 'test')) continue;
      const d = daysTo(t.date); let flag = null; let when = '';
      if (d === 7 && !t.r7) { flag = 'r7'; when = 'in 1 week'; } else if (d === 1 && !t.r1) { flag = 'r1'; when = 'tomorrow'; } else if (d === 0 && !t.r0 && hour >= 6) { flag = 'r0'; when = 'today'; }
      if (!flag) continue;
      t[flag] = true; await store.put('timetable', t);
      const aud = t.uid ? { uid: t.uid } : audienceOfScope(t.departmentId ? { departmentId: t.departmentId, level: t.level || 0 } : { level: t.level || 0 });
      await push.notify({ audience: aud, type: 'events', title: (t.course || t.title) + ' ' + t.kind + ' ' + when, body: entryNote(t), url: '/#/timetable' });
    }
  }
  if (!process.env.NO_REMINDERS) {
    setTimeout(() => runReminders().catch((e) => console.error('reminders:', e.message)), 30000).unref();
    setInterval(() => runReminders().catch((e) => console.error('reminders:', e.message)), 30 * 60 * 1000).unref();
  }
  route('POST', '/api/admin/push/run-reminders', A, async (req, res) => { await runReminders(); send(res, 200, { ok: true }); });
};
