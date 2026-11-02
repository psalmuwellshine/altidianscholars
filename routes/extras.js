'use strict';
/* Sign-up progress, scheduled posts, bookmarks, question of the day, study groups, analytics and receipts. */
const crypto = require('crypto');
const H = require('../lib/helpers');
const D = require('../lib/domain');
const Ac = require('../lib/academics');

const { HttpError, clean, newId, isDate, isTime, bool } = H;
const DAY = 86400000;
const LEVELS = ['info', 'success', 'warning'];
const QOTD_POINTS = 5;

module.exports = function registerExtras({ route, store, send, userOf, push, stats }) {
  const A = { admin: true };
  const need = async (req) => { const u = await userOf(req); if (!u) throw new HttpError(401, 'Please log in first.'); return u; };
  const qHash = stats.qHash;

  route('GET', '/api/ping', {}, async (req, res) => send(res, 200, { ok: true }));

  /* ================= sign-up progress (admin) ================= */
  route('GET', '/api/admin/signups', A, async (req, res) => {
    const [users, acad] = await Promise.all([store.list('users'), Ac.loadAcademics(store)]);
    const live = users.filter((u) => !u.disabled);
    const now = Date.now(); const week = now - 7 * DAY;
    const levels = [...new Set(live.map((u) => u.level).filter(Boolean))].sort((a, b) => a - b);
    const byDept = acad.departments.map((d) => {
      const mine = live.filter((u) => u.departmentId === d.id);
      const per = {}; levels.forEach((l) => { per[l] = mine.filter((u) => u.level === l).length; });
      return { id: d.id, name: d.name, total: mine.length, week: mine.filter((u) => (u.createdAt || 0) > week).length, levels: per };
    }).sort((a, b) => b.total - a.total);
    const series = [];
    for (let i = 13; i >= 0; i--) { const day = D.lagosDate(now - i * DAY); series.push({ date: day, n: live.filter((u) => u.createdAt && D.lagosDate(u.createdAt) === day).length }); }
    const dn = (id) => (acad.departments.find((d) => d.id === id) || {}).name || '';
    const recent = live.filter((u) => u.createdAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map((u) => ({ username: u.username, dept: dn(u.departmentId), level: u.level || 0, at: u.createdAt }));
    send(res, 200, { total: live.length, today: series[series.length - 1].n, week: live.filter((u) => (u.createdAt || 0) > week).length, unplaced: live.filter((u) => !u.departmentId || !u.level).length, levels, byDept, series, recent });
  });

  /* ================= scheduled posts (admin) ================= */
  const readWhen = (v) => { const at = Number(v); if (!Number.isFinite(at) || at < Date.now() - 60000 || at > Date.now() + 366 * DAY) throw new HttpError(400, 'Pick a time in the future (within a year).'); return Math.round(at); };
  route('GET', '/api/admin/schedule', A, async (req, res) => {
    const all = (await store.list('scheduled')).sort((a, b) => a.at - b.at);
    send(res, 200, { pending: all.filter((s) => s.status === 'pending'), done: all.filter((s) => s.status !== 'pending').slice(-8).reverse() });
  });
  route('POST', '/api/admin/schedule', A, async (req, res, ctx) => {
    const b = ctx.body; const kind = b.kind === 'push' ? 'push' : 'notice';
    if ((await store.list('scheduled')).filter((s) => s.status === 'pending').length >= 30) throw new HttpError(400, 'You have 30 scheduled posts waiting. Remove some first.');
    const doc = { id: newId(), kind, at: readWhen(b.at), status: 'pending', createdAt: Date.now() };
    if (kind === 'notice') {
      doc.text = clean(b.text, 240); doc.level = LEVELS.includes(b.level) ? b.level : 'info'; doc.push = bool(b.push);
      if (!doc.text) throw new HttpError(400, 'Write the announcement first.');
    } else {
      doc.title = clean(b.title, 80); doc.body = clean(b.body, 160);
      if (!doc.title) throw new HttpError(400, 'Give the notification a title.');
      const dep = H.str(b.departmentId, 60); const lvl = Number(b.level) || 0;
      if (dep) doc.departmentId = dep; if (lvl) doc.studentLevel = lvl;
    }
    await store.put('scheduled', doc);
    send(res, 200, { ok: true, id: doc.id });
  });
  route('DELETE', '/api/admin/schedule/:id', A, async (req, res, ctx) => { await store.del('scheduled', ctx.params[0]); send(res, 200, { ok: true }); });

  async function runScheduled() {
    const now = Date.now(); const all = await store.list('scheduled');
    for (const s of all) {
      if (s.status === 'pending' && s.at <= now) {
        s.status = 'sent'; s.sentAt = now; await store.put('scheduled', s);
        try {
          if (s.kind === 'notice') {
            await store.put('settings', { id: 'notice', text: s.text, level: s.level, at: now });
            if (s.push) push.later({ audience: {}, type: 'notices', title: 'Announcement', body: s.text, url: '/' });
          } else {
            push.later({ audience: { departmentIds: s.departmentId ? [s.departmentId] : [], level: s.studentLevel || 0 }, type: 'direct', title: s.title, body: s.body, url: '/' });
          }
        } catch (e) { s.status = 'failed'; s.error = String(e.message).slice(0, 100); await store.put('scheduled', s); }
      } else if (s.status !== 'pending' && (s.sentAt || s.at) < now - 14 * DAY) await store.del('scheduled', s.id);
    }
  }
  // Once a day, a nudge to answer the question of the day.
  async function runDaily() {
    const today = D.lagosDate(); const hour = new Date(Date.now() + 3600000).getUTCHours();
    if (hour < 7) return;
    const flag = await store.get('settings', 'qotd-push');
    if (flag && flag.date === today) return;
    await store.put('settings', { id: 'qotd-push', date: today });
    push.later({ audience: {}, type: 'daily', title: 'Question of the day', body: 'One question, one minute. Keep your streak going.', url: '/' });
  }
  const tick = () => runScheduled().then(runDaily).catch((e) => console.error('schedule:', e.message));
  if (!process.env.NO_REMINDERS) { setTimeout(tick, 10000).unref(); setInterval(tick, 60 * 1000).unref(); }
  route('POST', '/api/admin/schedule/run', A, async (req, res) => { await runScheduled(); await runDaily(); send(res, 200, { ok: true }); });

  /* ================= bookmarks and notes ================= */
  const markKey = (m) => m.t + ':' + m.id + ':' + (m.i === undefined ? '' : m.i);
  route('GET', '/api/marks', {}, async (req, res) => {
    const u = await need(req); const d = await store.get('marks', u.id);
    send(res, 200, { items: ((d && d.items) || []).slice().sort((a, b) => b.at - a.at) });
  });
  route('POST', '/api/marks', { limit: ['marks', 300, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req); const b = ctx.body; const t = b.t === 'q' ? 'q' : b.t === 'm' ? 'm' : '';
    if (!t) throw new HttpError(400, 'Nothing to save.');
    const id = H.str(b.id, 40); const m = { t, id, note: clean(b.note, 300), at: Date.now() };
    if (t === 'q') {
      const quiz = await store.get('quizzes', id); const i = Number(b.i);
      if (!quiz || quiz.hidden || !Number.isInteger(i) || i < 0 || i >= quiz.questions.length) throw new HttpError(404, 'That question was not found.');
      if (!D.hasAccess(u, quiz)) throw new HttpError(403, 'This quiz is locked.');
      m.i = i;
    } else {
      const mat = await store.get('materials', id);
      if (!mat || mat.hidden) throw new HttpError(404, 'That resource was not found.');
      if (!D.hasAccess(u, mat)) throw new HttpError(403, 'This resource is locked.');
    }
    const d = (await store.get('marks', u.id)) || { id: u.id, items: [] };
    const k = markKey(m); const at = d.items.findIndex((x) => markKey(x) === k);
    if (at >= 0) { m.at = d.items[at].at; if (b.note === undefined) m.note = d.items[at].note; d.items[at] = m; }
    else { if (d.items.length >= 300) throw new HttpError(400, 'You have 300 bookmarks already. Remove some first.'); d.items.push(m); }
    await store.put('marks', d);
    send(res, 200, { ok: true });
  });
  route('POST', '/api/marks/remove', {}, async (req, res, ctx) => {
    const u = await need(req); const b = ctx.body; const d = await store.get('marks', u.id);
    if (d) { const k = markKey({ t: b.t, id: H.str(b.id, 40), i: b.i === undefined || b.i === null || b.i === '' ? undefined : Number(b.i) }); d.items = d.items.filter((x) => markKey(x) !== k); await store.put('marks', d); }
    send(res, 200, { ok: true });
  });

  /* ================= question of the day ================= */
  async function todaysQuestion(user) {
    const [quizzes, acad] = await Promise.all([store.list('quizzes'), Ac.loadAcademics(store)]);
    const codes = new Set(acad.courses.filter((c) => Ac.courseApplies(c, user)).map((c) => c.code));
    let pool = quizzes.filter((q) => !q.hidden && q.questions.length && D.hasAccess(user, q));
    const mine = pool.filter((q) => codes.has(q.course)); if (mine.length) pool = mine;
    pool.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const flat = []; pool.forEach((q) => q.questions.forEach((_, i) => flat.push([q, i])));
    if (!flat.length) return null;
    const date = D.lagosDate();
    const n = parseInt(H.sha(date + ':' + (user.departmentId || '') + ':' + (user.level || 0)).slice(0, 8), 16) % flat.length;
    return { date, quiz: flat[n][0], i: flat[n][1] };
  }
  const liveStreak = (q, date) => (q && (q.date === date || q.date === D.lagosDate(Date.now() - DAY)) ? q.streak || 0 : 0);
  route('GET', '/api/qotd', {}, async (req, res) => {
    const u = await need(req); const t = await todaysQuestion(u);
    const rec = await store.get('scores', u.id); const q = rec && rec.qotd;
    if (!t) return send(res, 200, { none: true, streak: liveStreak(q, D.lagosDate()), best: (q && q.best) || 0 });
    const x = t.quiz.questions[t.i];
    const out = { date: t.date, quizId: t.quiz.id, title: t.quiz.title, course: t.quiz.course, i: t.i, q: x.q, o: x.o, streak: liveStreak(q, t.date), best: (q && q.best) || 0, points: QOTD_POINTS };
    if (q && q.date === t.date) Object.assign(out, { answered: true, picked: q.picked, correct: q.correct, a: x.a, e: x.e || '' });
    send(res, 200, out);
  });
  route('POST', '/api/qotd', { limit: ['qotd', 60, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req); const t = await todaysQuestion(u);
    if (!t) throw new HttpError(404, 'There is no question today.');
    const x = t.quiz.questions[t.i]; const pick = Number(ctx.body.pick);
    if (!Number.isInteger(pick) || pick < 0 || pick >= x.o.length) throw new HttpError(400, 'Pick one of the answers.');
    const rec = (await store.get('scores', u.id)) || { id: u.id, nick: '', best: {} };
    const prev = rec.qotd;
    if (prev && prev.date === t.date) return send(res, 200, { already: true, correct: prev.correct, a: x.a, e: x.e || '', streak: prev.streak, best: prev.best });
    const streak = prev && prev.date === D.lagosDate(Date.now() - DAY) ? (prev.streak || 0) + 1 : 1;
    const correct = pick === x.a;
    rec.qotd = { date: t.date, picked: pick, correct, streak, best: Math.max(streak, (prev && prev.best) || 0), days: ((prev && prev.days) || 0) + 1 };
    if (correct) rec.bonus = Math.max(0, Number(rec.bonus) || 0) + QOTD_POINTS;
    rec.updatedAt = Date.now(); await store.put('scores', rec);
    send(res, 200, { correct, a: x.a, e: x.e || '', streak, best: rec.qotd.best, points: correct ? QOTD_POINTS : 0 });
  });

  /* ================= study groups ================= */
  const MAX_GROUPS = 5; const MAX_MEMBERS = 30; const MAX_TODOS = 40;
  const makeCode = async () => {
    const all = new Set((await store.list('groups')).map((g) => g.code)); const A32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let n = 0; n < 20; n++) { const c = Array.from(crypto.randomBytes(6), (b) => A32[b % 32]).join(''); if (!all.has(c)) return c; }
    throw new HttpError(500, 'Try again.');
  };
  const readMeet = (b) => {
    const date = String(b.date || '').trim(); const time = String(b.time || '').trim();
    if (date && !isDate(date)) throw new HttpError(400, 'Pick a valid meeting date.');
    if (time && !isTime(time)) throw new HttpError(400, 'Pick a valid meeting time.');
    return { date, time, place: clean(b.place, 60) };
  };
  const readLink = (v) => {
    const s = clean(v, 200); if (!s) return '';
    let url; try { url = new URL(s); } catch (e) { throw new HttpError(400, 'That group link does not look right.'); }
    if (url.protocol !== 'https:' || !['chat.whatsapp.com', 't.me'].includes(url.hostname)) throw new HttpError(400, 'Only WhatsApp (chat.whatsapp.com) or Telegram (t.me) group links are allowed.');
    return url.toString();
  };
  const view = (g, uid) => ({ id: g.id, name: g.name, course: g.course || '', code: g.code, owner: g.ownerId === uid, ownerName: g.ownerName, members: g.members.map((m) => ({ name: m.name, owner: m.uid === g.ownerId, me: m.uid === uid })), meet: g.meet || {}, link: g.link || '', todos: g.todos });
  const mine = async (uid) => (await store.list('groups')).filter((g) => g.members.some((m) => m.uid === uid));
  const getMine = async (req, id) => { const u = await need(req); const g = await store.get('groups', id); if (!g || !g.members.some((m) => m.uid === u.id)) throw new HttpError(404, 'Group not found.'); return { u, g }; };
  route('GET', '/api/groups', {}, async (req, res) => { const u = await need(req); send(res, 200, { groups: (await mine(u.id)).sort((a, b) => b.createdAt - a.createdAt).map((g) => view(g, u.id)) }); });
  route('POST', '/api/groups', { limit: ['groupnew', 10, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req); const b = ctx.body; const name = clean(b.name, 60);
    if (name.length < 3) throw new HttpError(400, 'Give the group a name, at least 3 letters.');
    if ((await mine(u.id)).length >= MAX_GROUPS) throw new HttpError(400, 'You are in ' + MAX_GROUPS + ' groups already. Leave one first.');
    const course = String(b.course || '').trim().toUpperCase(); if (course && !H.okCourse(course)) throw new HttpError(400, 'That course code does not look right.');
    const g = { id: newId(), name, course, code: await makeCode(), ownerId: u.id, ownerName: u.username, members: [{ uid: u.id, name: u.username, at: Date.now() }], meet: readMeet(b), link: readLink(b.link), todos: [], createdAt: Date.now() };
    await store.put('groups', g); send(res, 200, { ok: true, id: g.id, code: g.code });
  });
  route('POST', '/api/groups/join', { limit: ['groupjoin', 30, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req); const code = String(ctx.body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const g = code.length === 6 && (await store.list('groups')).find((x) => x.code === code);
    if (!g) throw new HttpError(404, 'No group has that code. Check it with whoever invited you.');
    if (g.members.some((m) => m.uid === u.id)) return send(res, 200, { ok: true, id: g.id });
    if (g.members.length >= MAX_MEMBERS) throw new HttpError(400, 'This group is full.');
    if ((await mine(u.id)).length >= MAX_GROUPS) throw new HttpError(400, 'You are in ' + MAX_GROUPS + ' groups already. Leave one first.');
    g.members.push({ uid: u.id, name: u.username, at: Date.now() }); await store.put('groups', g);
    send(res, 200, { ok: true, id: g.id });
  });
  route('GET', '/api/groups/:id', {}, async (req, res, ctx) => { const { u, g } = await getMine(req, ctx.params[0]); send(res, 200, view(g, u.id)); });
  route('POST', '/api/groups/:id/update', {}, async (req, res, ctx) => {
    const { u, g } = await getMine(req, ctx.params[0]); if (g.ownerId !== u.id) throw new HttpError(403, 'Only the group owner can change this.');
    const b = ctx.body; const name = clean(b.name, 60); if (name.length < 3) throw new HttpError(400, 'Give the group a name, at least 3 letters.');
    g.name = name; g.meet = readMeet(b); g.link = readLink(b.link); await store.put('groups', g); send(res, 200, { ok: true });
  });
  route('POST', '/api/groups/:id/leave', {}, async (req, res, ctx) => {
    const { u, g } = await getMine(req, ctx.params[0]);
    g.members = g.members.filter((m) => m.uid !== u.id);
    if (!g.members.length) await store.del('groups', g.id);
    else { if (g.ownerId === u.id) { g.ownerId = g.members[0].uid; g.ownerName = g.members[0].name; } await store.put('groups', g); }
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/groups/:id', {}, async (req, res, ctx) => {
    const { u, g } = await getMine(req, ctx.params[0]); if (g.ownerId !== u.id) throw new HttpError(403, 'Only the group owner can delete the group.');
    await store.del('groups', g.id); send(res, 200, { ok: true });
  });
  route('POST', '/api/groups/:id/todos', { limit: ['grouptodo', 120, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const { u, g } = await getMine(req, ctx.params[0]); const text = clean(ctx.body.text, 120);
    if (!text) throw new HttpError(400, 'Write the task first.'); if (g.todos.length >= MAX_TODOS) throw new HttpError(400, 'This list is full. Remove finished tasks.');
    g.todos.push({ id: newId(), text, done: false, by: u.username, at: Date.now() }); await store.put('groups', g); send(res, 200, { ok: true });
  });
  route('POST', '/api/groups/:id/todos/:tid/toggle', {}, async (req, res, ctx) => {
    const { g } = await getMine(req, ctx.params[0]); const t = g.todos.find((x) => x.id === ctx.params[1]);
    if (t) { t.done = !t.done; await store.put('groups', g); } send(res, 200, { ok: true });
  });
  route('DELETE', '/api/groups/:id/todos/:tid', {}, async (req, res, ctx) => {
    const { g } = await getMine(req, ctx.params[0]); g.todos = g.todos.filter((x) => x.id !== ctx.params[1]); await store.put('groups', g); send(res, 200, { ok: true });
  });

  /* ================= analytics ================= */
  route('POST', '/api/track', { limit: ['track', 400, 60 * 60 * 1000] }, async (req, res, ctx) => {
    await need(req); const id = H.str(ctx.body.id, 40);
    if (H.okId(id) && await store.get('materials', id)) stats.open(id);
    send(res, 200, { ok: true });
  });
  route('GET', '/api/admin/analytics', A, async (req, res) => {
    const [mats, quizzes, st, groups, users] = await Promise.all([store.list('materials'), store.list('quizzes'), store.list('stats'), store.list('groups'), store.list('users')]);
    const by = new Map(st.map((s) => [s.id, s])); const since = D.lagosDate(Date.now() - 13 * DAY);
    const resources = mats.filter((m) => !m.hidden && m.status !== 'pending').map((m) => {
      const s = by.get('mat:' + m.id) || {}; const recent = Object.entries(s.days || {}).filter(([d]) => d >= since).reduce((a, [, n]) => a + n, 0);
      return { id: m.id, title: m.title, course: m.course, kind: m.kind, opens: s.opens || 0, recent };
    });
    const questions = [];
    quizzes.forEach((q) => {
      const s = by.get('quiz:' + q.id); if (!s) return;
      q.questions.forEach((x, i) => { const h = qHash(x); const seen = (s.seen || {})[h] || 0; if (seen >= 3) questions.push({ quizId: q.id, title: q.title, course: q.course, n: i + 1, q: x.q.slice(0, 140), seen, miss: Math.round((((s.wrong || {})[h] || 0) / seen) * 100) }); });
    });
    const cs = new Map(); const row = (c) => { if (!cs.has(c)) cs.set(c, { course: c, resources: 0, opens: 0, quizzes: 0, attempts: 0, correct: 0, total: 0 }); return cs.get(c); };
    resources.forEach((r) => { const x = row(r.course); x.resources++; x.opens += r.opens; });
    quizzes.filter((q) => !q.hidden).forEach((q) => { const x = row(q.course); const s = by.get('quiz:' + q.id) || {}; x.quizzes++; x.attempts += s.attempts || 0; x.correct += s.correct || 0; x.total += s.total || 0; });
    send(res, 200, {
      resources: resources.sort((a, b) => b.opens - a.opens).slice(0, 15), unopened: resources.filter((r) => !r.opens).length, resourceCount: resources.length,
      questions: questions.sort((a, b) => b.miss - a.miss || b.seen - a.seen).slice(0, 15),
      courses: [...cs.values()].map((x) => ({ course: x.course, resources: x.resources, opens: x.opens, quizzes: x.quizzes, attempts: x.attempts, avg: x.total ? Math.round((x.correct / x.total) * 100) : null })).sort((a, b) => b.opens + b.attempts - (a.opens + a.attempts)),
      totals: { students: users.filter((u) => !u.disabled).length, groups: groups.length, opens: resources.reduce((a, r) => a + r.opens, 0), attempts: [...by.values()].reduce((a, s) => a + (String(s.id).startsWith('quiz:') ? s.attempts || 0 : 0), 0) },
    });
  });

  /* ================= receipts ================= */
  route('GET', '/api/receipts', {}, async (req, res) => {
    const u = await need(req); const today = D.lagosDate();
    const [mats, qzs] = await Promise.all([store.list('materials'), store.list('quizzes')]);
    const all = mats.map((m) => ({ ...m, what: 'resource' })).concat(qzs.map((q) => ({ ...q, what: 'quiz' })));
    const receipts = (Array.isArray(u.receipts) ? u.receipts : []).slice().sort((a, b) => b.at - a.at);
    const items = (Array.isArray(u.unlocked) ? u.unlocked : []).map((id) => all.find((x) => x.id === id)).filter(Boolean).map((x) => ({ id: x.id, title: x.title, course: x.course, what: x.what }));
    send(res, 200, { paidUntil: u.paidUntil || '', passActive: !!u.paidUntil && u.paidUntil >= today, items, receipts });
  });
};
