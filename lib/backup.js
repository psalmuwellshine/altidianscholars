'use strict';
/* Backups: a data file (everything except uploaded files) and a zip of the uploaded files.
   Restoring only ever adds or replaces records. It never deletes anything. */
const zlib = require('zlib');
const { COLLECTIONS } = require('../store');

/* ---------- CRC32 (needed by the zip format) ---------- */
let TABLE = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!TABLE) { TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- data backup ---------- */
async function collectData(store) {
  const collections = {}; const counts = {};
  for (const c of COLLECTIONS) {
    try { collections[c] = await store.list(c); } catch (e) { collections[c] = []; }
    counts[c] = collections[c].length;
  }
  return { app: 'altidian-backup', version: 1, createdAt: Date.now(), storage: store.kind, counts, collections };
}

/* Adds or replaces records from a backup. Returns how many were written per collection. */
async function restoreData(store, backup) {
  if (!backup || backup.app !== 'altidian-backup' || typeof backup.collections !== 'object' || !backup.collections) throw new Error('That is not an Altidian data backup.');
  const done = {}; let total = 0;
  for (const c of COLLECTIONS) {
    const list = backup.collections[c]; if (!Array.isArray(list)) continue;
    let n = 0;
    for (const doc of list) {
      if (!doc || typeof doc !== 'object' || typeof doc.id !== 'string' || !doc.id || doc.id.length > 120) continue;
      await store.put(c, doc); n++;
    }
    done[c] = n; total += n;
  }
  return { done, total };
}

/* ---------- zip writer: stores each file as it is, one at a time, so memory stays small ---------- */
function dosTime(d) { return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
function zipWriter(write) {
  const central = []; let offset = 0; const now = dosTime(new Date());
  const out = async (buf) => { await write(buf); offset += buf.length; };
  return {
    async add(name, data) {
      const nameBuf = Buffer.from(name, 'utf8'); const crc = crc32(data); const start = offset;
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
      lh.writeUInt16LE(now.time, 10); lh.writeUInt16LE(now.date, 12); lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
      await out(lh); await out(nameBuf); await out(data);
      central.push({ nameBuf, crc, size: data.length, start });
    },
    async finish() {
      const cdStart = offset;
      for (const e of central) {
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
        ch.writeUInt16LE(now.time, 12); ch.writeUInt16LE(now.date, 14); ch.writeUInt32LE(e.crc, 16);
        ch.writeUInt32LE(e.size, 20); ch.writeUInt32LE(e.size, 24); ch.writeUInt16LE(e.nameBuf.length, 28);
        ch.writeUInt32LE(e.start, 42);
        await out(ch); await out(e.nameBuf);
      }
      const cdSize = offset - cdStart; const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
      end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(cdStart, 16);
      await out(end);
    },
  };
}

/* ---------- zip reader (for restoring files): handles stored and deflated entries ---------- */
function readZip(buf) {
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a valid zip file.');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The zip file is damaged.');
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20); const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32); const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    entries.push({ name, data: () => { const raw = buf.slice(dataStart, dataStart + csize); return method === 0 ? raw : zlib.inflateRawSync(raw); } });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

const FILE_NAME = /^files\/([a-f0-9]{16})$/;
async function restoreFiles(store, zipBuf) {
  let n = 0;
  for (const e of readZip(zipBuf)) { const m = FILE_NAME.exec(e.name); if (!m) continue; await store.putFile(m[1], e.data()); n++; }
  return n;
}

module.exports = { collectData, restoreData, zipWriter, readZip, restoreFiles, crc32 };
