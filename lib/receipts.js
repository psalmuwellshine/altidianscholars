'use strict';
/* Receipts: the code behind the "scan to verify" box, the list of what a pack contained, and the privacy mask on the public check. */
const crypto = require('crypto');

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, so a code is easy to read out or type
const CODE_RE = /^ALT-[0-9A-F]{8}-[A-Z2-9]{6}$/;
const MAX_ITEMS = 40;

// The receipt number plus six random characters. Random, so nobody can guess another student's receipt by counting up.
function makeCode(no) {
  const tail = Array.from(crypto.randomBytes(6)).map((b) => ALPHA[b % 32]).join('');
  const head = /^ALT-[0-9A-F]{8}$/.test(String(no || '')) ? no : 'ALT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  return head + '-' + tail;
}
const normaliseCode = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

// What a pack held, as it was on the day: title, course, kind and the price each item would have cost alone.
function packItems(materials, quizzes, ids) {
  const byId = new Map(materials.map((m) => [m.id, { m, quiz: false }]).concat(quizzes.map((q) => [q.id, { m: q, quiz: true }])));
  const items = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const hit = byId.get(id); if (!hit) continue;
    items.push({ title: String(hit.m.title || '').slice(0, 120), course: hit.m.course || '', kind: hit.quiz ? 'quiz' : (hit.m.kind || 'notes'), price: Number(hit.m.price) || 0 });
  }
  return { items: items.slice(0, MAX_ITEMS), count: items.length, value: items.reduce((n, x) => n + x.price, 0) };
}

// "samuel" -> "s••••l": enough for the owner to recognise, not enough to name them.
function maskName(name) {
  const s = String(name || '').trim(); if (!s) return '';
  if (s.length <= 2) return s[0] + '•';
  return s[0] + '•'.repeat(Math.min(5, s.length - 2)) + s[s.length - 1];
}

module.exports = { makeCode, normaliseCode, packItems, maskName, CODE_RE };
