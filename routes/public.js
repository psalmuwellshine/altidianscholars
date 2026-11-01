'use strict';
/* Routes for students and visitors. */
const crypto = require('crypto');
const H = require('../lib/helpers');
const D = require('../lib/domain');
const Ac = require('../lib/academics');
const { looksLike } = require('../lib/files');
const Cl = require('../lib/classes');

const { HttpError } = H;

const qHash = (q) => H.sha(String(q.q)).slice(0, 10); // follows a question even if the quiz is reordered

module.exports = function registerPublic({ route, store, send, userOf, fileTypes }) {
  const publicUser = (u) => ({ id: u.id, username: u.username, createdAt: u.createdAt || null, matric: u.matric || '', facultyId: u.facultyId || '', departmentId: u.departmentId || '', level: u.level || 0, rep: u.rep || null, avatarId: u.avatarId || '' });
  const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_AVATAR = 400 * 1024;

  async function startSession(req, res, user, extra) {
    return Object.assign({ 'Set-Cookie': H.makeCookie(req, 'ew_user', 'user', user.id, user.sv || 0, H.USER_SESSION_DAYS * 86400) }, extra || {});
  }

  // A guest who logs in or registers keeps the scores they earned on this device.
  async function claimGuest(deviceId, user) {
    if (!H.okDevice(deviceId) || deviceId === user.id) return;
    const g = await store.get('scores', deviceId);
    if (!g) return;
    const rec = (await store.get('scores', user.id)) || { id: user.id, nick: '', best: {} };
    rec.best = rec.best || {};
    Object.keys(g.best || {}).forEach((id) => {
      if (!rec.best[id] || g.best[id].correct > rec.best[id].correct) rec.best[id] = g.best[id];
    });
    rec.history = D.historyOf(rec).concat(D.historyOf(g)).sort((a, b) => a.at - b.at).slice(-D.HISTORY_LIMIT);
    rec.updatedAt = Math.max(rec.updatedAt || 0, g.updatedAt || 0);
    await store.put('scores', rec);
    await store.del('scores', deviceId);
  }

  const findByName = async (name) => {
    const users = await store.list('users');
    return users.find((u) => u.username.toLowerCase() === name.toLowerCase()) || null;
  };

  /* ---------- everything the site needs to draw itself ---------- */
  route('GET', '/api/state', {}, async (req, res, ctx) => {
    const [materials, quizzes, scores, events, users, notice, config, timetable, classnotes] = await Promise.all([
      store.list('materials'), store.list('quizzes'), store.list('scores'), store.list('events'),
      store.list('users'), store.get('settings', 'notice'), D.loadConfig(store), store.list('timetable'), store.list('classnotes'),
    ]);
    const academics = await Ac.loadAcademics(store);
    const user = await userOf(req);
    const dev = String(ctx.query.get('device') || '');
    const meId = user ? user.id : (H.okDevice(dev) ? dev : '');

    const quizIds = new Set(quizzes.map((q) => q.id));
    const usersById = new Map(users.map((u) => [u.id, u]));
    const board = D.buildBoard(usersById, scores, quizIds);

    let me = null;
    const rec = meId ? scores.find((s) => s.id === meId) : null;
    if (rec) {
      const { points, done } = D.pointsFor(rec, quizIds);
      const idx = board.findIndex((b) => b.id === meId);
      const missed = {};
      quizzes.forEach((q) => { const hs = (rec.missed || {})[q.id]; if (!hs || !hs.length || q.hidden) return; const set = new Set(hs); const at = []; q.questions.forEach((x, i) => { if (set.has(qHash(x))) at.push(i); }); if (at.length) missed[q.id] = at; });
      me = { points, done, best: rec.best || {}, nick: rec.nick || '', position: idx >= 0 ? idx + 1 : null, rank: D.rankInfo(points), missed };
    }

    const visibleMaterials = materials.filter((m) => !m.hidden);
    const visibleQuizzes = quizzes.filter((q) => !q.hidden);
    send(res, 200, {
      config, academics,
      notice: user && notice && notice.text ? { text: notice.text, level: notice.level || 'info' } : null,
      materials: visibleMaterials
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
        .map((m) => {
          const open = D.hasAccess(user, m);
          // A locked item still shows its title and price, but none of its content.
          return {
            id: m.id, title: m.title, course: m.course, kind: m.kind, pinned: !!m.pinned, addedAt: m.addedAt, ...(m.byName ? { by: m.byName } : {}),
            note: open ? m.note || '' : '', link: open ? m.link || '' : '', fileId: open ? m.fileId || '' : '', fileName: open ? m.fileName || '' : '',
            ...(m.paid ? { paid: true, price: m.price, locked: !open } : {}),
          };
        }),
      quizzes: visibleQuizzes.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).map((q) => {
        const open = D.hasAccess(user, q);
        // A locked quiz keeps its title, price and question count, but no questions or answers.
        return { ...q, count: q.questions.length, questions: open ? q.questions : [], ...(q.paid ? { locked: !open } : {}) };
      }),
      events: events.filter((e) => Cl.classMatch(e, user)).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 200)
        .map((e) => ({ id: e.id, title: e.title, date: e.date, time: e.time, location: e.location, description: e.description, link: e.link, ...(e.departmentId || e.level ? { scoped: true } : {}), ...(e.byName ? { by: e.byName } : {}) })),
      timetable: user ? timetable.filter((t) => (t.uid ? t.uid === user.id : Cl.classMatch(t, user))).slice(0, 400).map((t) => ({ id: t.id, kind: t.kind, title: t.title, course: t.course || '', day: t.day || 0, date: t.date || '', start: t.start || '', end: t.end || '', venue: t.venue || '', mine: !!t.uid, by: t.byName || '' })) : [],
      classNotes: user ? classnotes.filter((n) => Cl.classMatch(n, user) && n.at > Date.now() - 30 * 86400000).sort((a, b) => b.at - a.at).slice(0, 5).map((n) => ({ id: n.id, text: n.text, by: n.byName, at: n.at })) : [],
      board: config.leaderboardEnabled
        ? board.slice(0, 200).map((b, i) => ({ rank: i + 1, name: b.name, points: b.points, done: b.done, isUser: b.isUser, me: b.id === meId, avatar: b.avatar, dept: b.dept, level: b.level }))
        : [],
      stats: { materials: visibleMaterials.length, quizzes: visibleQuizzes.length, students: users.filter((u) => !u.disabled).length },
      user: user ? publicUser(user) : null,
      me,
    });
  });

  route('GET', '/files/:id', {}, async (req, res, ctx) => {
    const id = ctx.params[0];
    const mats = await store.list('materials');
    const m = mats.find((x) => x.fileId === id);
    let allowed = !!m && (!m.hidden || H.isAdmin(req));
    if (m && !allowed) { // pending uploads can be opened by the student who shared them and by the class rep who reviews them
      const u = await userOf(req);
      if (u && m.by === u.id) allowed = true;
      else if (u && Cl.repScope(u)) { const course = (await store.list('courses')).find((c) => c.code === m.course); allowed = m.status === 'pending' && Cl.courseInScope(course, Cl.repScope(u)); }
    }
    if (!allowed) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    if (m.paid && !H.isAdmin(req) && !D.hasAccess(await userOf(req), m)) {
      return send(res, 403, 'This file is locked. Open Altidian and unlock it first.', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    // Paid files are view-only: only Altidian's own viewer asks for them (it sends this header).
    // Typing the address into a browser, or a download link, gets nothing.
    if (m.paid && !H.isAdmin(req) && req.headers['x-altidian-view'] !== '1') {
      return send(res, 403, 'This file is view-only. Open it from inside Altidian.', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    const buf = await store.getFile(id);
    if (!buf) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const meta = fileTypes[m.fileType] || { inline: false };
    const name = (m.fileName || 'file').replace(/[^\w.\- ]+/g, '_');
    send(res, 200, buf, {
      'Content-Type': m.fileType || 'application/octet-stream',
      'Content-Disposition': (meta.inline || m.paid ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(name),
      'Content-Security-Policy': 'sandbox',
      'Cache-Control': m.paid ? 'private, no-store' : 'public, max-age=3600', // paid files must never sit in a shared cache
    });
  });

  /* ---------- accounts ---------- */
  route('POST', '/api/register', { limit: ['register', 30, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const config = await D.loadConfig(store);
    if (!config.registrationOpen) throw new HttpError(403, 'Registration is closed right now. Please check back later.');
    const b = ctx.body;
    const username = H.str(b.username, 60).trim().replace(/\s+/g, ' ');
    const password = H.str(b.password, 100);
    const phrase = H.normPhrase(H.str(b.recoveryPhrase, 100));
    if (!username || !password) throw new HttpError(400, 'Username and password required.');
    if (!H.USERNAME_RE.test(username)) throw new HttpError(400, 'Username must be 3 to 24 characters: letters, numbers, spaces, dots, dashes or underscores.');
    if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
    if (phrase.length < 4 || phrase.length > 60) throw new HttpError(400, 'Recovery phrase must be 4 to 60 characters.');
    if (await findByName(username)) throw new HttpError(400, 'Username already taken.');
    const acad = await Ac.loadAcademics(store);
    const matric = Ac.cleanMatric(b.matric);
    if ((await store.list('users')).some((u) => u.matric === matric)) throw new HttpError(400, 'That matric number is already registered. If it is yours, log in or contact an admin.');
    const place = Ac.pickAcademic(b, acad);

    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: H.newId(), username, sv: 0, matric, facultyId: place.facultyId, departmentId: place.departmentId, level: place.level,
      password: await H.hashPassword(password),
      recovery: { salt, hash: await H.hashPhrase(phrase, salt) },
      createdAt: Date.now(), lastLoginAt: Date.now(),
    };
    await store.put('users', user);
    await claimGuest(b.deviceId, user);
    send(res, 200, { message: 'Welcome aboard! Your account is ready.', user: publicUser(user) }, await startSession(req, res, user));
  });

  route('POST', '/api/login', { limit: ['userlogin', 200, 15 * 60 * 1000] }, async (req, res, ctx) => {
    const b = ctx.body;
    const username = H.str(b.username, 60).trim();
    const password = H.str(b.password, 100);
    if (!username || !password) throw new HttpError(400, 'Username and password required.');
    const lockKey = username.toLowerCase(); // 5 wrong passwords in 15 minutes locks this account's login for a while
    if (H.tooManyFails('ulogin', lockKey, 5)) throw new HttpError(429, 'Too many wrong attempts on this account. Please wait 15 minutes, or reset your password with your recovery phrase.');
    const user = await findByName(username);
    const check = user ? await H.checkPassword(user.password, password) : { ok: false };
    if (!user || !check.ok) { H.noteFail('ulogin', lockKey, 15 * 60 * 1000); throw new HttpError(401, 'Invalid username or password.'); }
    H.clearFails('ulogin', lockKey);
    if (user.disabled) throw new HttpError(403, 'This account has been disabled. Please contact an Altidian admin.');
    if (check.legacy) user.password = await H.hashPassword(password); // upgrade an older password hash
    user.lastLoginAt = Date.now();
    await store.put('users', user);
    await claimGuest(b.deviceId, user);
    send(res, 200, { message: 'Welcome back, ' + user.username + '!', user: publicUser(user) }, await startSession(req, res, user));
  });

  route('POST', '/api/logout', {}, async (req, res) => {
    send(res, 200, { ok: true }, { 'Set-Cookie': H.clearCookie('ew_user') });
  });

  route('GET', '/api/me', {}, async (req, res) => {
    const user = await userOf(req);
    send(res, 200, { user: user ? publicUser(user) : null });
  });

  route('POST', '/api/user/reset-password', { limit: ['reset', 60, 15 * 60 * 1000] }, async (req, res, ctx) => {
    const b = ctx.body;
    const username = H.str(b.username, 60).trim();
    const phrase = H.str(b.recoveryPhrase, 100);
    const newPassword = H.str(b.newPassword, 100);
    if (!username || !phrase || !newPassword) throw new HttpError(400, 'Please fill in all fields.');
    if (newPassword.length < 6) throw new HttpError(400, 'New password must be at least 6 characters.');
    const BAD = 'Username or recovery phrase is incorrect.';
    const lockKey = username.toLowerCase(); // 5 wrong recovery phrases in 15 minutes locks resets for this account
    if (H.tooManyFails('ureset', lockKey, 5)) throw new HttpError(429, 'Too many wrong attempts. Please wait 15 minutes, or ask an Altidian admin to reset your password.');
    const user = await findByName(username);
    if (!user) { await H.hashPhrase(phrase, H.NO_SALT); H.noteFail('ureset', lockKey, 15 * 60 * 1000); throw new HttpError(401, BAD); }
    if (!user.recovery) throw new HttpError(403, 'This account has no recovery phrase yet. Please contact an Altidian admin.');
    const given = Buffer.from(await H.hashPhrase(phrase, user.recovery.salt), 'hex');
    const saved = Buffer.from(user.recovery.hash, 'hex');
    if (given.length !== saved.length || !crypto.timingSafeEqual(given, saved)) { H.noteFail('ureset', lockKey, 15 * 60 * 1000); throw new HttpError(401, BAD); }
    H.clearFails('ureset', lockKey);
    user.password = await H.hashPassword(newPassword);
    user.sv = (user.sv || 0) + 1; // signs the account out everywhere else
    await store.put('users', user);
    send(res, 200, { message: 'Password reset successfully! You can now log in.', username: user.username });
  });

  route('POST', '/api/user/update', { limit: ['update', 20, 15 * 60 * 1000] }, async (req, res, ctx) => {
    const user = await userOf(req);
    if (!user) throw new HttpError(401, 'Please log in first.');
    const b = ctx.body;
    const current = H.str(b.currentPassword, 100);
    if (!current) throw new HttpError(400, 'Enter your current password to make changes.');
    if (!(await H.checkPassword(user.password, current)).ok) throw new HttpError(401, 'Your current password is not correct.');

    const changes = [];
    const newUsername = H.str(b.newUsername, 60).trim().replace(/\s+/g, ' ');
    if (newUsername && newUsername !== user.username) {
      if (!H.USERNAME_RE.test(newUsername)) throw new HttpError(400, 'Username must be 3 to 24 characters: letters, numbers, spaces, dots, dashes or underscores.');
      const other = await findByName(newUsername);
      if (other && other.id !== user.id) throw new HttpError(400, 'That username is already taken.');
      user.username = newUsername; changes.push('username');
    }
    const newPassword = H.str(b.newPassword, 100);
    let reissue = false;
    if (newPassword) {
      if (newPassword.length < 6) throw new HttpError(400, 'New password must be at least 6 characters.');
      user.password = await H.hashPassword(newPassword);
      user.sv = (user.sv || 0) + 1; reissue = true; changes.push('password');
    }
    const phrase = H.normPhrase(H.str(b.newRecoveryPhrase, 100));
    if (phrase) {
      if (phrase.length < 4 || phrase.length > 60) throw new HttpError(400, 'Recovery phrase must be 4 to 60 characters.');
      const salt = crypto.randomBytes(16).toString('hex');
      user.recovery = { salt, hash: await H.hashPhrase(phrase, salt) }; changes.push('recovery phrase');
    }
    const newMatric = H.str(b.newMatric, 40);
    if (newMatric && Ac.normMatric(newMatric) !== user.matric) {
      const m = Ac.cleanMatric(newMatric);
      if ((await store.list('users')).some((u) => u.matric === m && u.id !== user.id)) throw new HttpError(400, 'That matric number is already registered.');
      user.matric = m; changes.push('matric number');
    }
    if (b.departmentId || b.facultyId || b.level) {
      const place = Ac.pickAcademic(b, await Ac.loadAcademics(store));
      if (place.departmentId !== user.departmentId || place.level !== user.level) changes.push('department and level');
      Object.assign(user, place);
    }
    if (!changes.length) throw new HttpError(400, 'There is nothing to change yet.');
    await store.put('users', user);
    send(res, 200, { message: 'Saved: ' + changes.join(', ') + '.', user: publicUser(user) }, reissue ? await startSession(req, res, user) : {});
  });

  /* ---------- profile ---------- */
  route('GET', '/api/profile', {}, async (req, res) => {
    const user = await userOf(req);
    if (!user) throw new HttpError(401, 'Please log in first.');
    const [quizzes, scores, users, courses] = await Promise.all([store.list('quizzes'), store.list('scores'), store.list('users'), store.list('courses')]);
    const board = D.buildBoard(new Map(users.map((u) => [u.id, u])), scores, new Set(quizzes.map((q) => q.id)));
    const rec = scores.find((s) => s.id === user.id) || null;
    const contributions = (await store.list('materials')).filter((m) => m.by === user.id && m.status === 'approved').length;
    send(res, 200, D.buildProfile({ user, rec, quizzes, courses, board, now: Date.now(), contributions }));
  });

  /* ---------- profile picture ---------- */
  route('POST', '/api/user/avatar', { limit: ['avatar', 20, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const user = await userOf(req);
    if (!user) throw new HttpError(401, 'Please log in first.');
    const img = ctx.body.image || {};
    const type = String(img.type || '');
    if (!AVATAR_TYPES.includes(type)) throw new HttpError(400, 'Use a JPG, PNG or WebP picture.');
    const buf = Buffer.from(String(img.data || ''), 'base64');
    if (!buf.length) throw new HttpError(400, 'The picture is empty.');
    if (buf.length > MAX_AVATAR) throw new HttpError(400, 'That picture is too big. Pick a smaller one.');
    if (!looksLike(buf, type)) throw new HttpError(400, 'The picture could not be read.');
    const old = user.avatarId;
    user.avatarId = H.newId(); user.avatarType = type;
    await store.putFile(user.avatarId, buf);
    await store.put('users', user);
    if (old) await store.delFile(old);
    send(res, 200, { ok: true, user: publicUser(user) });
  });
  route('DELETE', '/api/user/avatar', {}, async (req, res) => {
    const user = await userOf(req);
    if (!user) throw new HttpError(401, 'Please log in first.');
    if (user.avatarId) { await store.delFile(user.avatarId); user.avatarId = ''; user.avatarType = ''; await store.put('users', user); }
    send(res, 200, { ok: true, user: publicUser(user) });
  });
  // Pictures are shown on the leaderboard, so they are public. Each upload gets a new random id.
  route('GET', '/avatars/:id', {}, async (req, res, ctx) => {
    const buf = H.okId(ctx.params[0]) ? await store.getFile(ctx.params[0]) : null;
    if (!buf) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const type = buf[0] === 0x89 ? 'image/png' : buf[0] === 0x52 ? 'image/webp' : 'image/jpeg';
    send(res, 200, buf, { 'Content-Type': type, 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'public, max-age=31536000, immutable' });
  });

  /* ---------- quiz results ---------- */
  route('POST', '/api/scores', { limit: ['scores', 150, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const { deviceId, quizId, answers } = ctx.body;
    const user = await userOf(req);
    const config = await D.loadConfig(store);
    let id;
    if (user) id = user.id;
    else {
      if (config.requireLogin) throw new HttpError(401, 'Please log in to take quizzes.');
      if (!H.okDevice(deviceId)) throw new HttpError(400, 'Invalid request.');
      id = deviceId;
    }
    if (typeof quizId !== 'string') throw new HttpError(400, 'Invalid request.');
    const quiz = await store.get('quizzes', quizId);
    if (!quiz || quiz.hidden) throw new HttpError(404, 'That quiz is no longer available.');
    if (!D.hasAccess(user, quiz)) throw new HttpError(403, 'This quiz is locked. Unlock it to take it.');
    if (!Array.isArray(answers) || answers.length !== quiz.questions.length) throw new HttpError(400, 'Answers do not match the quiz.');

    let correct = 0;
    quiz.questions.forEach((q, i) => { if (answers[i] === q.a) correct++; });
    const total = quiz.questions.length;
    const rec = (await store.get('scores', id)) || { id, nick: '', best: {} };
    const quizzes = await store.list('quizzes');
    const snap = (r) => D.buildProfile({ user: { id }, rec: r, quizzes, courses: [], board: [], now: Date.now() });
    const before = user ? snap(JSON.parse(JSON.stringify(rec))) : null;

    const prev = rec.best[quizId];
    const improved = !prev || correct > prev.correct;
    if (improved) rec.best[quizId] = { correct, total };
    rec.history = D.historyOf(rec).concat([{ q: quizId, c: correct, t: total, at: Date.now() }]).slice(-D.HISTORY_LIMIT);
    rec.updatedAt = Date.now();
    const wrong = []; quiz.questions.forEach((q, i) => { if (answers[i] !== q.a) wrong.push(i); });
    rec.missed = rec.missed || {};
    if (wrong.length) rec.missed[quizId] = wrong.map((i) => qHash(quiz.questions[i])); else delete rec.missed[quizId];
    await store.put('scores', rec);

    const after = snap(rec);
    const earned = user
      ? after.badges.filter((b) => b.earned && !before.badges.find((x) => x.id === b.id).earned).map((b) => b.name)
      : [];
    send(res, 200, { correct, total, improved, points: after.points, rank: after.rank.title, newBadges: earned, missed: wrong });
  });

  // Practising old mistakes: no points, but each one answered correctly leaves the student's mistakes list.
  route('POST', '/api/scores/practice', { limit: ['practice', 300, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const { deviceId, quizId, answers } = ctx.body;
    const user = await userOf(req); const config = await D.loadConfig(store);
    let id;
    if (user) id = user.id; else { if (config.requireLogin) throw new HttpError(401, 'Please log in first.'); if (!H.okDevice(deviceId)) throw new HttpError(400, 'Invalid request.'); id = deviceId; }
    if (typeof quizId !== 'string' || !answers || typeof answers !== 'object') throw new HttpError(400, 'Invalid request.');
    const quiz = await store.get('quizzes', quizId);
    if (!quiz || quiz.hidden) throw new HttpError(404, 'That quiz is no longer available.');
    if (!D.hasAccess(user, quiz)) throw new HttpError(403, 'This quiz is locked. Unlock it to take it.');
    const rec = await store.get('scores', id);
    const left = new Set(((rec && rec.missed) || {})[quizId] || []);
    let fixed = 0; let tried = 0;
    Object.keys(answers).slice(0, quiz.questions.length).forEach((k) => {
      const i = Number(k); if (!Number.isInteger(i) || i < 0 || i >= quiz.questions.length) return;
      const h = qHash(quiz.questions[i]); if (!left.has(h)) return;
      tried++; if (answers[k] === quiz.questions[i].a) { left.delete(h); fixed++; }
    });
    if (rec) { rec.missed = rec.missed || {}; if (left.size) rec.missed[quizId] = [...left]; else delete rec.missed[quizId]; await store.put('scores', rec); }
    const idx = []; quiz.questions.forEach((q, i) => { if (left.has(qHash(q))) idx.push(i); });
    send(res, 200, { fixed, tried, left: idx });
  });

  // Guests (only possible when the admin turns off "login required") choose a leaderboard name.
  route('POST', '/api/nick', { limit: ['nick', 20, 10 * 60 * 1000] }, async (req, res, ctx) => {
    if (await userOf(req)) throw new HttpError(400, 'Your leaderboard name is your username.');
    const nick = H.clean(ctx.body.nick, 24);
    if (!H.okDevice(ctx.body.deviceId) || !nick) throw new HttpError(400, 'A name is required.');
    const rec = (await store.get('scores', ctx.body.deviceId)) || { id: ctx.body.deviceId, nick: '', best: {} };
    rec.nick = nick; rec.updatedAt = Date.now();
    await store.put('scores', rec);
    send(res, 200, { ok: true, nick });
  });
};
