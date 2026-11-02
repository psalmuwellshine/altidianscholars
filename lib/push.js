'use strict';
/* Push notifications: who is subscribed, who should hear about what, and sending. */
const W = require('./webpush');
const H = require('./helpers');

const TYPES = ['notices', 'materials', 'events', 'daily']; // what a student can switch on or off
const DRY = process.env.PUSH_DRY_RUN === '1'; // tests: record messages instead of sending

module.exports = function createPush(store) {
  let vapidP = null; const outbox = [];
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@altidian.app';

  function vapid() {
    if (!vapidP) {
      vapidP = (async () => {
        if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
        let doc = await store.get('settings', 'vapid');
        if (!doc) { doc = Object.assign({ id: 'vapid' }, W.makeVapid()); await store.put('settings', doc); }
        return { publicKey: doc.publicKey, privateKey: doc.privateKey };
      })();
    }
    return vapidP;
  }
  const idFor = (endpoint) => H.sha(endpoint).slice(0, 32);
  const cleanPrefs = (p) => { const o = {}; TYPES.forEach((t) => { o[t] = !p || p[t] !== false; }); return o; };

  async function subscribe(uid, sub, prefs) {
    const doc = { id: idFor(sub.endpoint), uid, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, prefs: cleanPrefs(prefs), at: Date.now() };
    await store.put('push', doc);
    const mine = (await store.list('push')).filter((s) => s.uid === uid).sort((a, b) => b.at - a.at);
    for (const old of mine.slice(5)) await store.del('push', old.id); // at most 5 devices per student
    return doc;
  }
  const find = async (endpoint) => store.get('push', idFor(endpoint));
  const remove = async (endpoint) => store.del('push', idFor(endpoint));
  async function setPrefs(endpoint, prefs) {
    const s = await find(endpoint); if (!s) return null;
    s.prefs = cleanPrefs(prefs); await store.put('push', s); return s;
  }

  const inAudience = (u, a) => {
    if (!a) return true;
    if (a.uid) return u.id === a.uid;
    if (a.departmentIds && a.departmentIds.length && !a.departmentIds.includes(u.departmentId)) return false;
    if (a.level && Number(u.level) !== Number(a.level)) return false;
    return true;
  };

  /* audience: {} for everyone, or { departmentIds:[…], level } or { uid }. type: one of TYPES, or 'direct' (always sent). */
  async function notify({ audience, type, title, body, url }) {
    const [subs, users] = await Promise.all([store.list('push'), store.list('users')]);
    const byId = new Map(users.map((u) => [u.id, u]));
    const targets = subs.filter((s) => {
      const u = byId.get(s.uid);
      return u && !u.disabled && inAudience(u, audience) && (type === 'direct' || (s.prefs || {})[type] !== false);
    });
    const payload = JSON.stringify({ title: String(title).slice(0, 80), body: String(body || '').slice(0, 160), url: url || '/', tag: type || 'altidian' });
    let sent = 0; let gone = 0;
    if (DRY) { targets.forEach((s) => outbox.push({ uid: s.uid, payload: JSON.parse(payload), at: Date.now() })); if (outbox.length > 300) outbox.splice(0, outbox.length - 300); return { sent: targets.length, gone: 0, devices: targets.length }; }
    if (!targets.length) return { sent: 0, gone: 0, devices: 0 };
    const v = await vapid();
    for (let i = 0; i < targets.length; i += 20) {
      await Promise.all(targets.slice(i, i + 20).map(async (s) => {
        try {
          const code = await W.send(s, payload, { vapid: v, subject });
          if (code === 404 || code === 410) { gone++; await store.del('push', s.id); } else if (code >= 200 && code < 300) sent++;
        } catch (e) { /* network trouble: try again next time */ }
      }));
    }
    return { sent, gone, devices: targets.length };
  }
  // Fire and forget: a slow push service must never hold up a request.
  const later = (opts) => { notify(opts).catch((e) => console.error('push failed:', e.message)); };

  async function stats() {
    const [subs, users] = await Promise.all([store.list('push'), store.list('users')]);
    return { devices: subs.length, students: new Set(subs.map((s) => s.uid)).size, totalStudents: users.filter((u) => !u.disabled).length };
  }
  return { vapid, subscribe, find, remove, setPrefs, notify, later, stats, TYPES, outbox, dry: DRY, inAudience };
};
