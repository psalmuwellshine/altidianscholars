'use strict';
/*
  Storage layer. Two backends with the same interface:
    - file     : saves to ./data (default; good for your laptop or a host with a persistent disk)
    - mongodb  : used automatically when MONGODB_URI is set (use this on free hosts,
                 because their local disk is wiped on every restart)

  Collections: materials, quizzes, scores, settings. Every document has a string `id`.
*/
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const COLLECTIONS = ['materials', 'quizzes', 'scores', 'settings', 'users', 'events', 'faculties', 'departments', 'courses', 'chat', 'chatrooms', 'push', 'timetable', 'classnotes', 'reports', 'stats', 'marks', 'groups', 'scheduled', 'transfers', 'candidates', 'payments'];
const FILE_ID = /^[a-f0-9]{16}$/;

function fileStore(dir) {
  const dbPath = path.join(dir, 'db.json');
  const filesDir = path.join(dir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });

  let db = {};
  COLLECTIONS.forEach((c) => (db[c] = []));
  try {
    db = Object.assign(db, JSON.parse(fs.readFileSync(dbPath, 'utf8')));
  } catch (e) { /* first run */ }

  let chain = Promise.resolve();
  function persist() {
    chain = chain
      .then(async () => {
        const tmp = dbPath + '.tmp';
        await fsp.writeFile(tmp, JSON.stringify(db));
        await fsp.rename(tmp, dbPath);
      })
      .catch((e) => console.error('Could not save data:', e));
    return chain;
  }

  return {
    kind: 'file',
    async list(c) { return db[c].slice(); },
    async get(c, id) { return db[c].find((d) => d.id === id) || null; },
    async put(c, doc) {
      const i = db[c].findIndex((d) => d.id === doc.id);
      if (i < 0) db[c].push(doc); else db[c][i] = doc;
      await persist();
    },
    async del(c, id) {
      db[c] = db[c].filter((d) => d.id !== id);
      await persist();
    },
    async putFile(id, buf) {
      if (!FILE_ID.test(id)) throw new Error('bad file id');
      await fsp.writeFile(path.join(filesDir, id), buf);
    },
    async getFile(id) {
      if (!FILE_ID.test(id)) return null;
      try { return await fsp.readFile(path.join(filesDir, id)); } catch (e) { return null; }
    },
    async delFile(id) {
      if (!FILE_ID.test(id)) return;
      try { await fsp.unlink(path.join(filesDir, id)); } catch (e) { /* already gone */ }
    },
    async listFileIds() { return (await fsp.readdir(filesDir)).filter((f) => FILE_ID.test(f)); },
  };
}

async function mongoStore(uri) {
  const { MongoClient, Binary } = require('mongodb');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'examwarriors');
  const toDoc = (d) => { if (!d) return null; const { _id, ...rest } = d; return { id: _id, ...rest }; };

  return {
    kind: 'mongodb',
    async list(c) { return (await db.collection(c).find({}).toArray()).map(toDoc); },
    async get(c, id) { return toDoc(await db.collection(c).findOne({ _id: id })); },
    async put(c, doc) {
      const { id, ...rest } = doc;
      await db.collection(c).replaceOne({ _id: id }, rest, { upsert: true });
    },
    async del(c, id) { await db.collection(c).deleteOne({ _id: id }); },
    async putFile(id, buf) {
      if (!FILE_ID.test(id)) throw new Error('bad file id');
      await db.collection('files').replaceOne({ _id: id }, { data: new Binary(buf) }, { upsert: true });
    },
    async getFile(id) {
      if (!FILE_ID.test(id)) return null;
      const d = await db.collection('files').findOne({ _id: id });
      return d ? Buffer.from(d.data.buffer) : null;
    },
    async delFile(id) {
      if (!FILE_ID.test(id)) return;
      await db.collection('files').deleteOne({ _id: id });
    },
    async listFileIds() { return (await db.collection('files').find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id).filter((id) => FILE_ID.test(id)); },
  };
}

/* Keeps every collection in memory after it is first read, so a page no longer waits on the database for each lookup.
   All saves still go to the database first; the memory copy is updated only after the save worked. This is right while ONE server runs
   Altidian. If you ever run two servers at once, set NO_STORE_CACHE=1 so each one always reads the database. */
function withCache(inner) {
  const cols = new Map();      // collection name -> Promise of { map } (or { skip:true } when too big to keep)
  const MAX_ONE = 40 * 1024 * 1024, MAX_ALL = 160 * 1024 * 1024; let total = 0;
  const copy = (d) => (d == null ? d : structuredClone(d));
  function ensure(c) {
    if (!cols.has(c)) {
      cols.set(c, inner.list(c).then((arr) => {
        const size = JSON.stringify(arr).length;
        if (size > MAX_ONE || total + size > MAX_ALL) { console.log('store cache: ' + c + ' is large (' + Math.round(size / 1048576) + ' MB), read from the database each time'); return { skip: true }; }
        total += size;
        const map = new Map(); arr.forEach((d) => map.set(d.id, d)); return { map };
      }).catch((e) => { cols.delete(c); throw e; }));
    }
    return cols.get(c);
  }
  return Object.assign({}, inner, {
    cached: true,
    async list(c) { const x = await ensure(c); return x.skip ? inner.list(c) : Array.from(x.map.values(), copy); },
    async get(c, id) { const x = await ensure(c); return x.skip ? inner.get(c, id) : copy(x.map.get(id) || null); },
    async put(c, doc) {
      const x = await ensure(c); await inner.put(c, doc);
      if (!x.skip) x.map.set(doc.id, copy(doc));
    },
    async del(c, id) { const x = await ensure(c); await inner.del(c, id); if (!x.skip) x.map.delete(id); },
  });
}

async function createStore() {
  if (process.env.MONGODB_URI) { const m = await mongoStore(process.env.MONGODB_URI); return process.env.NO_STORE_CACHE ? m : withCache(m); }
  const f = fileStore(process.env.DATA_DIR || path.join(__dirname, 'data'));
  return process.env.FORCE_STORE_CACHE ? withCache(f) : f; // (FORCE_STORE_CACHE is only for testing the cache on a laptop)
}

module.exports = { createStore, COLLECTIONS, withCache };
