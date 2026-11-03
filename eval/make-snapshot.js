#!/usr/bin/env node
'use strict';

// Create the canonical eval snapshot: a consistent copy of the live DB (VACUUM INTO, a read of
// the source) at eval/snapshots/eval.db, then optionally embed every transaction in the COPY.
// The live database is only ever read. The snapshot is git-ignored (it contains password hashes).
//
//   node --experimental-sqlite eval/make-snapshot.js [--embed] [--force]

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { REAL_DB } = require('./lib/guard');

const SNAP = path.resolve(__dirname, 'snapshots', 'eval.db');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);

(async () => {
  if (!fs.existsSync(SNAP) || flag('--force')) {
    if (!fs.existsSync(REAL_DB)) throw new Error(`live database not found at ${REAL_DB}`);
    fs.mkdirSync(path.dirname(SNAP), { recursive: true });
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(SNAP + ext, { force: true });
    const src = new DatabaseSync(REAL_DB, { readOnly: true });
    src.exec(`VACUUM INTO '${SNAP.replace(/\\/g, '/').replace(/'/g, "''")}'`);
    src.close();
    console.log(`snapshot written: ${SNAP}`);
  } else {
    console.log(`snapshot already exists (use --force to rebuild): ${SNAP}`);
  }

  if (flag('--embed')) {
    // from here on everything goes through src/, so point it at the COPY first
    process.env.DB_PATH = SNAP;
    process.env.EMBED_ENABLED = 'true';
    const { assertSnapshotPath } = require('./lib/guard');
    assertSnapshotPath(process.env.DB_PATH);
    const { db } = require('../src/db');
    const embed = require('../src/embed');
    const users = db.prepare('SELECT id, email FROM users ORDER BY id').all();
    for (const u of users) {
      let rounds = 0;
      for (;;) {
        const r = await embed.reindexUser(u.id);
        rounds++;
        if (r.remaining <= 0) { console.log(`user ${u.id} (${u.email}): ${r.total} rows, all embedded (${rounds} round${rounds > 1 ? 's' : ''}, model ${r.model})`); break; }
      }
    }
  }

  const s = new DatabaseSync(SNAP, { readOnly: true });
  console.log(JSON.stringify(s.prepare(
    `SELECT u.id, u.email,
       (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) transactions,
       (SELECT COUNT(*) FROM tx_embed e JOIN transactions t ON t.id = e.transaction_id WHERE t.user_id = u.id) embedded
     FROM users u ORDER BY u.id`).all()));
})().catch((e) => { console.error(e.message); process.exit(1); });
