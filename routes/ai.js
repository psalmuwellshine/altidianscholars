'use strict';
/* Ask Altidian: students ask a question about the note they are reading. The student's phone reads the page text
   (the viewer already has the PDF open); the server checks the student, the file, the daily limit and the monthly
   spending cap, then asks Claude. Students with a semester pass get more questions a day; everyone else gets a few
   free ones (the admin sets both numbers in Admin -> Ask Altidian). */
const H = require('../lib/helpers');
const D = require('../lib/domain');
const AI = require('../lib/ai');
const Units = require('../lib/units');

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

  // What a student can still ask: today's free allowance plus any units they bought. Units are used after the allowance.
  async function room(S, u) {
    const p = plan(u); const limit = limitFor(S, p); const used = await AI.usedToday(store, u.id);
    const remaining = Math.max(0, limit - used); const units = await Units.balance(store, u.id); const call = await Units.callSettings(store);
    return { plan: p, limit, remaining, units, left: remaining + units, passLimit: S.passDaily, buyerLimit: S.buyerDaily, callCost: call.callCost, callOn: call.callOn };
  }
  async function charge(S, u, limit) {
    if (await AI.reserve(store, u.id, limit)) return 'daily';
    if (await Units.spend(store, u.id, 1, 'Ask Altidian')) return 'unit';
    return '';
  }
  const uncharge = (how, uid) => (how === 'unit' ? Units.credit(store, uid, 1, 'Returned: the question did not run') : AI.refund(store, uid));
  const noRoom = (r) => ({ error: r.plan === 'pass' ? 'You have used your ' + r.limit + ' questions for today. Get units to keep going, or they come back tomorrow.' : 'You have used your questions for today.', reason: r.plan === 'pass' ? 'limit' : 'upsell', plan: r.plan, remaining: 0, units: 0, left: 0 });

  route('GET', '/api/ai/status', {}, async (req, res, ctx) => {
    const u = await need(req); const S = await AI.settings(store);
    const r = await room(S, u); const base = Object.assign(r, { packs: await Units.packs(store) });
    if (!S.enabled) return send(res, 200, Object.assign(base, { state: 'off' }));
    if (ctx.query.get('file') && await fileCheck(S, u, H.str(ctx.query.get('file') || '', 40))) return send(res, 200, Object.assign(base, { state: 'off' }));
    if ((await AI.monthSpend(store)).cost >= S.capUsd) return send(res, 200, Object.assign(base, { state: 'resting', message: 'Ask Altidian is resting until next month. Please check back soon.' }));
    if (r.left > 0) return send(res, 200, Object.assign(base, { state: 'ready' }));
    send(res, 200, Object.assign(base, r.plan !== 'pass' ? { state: 'upsell' } : { state: 'limit', message: 'You have used your ' + r.limit + ' questions for today. They come back tomorrow, or you can get units to keep going.' }));
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
    const how = await charge(S, u, limit);
    if (!how) return send(res, 429, noRoom(await room(S, u)));
    try {
      const out = await AI.complete({ system: AI.SYSTEM, messages, maxTokens: 700 });
      await AI.record(store, out.usage);
      send(res, 200, Object.assign({ answer: out.text }, await room(S, u)));
    } catch (e) {
      await uncharge(how, u.id);
      if (e instanceof AI.AiError) {
        if (e.kind === 'busy') throw new HttpError(503, 'Ask Altidian is busy right now. Please try again in a minute.');
        throw new HttpError(503, 'Ask Altidian is not available right now. Please try again later.'); // the real reason is in the server log
      }
      throw e;
    }
  });

  /* ---------- the Ask tab: learn a topic without opening a note ---------- */
  const STOP = new Set('what when where which about teach explain tell give make with from that this these those have does your their there then than into over some more most very just like also been were they them will would could should please topic course lecture notes study learn'.split(' '));
  async function related(text) {
    const words = Array.from(new Set(String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)))).slice(0, 8);
    if (!words.length) return [];
    const mats = (await store.list('materials')).filter((m) => !m.hidden && m.status !== 'pending');
    return mats.map((m) => { const hay = (m.title + ' ' + (m.course || '')).toLowerCase(); return { m, n: words.filter((w) => hay.includes(w)).length }; })
      .filter((x) => x.n >= Math.min(2, words.length)).sort((a, b) => b.n - a.n).slice(0, 3)
      .map((x) => ({ id: x.m.id, title: x.m.title, course: x.m.course || '', paid: !!x.m.paid }));
  }
  route('POST', '/api/ai/tutor', { limit: ['aitutor', 300, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const u = await need(req);
    if (busy(u.id, 'tutor', 20, 10 * 60 * 1000)) throw new HttpError(429, 'You are asking very fast. Please wait a few minutes and try again.');
    const S = await AI.settings(store); const b = ctx.body || {};
    if (!S.enabled) throw new HttpError(403, 'Ask Altidian is not switched on yet.');
    if ((await AI.monthSpend(store)).cost >= S.capUsd) throw new HttpError(503, 'Ask Altidian is resting until next month. Please check back soon.');
    const message = clean(b.message, 600);
    if (message.length < 2) throw new HttpError(400, 'Type your question or topic first.');
    const mode = b.mode === 'teach' ? 'teach' : b.mode === 'call' ? 'call' : 'ask'; const topic = clean(b.topic, 120); const course = clean(b.course, 24);
    const history = (Array.isArray(b.history) ? b.history : []).slice(-6).filter((h) => h && typeof h.q === 'string' && typeof h.a === 'string');
    const messages = [];
    history.forEach((h) => { messages.push({ role: 'user', content: clean(h.q, 600) }); messages.push({ role: 'assistant', content: clean(h.a, 2000) || '...' }); });
    messages.push({ role: 'user', content: mode === 'teach' && !history.length ? 'Teach me: ' + message : message });
    const system = AI.TUTOR + '\nMode: ' + (mode === 'teach' ? 'TEACH (lead the lesson step by step)' : mode === 'call' ? 'CALL (spoken conversation, teach by voice)' : 'ASK (answer the question, then offer to go deeper)') + '.'
      + (topic ? '\nThe student is studying: ' + topic + (course ? ' (' + course + ')' : '') + '.' : '');
    const p = plan(u); const limit = limitFor(S, p);
    // A voice call is paid for with units only. Everything else uses the free daily turns first.
    let how = ''; let paid = 1;
    if (mode === 'call') {
      const call = await Units.callSettings(store); paid = call.callCost;
      if (!call.callOn) throw new HttpError(403, 'Voice calls are switched off for now.');
      if (await Units.spend(store, u.id, paid, 'Voice call')) how = 'call';
      else { const r = await room(S, u); return send(res, 429, Object.assign({}, r, { error: 'A voice call uses ' + paid + ' unit' + (paid === 1 ? '' : 's') + ' for each reply, and you have ' + r.units + '. Get units to talk to Ask Altidian.', reason: 'units' })); }
    } else {
      how = await charge(S, u, limit);
      if (!how) return send(res, 429, noRoom(await room(S, u)));
    }
    try {
      const out = await AI.complete({ system, messages, maxTokens: mode === 'call' ? 320 : 800 });
      await AI.record(store, out.usage);
      send(res, 200, Object.assign({ answer: out.text, related: history.length || mode === 'call' ? [] : await related(topic + ' ' + message) }, await room(S, u)));
    } catch (e) {
      await uncharge(how, u.id);
      if (e instanceof AI.AiError) {
        if (e.kind === 'busy') throw new HttpError(503, 'Ask Altidian is busy right now. Please try again in a minute.');
        throw new HttpError(503, 'Ask Altidian is not available right now. Please try again later.');
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
  /* ---------- admin: units ---------- */
  route('GET', '/api/admin/units', { admin: true }, async (req, res, ctx) => {
    const name = H.str(ctx.query.get('username') || '', 60).trim().toLowerCase(); let found = null;
    if (name) {
      const user = (await store.list('users')).find((x) => String(x.username).toLowerCase() === name);
      if (!user) throw new HttpError(404, 'No student with that username.');
      const l = await Units.ledger(store, user.id); found = { username: user.username, balance: l.bal, bought: l.bought, log: l.log.slice(0, 12) };
    }
    const pays = (await store.list('payments')).filter((p) => p.kind === 'units').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const paid = pays.filter((p) => p.status === 'paid');
    send(res, 200, { packs: await Units.packs(store), call: await Units.callSettings(store), found,
      sold: { count: paid.length, units: paid.reduce((a, p) => a + (p.units || 0), 0), naira: paid.reduce((a, p) => a + (p.amount || 0), 0) },
      recent: pays.slice(0, 15).map((p) => ({ id: p.id, username: p.username, title: p.title, amount: p.amount, status: p.status, at: p.paidAt || p.createdAt || 0 })) });
  });
  route('PUT', '/api/admin/units', { admin: true }, async (req, res, ctx) => {
    try {
      const b = ctx.body || {}; const out = {};
      if (Array.isArray(b.packs)) out.packs = await Units.savePacks(store, b.packs);
      if (b.callCost !== undefined) Object.assign(out, await Units.saveCall(store, b));
      send(res, 200, out);
    } catch (e) { if (e.status === 400) throw new HttpError(400, e.message); throw e; }
  });
  route('POST', '/api/admin/units/grant', { admin: true }, async (req, res, ctx) => {
    const b = ctx.body || {}; const name = H.str(b.username || '', 60).trim().toLowerCase();
    const user = (await store.list('users')).find((x) => String(x.username).toLowerCase() === name);
    if (!user) throw new HttpError(404, 'No student with that username.');
    const n = Number(b.units); if (!Number.isInteger(n) || n < 1 || n > 5000) throw new HttpError(400, 'Units must be a whole number from 1 to 5000.');
    const out = await Units.credit(store, user.id, n, 'Added by admin' + (clean(b.note, 60) ? ': ' + clean(b.note, 60) : ''));
    send(res, 200, { ok: true, username: user.username, balance: out.bal });
  });
  route('DELETE', '/api/admin/ai/feedback/:id', { admin: true }, async (req, res, ctx) => {
    const id = String(ctx.params[0] || ''); if (!/^aifb:[a-z0-9]+$/.test(id)) throw new HttpError(400, 'Bad id.');
    await store.del('stats', id); send(res, 200, { ok: true });
  });
};

function wrap(title, context, question) {
  return 'File: ' + (title || 'study note') + '\n<notes>\n' + context + '\n</notes>\n\nStudent question: ' + question;
}
