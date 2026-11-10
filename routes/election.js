'use strict';
/* Student election campaigns: admin management and the student-facing list. */
const H = require('../lib/helpers');
const Ac = require('../lib/academics');
const E = require('../lib/election');
const { looksLike } = require('../lib/files');

const { HttpError, clean, isHttp, newId, isDate, bool } = H;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO = 400 * 1024;

module.exports = function registerElection({ route, store, send, userOf }) {
  const A = { admin: true };

  route('GET', '/api/election', {}, async (req, res) => {
    const user = await userOf(req);
    const cfg = await E.loadCfg(store);
    if (!E.visibleTo(cfg, user)) return send(res, 200, { on: false });
    const list = await store.list('candidates');
    send(res, 200, { on: true, title: cfg.title, votingDate: cfg.votingDate || '', note: cfg.note || '', posts: E.groupByPost(list) });
  });

  /* ---------- admin ---------- */
  route('GET', '/api/admin/election', A, async (req, res) => {
    const [cfg, list] = await Promise.all([E.loadCfg(store), store.list('candidates')]);
    send(res, 200, { cfg, positions: E.POSITIONS, candidates: E.groupByPost(list).flatMap((g) => g.candidates) });
  });
  route('PUT', '/api/admin/election', A, async (req, res, ctx) => {
    const b = ctx.body || {};
    const acad = await Ac.loadAcademics(store);
    const departmentId = String(b.departmentId || '');
    if (departmentId && !acad.departments.find((d) => d.id === departmentId)) throw new HttpError(400, 'Choose a department from the list.');
    const votingDate = clean(b.votingDate, 10);
    if (votingDate && !isDate(votingDate)) throw new HttpError(400, 'Enter a valid voting date.');
    const next = { id: 'election', on: bool(b.on), title: clean(b.title, 80) || 'Student Elections', departmentId, votingDate, note: clean(b.note, 600) };
    if (next.on && !next.departmentId) throw new HttpError(400, 'Choose which department can see the campaigns before turning them on.');
    await store.put('settings', next);
    send(res, 200, { ok: true });
  });

  async function readCandidate(body, old) {
    const name = clean(body.name, 80); const position = clean(body.position, 60);
    if (!name) throw new HttpError(400, 'Enter the candidate’s name.');
    if (!position) throw new HttpError(400, 'Enter the position they are running for.');
    const link = clean(body.link, 300);
    if (link && !isHttp(link)) throw new HttpError(400, 'The link must start with http:// or https://');
    const promises = (Array.isArray(body.promises) ? body.promises : String(body.promises || '').split('\n')).map((x) => clean(String(x), 200)).filter(Boolean).slice(0, 12);
    const level = [100, 200, 300, 400, 500, 600].includes(Number(body.level)) ? Number(body.level) : 0;
    const doc = { id: old ? old.id : newId(), name, position, level, slogan: clean(body.slogan, 140), manifesto: clean(body.manifesto, 4000), promises, link, photoId: old ? old.photoId || '' : '', addedAt: old ? old.addedAt : Date.now() };
    const img = body.photo;
    if (img && img.data) {
      const type = String(img.type || ''); const buf = Buffer.from(String(img.data), 'base64');
      if (!PHOTO_TYPES.includes(type) || !buf.length || !looksLike(buf, type)) throw new HttpError(400, 'Use a JPG, PNG or WebP photo.');
      if (buf.length > MAX_PHOTO) throw new HttpError(400, 'That photo is too big. Pick a smaller one.');
      const prev = doc.photoId; doc.photoId = newId(); await store.putFile(doc.photoId, buf); if (prev) await store.delFile(prev);
    } else if (bool(body.removePhoto) && doc.photoId) { await store.delFile(doc.photoId); doc.photoId = ''; }
    return doc;
  }
  route('POST', '/api/admin/election/candidates', A, async (req, res, ctx) => {
    const doc = await readCandidate(ctx.body || {}, null); await store.put('candidates', doc); send(res, 200, { ok: true, id: doc.id });
  });
  route('PUT', '/api/admin/election/candidates/:id', A, async (req, res, ctx) => {
    const old = await store.get('candidates', ctx.params[0]); if (!old) throw new HttpError(404, 'Candidate not found.');
    await store.put('candidates', await readCandidate(ctx.body || {}, old)); send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/election/candidates/:id', A, async (req, res, ctx) => {
    const old = await store.get('candidates', ctx.params[0]);
    if (old && old.photoId) await store.delFile(old.photoId);
    await store.del('candidates', ctx.params[0]); send(res, 200, { ok: true });
  });
};
