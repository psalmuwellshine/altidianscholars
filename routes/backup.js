'use strict';
/* Admin-only backup and restore. */
const H = require('../lib/helpers');
const { HttpError } = H;
const B = require('../lib/backup');

module.exports = function registerBackup({ route, store, send }) {
  const A = { admin: true };
  const stamp = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10); // Nigeria date
  const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

  async function markBackup(field) {
    const meta = (await store.get('settings', 'backupmeta')) || { id: 'backupmeta' };
    meta[field] = Date.now(); await store.put('settings', meta);
  }

  route('GET', '/api/admin/backup/status', A, async (req, res) => {
    const meta = (await store.get('settings', 'backupmeta')) || {};
    const ids = await store.listFileIds();
    const users = await store.list('users');
    send(res, 200, { dataAt: meta.dataAt || 0, filesAt: meta.filesAt || 0, files: ids.length, students: users.length, storage: store.kind });
  });

  // Everything except uploaded files, as one small file.
  route('GET', '/api/admin/backup/data', { admin: true, limit: ['backup', 20, 15 * 60 * 1000] }, async (req, res) => {
    const body = JSON.stringify(await B.collectData(store));
    await markBackup('dataAt');
    send(res, 200, body, { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="altidian-data-backup-' + stamp() + '.json"' });
  });

  // Every uploaded file (PDFs, images, profile photos) in one zip, sent a file at a time.
  route('GET', '/api/admin/backup/files', { admin: true, limit: ['backup', 20, 15 * 60 * 1000] }, async (req, res) => {
    const ids = await store.listFileIds();
    res.writeHead(200, { ...NO_STORE, 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="altidian-files-backup-' + stamp() + '.zip"' });
    const write = (buf) => new Promise((resolve, reject) => {
      if (res.destroyed || res.writableEnded) return reject(new Error('download cancelled'));
      if (res.write(buf)) return resolve();
      const fail = () => reject(new Error('download cancelled'));
      res.once('close', fail); res.once('drain', () => { res.off('close', fail); resolve(); });
    });
    const zip = B.zipWriter(write);
    try {
      await zip.add('README.txt', Buffer.from('Altidian files backup. Restore with: node scripts/restore.js <this file>\nFiles are named files/<id>.\n'));
      for (const id of ids) { const buf = await store.getFile(id); if (buf) await zip.add('files/' + id, buf); }
      await zip.finish();
      await markBackup('filesAt');
    } catch (e) { console.error('Files backup failed:', e); }
    res.end();
  });

  // Adds or replaces records from a data backup. Never deletes anything.
  route('POST', '/api/admin/backup/restore', { admin: true, limit: ['restore', 5, 15 * 60 * 1000] }, async (req, res, ctx) => {
    if (ctx.body.confirm !== 'RESTORE') throw new HttpError(400, 'Type RESTORE to confirm.');
    let result;
    try { result = await B.restoreData(store, ctx.body.backup); } catch (e) { throw new HttpError(400, e.message || 'Could not restore that file.'); }
    send(res, 200, { ok: true, total: result.total, done: result.done });
  });
};
