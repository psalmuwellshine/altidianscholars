'use strict';
/* Chat room API for students (live, with Server-Sent Events) and for admins (moderation). */
const H = require('../lib/helpers');
const D = require('../lib/domain');
const Ac = require('../lib/academics');
const C = require('../lib/chat');

const { HttpError, clean, newId, bool } = H;

module.exports = function registerChat({ route, store, send, userOf, push }) {
  const chat = C.createChat(store);

  const state = async () => {
    const [config, acad, customs] = await Promise.all([D.loadConfig(store), Ac.loadAcademics(store), store.list('chatrooms')]);
    return { config, acad, customs: customs.sort((a, b) => String(a.name).localeCompare(String(b.name))) };
  };
  const usersMap = async () => new Map((await store.list('users')).map((u) => [u.id, u]));

  const pubUser = (u) => ({ id: u.id, name: u.username, avatar: u.avatarId || '' });
  const blocked = (a, b) => (a.blocks || []).includes(b.id) || (b.blocks || []).includes(a.id);

  // Loads the signed-in student and checks they may use this room.
  async function gate(req, roomId) {
    const user = await userOf(req);
    if (!user) throw new HttpError(401, 'Please log in to chat.');
    const st = await state();
    if (!st.config.chatEnabled) throw new HttpError(403, 'Chat is switched off right now.');
    if (roomId === undefined) return { user, st };
    if (!C.ROOM_RE.test(String(roomId))) throw new HttpError(404, 'That room does not exist.');
    if (String(roomId).startsWith('dm-')) {
      if (st.config.dmEnabled === false) throw new HttpError(403, 'Personal messages are switched off right now.');
      const [a, b] = C.dmParts(roomId);
      if (a === b || (user.id !== a && user.id !== b)) throw new HttpError(403, 'You do not have access to that chat.');
      const other = await store.get('users', user.id === a ? b : a);
      if (!other) throw new HttpError(404, 'That student no longer exists.');
      const room = { id: roomId, name: other.username, kind: 'dm', desc: 'Personal chat', readOnly: false, other: pubUser(other) };
      return { user, st, room, other };
    }
    const room = C.roomsFor(user, st.acad, st.customs).find((r) => r.id === roomId);
    if (!room) throw new HttpError(403, 'You do not have access to that room.');
    return { user, st, room };
  }
  // For personal chats: may this person post right now? Returns a reason when not.
  const dmBlock = (user, other) => {
    if ((user.blocks || []).includes(other.id)) return 'You blocked this student. Unblock to send messages.';
    if ((other.blocks || []).includes(user.id)) return 'You cannot message this student.';
    if (other.dmOff) return 'This student is not taking personal messages.';
    return '';
  };

  /* ---------- students ---------- */
  route('GET', '/api/chat/rooms', {}, async (req, res) => {
    const { user, st } = await gate(req);
    const users = await usersMap();
    const rooms = C.roomsFor(user, st.acad, st.customs);
    const out = [];
    for (const r of rooms) {
      const msgs = await chat.read(r.id); const last = msgs[msgs.length - 1];
      out.push(Object.assign({}, r, { online: chat.online(r.id), last: last ? { name: C.clientMsg(last, users).name, text: last.text.slice(0, 90), at: last.at, uid: last.uid } : null }));
    }
    const dmEnabled = st.config.dmEnabled !== false;
    const dms = [];
    if (dmEnabled) {
      for (const d of await store.list('chat')) {
        if (!String(d.id).startsWith('dm-') || !C.ROOM_RE.test(d.id)) continue;
        const [a, b] = C.dmParts(d.id);
        if (a !== user.id && b !== user.id) continue;
        const other = users.get(a === user.id ? b : a); if (!other || !d.messages.length) continue;
        const last = d.messages[d.messages.length - 1];
        dms.push({ id: d.id, other: pubUser(other), online: chat.online(d.id) > 1, last: { text: last.text.slice(0, 90), at: last.at, mine: last.uid === user.id } });
      }
      dms.sort((x, y) => y.last.at - x.last.at);
    }
    send(res, 200, { rooms: out, dms, dmEnabled, dmOff: !!user.dmOff, muted: !!user.chatMuted, me: user.id });
  });

  // Search students by username to start a personal chat.
  route('GET', '/api/chat/find', { limit: ['chatfind', 60, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, st } = await gate(req);
    if (st.config.dmEnabled === false) throw new HttpError(403, 'Personal messages are switched off right now.');
    const q = clean(ctx.query.get('q'), 30).toLowerCase();
    if (q.length < 2) return send(res, 200, { users: [] });
    const found = (await store.list('users')).filter((u) => u.id !== user.id && String(u.username).toLowerCase().includes(q) && !(u.blocks || []).includes(user.id))
      .sort((a, b) => String(a.username).localeCompare(String(b.username))).slice(0, 8).map(pubUser);
    send(res, 200, { users: found });
  });
  route('GET', '/api/chat/user', {}, async (req, res, ctx) => {
    const { user, st } = await gate(req);
    if (st.config.dmEnabled === false) throw new HttpError(403, 'Personal messages are switched off right now.');
    const id = String(ctx.query.get('id') || '');
    const other = /^[a-f0-9]{16}$/.test(id) && id !== user.id ? await store.get('users', id) : null;
    if (!other) throw new HttpError(404, 'That student was not found.');
    send(res, 200, { room: C.dmId(user.id, other.id), other: pubUser(other) });
  });
  route('POST', '/api/chat/block', {}, async (req, res, ctx) => {
    const { user } = await gate(req);
    const id = String(ctx.body.uid || '');
    if (!/^[a-f0-9]{16}$/.test(id) || id === user.id) throw new HttpError(400, 'Not a valid student.');
    const set = new Set(user.blocks || []);
    if (bool(ctx.body.blocked)) set.add(id); else set.delete(id);
    user.blocks = [...set].slice(0, 200); await store.put('users', user);
    send(res, 200, { ok: true, blocked: set.has(id) });
  });
  route('POST', '/api/chat/dm-settings', {}, async (req, res, ctx) => {
    const { user } = await gate(req);
    user.dmOff = !bool(ctx.body.allow); await store.put('users', user);
    send(res, 200, { ok: true, dmOff: user.dmOff });
  });

  route('GET', '/api/chat/messages', { limit: ['chatread', 1500, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, room, other } = await gate(req, ctx.query.get('room'));
    const after = Number(ctx.query.get('after')) || 0;
    let msgs = await chat.read(room.id);
    msgs = after ? msgs.filter((m) => m.at > after).slice(0, 100) : msgs.slice(-80);
    const users = await usersMap();
    send(res, 200, {
      room, messages: msgs.map((m) => C.clientMsg(m, users)), online: chat.online(room.id),
      canPost: !user.chatMuted && !room.readOnly && !(other && dmBlock(user, other)), blockedMsg: other ? dmBlock(user, other) : '',
      iBlocked: !!(other && (user.blocks || []).includes(other.id)), muted: !!user.chatMuted, me: user.id,
    });
  });

  const pushTimes = new Map(); // sender>recipient -> last push time
  route('POST', '/api/chat/send', { limit: ['chatsend', 600, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, room, other } = await gate(req, ctx.body.room);
    if (user.chatMuted) throw new HttpError(403, 'An admin has muted you in chat.');
    if (room.readOnly) throw new HttpError(403, 'Only admins can post in this room.');
    if (other) { const why = dmBlock(user, other); if (why) throw new HttpError(403, why); }
    const text = chat.cleanText(ctx.body.text);
    if (!text) throw new HttpError(400, 'Type a message first.');
    chat.checkRate(user.id, text);
    const msg = { id: newId(), uid: user.id, text, at: Date.now() };
    const replyTo = String(ctx.body.replyTo || '');
    if (replyTo) {
      const users = await usersMap();
      const orig = (await chat.read(room.id)).find((x) => x.id === replyTo);
      if (orig) msg.reply = { id: orig.id, uid: orig.uid, name: C.clientMsg(orig, users).name, text: String(orig.text).slice(0, 120) };
    }
    await chat.post(room.id, msg);
    const out = C.clientMsg(msg, new Map([[user.id, user]]));
    chat.broadcast(room.id, 'message', out);
    if (other && push && chat.online(room.id) < 2) {
      const key = user.id + '>' + other.id; const now = Date.now();
      if (now - (pushTimes.get(key) || 0) > 5 * 60 * 1000) {
        pushTimes.set(key, now);
        Promise.resolve(push.notify({ audience: { uid: other.id }, type: 'messages', title: user.username, body: text.slice(0, 100), url: '/#/chat/dm/' + user.id })).catch(() => {});
      }
    }
    send(res, 200, { ok: true, message: out });
  });

  // One reaction per student per message; tapping the same emoji again removes it.
  route('POST', '/api/chat/react', { limit: ['chatreact', 400, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, room, other } = await gate(req, ctx.body.room);
    if (other && dmBlock(user, other)) throw new HttpError(403, 'You cannot react in this chat.');
    const id = String(ctx.body.id || ''); const emoji = String(ctx.body.emoji || '');
    if (!C.REACTIONS.includes(emoji)) throw new HttpError(400, 'That reaction is not available.');
    const reactions = await chat.mutate(room.id, (doc) => {
      const m = doc.messages.find((x) => x.id === id); if (!m) return null;
      const r = m.reactions || {}; const had = (r[emoji] || []).includes(user.id);
      for (const k of Object.keys(r)) { r[k] = r[k].filter((u) => u !== user.id); if (!r[k].length) delete r[k]; }
      if (!had) { r[emoji] = (r[emoji] || []).concat(user.id); }
      if (Object.keys(r).length) m.reactions = r; else delete m.reactions;
      return m.reactions || {};
    });
    if (reactions === null) throw new HttpError(404, 'That message is not available.');
    chat.broadcast(room.id, 'reaction', { id, reactions });
    send(res, 200, { ok: true, reactions });
  });

  route('POST', '/api/chat/delete', {}, async (req, res, ctx) => {
    const { user, room } = await gate(req, ctx.body.room);
    const id = String(ctx.body.id || '');
    const removed = await chat.mutate(room.id, (doc) => {
      const m = doc.messages.find((x) => x.id === id);
      if (!m || m.uid !== user.id) return false;
      doc.messages = doc.messages.filter((x) => x.id !== id); return true;
    });
    if (!removed) throw new HttpError(404, 'You can only delete your own messages.');
    chat.broadcast(room.id, 'delete', { id });
    send(res, 200, { ok: true });
  });

  route('POST', '/api/chat/report', { limit: ['chatreport', 60, 60 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, room } = await gate(req, ctx.body.room);
    const id = String(ctx.body.id || '');
    const done = await chat.mutate(room.id, (doc) => {
      const m = doc.messages.find((x) => x.id === id);
      if (!m || m.uid === user.id || m.admin) return false;
      m.reports = m.reports || []; if (!m.reports.includes(user.id)) m.reports.push(user.id); return true;
    });
    if (!done) throw new HttpError(404, 'That message is not available.');
    send(res, 200, { ok: true });
  });

  // Live updates: the browser keeps this connection open and we push new messages down it.
  route('GET', '/api/chat/stream', {}, async (req, res, ctx) => {
    const { user, room } = await gate(req, ctx.query.get('room'));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff',
    });
    res.write('retry: 3000\n\n');
    const leave = chat.subscribe(room.id, res, user.id);
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* closed */ } }, 25000);
    req.on('close', () => { clearInterval(beat); leave(); });
  });

  /* ---------- admins ---------- */
  const A = { admin: true };
  const adminName = (st) => st.config.siteName + ' admin';

  route('GET', '/api/admin/chat/rooms', A, async (req, res) => {
    const st = await state();
    const out = [];
    for (const r of C.allRooms(st.acad, st.customs)) {
      const msgs = await chat.read(r.id);
      out.push(Object.assign({}, r, { count: msgs.length, reported: msgs.filter((m) => (m.reports || []).length).length, online: chat.online(r.id), lastAt: msgs.length ? msgs[msgs.length - 1].at : 0 }));
    }
    const rep = await dmReports();
    out.push({ id: 'dm-reports', name: 'Reported personal messages', desc: 'Only reported messages are shown here', kind: 'dmreports', readOnly: true, count: rep.length, reported: rep.length, online: 0, lastAt: rep.length ? rep[rep.length - 1].at : 0 });
    send(res, 200, { rooms: out, muted: (await store.list('users')).filter((u) => u.chatMuted).map((u) => ({ id: u.id, username: u.username })) });
  });
  // Personal chats are private. Admins only see messages that a student reported.
  async function dmReports() {
    const users = await usersMap(); const out = [];
    for (const d of await store.list('chat')) {
      if (!String(d.id).startsWith('dm-')) continue;
      for (const m of d.messages) if ((m.reports || []).length) out.push(Object.assign(C.clientMsg(m, users, true), { room: d.id }));
    }
    return out.sort((a, b) => a.at - b.at);
  }
  const adminRoom = async (id) => {
    if (String(id).startsWith('dm-') && C.ROOM_RE.test(String(id))) return { room: { id }, st: await state() };
    if (!C.ROOM_RE.test(String(id))) throw new HttpError(404, 'That room does not exist.');
    const st = await state();
    const room = C.allRooms(st.acad, st.customs).find((r) => r.id === id);
    if (!room) throw new HttpError(404, 'That room does not exist.');
    return { room, st };
  };
  route('GET', '/api/admin/chat/messages', A, async (req, res, ctx) => {
    if (ctx.query.get('room') === 'dm-reports') {
      return send(res, 200, { room: { id: 'dm-reports', name: 'Reported personal messages', kind: 'dmreports', readOnly: true }, messages: (await dmReports()).slice(-150), online: 0 });
    }
    const { room } = await adminRoom(ctx.query.get('room'));
    const users = await usersMap();
    send(res, 200, { room, messages: (await chat.read(room.id)).slice(-150).map((m) => C.clientMsg(m, users, true)), online: chat.online(room.id) });
  });
  route('POST', '/api/admin/chat/send', A, async (req, res, ctx) => {
    const { room, st } = await adminRoom(ctx.body.room);
    if (room.id.startsWith('dm-')) throw new HttpError(403, 'Admins cannot post in personal chats.');
    const text = chat.cleanText(ctx.body.text);
    if (!text) throw new HttpError(400, 'Type a message first.');
    const msg = await chat.post(room.id, { id: newId(), uid: 'admin', admin: true, name: adminName(st), text, at: Date.now() });
    const out = C.clientMsg(msg, null); chat.broadcast(room.id, 'message', out);
    send(res, 200, { ok: true });
  });
  route('POST', '/api/admin/chat/delete', A, async (req, res, ctx) => {
    const { room } = await adminRoom(ctx.body.room); const id = String(ctx.body.id || '');
    await chat.mutate(room.id, (doc) => { doc.messages = doc.messages.filter((x) => x.id !== id); });
    chat.broadcast(room.id, 'delete', { id });
    send(res, 200, { ok: true });
  });
  route('POST', '/api/admin/chat/dismiss', A, async (req, res, ctx) => {
    const { room } = await adminRoom(ctx.body.room); const id = String(ctx.body.id || '');
    await chat.mutate(room.id, (doc) => { const m = doc.messages.find((x) => x.id === id); if (m) m.reports = []; });
    send(res, 200, { ok: true });
  });
  route('POST', '/api/admin/chat/clear', A, async (req, res, ctx) => {
    const { room } = await adminRoom(ctx.body.room);
    if (ctx.body.confirm !== 'CLEAR') throw new HttpError(400, 'Type CLEAR to confirm.');
    await chat.mutate(room.id, (doc) => { doc.messages = []; });
    chat.broadcast(room.id, 'clear', {});
    send(res, 200, { ok: true });
  });
  route('POST', '/api/admin/users/:id/mute', A, async (req, res, ctx) => {
    const user = await store.get('users', ctx.params[0]);
    if (!user) throw new HttpError(404, 'Student not found.');
    user.chatMuted = bool(ctx.body.muted); await store.put('users', user);
    send(res, 200, { ok: true, muted: user.chatMuted });
  });

  /* extra rooms the admin creates (for example an announcements room that only admins can post in) */
  const readCustom = (b) => {
    const name = clean(b.name, 40);
    if (!name) throw new HttpError(400, 'Give the room a name.');
    return { name, description: clean(b.description, 90), readOnly: bool(b.readOnly) };
  };
  route('POST', '/api/admin/chat/custom', A, async (req, res, ctx) => {
    const doc = Object.assign({ id: newId() }, readCustom(ctx.body));
    if ((await store.list('chatrooms')).length >= 30) throw new HttpError(400, 'You can have up to 30 extra rooms.');
    await store.put('chatrooms', doc);
    send(res, 200, { ok: true, id: doc.id });
  });
  route('PUT', '/api/admin/chat/custom/:id', A, async (req, res, ctx) => {
    const cur = await store.get('chatrooms', ctx.params[0]);
    if (!cur) throw new HttpError(404, 'Room not found.');
    await store.put('chatrooms', Object.assign({ id: cur.id }, readCustom(ctx.body)));
    send(res, 200, { ok: true });
  });
  route('DELETE', '/api/admin/chat/custom/:id', A, async (req, res, ctx) => {
    const id = ctx.params[0];
    if (!(await store.get('chatrooms', id))) return send(res, 200, { ok: true });
    await store.del('chatrooms', id); await store.del('chat', 'custom-' + id);
    chat.broadcast('custom-' + id, 'clear', {});
    send(res, 200, { ok: true });
  });
};
