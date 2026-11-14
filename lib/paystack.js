'use strict';
/* Card and online payments through Paystack. The secret key lives only in the server's settings (PAYSTACK_SECRET_KEY),
   never in the code or in the browser. Every payment is checked with Paystack before anything is unlocked. */
const crypto = require('crypto');
const H = require('./helpers');
const D = require('./domain');

const KEY = () => process.env.PAYSTACK_SECRET_KEY || '';
const BASE = () => (process.env.PAYSTACK_API || 'https://api.paystack.co').replace(/\/+$/, '');
const SITE = () => (process.env.CANONICAL_URL || 'https://www.altidian.com.ng').replace(/\/+$/, '');
const keyPresent = () => /^sk_(test|live)_\w+/.test(KEY());
const mode = () => (KEY().startsWith('sk_live_') ? 'live' : 'test');
const enabled = (cfg) => !!(cfg && cfg.paystackOn && keyPresent());

async function api(method, path, body) {
  let r; let j = {};
  try {
    r = await fetch(BASE() + path, { method, headers: { Authorization: 'Bearer ' + KEY(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    try { j = await r.json(); } catch (e) { j = {}; }
  } catch (e) { throw new H.HttpError(502, 'Could not reach the payment service. Please try again in a moment.'); }
  if (!r.ok || j.status === false) { console.error('[paystack] ' + method + ' ' + path + ' -> ' + r.status + ' ' + (j.message || '')); throw new H.HttpError(502, 'The payment service could not start this payment. Please try again, or pay by bank transfer.'); }
  return j;
}

// Paystack signs every webhook with the secret key (HMAC SHA-512 of the raw body).
function signatureOk(raw, header) {
  if (!keyPresent() || !header || !Buffer.isBuffer(raw)) return false;
  const want = crypto.createHmac('sha512', KEY()).update(raw).digest('hex');
  const got = String(header).trim().toLowerCase();
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function grant(store, push, p) {
  const user = await store.get('users', p.userId);
  if (!user) return;
  const now = Date.now(); const no = 'ALT-' + H.sha(H.newId() + now).slice(0, 8).toUpperCase();
  user.receipts = Array.isArray(user.receipts) ? user.receipts : [];
  let title;
  if (p.kind === 'pass') {
    title = 'Semester pass';
    if (p.until && (!user.paidUntil || p.until > user.paidUntil)) user.paidUntil = p.until;
    user.receipts.push({ id: H.newId(), no, kind: 'pass', title, amount: p.amount, until: p.until, at: now, via: 'online', pref: p.id, channel: p.channel || '' });
  } else {
    title = p.title || 'Paid item';
    user.unlocked = Array.from(new Set((Array.isArray(user.unlocked) ? user.unlocked : []).concat([p.itemId])));
    user.receipts.push({ id: H.newId(), no, kind: 'item', ref: p.itemId, title, amount: p.amount, at: now, via: 'online', pref: p.id, channel: p.channel || '' });
  }
  user.receipts = user.receipts.slice(-100);
  await store.put('users', user);
  try { push.later({ audience: { uid: user.id }, type: 'direct', title: 'Payment received', body: title + ' is now unlocked.', url: '/#/receipts' }); } catch (e) { /* a missing notification must never undo a payment */ }
}

const inflight = new Map();
// Confirms a payment with Paystack and unlocks it, once. Safe to call again and again (return page and webhook both call it).
function settle(ctx, reference) {
  if (inflight.has(reference)) return inflight.get(reference);
  const run = (async () => {
    const { store, push } = ctx;
    const p = reference ? await store.get('payments', reference) : null;
    if (!p) return { state: 'unknown' };
    if (p.status === 'paid') return { state: 'ok', payment: p };
    let v;
    try { v = await api('GET', '/transaction/verify/' + encodeURIComponent(reference)); } catch (e) { return { state: 'pending', payment: p }; }
    const d = v.data || {};
    if (d.status === 'success') {
      if (String(d.reference) !== reference || Number(d.amount) < p.amount * 100 || String(d.currency || 'NGN').toUpperCase() !== 'NGN') {
        p.status = 'mismatch'; p.note = 'Paystack reported ' + d.amount + ' ' + d.currency; await store.put('payments', p);
        console.error('[paystack] amount mismatch for ' + reference);
        return { state: 'failed', payment: p };
      }
      p.status = 'paid'; p.paidAt = Date.now(); p.channel = d.channel || ''; await store.put('payments', p);
      await grant(store, push, p);
      return { state: 'ok', payment: p };
    }
    if (d.status === 'failed' || d.status === 'reversed') {
      if (p.status === 'pending') { p.status = 'failed'; await store.put('payments', p); }
      return { state: 'failed', payment: p };
    }
    if (d.status === 'abandoned') { // not finished yet, or a bank transfer Paystack has not seen arrive. The webhook can still unlock it later.
      if (p.status === 'pending') { p.status = 'cancelled'; await store.put('payments', p); }
      return { state: 'pending', payment: p };
    }
    return { state: 'pending', payment: p };
  })().finally(() => inflight.delete(reference));
  inflight.set(reference, run);
  return run;
}

module.exports = { api, enabled, keyPresent, mode, signatureOk, settle, SITE };
