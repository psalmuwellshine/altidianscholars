'use strict';
/* Units: extra Ask Altidian questions a student buys with a top-up. They never expire and are not refundable once used.
   Each student has one small record in the `stats` collection (id "units:<student id>") holding the balance and the last
   60 changes, so nothing else (the student's own record, their scores) is ever touched or can overwrite it.
   A question or a "Teach me" turn costs 1 unit. The daily allowance is used first, then units. */
const H = require('./helpers');

const DEFAULT_PACKS = [
  { id: 'u20', name: 'Small', units: 20, price: 200 },
  { id: 'u60', name: 'Standard', units: 60, price: 500 },
  { id: 'u150', name: 'Big', units: 150, price: 1000 },
];
const LOG_KEEP = 60;
const REF_KEEP = 300;

const chains = new Map();
// Changes to one student's units run one after another, so two taps at the same moment cannot spend the same unit twice.
function lock(id, fn) {
  const prev = chains.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  chains.set(id, tail);
  tail.then(() => { if (chains.get(id) === tail) chains.delete(id); });
  return next;
}
const docId = (uid) => 'units:' + uid;

async function balance(store, uid) {
  const d = await store.get('stats', docId(uid));
  return Math.max(0, Math.floor((d && d.bal) || 0));
}
async function ledger(store, uid) {
  const d = (await store.get('stats', docId(uid))) || {};
  return { bal: Math.max(0, Math.floor(d.bal || 0)), bought: d.bought || 0, log: (d.log || []).slice().reverse() };
}

// Takes n units if the student has them. Returns true when taken.
function spend(store, uid, n, why) {
  n = Math.max(1, Math.floor(n || 1));
  return lock(docId(uid), async () => {
    const d = await store.get('stats', docId(uid));
    if (!d || (d.bal || 0) < n) return false;
    d.bal -= n; d.spent = (d.spent || 0) + n;
    d.log = (d.log || []).concat([{ at: Date.now(), n: -n, why: why || 'Question', bal: d.bal }]).slice(-LOG_KEEP);
    await store.put('stats', d);
    return true;
  });
}

// Adds n units. If a ref (a payment reference) is given, the same ref is only ever credited once.
function credit(store, uid, n, why, ref, kind) {
  n = Math.max(1, Math.floor(n || 1));
  return lock(docId(uid), async () => {
    const d = (await store.get('stats', docId(uid))) || { id: docId(uid), bal: 0 };
    d.refs = d.refs || [];
    if (ref && d.refs.includes(ref)) return { added: false, bal: d.bal || 0 };
    d.bal = (d.bal || 0) + n;
    if (kind === 'bought') d.bought = (d.bought || 0) + n;
    if (ref) d.refs = d.refs.concat([ref]).slice(-REF_KEEP);
    d.log = (d.log || []).concat([{ at: Date.now(), n, why: why || 'Units added', bal: d.bal, ...(ref ? { ref } : {}) }]).slice(-LOG_KEEP);
    await store.put('stats', d);
    return { added: true, bal: d.bal };
  });
}

/* ---------- the packs the admin sells (saved in settings, with the three starting packs as the default) ---------- */
const okPack = (p) => p && /^u[a-z0-9]{1,12}$/.test(p.id) && Number.isInteger(p.units) && p.units >= 1 && p.units <= 10000 && Number.isInteger(p.price) && p.price >= 50 && p.price <= 500000 && typeof p.name === 'string' && p.name.length >= 1;
async function packs(store) {
  const s = await store.get('settings', 'units');
  const list = s && Array.isArray(s.packs) ? s.packs.filter(okPack) : null;
  return (list && list.length ? list : DEFAULT_PACKS).map((p) => ({ id: p.id, name: p.name, units: p.units, price: p.price }));
}
/* Voice calls are paid for with units only (the free daily turns do not cover them). The admin sets the price per reply and can switch calls off. */
async function callSettings(store) {
  const s = (await store.get('settings', 'units')) || {};
  const cost = Number.isInteger(s.callCost) && s.callCost >= 1 && s.callCost <= 20 ? s.callCost : 2;
  return { callCost: cost, callOn: s.callOn !== false };
}
async function saveCall(store, input) {
  const bad = (m) => { const e = new Error(m); e.status = 400; return e; };
  const cost = Number(input && input.callCost);
  if (!Number.isInteger(cost) || cost < 1 || cost > 20) throw bad('Units per call reply must be a whole number from 1 to 20.');
  const s = (await store.get('settings', 'units')) || { id: 'units' };
  s.callCost = cost; s.callOn = !!(input && input.callOn); s.id = 'units';
  await store.put('settings', s);
  return { callCost: cost, callOn: s.callOn };
}
async function savePacks(store, input) {
  const bad = (m) => { const e = new Error(m); e.status = 400; return e; };
  if (!Array.isArray(input) || input.length < 1 || input.length > 6) throw bad('Add from 1 to 6 packs.');
  const out = []; const seen = new Set();
  for (const raw of input) {
    const name = H.clean(raw && raw.name, 30);
    const units = Number(raw && raw.units); const price = Number(raw && raw.price);
    if (!name) throw bad('Each pack needs a name.');
    if (!Number.isInteger(units) || units < 1 || units > 10000) throw bad('Units in a pack must be a whole number from 1 to 10,000.');
    if (!Number.isInteger(price) || price < 50 || price > 500000) throw bad('A pack price must be a whole number of naira from 50 to 500,000.');
    let id = raw && typeof raw.id === 'string' && /^u[a-z0-9]{1,12}$/.test(raw.id) ? raw.id : 'u' + H.newId().replace(/[^a-z0-9]/gi, '').slice(0, 7).toLowerCase();
    while (seen.has(id)) id = 'u' + H.newId().replace(/[^a-z0-9]/gi, '').slice(0, 7).toLowerCase();
    seen.add(id); out.push({ id, name, units, price });
  }
  const cur = (await store.get('settings', 'units')) || {};
  await store.put('settings', Object.assign({}, cur, { id: 'units', packs: out }));
  return out;
}

module.exports = { balance, ledger, spend, credit, packs, savePacks, callSettings, saveCall, DEFAULT_PACKS };
