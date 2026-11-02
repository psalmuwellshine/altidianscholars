#!/usr/bin/env node
'use strict';
/* Restore from a backup, from your own computer.
     node scripts/restore.js altidian-data-backup-2026-11-01.json     (students, resources, quizzes, settings...)
     node scripts/restore.js altidian-files-backup-2026-11-01.zip     (uploaded PDFs, images, profile photos)
   It writes to the database named by MONGODB_URI (and MONGODB_DB), or to ./data when MONGODB_URI is not set.
   It only adds or replaces records. It never deletes anything. */
const fs = require('fs');
const path = require('path');
const { createStore } = require('../store');
const B = require('../lib/backup');

(async () => {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) { console.error('Usage: node scripts/restore.js <backup .json or .zip file>'); process.exit(1); }
  const store = await createStore();
  console.log('Restoring into:', store.kind === 'mongodb' ? 'MongoDB' : 'local data folder');
  const buf = fs.readFileSync(file);
  if (path.extname(file).toLowerCase() === '.zip') {
    console.log('Restored', await B.restoreFiles(store, buf), 'files.');
  } else {
    const r = await B.restoreData(store, JSON.parse(buf.toString('utf8')));
    console.log('Restored', r.total, 'records:', JSON.stringify(r.done));
  }
  process.exit(0);
})().catch((e) => { console.error('Restore failed:', e.message); process.exit(1); });
