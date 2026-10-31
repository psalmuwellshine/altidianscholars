'use strict';
/* Chat room API for students (live, with Server-Sent Events) and for admins (moderation). */
const H = require('../lib/helpers');
const D = require('../lib/domain');
const Ac = require('../lib/academics');
const C = require('../lib/chat');

const { HttpError, clean, newId, bool } = H;

module.exports = function registerChat({ route, store, send, userOf }) {
  const chat = C.createChat(store);

  const state = async () => {
    const [config, acad, customs] = await Promise.all([D.loadConfig(store), Ac.loadAcademics(store), store.list('chatrooms')]);
    return { config, acad, customs: customs.sort((a, b) => String(a.name).localeCompare(String(b.name))) };
  };
  const usersMap = async () => new Map((await store.list('users')).map((u) => [u.id, u]));

  // Loads the signed-in student and checks they may use this room.
  async function gate(req, roomId) {
    const user = await userOf(req);
    if (!user) throw new HttpError(401, 'Please log in to chat.');
    const st = await state();
    if (!st.config.chatEnabled) throw new HttpError(403, 'Chat is switched off right now.');
    if (roomId === undefined) return { user, st };
    if (!C.ROOM_RE.test(String(roomId))) throw new HttpError(404, 'That room does not exist.');
    const room = C.roomsFor(user, st.acad, st.customs).find((r) => r.id === roomId);
    if (!room) throw new HttpError(403, 'You do not have access to that room.');
    return { user, st, room };
  }

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
    send(res, 200, { rooms: out, muted: !!user.chatMuted, me: user.id });
  });

  route('GET', '/api/chat/messages', { limit: ['chatread', 1500, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, room } = await gate(req, ctx.query.get('room'));
    const after = Number(ctx.query.get('after')) || 0;
    let msgs = await chat.read(room.id);
    msgs = after ? msgs.filter((m) => m.at > after).slice(0, 100) : msgs.slice(-80);
    const users = await usersMap();
    send(res, 200, {
      room, messages: msgs.map((m) => C.clientMsg(m, users)), online: chat.online(room.id),
      canPost: !user.chatMuted && !room.readOnly, muted: !!user.chatMuted, me: user.id,
    });
  });

  route('POST', '/api/chat/send', { limit: ['chatsend', 600, 10 * 60 * 1000] }, async (req, res, ctx) => {
    const { user, room } = await gate(req, ctx.body.room);
    if (user.chatMuted) throw new HttpError(403, 'An admin has muted you in chat.');
    if (room.readOnly) throw new HttpError(403, 'Only admins can post in this room.');
    const text = chat.cleanText(ctx.body.text);
    if (!text) throw new HttpError(400, 'Type a message first.');
    chat.checkRate(user.id, text);
    const msg = await chat.post(room.id, { id: newId(), uid: user.id, text, at: Date.now() });
    const out = C.clientMsg(msg, new Map([[user.id, user]]));
    chat.broadcast(room.id, 'message', out);
    send(res, 200, { ok: true, message: out });
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
    send(res, 200, { rooms: out, muted: (await store.list('users')).filter((u) => u.chatMuted).map((u) => ({ id: u.id, username: u.username })) });
  });
  const adminRoom = async (id) => {
    if (!C.ROOM_RE.test(String(id))) throw new HttpError(404, 'That room does not exist.');
    const st = await state();
    const room = C.allRooms(st.acad, st.customs).find((r) => r.id === id);
    if (!room) throw new HttpError(404, 'That room does not exist.');
    return { room, st };
  };
  route('GET', '/api/admin/chat/messages', A, async (req, res, ctx) => {
    const { room } = await adminRoom(ctx.query.get('room'));
    const users = await usersMap();
    send(res, 200, { room, messages: (await chat.read(room.id)).slice(-150).map((m) => Object.assign(C.clientMsg(m, users, true), { matric: (users.get(m.uid) || {}).matric || '' })), online: chat.online(room.id) });
  });
  route('POST', '/api/admin/chat/send', A, async (req, res, ctx) => {
    const { room, st } = await adminRoom(ctx.body.room);
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
