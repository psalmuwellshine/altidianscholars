'use strict';
/* Ask Altidian: students ask a question about the note they are reading. The student's phone reads the page text
   (the viewer already has the PDF open); the server checks the student, the file, the daily limit and the monthly
   spending cap, then asks Claude. Students with a semester pass get more questions a day; everyone else gets a few
   free ones (the admin sets both numbers in Admin -> Ask Altidian). */
const H = require('../lib/helpers');
const D = require('../lib/domain');
const AI = require('../lib/ai');

const { HttpError, clean } = H;

module.exports = function registerAi({ route, store, send, userOf }) {
  const need = async (req) => { const u = await userOf(req); if (!u) throw new HttpError(401, 'Please log in first.'); return u; };
  const FILE = /^[a-f0-9]{16}$/;
  const hasPlan = (u) => !!(u && u.paidUntil && u.paidUntil >= D.lagosDate()); // a live semester pass

  // A limit per student (not per internet address): many students share one campus or phone-network address.
  const recent = new Map();
  const busy = (id, name, max, windowMs) => {
    const key = name + ':' + id; const now = Date.now();
    const list = (recent.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) { recent.set(key, list); return true; }
    list.push(now); recent.set(key, list); return false;
  };
  setInterval(() => { const now = Date.now(); for (const [k, v] of recent) { const f = v.filter((t) => now - t < 600000); if (f.length) recent.set(k, f); else recent.delete(k); } }, 120000).unref();

  // Why Ask Altidian cannot be used for this file right now ('' = it can). Checked on every request, on the server.
  async function fileCheck(S, user, fileId) {
    if (!fileId) return '';
    const m = FILE.test(fileId) ? (await store.list('materials')).find((x) => x.fileId === fileId) : null;
    if (!m || m.hidden) return 'nofile';
    if (m.paid && !(S.paidNotes && D.hasAccess(user, m))) return 'nofile';
    return '';
  }
  const hasBought = (u) => !!(u && Array.isArray(u.unlocked) && u.unlocked.length); // a paid note, quiz or pack opened for them
  const plan = (u) => (hasPlan(u) ? 'pass' : hasBought(u) ? 'buyer' : 'free');
  const limitFor = (S, p) => (p === 'pass' ? S.passDaily : p === 'buyer' ? S.buyerDaily : S.freeDaily);

  route('GET', '/api/ai/status', {}, async (req, res, ctx) => {
    const u = await need(req); const S = await AI.settings(store);
    const p = plan(u); const limit = limitFor(S, p); const used = await AI.usedToday(store, u.id); const remaining = Math.max(0, limit - used);
    const base = { plan: p, limit, remaining, passLimit: S.passDaily, buyerLimit: S.buyerDaily };
    if (!S.enabled) return send(res, 200, Object.assign(base, { state: 'off' }));
    if (await fileCheck(S, u, H.str(ctx.query.get('file') || '', 40))) return send(res, 200, Object.assign(base, { state: 'off' }));
    if ((await AI.monthSpend(store)).cost >= S.capUsd) return send(res, 200, Object.assign(base, { state: 'resting', message: 'Ask Altidian is resting until next month. Please check back soon.' }));
    if (remaining > 0) return send(res, 200, Object.assign(base, { state: 'ready' }));
    send(res, 200, Object.assign(base, p !== 'pass' ? { state: 'upsell' } : { state: 'limit', message: 'You have used your ' + limit + ' questions for today. They come back tomorrow.' }));
  });

  route('POST', '/api/ai/ask', { limit: ['ai', 300, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req);
    if (busy(u.id, 'ask', 15, 10 * 60 * 1000)) throw new HttpError(429, 'You are asking very fast. Please wait a few minutes and try again.');
    const S = await AI.settings(store); const b = ctx.body || {};
    if (!S.enabled) throw new HttpError(403, 'Ask Altidian is not switched on yet.');
    if (await fileCheck(S, u, H.str(b.file, 40))) throw new HttpError(403, 'Ask Altidian is not available for this file.');
    if ((await AI.monthSpend(store)).cost >= S.capUsd) throw new HttpError(503, 'Ask Altidian is resting until next month. Please check back soon.');
    const question = clean(b.question, 500);
    if (question.length < 3) throw new HttpError(400, 'Type your question first.');
    const context = clean(typeof b.context === 'string' ? b.context.slice(0, 60000) : '', 30000);
    if (context.length < 40) throw new HttpError(400, 'This file has no readable text (it may be scanned pictures), so Ask Altidian cannot read it.');
    const title = clean(b.title, 150);
    const history = (Array.isArray(b.history) ? b.history : []).slice(-3).filter((h) => h && typeof h.q === 'string' && typeof h.a === 'string');

    const messages = [];
    history.forEach((h, i) => {
      messages.push({ role: 'user', content: i === 0 ? wrap(title, context, clean(h.q, 500)) : clean(h.q, 500) });
      messages.push({ role: 'assistant', content: clean(h.a, 1500) || '...' });
    });
    messages.push({ role: 'user', content: history.length ? question : wrap(title, context, question) });

    const p = plan(u); const limit = limitFor(S, p);
    if (!(await AI.reserve(store, u.id, limit))) {
      if (p !== 'pass') return send(res, 429, { error: 'You have used your questions for today.', reason: 'upsell', plan: p, remaining: 0 });
      return send(res, 429, { error: 'You have used your ' + limit + ' questions for today. They come back tomorrow.', reason: 'limit', plan: p, remaining: 0 });
    }
    try {
      const out = await AI.complete({ system: AI.SYSTEM, messages, maxTokens: 700 });
      await AI.record(store, out.usage);
      const used = await AI.usedToday(store, u.id);
      send(res, 200, { answer: out.text, plan: p, limit, remaining: Math.max(0, limit - used) });
    } catch (e) {
      await AI.refund(store, u.id);
      if (e instanceof AI.AiError) {
        if (e.kind === 'busy') throw new HttpError(503, 'Ask Altidian is busy right now. Please try again in a minute.');
        throw new HttpError(503, 'Ask Altidian is not available right now. Please try again later.'); // the real reason is in the server log
      }
      throw e;
    }
  });

  // A thumbs up/down or a report on one answer. Only what the student chose to rate is saved.
  route('POST', '/api/ai/feedback', { limit: ['aifb', 200, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req); const b = ctx.body || {};
    if (busy(u.id, 'fb', 20, 10 * 60 * 1000)) throw new HttpError(429, 'Please wait a little before sending more feedback.');
    const rating = ['up', 'down', 'report'].includes(b.rating) ? b.rating : '';
    if (!rating) throw new HttpError(400, 'Choose a rating.');
    const answer = clean(b.answer, 1500); if (answer.length < 3) throw new HttpError(400, 'Nothing to rate.');
    await AI.addFeedback(store, { userId: u.id, username: u.username, file: H.str(b.file, 40), title: clean(b.title, 150), rating, question: clean(b.question, 500), answer, note: clean(b.note, 300) });
    send(res, 200, { ok: true });
  });

  /* ---------- admin ---------- */
  route('GET', '/api/admin/ai', { admin: true }, async (req, res) => {
    const S = await AI.settings(store); const m = await AI.monthSpend(store); const day = (await store.get('stats', AI.dayId())) || {};
    const users = day.users || {}; const fb = await AI.feedbackList(store);
    send(res, 200, {
      settings: { enabled: S.adminOn, passDaily: S.passDaily, buyerDaily: S.buyerDaily, freeDaily: S.freeDaily, capUsd: S.capUsd, paidNotes: S.paidNotes },
      keySet: S.keySet, killed: S.killed, running: S.enabled, model: AI.cfg().model,
      month: AI.monthId().slice(9), questions: m.calls || 0, tokensIn: m.tokensIn || 0, tokensOut: m.tokensOut || 0,
      spentUsd: Math.round((m.cost || 0) * 10000) / 10000, restingNow: (m.cost || 0) >= S.capUsd,
      today: { students: Object.keys(users).length, questions: Object.values(users).reduce((a, n) => a + n, 0) },
      feedback: { up: fb.filter((f) => f.rating === 'up').length, down: fb.filter((f) => f.rating === 'down').length, report: fb.filter((f) => f.rating === 'report').length,
        recent: fb.filter((f) => f.rating !== 'up').slice(0, 30).map((f) => ({ id: f.id, at: f.at, username: f.username, title: f.title, rating: f.rating, question: f.question, answer: f.answer, note: f.note })) },
    });
  });
  route('PUT', '/api/admin/ai', { admin: true }, async (req, res, ctx) => {
    try { await AI.saveSettings(store, ctx.body || {}); } catch (e) { if (e.status === 400) throw new HttpError(400, e.message); throw e; }
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/ai/feedback/:id', { admin: true }, async (req, res, ctx) => {
    const id = String(ctx.params[0] || ''); if (!/^aifb:[a-z0-9]+$/.test(id)) throw new HttpError(400, 'Bad id.');
    await store.del('stats', id); send(res, 200, { ok: true });
  });
};

function wrap(title, context, question) {
  return 'File: ' + (title || 'study note') + '\n<notes>\n' + context + '\n</notes>\n\nStudent question: ' + question;
}
