'use strict';
/* Department transfers (automatic from the published list, or by request with admin approval) and the new-session level window. */
const H = require('../lib/helpers');
const D = require('../lib/domain');
const Ac = require('../lib/academics');

const { HttpError, clean, isDate, bool } = H;

module.exports = function registerTransfers({ route, store, send, userOf, push }) {
  const A = { admin: true };
  const need = async (req) => { const u = await userOf(req); if (!u) throw new HttpError(401, 'Please log in first.'); return u; };
  const state = async () => (await store.get('settings', 'transfer-state')) || { id: 'transfer-state', listOut: false };
  const listDoc = async () => (await store.get('settings', 'transfer-list')) || { id: 'transfer-list', entries: {} };

  async function moveUser(user, dept, level) {
    user.departmentId = dept.id; user.facultyId = dept.facultyId;
    if (level) user.level = level;
    if (user.rep && user.rep.departmentId !== dept.id) delete user.rep; // a rep only looks after their own department
    user.transferredAt = Date.now();
    await store.put('users', user);
    push.later({ audience: { uid: user.id }, type: 'direct', title: 'You have been moved', body: 'You are now in ' + dept.name + (level ? ', ' + level + ' level' : '') + '.', url: '/#/profile' });
  }
  const pickLevel = (dept, n) => { const l = Number(n); return Ac.LEVELS.includes(l) && l <= (dept.maxLevel || 600) ? l : 0; };

  /* ---------- student side ---------- */
  route('GET', '/api/transfer/me', {}, async (req, res) => {
    const u = await need(req); const st = await state();
    const mine = (await store.list('transfers')).filter((t) => t.uid === u.id);
    const declared = mine.find((t) => t.kind === 'declared') || null; const request = mine.filter((t) => t.kind === 'request').sort((a, b) => b.createdAt - a.createdAt)[0] || null;
    const cfg = await D.loadConfig(store);
    send(res, 200, { listOut: !!st.listOut, declared: declared && { matric: declared.matric, status: declared.status, createdAt: declared.createdAt }, request: request && { id: request.id, toDepartmentId: request.toDepartmentId, status: request.status, note: request.note || '', createdAt: request.createdAt }, levelOpen: D.levelWindowOpen(cfg), levelEnds: cfg.levelEnds || '' });
  });
  route('POST', '/api/transfer/declare', { limit: ['tdeclare', 10, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req); const matric = Ac.cleanMatric(ctx.body.matric);
    const all = await store.list('transfers');
    if (all.some((t) => t.kind === 'declared' && t.matric === matric && t.uid !== u.id)) throw new HttpError(400, 'That matric number was already submitted by another account. Contact an admin if it is yours.');
    let doc = all.find((t) => t.kind === 'declared' && t.uid === u.id);
    if (doc && doc.status === 'moved') throw new HttpError(400, 'You have already been moved by the transfer list.');
    doc = Object.assign(doc || { id: H.newId(), uid: u.id, kind: 'declared', createdAt: Date.now() }, { username: u.username, matric, status: 'waiting', fromDepartmentId: u.departmentId || '' });
    // If the list is already out and this matric is on it, the move happens straight away.
    const hit = ((await listDoc()).entries || {})[matric]; let moved = null;
    if (hit) {
      const acad = await Ac.loadAcademics(store); const dept = acad.departments.find((d) => d.id === hit.departmentId);
      if (dept) { await moveUser(u, dept, pickLevel(dept, hit.level)); doc.status = 'moved'; doc.movedTo = dept.id; moved = dept.name; }
    } else if ((await state()).listOut) doc.status = 'not-listed';
    await store.put('transfers', doc);
    send(res, 200, { ok: true, status: doc.status, moved });
  });
  route('POST', '/api/transfer/withdraw', {}, async (req, res) => {
    const u = await need(req); const t = (await store.list('transfers')).find((x) => x.kind === 'declared' && x.uid === u.id && x.status !== 'moved');
    if (t) await store.del('transfers', t.id); send(res, 200, { ok: true });
  });
  route('POST', '/api/transfer/request', { limit: ['trequest', 10, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req);
    if (!(await state()).listOut) throw new HttpError(400, 'Department change requests open after the transfer list is published.');
    const acad = await Ac.loadAcademics(store); const dept = acad.departments.find((d) => d.id === H.str(ctx.body.departmentId, 40));
    if (!dept) throw new HttpError(400, 'Choose the department you want to move to.');
    if (dept.id === u.departmentId) throw new HttpError(400, 'You are already in that department.');
    const reason = clean(ctx.body.reason, 300); if (reason.length < 5) throw new HttpError(400, 'Tell the admin briefly why you are moving.');
    const mine = (await store.list('transfers')).filter((t) => t.uid === u.id && t.kind === 'request');
    if (mine.some((t) => t.status === 'pending')) throw new HttpError(400, 'You already have a request waiting for the admin.');
    await store.put('transfers', { id: H.newId(), uid: u.id, username: u.username, kind: 'request', fromDepartmentId: u.departmentId || '', toDepartmentId: dept.id, level: pickLevel(dept, ctx.body.level), reason, status: 'pending', createdAt: Date.now() });
    send(res, 200, { ok: true });
  });

  /* ---------- admin side ---------- */
  // Each line: matric, department (name), optional level. Commas, tabs or | all work.
  function parseList(text, acad) {
    const rows = []; const bad = []; const byName = acad.departments.map((d) => [d, d.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()]);
    String(text || '').split(/\r?\n/).slice(0, 5000).forEach((line, n) => {
      const raw = line.trim(); if (!raw) return;
      const parts = raw.split(/[\t,|;]+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length < 2) return bad.push({ line: n + 1, text: raw.slice(0, 80), why: 'Needs a matric number and a department.' });
      const matric = Ac.normMatric(parts[0]);
      if (!/^[A-Z0-9][A-Z0-9/._-]{3,24}$/.test(matric)) return bad.push({ line: n + 1, text: raw.slice(0, 80), why: 'The matric number does not look right.' });
      const key = parts[1].toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const hits = byName.filter(([d, nm]) => nm === key || d.id === parts[1]);
      const dept = hits.length === 1 ? hits[0][0] : (hits.length === 0 ? (byName.filter(([, nm]) => nm.includes(key) && key.length >= 4).length === 1 ? byName.find(([, nm]) => nm.includes(key))[0] : null) : null);
      if (!dept) return bad.push({ line: n + 1, text: raw.slice(0, 80), why: 'No single department matches "' + parts[1].slice(0, 40) + '".' });
      rows.push({ matric, departmentId: dept.id, deptName: dept.name, level: pickLevel(dept, parts[2]) });
    });
    return { rows, bad };
  }
  const brief = (acad, t) => Object.assign({}, t, { toName: (acad.departments.find((d) => d.id === t.toDepartmentId) || {}).name || '', fromName: (acad.departments.find((d) => d.id === t.fromDepartmentId) || {}).name || '' });
  route('GET', '/api/admin/transfers', A, async (req, res) => {
    const [all, st, ld, acad] = await Promise.all([store.list('transfers'), state(), listDoc(), Ac.loadAcademics(store)]);
    const by = (k, s) => all.filter((t) => t.kind === k && (!s || s.includes(t.status))).sort((a, b) => b.createdAt - a.createdAt).map((t) => brief(acad, t));
    send(res, 200, { listOut: !!st.listOut, listCount: Object.keys(ld.entries || {}).length, listAt: ld.at || null, declared: by('declared'), requests: by('request', ['pending']), decided: by('request', ['approved', 'rejected']).slice(0, 15) });
  });
  route('POST', '/api/admin/transfers/preview', A, async (req, res, ctx) => {
    const acad = await Ac.loadAcademics(store); const { rows, bad } = parseList(ctx.body.text, acad);
    const dec = new Map((await store.list('transfers')).filter((t) => t.kind === 'declared').map((t) => [t.matric, t]));
    send(res, 200, { rows: rows.length, bad, willMove: rows.filter((r) => dec.has(r.matric) && dec.get(r.matric).status !== 'moved').length, sample: rows.slice(0, 8) });
  });
  route('POST', '/api/admin/transfers/publish', A, async (req, res, ctx) => {
    const acad = await Ac.loadAcademics(store); const { rows, bad } = parseList(ctx.body.text, acad);
    if (!rows.length) throw new HttpError(400, 'No usable lines found. Each line needs a matric number and a department.');
    if (bad.length && !bool(ctx.body.ignoreBad)) throw new HttpError(400, bad.length + ' line' + (bad.length > 1 ? 's' : '') + ' could not be read. Fix them, or tick "skip unreadable lines".');
    const ld = await listDoc(); ld.entries = ld.entries || {}; rows.forEach((r) => { ld.entries[r.matric] = { departmentId: r.departmentId, level: r.level }; }); ld.at = Date.now();
    await store.put('settings', ld); await store.put('settings', { id: 'transfer-state', listOut: true, at: Date.now() });
    const users = new Map((await store.list('users')).map((u) => [u.id, u])); let moved = 0; let notListed = 0;
    for (const t of await store.list('transfers')) {
      if (t.kind !== 'declared' || t.status === 'moved') continue;
      const hit = ld.entries[t.matric]; const u = users.get(t.uid);
      if (hit && u) { const dept = acad.departments.find((d) => d.id === hit.departmentId); if (dept) { await moveUser(u, dept, pickLevel(dept, hit.level)); t.status = 'moved'; t.movedTo = dept.id; moved++; await store.put('transfers', t); } }
      else if (t.status !== 'not-listed') { t.status = 'not-listed'; notListed++; await store.put('transfers', t); }
    }
    if (notListed) push.later({ audience: {}, type: 'direct', title: 'Transfer list is out', body: 'Not on the list? You can request a department change from your profile.', url: '/#/profile' });
    send(res, 200, { ok: true, saved: rows.length, moved, notListed, skipped: bad.length });
  });
  route('POST', '/api/admin/transfers/list-out', A, async (req, res, ctx) => { await store.put('settings', { id: 'transfer-state', listOut: bool(ctx.body.open), at: Date.now() }); send(res, 200, { ok: true }); });
  route('POST', '/api/admin/transfers/requests/:id/resolve', A, async (req, res, ctx) => {
    const t = await store.get('transfers', ctx.params[0]); if (!t || t.kind !== 'request' || t.status !== 'pending') throw new HttpError(404, 'That request is not waiting any more.');
    const note = clean(ctx.body.note, 200);
    if (ctx.body.action === 'approve') {
      const acad = await Ac.loadAcademics(store); const dept = acad.departments.find((d) => d.id === t.toDepartmentId); const u = await store.get('users', t.uid);
      if (!dept || !u) throw new HttpError(400, 'The department or the student no longer exists.');
      await moveUser(u, dept, t.level); t.status = 'approved';
    } else if (ctx.body.action === 'reject') {
      t.status = 'rejected'; push.later({ audience: { uid: t.uid }, type: 'direct', title: 'Department change not approved', body: note || 'Please contact an admin for details.', url: '/#/profile' });
    } else throw new HttpError(400, 'Choose approve or reject.');
    t.note = note; t.decidedAt = Date.now(); await store.put('transfers', t); send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/transfers/:id', A, async (req, res, ctx) => { await store.del('transfers', ctx.params[0]); send(res, 200, { ok: true }); });

  /* ---------- new-session level window ---------- */
  route('POST', '/api/admin/level-window', A, async (req, res, ctx) => {
    const cfg = await D.loadConfig(store); const open = bool(ctx.body.open); const ends = String(ctx.body.ends || '').trim();
    if (ends && !isDate(ends)) throw new HttpError(400, 'Pick a valid last day for the window.');
    const next = Object.assign({}, cfg, { id: 'config', levelOpen: open, levelEnds: open ? ends : '' }); await store.put('settings', next);
    if (open && !cfg.levelOpen && bool(ctx.body.notify)) push.later({ audience: {}, type: 'notices', title: 'New session: update your level', body: 'Open your profile to move to your new level' + (ends ? ' before ' + ends : '') + '.', url: '/#/profile' });
    send(res, 200, { ok: true, levelOpen: open, levelEnds: next.levelEnds });
  });
};
