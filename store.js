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

const COLLECTIONS = ['materials', 'quizzes', 'scores', 'settings', 'users', 'events', 'faculties', 'departments', 'courses', 'chat', 'chatrooms', 'push', 'timetable', 'classnotes', 'reports', 'stats', 'marks', 'groups', 'scheduled', 'transfers'];
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
  };
}

async function createStore() {
  if (process.env.MONGODB_URI) return mongoStore(process.env.MONGODB_URI);
  return fileStore(process.env.DATA_DIR || path.join(__dirname, 'data'));
}

module.exports = { createStore };
