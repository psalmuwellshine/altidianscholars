'use strict';
/* Chat rooms: who may enter which room, how messages are kept, and the live connections. */
const H = require('./helpers');

const ROOM_RE = /^(general|dept-[a-f0-9]{16}|class-[a-f0-9]{16}-[1-6]00|custom-[a-f0-9]{16})$/;
const KEEP = 300; // newest messages kept per room
const MAX_LEN = 600;

// Every room that exists, for admins. Students get the subset from roomsFor().
function allRooms(acad, customs) {
  const rooms = [{ id: 'general', name: 'General', desc: 'Everyone on Altidian', kind: 'general', readOnly: false }];
  customs.forEach((c) => rooms.push({ id: 'custom-' + c.id, name: c.name, desc: c.description || '', kind: 'custom', readOnly: !!c.readOnly, customId: c.id }));
  acad.departments.forEach((d) => {
    rooms.push({ id: 'dept-' + d.id, name: d.name, desc: 'All levels', kind: 'dept', readOnly: false });
    for (let l = 100; l <= (d.maxLevel || 600); l += 100) rooms.push({ id: `class-${d.id}-${l}`, name: `${d.name} · ${l} level`, desc: 'Your class', kind: 'class', readOnly: false });
  });
  return rooms;
}
function roomsFor(user, acad, customs) {
  const all = allRooms(acad, customs);
  return all.filter((r) => r.kind === 'general' || r.kind === 'custom'
    || (r.kind === 'dept' && user.departmentId && r.id === 'dept-' + user.departmentId)
    || (r.kind === 'class' && user.departmentId && user.level && r.id === `class-${user.departmentId}-${user.level}`));
}

const clientMsg = (m, users, withReports) => {
  const u = users && users.get(m.uid);
  const out = {
    id: m.id, uid: m.uid, name: m.admin ? m.name : (u ? u.username : (m.name || 'Former student')),
    avatar: m.admin ? '' : (u ? u.avatarId || '' : ''), text: m.text, at: m.at, admin: !!m.admin,
  };
  if (withReports) out.reports = (m.reports || []).length;
  return out;
};

function createChat(store) {
  const locks = new Map();
  const subs = new Map(); // room -> Set of { res, uid }
  const lastSent = new Map(); // uid -> { times: [], text, at }

  function mutate(room, fn) {
    const prev = locks.get(room) || Promise.resolve();
    const run = prev.then(async () => {
      const doc = (await store.get('chat', room)) || { id: room, messages: [] };
      const r = await fn(doc);
      await store.put('chat', doc);
      return r;
    });
    locks.set(room, run.catch(() => {}));
    return run;
  }
  const read = async (room) => ((await store.get('chat', room)) || { messages: [] }).messages;

  function broadcast(room, event, data) {
    const set = subs.get(room); if (!set) return;
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const s of set) { try { s.res.write(line); } catch (e) { /* closed */ } }
  }
  const online = (room) => { const set = subs.get(room); return set ? new Set([...set].map((s) => s.uid)).size : 0; };
  function subscribe(room, res, uid) {
    let set = subs.get(room); if (!set) { set = new Set(); subs.set(room, set); }
    const mine = [...set].filter((s) => s.uid === uid);
    if (mine.length >= 4) { try { mine[0].res.end(); } catch (e) { /* ignore */ } set.delete(mine[0]); }
    const entry = { res, uid }; set.add(entry);
    broadcast(room, 'presence', { online: online(room) });
    return () => { set.delete(entry); if (!set.size) subs.delete(room); else broadcast(room, 'presence', { online: online(room) }); };
  }

  // Slows down floods: one message per second, 25 a minute, and no repeating the same text.
  function checkRate(uid, text) {
    const now = Date.now(); const s = lastSent.get(uid) || { times: [], text: '', at: 0 };
    s.times = s.times.filter((t) => now - t < 60000);
    if (s.times.length && now - s.times[s.times.length - 1] < 1000) throw new H.HttpError(429, 'Slow down a little.');
    if (s.times.length >= 25) throw new H.HttpError(429, 'You are sending too fast. Wait a moment.');
    if (s.text === text && now - s.at < 30000) throw new H.HttpError(429, 'You already sent that.');
    s.times.push(now); s.text = text; s.at = now; lastSent.set(uid, s);
  }
  setInterval(() => { const n = Date.now(); for (const [k, v] of lastSent) if (n - v.at > 120000) lastSent.delete(k); }, 60000).unref();

  async function post(room, msg) {
    return mutate(room, (doc) => { doc.messages.push(msg); if (doc.messages.length > KEEP) doc.messages = doc.messages.slice(-KEEP); return msg; });
  }
  const cleanText = (t) => H.clean(t, MAX_LEN).replace(/\n{3,}/g, '\n\n');

  return { mutate, read, broadcast, online, subscribe, checkRate, post, cleanText, subs };
}

module.exports = { ROOM_RE, KEEP, MAX_LEN, allRooms, roomsFor, clientMsg, createChat };
