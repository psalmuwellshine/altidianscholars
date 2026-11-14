'use strict';
/* Online payments (Paystack): start a payment, the page Paystack sends the student back to, the webhook, and the admin list. */
const H = require('../lib/helpers');
const D = require('../lib/domain');
const P = require('../lib/paystack');

const { HttpError, clean, newId } = H;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = function registerPaystack({ route, store, send, userOf, push }) {
  const A = { admin: true };
  const ctx = { store, push };

  route('POST', '/api/pay/start', { limit: ['paystart', 20, 15 * 60 * 1000] }, async (req, res, c) => {
    const user = await userOf(req);
    if (!user) throw new HttpError(401, 'Please log in first.');
    const cfg = await D.loadConfig(store);
    if (!P.enabled(cfg)) throw new HttpError(400, 'Online payment is not switched on yet. Please pay by bank transfer.');
    const b = c.body; const kind = b.kind === 'pass' ? 'pass' : 'item';
    const email = clean(b.email, 120).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address. Your receipt is sent there.');
    let amount; let title; let itemId = ''; let until = '';
    if (kind === 'pass') {
      amount = Math.round(Number(cfg.passPrice)); until = cfg.passEnds || '';
      if (!(amount > 0) || !until || until < D.lagosDate()) throw new HttpError(400, 'The semester pass is not on sale right now.');
      if (user.paidUntil && user.paidUntil >= until) throw new HttpError(400, 'You already have a semester pass.');
      title = 'Semester pass';
    } else {
      const id = H.okId(b.itemId) ? String(b.itemId) : '';
      const item = id && ((await store.get('materials', id)) || (await store.get('quizzes', id)));
      if (!item || !item.paid || item.hidden) throw new HttpError(404, 'That item was not found.');
      amount = Math.round(Number(item.price)); title = item.title; itemId = item.id;
      if (!(amount > 0)) throw new HttpError(400, 'This item has no price yet. Please contact an admin.');
      if (D.hasAccess(user, item)) throw new HttpError(400, 'You already have access to this.');
    }
    const reference = 'ALT' + Date.now().toString(36).toUpperCase() + newId().slice(0, 6).toUpperCase();
    const pay = { id: reference, userId: user.id, username: user.username, kind, itemId, title, amount, until, email, status: 'pending', createdAt: Date.now() };
    await store.put('payments', pay);
    let init;
    try {
      init = await P.api('POST', '/transaction/initialize', {
        email, amount: amount * 100, currency: 'NGN', reference, channels: ['card', 'bank', 'bank_transfer', 'ussd', 'qr', 'mobile_money'], callback_url: P.SITE() + '/pay/return',
        metadata: { username: user.username, kind, itemId, title, custom_fields: [{ display_name: 'Username', variable_name: 'username', value: user.username }, { display_name: 'Item', variable_name: 'item', value: title }] },
      });
    } catch (e) { pay.status = 'failed'; pay.note = 'Could not start'; await store.put('payments', pay); throw e; }
    const url = init.data && init.data.authorization_url;
    if (!url || !/^https:\/\/|^http:\/\/localhost/.test(url)) throw new HttpError(502, 'The payment service did not give a payment page. Please try again.');
    send(res, 200, { url, reference });
  });

  // The student's own recent payment attempts, so they can confirm one that paid but did not unlock.
  route('GET', '/api/pay/mine', {}, async (req, res) => {
    const user = await userOf(req);
    if (!user) throw new HttpError(401, 'Please log in first.');
    const since = Date.now() - 30 * 86400000;
    const mine = (await store.list('payments')).filter((p) => p.userId === user.id && (p.createdAt || 0) >= since).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
    send(res, 200, { payments: mine.map((p) => ({ id: p.id, title: p.title, amount: p.amount, status: p.status, createdAt: p.createdAt })) });
  });

  // "I have paid" button: checks one of the student's own payments with Paystack and unlocks it if Paystack says it was paid.
  route('POST', '/api/pay/confirm', { limit: ['payconfirm', 20, 15 * 60 * 1000] }, async (req, res, c) => {
    const user = await userOf(req);
    if (!user) throw new HttpError(401, 'Please log in first.');
    if (!P.keyPresent()) throw new HttpError(400, 'Online payment is not set up.');
    const ref = clean(c.body.reference, 80).replace(/\s+/g, '').toUpperCase();
    const p = ref && (await store.get('payments', ref));
    if (!p || p.userId !== user.id) throw new HttpError(404, 'We could not find a payment with that reference on your account. Check it and try again.');
    const r = await P.settle(ctx, ref);
    const state = r.state === 'unknown' ? 'failed' : r.state;
    const message = state === 'ok' ? 'Payment confirmed. ' + p.title + ' is now unlocked.'
      : state === 'pending' ? 'Paystack has not confirmed this payment yet. Bank transfers can take a few minutes. Try again shortly.'
      : 'Paystack did not confirm this payment. If your bank shows that money left your account, contact support with the reference ' + ref + '.';
    send(res, 200, { state, message });
  });

  // Paystack sends the student back here after paying. We confirm the payment, then open the app on the result page.
  route('GET', '/pay/return', {}, async (req, res, c) => {
    const ref = String(c.query.get('reference') || c.query.get('trxref') || '').slice(0, 80);
    let state = 'unknown';
    try { state = (await P.settle(ctx, ref)).state; } catch (e) { console.error('[paystack] return failed', e.message); state = 'pending'; }
    res.writeHead(302, { Location: P.SITE() + '/#/paid?s=' + state + '&ref=' + encodeURIComponent(ref), 'Cache-Control': 'no-store' });
    res.end();
  });

  // Paystack tells us about every payment, even if the student closed the page. The body is checked against the signature first.
  route('POST', '/api/paystack/webhook', { raw: true }, async (req, res, c) => {
    if (!P.signatureOk(c.raw, req.headers['x-paystack-signature'])) throw new HttpError(401, 'Bad signature.');
    let ev = {}; try { ev = JSON.parse(c.raw.toString('utf8')); } catch (e) { throw new HttpError(400, 'Bad request.'); }
    if (ev && ev.event === 'charge.success' && ev.data && ev.data.reference) { try { await P.settle(ctx, String(ev.data.reference)); } catch (e) { console.error('[paystack] webhook', e.message); } }
    send(res, 200, { ok: true });
  });

  // ----- admin -----
  route('GET', '/api/admin/paystack', A, async (req, res) => {
    send(res, 200, { keyPresent: P.keyPresent(), mode: P.keyPresent() ? P.mode() : '', webhookUrl: P.SITE() + '/api/paystack/webhook' });
  });
  route('GET', '/api/admin/payments', A, async (req, res) => {
    const list = (await store.list('payments')).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 300);
    send(res, 200, { payments: list.map((p) => ({ id: p.id, username: p.username, kind: p.kind, title: p.title, amount: p.amount, status: p.status, createdAt: p.createdAt, paidAt: p.paidAt || 0, channel: p.channel || '', note: p.note || '' })) });
  });
  // Re-check one payment with Paystack (for a payment that shows "pending" although the student says they paid).
  route('POST', '/api/admin/payments/:id/check', A, async (req, res, c) => {
    const p = await store.get('payments', c.params[0]);
    if (!p) throw new HttpError(404, 'Payment not found.');
    const r = await P.settle(ctx, p.id);
    send(res, 200, { state: r.state });
  });
};
